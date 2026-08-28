import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AgentSessionTracker } from '$lib/modules/agent-room/infrastructure/pty/AgentSessionTracker.js';
import { claudeAdapter } from '$lib/modules/agent-room/application/adapters/ClaudeAdapter.js';
import { codexAdapter } from '$lib/modules/agent-room/application/adapters/CodexAdapter.js';
import { kimiAdapter } from '$lib/modules/agent-room/application/adapters/KimiAdapter.js';
import { openCodeAdapter } from '$lib/modules/agent-room/application/adapters/OpenCodeAdapter.js';
import { cursorAdapter } from '$lib/modules/agent-room/application/adapters/CursorAdapter.js';
import { antigravityAdapter } from '$lib/modules/agent-room/application/adapters/AntigravityAdapter.js';
import { clineAdapter } from '$lib/modules/agent-room/application/adapters/ClineAdapter.js';
import { devinAdapter } from '$lib/modules/agent-room/application/adapters/DevinAdapter.js';

const temporaryHomes: string[] = [];

afterEach(() => {
  for (const home of temporaryHomes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function isolatedTracker() {
  const home = mkdtempSync(join(tmpdir(), 'orkestrai-session-tracker-'));
  temporaryHomes.push(home);
  return { home, tracker: new AgentSessionTracker(home) };
}

function touch(path: string, when: Date) {
  const sessionId = path.split('/').at(-1)?.replace(/\.jsonl$/, '') ?? '';
  writeFileSync(path, `${JSON.stringify({ isSidechain: false, sessionId, type: 'user' })}\n`);
  utimesSync(path, when, when);
}

describe('AgentSessionTracker', () => {
  it('mantem o session id real vinculado ao PTY ativo', () => {
    const { tracker } = isolatedTracker();
    tracker.bind('pty-1', 'provider-session-1');
    expect(tracker.agentSessionIdForPty('pty-1')).toBe('provider-session-1');
    tracker.forget('pty-1');
    expect(tracker.agentSessionIdForPty('pty-1')).toBeNull();
  });

  it('encontra sessao do claude pelo jsonl mais novo apos o spawn', () => {
    const since = Date.now() - 60_000;
    const cwd = join(tmpdir(), 'meu-projeto');
    const { home, tracker } = isolatedTracker();

    // Simula a estrutura real: ~/.claude/projects/-tmp-meu-projeto/
    const claudeDir = join(home, '.claude', 'projects', `-${cwd.replace(/[/\\]/g, '-').replace(/^-/, '')}`);
    mkdirSync(claudeDir, { recursive: true });
    const sessionFile = join(claudeDir, 'abc-123-session.jsonl');
    touch(sessionFile, new Date());
    const older = join(claudeDir, 'old-session.jsonl');
    touch(older, new Date(Date.now() - 3_600_000));

    const found = tracker.findAgentSessionId(claudeAdapter.sessionStorage, cwd, since);
    expect(found).toBe('abc-123-session');
  });

  it('retorna null quando nao ha sessao nova', () => {
    const { tracker } = isolatedTracker();
    expect(tracker.findAgentSessionId(claudeAdapter.sessionStorage, join(tmpdir(), 'nao-existe-' + Date.now()), Date.now())).toBeNull();
  });

  it('atribui ids distintos a agentes no mesmo diretorio (mais antigo nao reivindicado)', () => {
    const since = Date.now() - 60_000;
    const cwd = join(tmpdir(), 'projeto-multi-' + Date.now());
    const { home, tracker } = isolatedTracker();

    const claudeDir = join(home, '.claude', 'projects', `-${cwd.replace(/[/\\]/g, '-').replace(/^-/, '')}`);
    mkdirSync(claudeDir, { recursive: true });
    const first = join(claudeDir, 'sessao-a.jsonl');
    const second = join(claudeDir, 'sessao-b.jsonl');
    touch(first, new Date(Date.now() - 10_000));
    touch(second, new Date());

    // Primeiro agente pega a mais antiga; o id fica reivindicado...
    const foundA = tracker.findAgentSessionId(claudeAdapter.sessionStorage, cwd, since);
    expect(foundA).toBe('sessao-a');
    tracker.claim(foundA!);

    // ...e o segundo agente NAO recebe o mesmo id.
    const foundB = tracker.findAgentSessionId(claudeAdapter.sessionStorage, cwd, since);
    expect(foundB).toBe('sessao-b');
    expect(foundB).not.toBe(foundA);
  });

  it('ignora transcripts de subagentes do claude', () => {
    const since = Date.now() - 60_000;
    const cwd = join(tmpdir(), 'projeto-claude-subagent-' + Date.now());
    const { home, tracker } = isolatedTracker();

    const claudeDir = join(home, '.claude', 'projects', `-${cwd.replace(/[/\\]/g, '-').replace(/^-/, '')}`);
    mkdirSync(claudeDir, { recursive: true });
    touch(join(claudeDir, 'agent-a2a88b5.jsonl'), new Date(Date.now() - 5_000));
    touch(join(claudeDir, 'sessao-principal.jsonl'), new Date());

    expect(tracker.findAgentSessionId(claudeAdapter.sessionStorage, cwd, since)).toBe('sessao-principal');
  });

  it('ignora transcript principal vazio do claude', () => {
    const since = Date.now() - 60_000;
    const cwd = join(tmpdir(), 'projeto-claude-vazio-' + Date.now());
    const { home, tracker } = isolatedTracker();

    const claudeDir = join(home, '.claude', 'projects', `-${cwd.replace(/[/\\]/g, '-').replace(/^-/, '')}`);
    mkdirSync(claudeDir, { recursive: true });
    const empty = join(claudeDir, 'sessao-vazia.jsonl');
    writeFileSync(empty, '');
    utimesSync(empty, new Date(), new Date());
    touch(join(claudeDir, 'sessao-valida.jsonl'), new Date(Date.now() - 5_000));

    expect(tracker.findLatestAgentSessionId(claudeAdapter.sessionStorage, cwd)).toBe('sessao-valida');
  });

  it('ignora transcript do claude que ainda contem apenas snapshots de startup', () => {
    const since = Date.now() - 60_000;
    const cwd = join(tmpdir(), 'projeto-claude-snapshot-' + Date.now());
    const { home, tracker } = isolatedTracker();

    const claudeDir = join(home, '.claude', 'projects', `-${cwd.replace(/[/\\]/g, '-').replace(/^-/, '')}`);
    mkdirSync(claudeDir, { recursive: true });
    const snapshotOnly = join(claudeDir, 'sessao-snapshot.jsonl');
    writeFileSync(snapshotOnly, `${JSON.stringify({ type: 'file-history-snapshot', messageId: 'abc' })}\n`);
    utimesSync(snapshotOnly, new Date(), new Date());
    touch(join(claudeDir, 'sessao-retomavel.jsonl'), new Date(Date.now() - 5_000));

    expect(tracker.findLatestAgentSessionId(claudeAdapter.sessionStorage, cwd)).toBe('sessao-retomavel');
  });

  it('vincula a sessao do Codex somente ao workspace do terminal', () => {
    const since = Date.now() - 60_000;
    const cwd = join(tmpdir(), `codex-workspace-${Date.now()}`);
    const otherCwd = join(tmpdir(), `codex-other-${Date.now()}`);
    mkdirSync(cwd, { recursive: true });
    mkdirSync(otherCwd, { recursive: true });
    const { home, tracker } = isolatedTracker();
    const sessionsDir = join(home, '.codex', 'sessions', '2026', '08', '10');
    mkdirSync(sessionsDir, { recursive: true });

    const otherId = '11111111-1111-4111-8111-111111111111';
    const targetId = '22222222-2222-4222-8222-222222222222';
    const otherPath = join(sessionsDir, `rollout-old-${otherId}.jsonl`);
    const targetPath = join(sessionsDir, `rollout-new-${targetId}.jsonl`);
    writeFileSync(otherPath, `${JSON.stringify({ type: 'session_meta', payload: { cwd: otherCwd } })}\n`);
    writeFileSync(targetPath, `${JSON.stringify({ type: 'session_meta', payload: { cwd } })}\n`);
    utimesSync(otherPath, new Date(Date.now() - 5_000), new Date(Date.now() - 5_000));
    utimesSync(targetPath, new Date(), new Date());

    expect(tracker.findAgentSessionId(codexAdapter.sessionStorage, cwd, since)).toBe(targetId);
    expect(tracker.findAgentSessionId(codexAdapter.sessionStorage, otherCwd, since)).toBe(otherId);
  });

  it('vincula a sessao do Kimi pelo hash exato mesmo com pastas de mesmo nome', () => {
    const since = Date.now() - 60_000;
    const cwd = join(tmpdir(), `kimi-a-${Date.now()}`, 'app');
    const otherCwd = join(tmpdir(), `kimi-b-${Date.now()}`, 'app');
    mkdirSync(cwd, { recursive: true });
    mkdirSync(otherCwd, { recursive: true });
    const { home, tracker } = isolatedTracker();
    const sessionsRoot = join(home, '.kimi-code', 'sessions');
    const sessionDir = (workspacePath: string, sessionId: string) => {
      const hash = createHash('sha256').update(realpathSync(workspacePath)).digest('hex').slice(0, 12);
      const path = join(sessionsRoot, `wd_app_${hash}`, sessionId);
      mkdirSync(path, { recursive: true });
      return path;
    };
    sessionDir(otherCwd, 'session_other');
    sessionDir(cwd, 'session_target');

    expect(tracker.findAgentSessionId(kimiAdapter.sessionStorage, cwd, since)).toBe('session_target');
    expect(tracker.findAgentSessionId(kimiAdapter.sessionStorage, otherCwd, since)).toBe('session_other');
  });

  it('vincula sessoes atuais do OpenCode pelo SQLite e diretorio exato', () => {
    const since = Date.now() - 60_000;
    const cwd = join(tmpdir(), `opencode-workspace-${Date.now()}`);
    const otherCwd = join(tmpdir(), `opencode-other-${Date.now()}`);
    mkdirSync(cwd, { recursive: true });
    mkdirSync(otherCwd, { recursive: true });
    const { home, tracker } = isolatedTracker();
    const databaseDir = join(home, '.local', 'share', 'opencode');
    mkdirSync(databaseDir, { recursive: true });
    const database = new DatabaseSync(join(databaseDir, 'opencode.db'));
    database.exec('CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL)');
    database.exec('CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL)');
    const insertSession = database.prepare('INSERT INTO session (id, directory, time_created, time_updated) VALUES (?, ?, ?, ?)');
    const insertMessage = database.prepare('INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)');
    const now = Date.now();
    insertSession.run('ses_other', otherCwd, now - 3_000, now - 1_000);
    insertSession.run('ses_target', cwd, now - 2_000, now);
    insertMessage.run('msg_other', 'ses_other', now - 1_000, now - 1_000, JSON.stringify({ role: 'user' }));
    insertMessage.run('msg_target', 'ses_target', now, now, JSON.stringify({ role: 'user' }));
    database.close();

    expect(tracker.findAgentSessionId(openCodeAdapter.sessionStorage, cwd, since)).toBe('ses_target');
    expect(tracker.findAgentSessionId(openCodeAdapter.sessionStorage, otherCwd, since)).toBe('ses_other');
    expect(tracker.findAgentSessionId(openCodeAdapter.sessionStorage, cwd, since, new Set(['ses_target']))).toBeNull();
  });

  it('valida um id exato do Claude apenas quando o transcript e retomavel', () => {
    const cwd = join(tmpdir(), 'projeto-claude-validacao-' + Date.now());
    const { home, tracker } = isolatedTracker();
    const claudeDir = join(home, '.claude', 'projects', `-${cwd.replace(/[/\\]/g, '-').replace(/^-/, '')}`);
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, 'reservada.jsonl'), `${JSON.stringify({ type: 'file-history-snapshot' })}\n`);
    touch(join(claudeDir, 'valida.jsonl'), new Date());

    expect(tracker.isAgentSessionResumable(claudeAdapter.sessionStorage, cwd, 'ausente')).toBe(false);
    expect(tracker.isAgentSessionResumable(claudeAdapter.sessionStorage, cwd, 'reservada')).toBe(false);
    expect(tracker.isAgentSessionResumable(claudeAdapter.sessionStorage, cwd, 'valida')).toBe(true);
    expect(tracker.isAgentSessionResumable(codexAdapter.sessionStorage, cwd, 'qualquer')).toBeNull();
  });

  it('rastreia a sessao do Claude na home isolada de uma distribuicao WSL', () => {
    const home = mkdtempSync(join(tmpdir(), 'orkestrai-wsl-home-'));
    temporaryHomes.push(home);
    const tracker = new AgentSessionTracker(home, (cwd) => posix.normalize(cwd));
    const linuxCwd = '/home/raoni/projects/app';
    const slug = linuxCwd.replace(/[^a-zA-Z0-9]/g, '-');
    const claudeDir = join(home, '.claude', 'projects', slug);
    mkdirSync(claudeDir, { recursive: true });
    touch(join(claudeDir, 'wsl-session.jsonl'), new Date());

    expect(tracker.findLatestAgentSessionId(claudeAdapter.sessionStorage, linuxCwd)).toBe('wsl-session');
    expect(tracker.isAgentSessionResumable(claudeAdapter.sessionStorage, linuxCwd, 'wsl-session')).toBe(true);
  });

  it('encontra a sessao do Cursor apenas no projeto correspondente', () => {
    const since = Date.now() - 60_000;
    const cwd = join(tmpdir(), `cursor-workspace-${Date.now()}`);
    const { home, tracker } = isolatedTracker();
    const slug = cwd.replace(/^[\\/]+/, '').replace(/[^a-zA-Z0-9]/g, '-');
    const sessionId = 'cursor-session-1';
    const transcriptDir = join(home, '.cursor', 'projects', slug, 'agent-transcripts', sessionId);
    mkdirSync(transcriptDir, { recursive: true });
    writeFileSync(join(transcriptDir, `${sessionId}.jsonl`), '{"role":"user"}\n');

    expect(tracker.findAgentSessionId(cursorAdapter.sessionStorage, cwd, since)).toBe(sessionId);
  });

  it('resolve a conversa do Antigravity pelo cache do workspace', () => {
    const since = Date.now() - 60_000;
    const cwd = join(tmpdir(), `antigravity-workspace-${Date.now()}`);
    const { home, tracker } = isolatedTracker();
    const cacheDir = join(home, '.gemini', 'antigravity-cli', 'cache');
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, 'last_conversations.json'), JSON.stringify({ [cwd]: 'agy-session-1' }));

    expect(tracker.findAgentSessionId(antigravityAdapter.sessionStorage, cwd, since)).toBe('agy-session-1');
  });

  it('filtra manifestos do Cline pelo diretorio do workspace', () => {
    const since = Date.now() - 60_000;
    const cwd = join(tmpdir(), `cline-workspace-${Date.now()}`);
    const otherCwd = join(tmpdir(), `cline-other-${Date.now()}`);
    const { home, tracker } = isolatedTracker();
    const sessionsDir = join(home, '.cline', 'data', 'sessions');
    for (const [id, manifestCwd] of [
      ['cline-other', otherCwd],
      ['cline-session-1', cwd],
    ]) {
      const sessionDir = join(sessionsDir, id);
      mkdirSync(sessionDir, { recursive: true });
      writeFileSync(join(sessionDir, `${id}.json`), JSON.stringify({ session_id: id, cwd: manifestCwd }));
    }

    expect(tracker.findAgentSessionId(clineAdapter.sessionStorage, cwd, since)).toBe('cline-session-1');
  });

  it('resolve sessoes concorrentes do Devin pelo banco e cwd exatos', () => {
    const since = Date.now() - 60_000;
    const cwd = join(tmpdir(), `devin-workspace-${Date.now()}`);
    const otherCwd = join(tmpdir(), `devin-other-${Date.now()}`);
    mkdirSync(cwd, { recursive: true });
    mkdirSync(otherCwd, { recursive: true });
    const { home, tracker } = isolatedTracker();
    const databaseDir = join(home, '.local', 'share', 'devin', 'cli');
    mkdirSync(databaseDir, { recursive: true });
    const database = new DatabaseSync(join(databaseDir, 'sessions.db'));
    database.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, working_directory TEXT NOT NULL, created_at INTEGER NOT NULL, hidden INTEGER NOT NULL DEFAULT 0)');
    const insert = database.prepare('INSERT INTO sessions (id, working_directory, created_at, hidden) VALUES (?, ?, ?, ?)');
    const now = Math.floor(Date.now() / 1_000);
    insert.run('devin-other', otherCwd, now - 2, 0);
    insert.run('calm-river', cwd, now - 1, 0);
    insert.run('bright-piano', cwd, now, 0);
    insert.run('hidden-helper', cwd, now, 1);
    database.close();

    const first = tracker.findAgentSessionId(devinAdapter.sessionStorage, cwd, since);
    expect(first).toBe('calm-river');
    tracker.claim(first!);
    expect(tracker.findAgentSessionId(devinAdapter.sessionStorage, cwd, since)).toBe('bright-piano');
    expect(tracker.findLatestAgentSessionId(devinAdapter.sessionStorage, cwd)).toBe('bright-piano');
  });
});

describe('resume exato dos adapters', () => {
  it('claude resume exato com id e fresh sem id', () => {
    expect(claudeAdapter.resumeArgs('abc-123')).toEqual(['--resume', 'abc-123']);
    // Sem id: comeca fresco — "claude --continue" sai com erro quando nao ha
    // conversa no diretorio (ex.: agente novo que nunca recebeu mensagem).
    expect(claudeAdapter.resumeArgs()).toEqual([]);
    expect(claudeAdapter.freshSessionArgs?.('novo-uuid')).toEqual(['--session-id', 'novo-uuid']);
  });

  it('codex resume exato com id e resume --last sem id', () => {
    expect(codexAdapter.resumeArgs('uuid-1')).toEqual(['resume', 'uuid-1']);
    expect(codexAdapter.resumeArgs()).toEqual(['resume', '--last']);
  });

  it('kimi resume exato com id e --continue sem id', () => {
    expect(kimiAdapter.resumeArgs('session_x')).toEqual(['-r', 'session_x']);
    expect(kimiAdapter.resumeArgs()).toEqual(['--continue']);
  });

  it('opencode resume exato com id e --continue sem id', () => {
    expect(openCodeAdapter.resumeArgs('ses_1')).toEqual(['--session', 'ses_1']);
    expect(openCodeAdapter.resumeArgs()).toEqual(['--continue']);
  });

  it('devin resume apenas com id exato', () => {
    expect(devinAdapter.resumeArgs('calm-river')).toEqual(['--resume', 'calm-river']);
    expect(devinAdapter.resumeArgs()).toBeNull();
  });
});
