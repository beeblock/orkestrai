import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';

type ReadonlySqliteDatabase = {
  prepare(sql: string): { all(...params: unknown[]): unknown[] };
  close(): void;
};

const require = createRequire(import.meta.url);

function openReadonlySqlite(path: string): ReadonlySqliteDatabase {
  try {
    const BetterSqlite = require('better-sqlite3') as new (
      filename: string,
      options: { readonly: boolean; fileMustExist: boolean }
    ) => ReadonlySqliteDatabase;
    return new BetterSqlite(path, { readonly: true, fileMustExist: true });
  } catch {
    // Tests may run against a different ABI than the Electron-native module.
    const { DatabaseSync } = require('node:sqlite') as {
      DatabaseSync: new (filename: string, options: { readOnly: boolean }) => ReadonlySqliteDatabase;
    };
    return new DatabaseSync(path, { readOnly: true });
  }
}

export type AgentSessionStorage =
  | 'claude-project-jsonl'
  | 'codex-rollout-jsonl'
  | 'kimi-session-dir'
  | 'opencode-session-json'
  | 'cursor-transcript-jsonl'
  | 'antigravity-workspace-cache'
  | 'cline-session-manifest'
  | 'devin-session-db';

/**
 * Rastreia o session-id REAL que cada CLI de agente grava em disco.
 * Assim o terminal retoma a sessao exata (nao so "a mais recente do diretorio").
 *
 * Estrategia declarada pelo adapter: observar o diretorio de sessoes da CLI e pegar o
 * arquivo/pasta criado DEPOIS do spawn do terminal.
 */
export class AgentSessionTracker {
  private watchers = new Map<string, ReturnType<typeof setInterval>>();
  private sessionsByPty = new Map<string, string>();
  /** Ids ja atribuidos a algum terminal — dois agentes no mesmo diretorio
      nao podem receber o mesmo session-id. */
  private claimed = new Set<string>();
  private readonly homeDir: string;
  private readonly cwdNormalizer: ((cwd: string) => string) | null;

  constructor(homeDir = homedir(), cwdNormalizer: ((cwd: string) => string) | null = null) {
    this.homeDir = homeDir;
    this.cwdNormalizer = cwdNormalizer;
  }

  /** Marca um id como reivindicado (watch ou lookup de respawn). */
  claim(agentSessionId: string): void {
    this.claimed.add(agentSessionId);
  }

  bind(ptySessionId: string, agentSessionId: string): void {
    this.sessionsByPty.set(ptySessionId, agentSessionId);
    this.claim(agentSessionId);
  }

  agentSessionIdForPty(ptySessionId: string): string | null {
    return this.sessionsByPty.get(ptySessionId) ?? null;
  }

  forget(ptySessionId: string): void {
    this.unwatch(ptySessionId);
    this.sessionsByPty.delete(ptySessionId);
  }

  /** Busca o session-id mais ANTIGO nao reivindicado criado apos `since`
      (o primeiro arquivo que aparece depois do meu spawn tende a ser o meu). */
  findAgentSessionId(storage: string | undefined, cwd: string, since: number, exclude?: Set<string>): string | null {
    return this.findByStrategy(storage, cwd, since, exclude ?? this.claimed, 'oldest');
  }

  /** Sessao mais recente do workspace sem considerar reivindicacoes de outros
      terminais. Usada apenas para reparar metadata persistida; o chamador ainda
      precisa confirmar o turno exato antes de aceitar a sessao. */
  findLatestAgentSessionId(storage: string | undefined, cwd: string, exclude = new Set<string>()): string | null {
    return this.findByStrategy(storage, cwd, 0, exclude, 'newest');
  }

  /**
   * Confirma se um id conhecido ja existe no armazenamento do provider e pode
   * ser retomado. `null` significa que o formato ainda nao oferece validacao
   * exata; nesse caso o chamador preserva o comportamento anterior.
   */
  isAgentSessionResumable(storage: string | undefined, cwd: string, agentSessionId: string): boolean | null {
    if (storage !== 'claude-project-jsonl') return null;
    try {
      const slug = this.realCwd(cwd).replace(/[^a-zA-Z0-9]/g, '-');
      const transcript = join(this.homeDir, '.claude', 'projects', slug, `${agentSessionId}.jsonl`);
      if (!existsSync(transcript)) return false;
      const stat = statSync(transcript);
      return stat.isFile() && this.isResumableClaudeTranscript(transcript, agentSessionId, stat.size);
    } catch {
      return false;
    }
  }

  private findByStrategy(
    storage: string | undefined,
    cwd: string,
    since: number,
    exclude: Set<string>,
    strategy: 'oldest' | 'newest'
  ): string | null {
    try {
      switch (storage) {
        case 'claude-project-jsonl':
          return this.findClaudeSession(cwd, since, exclude, strategy);
        case 'codex-rollout-jsonl':
          return this.findCodexSession(cwd, since, exclude, strategy);
        case 'kimi-session-dir':
          return this.findKimiSession(cwd, since, exclude, strategy);
        case 'opencode-session-json':
          return this.findOpenCodeSession(cwd, since, exclude, strategy);
        case 'cursor-transcript-jsonl':
          return this.findCursorSession(cwd, since, exclude, strategy);
        case 'antigravity-workspace-cache':
          return this.findAntigravitySession(cwd, since, exclude);
        case 'cline-session-manifest':
          return this.findClineSession(cwd, since, exclude, strategy);
        case 'devin-session-db':
          return this.findDevinSession(cwd, since, exclude, strategy);
        default:
          return null;
      }
    } catch {
      return null;
    }
  }

  /**
   * Observa a sessao PTY e chama onFound com o session-id da CLI quando
   * descoberto. Para de observar ao encontrar ou apos `timeoutMs`.
   */
  watch(
    ptySessionId: string,
    storage: string | undefined,
    cwd: string,
    startedAt: number,
    onFound: (agentSessionId: string) => void,
    timeoutMs = 1_800_000
  ): void {
    this.unwatch(ptySessionId);
    const started = Date.now();
    const timer = setInterval(() => {
      const found = this.findAgentSessionId(storage, cwd, startedAt);
      if (found) {
        this.unwatch(ptySessionId);
        this.bind(ptySessionId, found);
        onFound(found);
        return;
      }
      if (Date.now() - started > timeoutMs) {
        this.unwatch(ptySessionId);
      }
    }, 3_000);
    timer.unref?.();
    this.watchers.set(ptySessionId, timer);
  }

  /**
   * Observa um id reservado pelo proprio provider (Claude --session-id). O id
   * so e publicado depois que a CLI gravar uma entrada real da conversa; um
   * arquivo vazio/snapshot nao pode ser usado com --resume no proximo boot.
   */
  watchExpected(
    ptySessionId: string,
    storage: string | undefined,
    cwd: string,
    agentSessionId: string,
    onFound: (agentSessionId: string) => void,
    timeoutMs = 1_800_000
  ): boolean {
    if (storage !== 'claude-project-jsonl') return false;
    this.unwatch(ptySessionId);
    const started = Date.now();
    const inspect = () => {
      if (this.isAgentSessionResumable(storage, cwd, agentSessionId)) {
        this.unwatch(ptySessionId);
        this.bind(ptySessionId, agentSessionId);
        onFound(agentSessionId);
        return;
      }
      if (Date.now() - started > timeoutMs) this.unwatch(ptySessionId);
    };
    const timer = setInterval(inspect, 3_000);
    timer.unref?.();
    this.watchers.set(ptySessionId, timer);
    inspect();
    return true;
  }

  unwatch(ptySessionId: string): void {
    const timer = this.watchers.get(ptySessionId);
    if (timer) clearInterval(timer);
    this.watchers.delete(ptySessionId);
  }

  /** Caminho real do cwd (resolve symlinks como /tmp -> /private/tmp no macOS). */
  private realCwd(cwd: string): string {
    if (this.cwdNormalizer) return this.cwdNormalizer(cwd);
    try {
      return realpathSync(cwd);
    } catch {
      return resolve(cwd);
    }
  }

  // ~/.claude/projects/<slug>/<sessionId>.jsonl — o claude troca TODO caractere
  // nao-alfanumerico por '-' (C:\a.b_c -> C--a-b-c no Windows; /Users/x ->
  // -Users-x no macOS). So ':' '/' '\' nao basta: cobre '.', '_', espaco etc.
  private findClaudeSession(cwd: string, since: number, exclude: Set<string>, strategy: 'oldest' | 'newest'): string | null {
    const slug = this.realCwd(cwd).replace(/[^a-zA-Z0-9]/g, '-');
    const dir = join(this.homeDir, '.claude', 'projects', slug);
    const pick = strategy === 'oldest' ? this.oldestFile : this.newestFile;
    const found = pick.call(this, dir, since, (name) => {
      const agentSessionId = name.replace(/\.jsonl$/, '');
      if (!name.endsWith('.jsonl') || name.startsWith('agent-') || exclude.has(agentSessionId)) return false;

      // Claude cria arquivos agent-* para subagentes e transcripts que contem
      // apenas snapshots durante o startup. So uma entrada da conversa
      // principal torna o novo session-id retomavel.
      try {
        const stat = statSync(join(dir, name));
        return stat.isFile() && this.isResumableClaudeTranscript(join(dir, name), agentSessionId, stat.size);
      } catch {
        return false;
      }
    });
    return found ? found.replace(/\.jsonl$/, '') : null;
  }

  private isResumableClaudeTranscript(path: string, agentSessionId: string, size: number): boolean {
    if (size <= 0) return false;
    const fd = openSync(path, 'r');
    try {
      const buffer = Buffer.allocUnsafe(Math.min(size, 256 * 1024));
      const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
      const sessionMarker = `\"sessionId\":\"${agentSessionId}\"`;
      return buffer
        .toString('utf8', 0, bytesRead)
        .split('\n')
        .some(
          (line) =>
            line.includes(sessionMarker) &&
            line.includes('\"isSidechain\":false') &&
            (line.includes('\"type\":\"user\"') || line.includes('\"type\":\"assistant\"'))
        );
    } finally {
      closeSync(fd);
    }
  }

  // ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl
  private findCodexSession(cwd: string, since: number, exclude: Set<string>, strategy: 'oldest' | 'newest'): string | null {
    const root = join(this.homeDir, '.codex', 'sessions');
    const targetCwd = this.realCwd(cwd);
    const uuidOf = (name: string) =>
      name.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/)?.[1] ?? null;
    const pick = strategy === 'oldest' ? this.oldestFileRecursive : this.newestFileRecursive;
    const found = pick.call(
      this,
      root,
      since,
      (name: string, path: string) => {
        if (!name.startsWith('rollout-') || !name.endsWith('.jsonl')) return false;
        const id = uuidOf(name);
        return id !== null && !exclude.has(id) && this.codexTranscriptMatchesCwd(path, targetCwd);
      },
      4
    );
    return found ? uuidOf(found) : null;
  }

  /** O Codex guarda todas as sessoes numa arvore global. O session_meta do
      rollout e a unica forma segura de nao vincular um terminal ao transcript
      de outro workspace que esteja sendo usado ao mesmo tempo. */
  private codexTranscriptMatchesCwd(path: string, targetCwd: string): boolean {
    const fd = openSync(path, 'r');
    try {
      const buffer = Buffer.allocUnsafe(512 * 1024);
      const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
      const firstLine = buffer.toString('utf8', 0, bytesRead).split('\n', 1)[0] ?? '';
      if (!firstLine) return false;
      const entry = JSON.parse(firstLine) as { type?: unknown; payload?: { cwd?: unknown } };
      return entry.type === 'session_meta' &&
        typeof entry.payload?.cwd === 'string' &&
        this.realCwd(entry.payload.cwd) === targetCwd;
    } catch {
      return false;
    } finally {
      closeSync(fd);
    }
  }

  // ~/.kimi-code/sessions/<wd_*>/session_<uuid>/
  private findKimiSession(cwd: string, since: number, exclude: Set<string>, strategy: 'oldest' | 'newest'): string | null {
    const root = join(this.homeDir, '.kimi-code', 'sessions');
    if (!existsSync(root)) return null;
    const realCwd = this.realCwd(cwd);
    const dirName = realCwd.split(/[/\\]/).filter(Boolean).at(-1) ?? '';
    const workspaceHash = createHash('sha256').update(realCwd).digest('hex').slice(0, 12);
    const candidate = join(root, `wd_${dirName}_${workspaceHash}`);
    if (!existsSync(candidate)) return null;
    const pick = strategy === 'oldest' ? this.oldestDir : this.newestDir;
    return pick.call(this, candidate, since, (name: string) => name.startsWith('session_') && !exclude.has(name));
  }

  // OpenCode atual: ~/.local/share/opencode/opencode.db. Versoes anteriores
  // persistiam JSON em storage/session/<project-id>/<session-id>.json.
  private findOpenCodeSession(cwd: string, since: number, exclude: Set<string>, strategy: 'oldest' | 'newest'): string | null {
    const roots = [
      process.env.XDG_DATA_HOME ? join(process.env.XDG_DATA_HOME, 'opencode') : '',
      join(this.homeDir, '.local', 'share', 'opencode'),
      process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'opencode') : '',
      process.env.APPDATA ? join(process.env.APPDATA, 'opencode') : '',
    ].filter((path, index, paths) => Boolean(path) && paths.indexOf(path) === index);
    const targetCwd = this.realCwd(cwd);
    const fallbackCwd = resolve(cwd);
    const direction = strategy === 'oldest' ? 'ASC' : 'DESC';

    for (const root of roots) {
      const databasePath = join(root, 'opencode.db');
      if (!existsSync(databasePath)) continue;
      let database: ReadonlySqliteDatabase | null = null;
      try {
        database = openReadonlySqlite(databasePath);
        const rows = database.prepare(
          `SELECT s.id,
                  MAX(COALESCE(m.time_updated, m.time_created, s.time_updated, s.time_created, 0)) AS activity
             FROM session s
             LEFT JOIN message m ON m.session_id = s.id
            WHERE s.directory IN (?, ?)
            GROUP BY s.id
           HAVING activity >= ?
            ORDER BY activity ${direction}, s.id ${direction}`
        ).all(targetCwd, fallbackCwd, since) as Array<{ id?: unknown }>;
        const found = rows.find((row) => typeof row.id === 'string' && row.id.trim() && !exclude.has(row.id));
        if (found && typeof found.id === 'string') return found.id;
      } catch {
        // Banco em migracao, ocupado ou de uma versao com outro schema.
      } finally {
        database?.close();
      }
    }

    const idOf = (name: string) =>
      name.match(/(ses_[A-Za-z0-9]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/)?.[1] ?? null;
    const pick = strategy === 'oldest' ? this.oldestFileRecursive : this.newestFileRecursive;
    for (const root of roots) {
      if (!existsSync(root)) continue;
      const found = pick.call(
        this,
        root,
        since,
        (name: string, path: string) => {
          if (!name.endsWith('.json') || !name.includes('ses')) return false;
          const id = idOf(name);
          if (!id || exclude.has(id)) return false;
          try {
            const payload = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
            const directory = typeof payload.directory === 'string' ? payload.directory : null;
            return directory !== null && this.realCwd(directory) === targetCwd;
          } catch {
            return false;
          }
        },
        6
      );
      if (found) return idOf(found);
    }
    return null;
  }

  // ~/.cursor/projects/<workspace-slug>/agent-transcripts/<session-id>/<session-id>.jsonl
  private findCursorSession(cwd: string, since: number, exclude: Set<string>, strategy: 'oldest' | 'newest'): string | null {
    const workspaceSlug = this.realCwd(cwd)
      .replace(/^[\\/]+/, '')
      .replace(/[^a-zA-Z0-9]/g, '-');
    const projectsRoot = join(this.homeDir, '.cursor', 'projects');
    const roots = [
      join(projectsRoot, workspaceSlug, 'agent-transcripts'),
      join(projectsRoot, `-${workspaceSlug}`, 'agent-transcripts'),
    ].filter((path, index, paths) => paths.indexOf(path) === index && existsSync(path));
    const pick = strategy === 'oldest' ? this.oldestFileRecursive : this.newestFileRecursive;

    for (const root of roots) {
      const found = pick.call(
        this,
        root,
        since,
        (name: string) => {
          const id = name.replace(/\.jsonl$/, '');
          return name.endsWith('.jsonl') && !exclude.has(id);
        },
        2
      );
      if (found) return basename(found).replace(/\.jsonl$/, '');
    }
    return null;
  }

  // ~/.gemini/antigravity-cli/cache/last_conversations.json — mapa cwd -> UUID.
  private findAntigravitySession(cwd: string, since: number, exclude: Set<string>): string | null {
    const cachePath = join(this.homeDir, '.gemini', 'antigravity-cli', 'cache', 'last_conversations.json');
    if (!existsSync(cachePath) || statSync(cachePath).mtimeMs <= since) return null;
    const cache = JSON.parse(readFileSync(cachePath, 'utf8')) as Record<string, unknown>;
    const candidates = [this.realCwd(cwd), resolve(cwd)];
    for (const workspacePath of candidates) {
      const id = cache[workspacePath];
      if (typeof id === 'string' && id.trim() && !exclude.has(id)) return id;
    }
    return null;
  }

  // ~/.cline/data/sessions/<session-id>/<session-id>.json — manifesto com cwd.
  private findClineSession(cwd: string, since: number, exclude: Set<string>, strategy: 'oldest' | 'newest'): string | null {
    const root = join(this.homeDir, '.cline', 'data', 'sessions');
    if (!existsSync(root)) return null;
    const targetCwd = this.realCwd(cwd);
    const candidates: Array<{ id: string; mtime: number }> = [];

    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || exclude.has(entry.name)) continue;
      const manifestPath = join(root, entry.name, `${entry.name}.json`);
      if (!existsSync(manifestPath)) continue;
      try {
        const stat = statSync(manifestPath);
        if (stat.mtimeMs <= since) continue;
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
        const id = typeof manifest.session_id === 'string' ? manifest.session_id : entry.name;
        const workspacePath =
          typeof manifest.cwd === 'string'
            ? manifest.cwd
            : typeof manifest.workspace_root === 'string'
              ? manifest.workspace_root
              : null;
        if (!workspacePath || this.realCwd(workspacePath) !== targetCwd || exclude.has(id)) continue;
        candidates.push({ id, mtime: stat.mtimeMs });
      } catch {
        // Manifesto ainda esta sendo gravado ou pertence a outra versao.
      }
    }

    candidates.sort((a, b) => (strategy === 'oldest' ? a.mtime - b.mtime : b.mtime - a.mtime));
    return candidates[0]?.id ?? null;
  }

  // Devin mantem as sessoes em um SQLite proprio. A leitura e estritamente
  // read-only e filtra pelo cwd real, evitando cruzar agentes concorrentes.
  private findDevinSession(cwd: string, since: number, exclude: Set<string>, strategy: 'oldest' | 'newest'): string | null {
    const candidates = [
      process.env.XDG_DATA_HOME ? join(process.env.XDG_DATA_HOME, 'devin', 'cli', 'sessions.db') : '',
      join(this.homeDir, '.local', 'share', 'devin', 'cli', 'sessions.db'),
      process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'devin', 'cli', 'sessions.db') : '',
      join(this.homeDir, 'AppData', 'Local', 'devin', 'cli', 'sessions.db'),
    ].filter((path, index, paths) => Boolean(path) && paths.indexOf(path) === index && existsSync(path));
    const targetCwd = this.realCwd(cwd);
    const fallbackCwd = resolve(cwd);
    const direction = strategy === 'oldest' ? 'ASC' : 'DESC';

    for (const path of candidates) {
      let database: ReadonlySqliteDatabase | null = null;
      try {
        database = openReadonlySqlite(path);
        const rows = database.prepare(
          `SELECT id FROM sessions
           WHERE hidden = 0
             AND working_directory IN (?, ?)
             AND created_at >= ?
           ORDER BY created_at ${direction}, rowid ${direction}`
        ).all(targetCwd, fallbackCwd, Math.floor(since / 1_000)) as Array<{ id?: unknown }>;
        const found = rows.find((row) => typeof row.id === 'string' && row.id.trim() && !exclude.has(row.id));
        if (found && typeof found.id === 'string') return found.id;
      } catch {
        // Banco ainda nao existe, esta migrando ou pertence a outra versao.
      } finally {
        database?.close();
      }
    }
    return null;
  }

  private oldestFile(dir: string, since: number, match: (name: string) => boolean): string | null {
    if (!existsSync(dir)) return null;
    let best: { name: string; mtime: number } | null = null;
    for (const entry of readdirSync(dir)) {
      if (!match(entry)) continue;
      const mtime = statSync(join(dir, entry)).mtimeMs;
      if (mtime > since && (!best || mtime < best.mtime)) best = { name: entry, mtime };
    }
    return best?.name ?? null;
  }

  private oldestDir(dir: string, since: number, match: (name: string) => boolean): string | null {
    if (!existsSync(dir)) return null;
    let best: { name: string; mtime: number } | null = null;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !match(entry.name)) continue;
      const mtime = statSync(join(dir, entry.name)).mtimeMs;
      if (mtime > since && (!best || mtime < best.mtime)) best = { name: entry.name, mtime };
    }
    return best?.name ?? null;
  }

  private oldestFileRecursive(dir: string, since: number, match: (name: string, path: string) => boolean, maxDepth: number): string | null {
    if (!existsSync(dir)) return null;
    let best: { path: string; mtime: number } | null = null;
    const walk = (current: string, depth: number) => {
      if (depth > maxDepth) return;
      let entries;
      try {
        entries = readdirSync(current, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = join(current, entry.name);
        if (entry.isDirectory()) {
          walk(full, depth + 1);
        } else if (match(entry.name, full)) {
          try {
            const mtime = statSync(full).mtimeMs;
            if (mtime > since && (!best || mtime < best.mtime)) best = { path: full, mtime };
          } catch {
            // some durante a varredura
          }
        }
      }
    };
    walk(dir, 0);
    const result = best as { path: string; mtime: number } | null;
    return result?.path ?? null;
  }

  private newestFile(dir: string, since: number, match: (name: string) => boolean): string | null {
    if (!existsSync(dir)) return null;
    let best: { name: string; mtime: number } | null = null;
    for (const entry of readdirSync(dir)) {
      if (!match(entry)) continue;
      const mtime = statSync(join(dir, entry)).mtimeMs;
      if (mtime > since && (!best || mtime > best.mtime)) best = { name: entry, mtime };
    }
    return best?.name ?? null;
  }

  private newestDir(dir: string, since: number, match: (name: string) => boolean): string | null {
    if (!existsSync(dir)) return null;
    let best: { name: string; mtime: number } | null = null;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !match(entry.name)) continue;
      const mtime = statSync(join(dir, entry.name)).mtimeMs;
      if (mtime > since && (!best || mtime > best.mtime)) best = { name: entry.name, mtime };
    }
    return best?.name ?? null;
  }

  private newestFileRecursive(dir: string, since: number, match: (name: string, path: string) => boolean, maxDepth: number): string | null {
    if (!existsSync(dir)) return null;
    let best: { path: string; mtime: number } | null = null;
    const walk = (current: string, depth: number) => {
      if (depth > maxDepth) return;
      let entries;
      try {
        entries = readdirSync(current, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = join(current, entry.name);
        if (entry.isDirectory()) {
          walk(full, depth + 1);
        } else if (match(entry.name, full)) {
          try {
            const mtime = statSync(full).mtimeMs;
            if (mtime > since && (!best || mtime > best.mtime)) best = { path: full, mtime };
          } catch {
            // some durante a varredura
          }
        }
      }
    };
    walk(dir, 0);
    const result = best as { path: string; mtime: number } | null;
    return result?.path ?? null;
  }
}

const trackerGlobal = globalThis as typeof globalThis & {
  __orkestraiAgentSessionTracker?: AgentSessionTracker;
  __orkestraiRuntimeSessionTrackers?: Map<string, AgentSessionTracker>;
};

export const agentSessionTracker = trackerGlobal.__orkestraiAgentSessionTracker ??= new AgentSessionTracker();

export function agentSessionTrackerForRuntime(key: string, homeDir: string, normalizeCwd: (cwd: string) => string): AgentSessionTracker {
  const trackers = trackerGlobal.__orkestraiRuntimeSessionTrackers ??= new Map();
  const existing = trackers.get(key);
  if (existing) return existing;
  const tracker = new AgentSessionTracker(homeDir, normalizeCwd);
  trackers.set(key, tracker);
  return tracker;
}
