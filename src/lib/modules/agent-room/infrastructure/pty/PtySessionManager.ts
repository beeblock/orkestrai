import { randomUUID, timingSafeEqual } from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import { readlink } from 'node:fs/promises';
import { platform } from 'node:os';
import { promisify } from 'node:util';
import type { IPty } from 'node-pty';
import type { WorkspaceExecutionRuntime } from '../../domain/types.ts';
import { executionRuntimeKey } from '../../domain/runtime.ts';
import { agentEnv, resolveCommand } from '../agent-path.ts';
import { buildWslLaunch } from '../WslRuntime.ts';
import { interactiveStartupGuard, type InteractiveStartupGuard } from '../../application/adapters/interactive-startup.ts';
import { HumanComposerInput } from './HumanComposerInput.ts';

// PATH aumentado e resolucao de comando (registro/PATHEXT/.cmd) foram movidos
// para ../agent-path.ts, compartilhado com o Modo Maestro (application/agents.ts)
// e a deteccao de CLIs (application/adapters/*).

export type PtySessionInfo = {
  id: string;
  command: string;
  args: string[];
  cwd: string;
  cols: number;
  rows: number;
  createdAt: string;
  /** Last PTY output or input observed by the process. */
  lastActivityAt: string;
  exited: boolean;
  exitCode: number | null;
  /** true quando a sessão parou de produzir saída (estado neutro de ociosidade). */
  waiting: boolean;
  /** The owner paused the process tree (SIGSTOP); it resumes with SIGCONT. */
  paused?: boolean;
  /** Já produziu algum output — usado na espera de prontidao antes de escrever. */
  hasOutput: boolean;
  /** Rotulos humanos (título do no / workspace) para notificações. */
  label?: string | null;
  workspace?: string | null;
  workspaceId?: string | null;
  nodeId?: string | null;
  /** Provider registrado; ausente em shells puros. */
  provider?: string | null;
  /** Conversa real observada no armazenamento do provider. */
  agentSessionId?: string | null;
  /** Home e cwd usados pelo provider para persistir transcripts (WSL-safe). */
  transcriptHome?: string | null;
  transcriptCwd?: string | null;
  /** Stable native/WSL identity used to avoid cross-runtime reattachment. */
  runtimeKey: string;
};

export type PtySessionListener = (data: string) => void;
export type PtyExitListener = (exitCode: number, expected?: boolean) => void;
export type PtyAttentionListener = (waiting: boolean) => void;
export type PtyWorkingDirectoryListener = (cwd: string) => void;

const execFileAsync = promisify(execFile);

export function parseLsofWorkingDirectory(output: string): string | null {
  const value = output
    .split(/\r?\n/)
    .find((line) => line.startsWith('n'))
    ?.slice(1)
    .trim();
  return value || null;
}

async function processWorkingDirectory(pid: number): Promise<string | null> {
  if (platform() === 'linux') {
    return readlink(`/proc/${pid}/cwd`).catch(() => null);
  }
  if (platform() === 'darwin') {
    const { stdout } = await execFileAsync('/usr/sbin/lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], {
      encoding: 'utf8',
      timeout: 2_000,
    }).catch(() => ({ stdout: '' }));
    return parseLsofWorkingDirectory(stdout);
  }
  return null;
}

/**
 * node-pty kills only its direct child. Agent launchers commonly fork a native
 * TUI, so stopping only the wrapper can leave the real provider holding a
 * conversation lock. Canvas PTYs own a dedicated process group/session and
 * can therefore terminate the complete tree without touching external CLIs.
 */
export function killPtyProcessTree(pty: IPty, owned: boolean): void {
  const pid = Number(pty.pid);
  if (!owned || !Number.isSafeInteger(pid) || pid <= 1) {
    pty.kill();
    return;
  }

  if (platform() === 'win32') {
    try {
      execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        timeout: 5_000,
        windowsHide: true,
      });
      return;
    } catch {
      pty.kill();
      return;
    }
  }

  try {
    const processGroup = Number(execFileSync('/bin/ps', ['-o', 'pgid=', '-p', String(pid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2_000,
    }).trim());
    if (processGroup === pid) {
      process.kill(-processGroup, 'SIGHUP');
      return;
    }
  } catch {
    // Fall back to node-pty when the process already exited or has no group.
  }
  pty.kill();
}

type PtySession = PtySessionInfo & {
  pty: IPty;
  /** Per-process bridge credential. It must never leave this private record. */
  bridgeAgentToken: string | null;
  managedStartupState: 'none' | 'submitted' | 'uncertain';
  ownsProcessTree: boolean;
  /** An owner action or Core shutdown is ending this PTY, not an agent failure. */
  stopping?: boolean;
  initialIdleObserved: boolean;
  startupGuard: InteractiveStartupGuard | null;
  bracketedPaste: boolean;
  terminalModeTail: string;
  scrollback: string;
  /** Modes in effect where the retained scrollback starts. */
  trimmedModes: Map<string, boolean>;
  /** Characters this session has output since it started, kept or trimmed. */
  outputLength: number;
  listeners: Set<PtySessionListener>;
  exitListeners: Set<PtyExitListener>;
  attentionListeners: Set<PtyAttentionListener>;
  workingDirectoryListeners: Set<PtyWorkingDirectoryListener>;
  workingDirectoryTimer: ReturnType<typeof setTimeout> | null;
  canTrackWorkingDirectory: boolean;
  idleTimer: ReturnType<typeof setTimeout> | null;
  deliveryTimer: ReturnType<typeof setTimeout> | null;
  deliveryQueue: ComposerDelivery[];
  activeDelivery: ComposerDelivery | null;
  deliveryInProgress: boolean;
  awaitingDeliveryIdle: boolean;
  lastSubmittedDelivery: ComposerDelivery | null;
  lastDeliveryAccepted: boolean;
  deliveryReadyAt: number;
  deferredHumanInput: Array<{ data: string; imagePaste: boolean }>;
  humanComposerLength: number;
  humanInputRevision: number;
  humanDraft: HumanDraft;
  humanComposerInput: HumanComposerInput;
  lastOutputAt: number;
  outputRevision: number;
  lastSubmitOutputRevision: number;
  conptySubmitGuard: boolean;
  /** Output after idle reported the agent as working; the next quiet spell reports idle again. */
  outputBurst: boolean;
  /** A resize makes TUIs repaint; that repaint is not work. */
  redrawUntil: number;
};

export type PtyOutputMark = { sessionId: string; length: number };

type ComposerDelivery = {
  text: string;
  submitDelayMs: number;
  resolve: () => void;
  reject: (error: Error) => void;
  requiresAcceptance: boolean;
  confirmAcceptance?: () => Promise<boolean>;
  confirmationPending?: boolean;
  /** Actual Enter time, rather than when the delivery joined the queue. */
  submittedAt?: number;
  humanInputRevision?: number;
  pasteRetryCount?: number;
  pasteRetryAt?: number;
  /** Where the terminal's output stood when Enter submitted this delivery. */
  onSubmitted?: (mark: PtyOutputMark) => void;
};

export type ComposerDeliveryHandle = {
  submitted: Promise<void>;
  /** Only an exact structured prompt match may acknowledge this delivery. */
  acknowledge: () => void;
  /** Cancela somente enquanto a entrega ainda está aguardando na fila. */
  cancel: (reason?: Error) => boolean;
};

export class ObsoletePtyDeliveryError extends Error {
  readonly code = 'PTY_DELIVERY_OBSOLETE';

  constructor() {
    super('Agent message delivery was cancelled because its task is no longer active.');
    this.name = 'ObsoletePtyDeliveryError';
  }
}

export type CreatePtySessionInput = {
  command: string;
  args?: string[];
  cwd: string;
  cols?: number;
  rows?: number;
  env?: Record<string, string>;
  /** Environment names intentionally forwarded into a WSL guest. */
  forwardEnvToWsl?: string[];
  /** Rotulos humanos (título do no / workspace) para notificações. */
  label?: string | null;
  workspace?: string | null;
  workspaceId?: string | null;
  nodeId?: string | null;
  provider?: string | null;
  runtime?: WorkspaceExecutionRuntime;
  /** Host path corresponding to runtime.linuxWorkingDir. */
  workspaceRoot?: string;
  /** Transcript location resolved before spawning a WSL-backed provider. */
  transcriptHome?: string;
  transcriptCwd?: string;
  agentSessionId?: string;
  /** Ephemeral credential injected only into this PTY's environment. */
  bridgeAgentToken?: string;
};

const SCROLLBACK_LIMIT = 256 * 1024; // 256 KB por sessão
const SESSION_IDLE_MS = 2_500;
const AGENT_DELIVERY_SETTLE_MS = 8_000;
const SHELL_DELIVERY_SETTLE_MS = 400;
const HUMAN_SUBMIT_SETTLE_MS = 400;
const COMPOSER_OUTPUT_QUIET_MS = 400;
const COMPOSER_SETTLE_LIMIT_MS = 5_000;

/**
 * Texto seguro para composers de TUI (Claude/Codex/Kimi): remove bytes de
 * controle (atalhos como Ctrl+X abrem o editor externo do Claude!) e achata
 * newlines — \n solto num composer e um Enter (submit parcial da mensagem).
 */
// Private modes a reattached terminal needs to keep working: the alternate
// screen first, then key, mouse, focus and paste reporting, then the cursor.
const REPLAYED_MODES = ['1049', '1047', '47', '1', '1000', '1002', '1003', '1004', '1005', '1006', '1015', '2004', '25'];

/** Records the private modes (`ESC [ ? n h|l`) that `text` sets, in order. */
export function applyTerminalModes(modes: Map<string, boolean>, text: string): void {
  for (const match of text.matchAll(/\x1b\[\?([\d;]+)([hl])/g)) {
    for (const mode of match[1].split(';')) modes.set(mode, match[2] === 'h');
  }
}

/**
 * Restores, ahead of a trimmed replay, the modes set by output that no longer
 * fits the scrollback. Without it an agent TUI that entered the alternate
 * screen and mouse reporting long ago reattaches as a plain terminal, and the
 * wheel no longer reaches it.
 */
export function terminalModePrefix(modes: Map<string, boolean>): string {
  let prefix = '';
  for (const mode of REPLAYED_MODES) {
    const on = modes.get(mode);
    if (on === undefined) continue;
    if (mode === '25') {
      if (!on) prefix += '\x1b[?25l';
    } else if (on) {
      prefix += `\x1b[?${mode}h`;
    }
  }
  return prefix;
}

/** Splits output at the scrollback limit without cutting an escape sequence in two. */
export function trimScrollback(text: string, limit: number): { kept: string; dropped: string } {
  if (text.length <= limit) return { kept: text, dropped: '' };
  let cut = text.length - limit;
  const escape = text.lastIndexOf('\x1b', cut);
  if (escape >= 0 && cut - escape < 64) cut = escape;
  return { kept: text.slice(cut), dropped: text.slice(0, cut) };
}

/**
 * The last `limit` characters of a terminal's output for a reattached viewer,
 * preceded by the modes that the omitted output set (`modes` already holds the
 * ones from output the scrollback no longer keeps). A plain tail would drop the
 * alternate screen and mouse reporting of an agent TUI that started long ago.
 */
export function replayTail(modes: ReadonlyMap<string, boolean>, scrollback: string, limit: number): string {
  const { kept, dropped } = trimScrollback(scrollback, limit);
  const replayed = new Map(modes);
  if (dropped) applyTerminalModes(replayed, dropped);
  return terminalModePrefix(replayed) + kept;
}

/** Text the owner is typing into an agent's terminal, across input chunks. */
export type HumanDraft = { text: string; paste: boolean };

/**
 * Follows what the owner types into an agent's terminal and returns each line
 * they submit, so the conversation in Chat can show it. Bracketed pastes keep
 * their line breaks; editing keys apply to the draft; other escape sequences
 * (arrows, focus reports, mouse) are terminal controls, not text.
 */
export function trackHumanDraft(draft: HumanDraft, data: string): string[] {
  const submitted: string[] = [];
  let text = draft.text;
  let index = 0;
  while (index < data.length) {
    if (data.startsWith('\x1b[200~', index)) { draft.paste = true; index += 6; continue; }
    if (data.startsWith('\x1b[201~', index)) { draft.paste = false; index += 6; continue; }
    const char = data[index];
    const code = char.charCodeAt(0);
    if (code === 0x1b) {
      const next = data[index + 1];
      if (next === '[') {
        let end = index + 2;
        while (end < data.length && !(data.charCodeAt(end) >= 0x40 && data.charCodeAt(end) <= 0x7e)) end++;
        index = end + 1;
      } else if (next === 'O') {
        index += 3;
      } else {
        // Alt+Enter adds a line; Alt+Backspace deletes a word; a lone Escape keeps the draft.
        if (next === '\r') text += '\n';
        else if (next === '\x7f') text = text.replace(/\S+\s*$/, '');
        index += next === undefined ? 1 : 2;
      }
      continue;
    }
    if (draft.paste) text += char === '\r' ? '\n' : char;
    else if (char === '\r' || char === '\n') {
      if (text.trim()) submitted.push(text);
      text = '';
    } else if (code === 0x7f || code === 0x08) text = text.slice(0, -1);
    else if (code === 0x15 || code === 0x03) text = '';
    else if (code === 0x17) text = text.replace(/\S+\s*$/, '');
    else if (code >= 0x20) text += char;
    index++;
  }
  draft.text = text.slice(-16_000);
  return submitted;
}

export function sanitizeComposerText(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/**
 * Gerenciador de sessões PTY (node-pty) do Agent Room.
 *
 * As sessões vivem no processo do servidor e sobrevivem a reloads da pagina:
 * o cliente reconecta via attach() e recebe o scrollback acumulado.
 * Singleton `ptySessionManager` para uso no transporte (WS) e nas rotas.
 */
export class PtySessionManager {
  private sessions = new Map<string, PtySession>();
  private spawnPty: typeof import('node-pty').spawn;
  private killProcessTree: (pty: IPty, owned: boolean) => void;

  constructor(
    spawnPty: typeof import('node-pty').spawn,
    killProcessTree: (pty: IPty, owned: boolean) => void = killPtyProcessTree,
  ) {
    this.spawnPty = spawnPty;
    this.killProcessTree = killProcessTree;
  }

  create(input: CreatePtySessionInput): PtySessionInfo {
    const id = randomUUID();
    const cols = input.cols ?? 120;
    const rows = input.rows ?? 30;

    const env = { ...agentEnv(), ...input.env } as Record<string, string>;
    // node-pty defines TERM from `name` on Unix, but ConPTY only uses `name`
    // internally and does not expose it to the Windows child process. Full-
    // screen CLIs such as Codex use these capabilities to enable mouse-wheel
    // navigation, so keep the child contract identical on every platform.
    // Inherited values describe the outer terminal (often TERM=dumb), not
    // this canvas xterm. Only an explicit session override changes its contract.
    env.TERM = input.env?.TERM || 'xterm-256color';
    env.COLORTERM = input.env?.COLORTERM || 'truecolor';
    const target = input.runtime?.kind === 'wsl'
      ? buildWslLaunch({
          runtime: input.runtime,
          command: input.command,
          args: input.args ?? [],
          hostCwd: input.cwd,
          workspaceRoot: input.workspaceRoot,
          hostEnv: env,
          forwardEnvToWsl: input.forwardEnvToWsl,
        })
      : { ...resolveCommand(input.command, input.args ?? [], env), cwd: input.cwd, env };
    const ptyProcess = this.spawnPty(target.command, target.args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: target.cwd,
      env: target.env,
    });

    const session: PtySession = {
      id,
      command: input.command,
      args: input.args ?? [],
      cwd: input.cwd,
      cols,
      rows,
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      exited: false,
      exitCode: null,
      waiting: false,
      hasOutput: false,
      label: input.label ?? null,
      workspace: input.workspace ?? null,
      workspaceId: input.workspaceId ?? null,
      nodeId: input.nodeId ?? null,
      provider: input.provider ?? null,
      agentSessionId: input.agentSessionId ?? null,
      transcriptHome: input.transcriptHome ?? null,
      transcriptCwd: input.transcriptCwd ?? input.cwd,
      runtimeKey: executionRuntimeKey(input.runtime ?? { kind: 'native' }),
      pty: ptyProcess,
      bridgeAgentToken: input.bridgeAgentToken ?? null,
      managedStartupState: 'none',
      ownsProcessTree: Boolean(input.workspaceId && input.nodeId),
      initialIdleObserved: false,
      startupGuard: interactiveStartupGuard(input.provider),
      bracketedPaste: false,
      terminalModeTail: '',
      scrollback: '',
      trimmedModes: new Map(),
      outputLength: 0,
      listeners: new Set(),
      exitListeners: new Set(),
      attentionListeners: new Set(),
      workingDirectoryListeners: new Set(),
      workingDirectoryTimer: null,
      canTrackWorkingDirectory: !input.provider && input.runtime?.kind !== 'wsl',
      idleTimer: null,
      deliveryTimer: null,
      deliveryQueue: [],
      activeDelivery: null,
      deliveryInProgress: false,
      awaitingDeliveryIdle: false,
      lastSubmittedDelivery: null,
      lastDeliveryAccepted: false,
      deliveryReadyAt: 0,
      deferredHumanInput: [],
      humanComposerLength: 0,
      humanInputRevision: 0,
      humanDraft: { text: '', paste: false },
      humanComposerInput: new HumanComposerInput(),
      lastOutputAt: 0,
      outputRevision: 0,
      lastSubmitOutputRevision: 0,
      conptySubmitGuard: platform() === 'win32' || input.runtime?.kind === 'wsl',
      outputBurst: false,
      redrawUntil: 0,
    };

    ptyProcess.onData((data) => {
      const firstOutput = session.scrollback.length === 0;
      const resumedFromIdle = session.waiting;
      session.lastOutputAt = Date.now();
      session.outputRevision += 1;
      session.outputLength += data.length;
      const retained = trimScrollback(session.scrollback + data, SCROLLBACK_LIMIT);
      if (retained.dropped) applyTerminalModes(session.trimmedModes, retained.dropped);
      session.scrollback = retained.kept;
      const modes = session.terminalModeTail + data;
      for (const match of modes.matchAll(/\x1b\[\?2004([hl])/g)) session.bracketedPaste = match[1] === 'h';
      session.terminalModeTail = modes.slice(-12);
      session.startupGuard?.observe(data);
      if (session.startupGuard && !session.startupGuard.canAcceptMessages) this.setWaiting(session, false);
      for (const listener of session.listeners) listener(data);
      this.scheduleAttentionCheck(session);
      // `waiting` stays set on purpose (deliveries rely on it), so the burst
      // flag remembers to report idle once the output goes quiet again.
      const repaint = resumedFromIdle && Date.now() < session.redrawUntil;
      if (firstOutput || (resumedFromIdle && !repaint && !session.outputBurst)) {
        if (resumedFromIdle) session.outputBurst = true;
        this.recordLifecycle(session, 'working');
      }
    });

    ptyProcess.onExit(({ exitCode }) => {
      session.exited = true;
      session.exitCode = exitCode;
      if (session.idleTimer) clearTimeout(session.idleTimer);
      if (session.deliveryTimer) clearTimeout(session.deliveryTimer);
      if (session.workingDirectoryTimer) clearTimeout(session.workingDirectoryTimer);
      this.rejectDeliveries(session, new Error(`Sessão PTY ${id} finalizada com código ${exitCode}.`));
      this.setWaiting(session, false);
      const expected = session.stopping || exitCode === 0;
      for (const listener of session.exitListeners) listener(exitCode, expected);
      this.recordLifecycle(session, expected ? 'disconnected' : 'error', expected ? null : `PTY exited with code ${exitCode}`);
    });

    this.sessions.set(id, session);
    this.recordLifecycle(session, 'starting');
    if (!session.provider && session.workspaceId && session.nodeId) {
      const startup = (globalThis as { __orkestraiStartManagedShell?: (workspaceId: string, nodeId: string, sessionId: string) => Promise<boolean> }).__orkestraiStartManagedShell;
      void startup?.(session.workspaceId, session.nodeId, id).catch(() => {
        this.recordLifecycle(session, 'error', 'Shell startup submission failed; command was not automatically replayed.');
      });
    }
    return this.toInfo(session);
  }

  list(): PtySessionInfo[] {
    return [...this.sessions.values()].map((session) => this.toInfo(session));
  }

  /**
   * A node owns at most one live PTY. Returning the oldest session makes the
   * original process canonical when a renderer reconnect race created a
   * second terminal for the same node.
   */
  listLiveForNode(workspaceId: string, nodeId: string): PtySessionInfo[] {
    return [...this.sessions.values()]
      .filter((session) => session.workspaceId === workspaceId && session.nodeId === nodeId && !session.exited)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((session) => this.toInfo(session));
  }

  listLiveForAgentSession(provider: string, agentSessionId: string): PtySessionInfo[] {
    return [...this.sessions.values()]
      .filter((session) => !session.exited && session.provider === provider
        && (session.agentSessionId === agentSessionId || session.args.includes(agentSessionId)))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((session) => this.toInfo(session));
  }

  claimNode(id: string, workspaceId: string, nodeId: string): boolean {
    const session = this.sessions.get(id);
    if (!session || session.exited) return false;
    // Recovery may adopt an orphan, never a terminal owned by another node.
    if (session.workspaceId && session.workspaceId !== workspaceId) return false;
    if (session.nodeId && session.nodeId !== nodeId) return false;
    session.workspaceId = workspaceId;
    session.nodeId = nodeId;
    return true;
  }

  bindAgentSession(id: string, agentSessionId: string): boolean {
    const session = this.sessions.get(id);
    if (!session || session.exited) return false;
    session.agentSessionId = agentSessionId;
    return true;
  }

  requiresSubmitConfirmation(id: string): boolean {
    const session = this.requireSession(id);
    return Boolean(session.provider && session.conptySubmitGuard);
  }

  get(id: string): PtySessionInfo | null {
    const session = this.sessions.get(id);
    return session ? this.toInfo(session) : null;
  }

  /** Resolves a bridge caller from a live PTY without exposing its credential. */
  resolveBridgeAgent(workspaceId: string, token: string): string | null {
    if (!token) return null;
    const candidate = Buffer.from(token);
    for (const session of this.sessions.values()) {
      if (session.exited || session.workspaceId !== workspaceId || !session.nodeId || !session.bridgeAgentToken) continue;
      const expected = Buffer.from(session.bridgeAgentToken);
      if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) return session.nodeId;
    }
    return null;
  }

  /**
   * Anexa um ouvinte a sessão. Retorna o scrollback acumulado para replay
   * e uma função de detach. Sessão já finalizada: devolve scrollback e o
   * ouvinte de saída recebe o exit code imediatamente após o replay.
   */
  attach(
    id: string,
    onData: PtySessionListener,
    onExit?: PtyExitListener,
    onAttention?: PtyAttentionListener,
    onWorkingDirectory?: PtyWorkingDirectoryListener,
  ): { scrollback: string; detach: () => void } {
    const session = this.requireSession(id);
    session.listeners.add(onData);
    if (onExit) session.exitListeners.add(onExit);
    if (onAttention) session.attentionListeners.add(onAttention);
    if (onWorkingDirectory) session.workingDirectoryListeners.add(onWorkingDirectory);

    const scrollback = terminalModePrefix(session.trimmedModes) + session.scrollback;
    if (session.exited && onExit) {
      queueMicrotask(() => onExit(session.exitCode ?? 0, Boolean(session.stopping || session.exitCode === 0)));
    }

    return {
      scrollback,
      detach: () => {
        session.listeners.delete(onData);
        if (onExit) session.exitListeners.delete(onExit);
        if (onAttention) session.attentionListeners.delete(onAttention);
        if (onWorkingDirectory) session.workingDirectoryListeners.delete(onWorkingDirectory);
      },
    };
  }

  /** At most `limit` characters of recent output, replayable on its own (see `replayTail`). */
  replay(id: string, limit = SCROLLBACK_LIMIT): string {
    const session = this.requireSession(id);
    return replayTail(session.trimmedModes, session.scrollback, limit);
  }

  writeStartupOnce(id: string, input: string): boolean {
    const session = this.requireSession(id);
    if (session.provider || session.exited) throw new Error('Managed startup requires a live pure Shell.');
    if (session.managedStartupState === 'submitted') return true;
    if (session.managedStartupState === 'uncertain') throw new Error('Shell startup submission is uncertain; automatic replay is disabled.');
    session.managedStartupState = 'uncertain';
    this.write(id, input);
    session.managedStartupState = 'submitted';
    return true;
  }

  write(id: string, data: string): void {
    const session = this.requireSession(id);
    if (session.exited) throw new Error(`Sessão PTY ${id} já finalizada.`);
    this.setWaiting(session, false);
    session.lastOutputAt = Date.now();
    session.pty.write(data);
  }

  /**
   * Entrada originada no terminal visivel. Enquanto uma entrega automatica
   * está entre o texto e o Enter, as teclas ficam em memória por alguns
   * milissegundos e são reproduzidas logo depois. Isso impede que o rascunho
   * humano seja concatenado a uma mensagem de outro agente.
   */
  writeHumanInput(id: string, data: string, options: { imagePaste?: boolean } = {}): void {
    const session = this.requireSession(id);
    if (session.exited) throw new Error(`Sessão PTY ${id} já finalizada.`);
    const imagePaste = options.imagePaste === true;
    // xterm sends focus/device/color reports through onData too. Those are
    // terminal protocol replies, not edits to the owner's draft.
    const protocolOnly = /^(?:\x1b\[[IO]|\x1b\[[?>]?[\d;:]+c|\x1b\](?:10|11|12);rgba?:[a-fA-F\d/]+(?:\x07|\x1b\\))+$/.test(data);
    if (imagePaste || (data.length && !protocolOnly)) session.humanInputRevision += 1;
    if (session.deliveryInProgress) {
      session.deferredHumanInput.push({ data, imagePaste });
      return;
    }
    this.writeHumanInputNow(session, data, imagePaste);
    if (/[\r\n]/.test(data)) this.scheduleWorkingDirectoryRefresh(session);
  }

  /**
   * Shells mudam o proprio cwd sem informar o processo pai. Depois de Enter,
   * consulta o processo PTY no macOS/Linux e publica somente mudancas reais.
   * OSC 7 no renderer cobre shells com integracao propria e Windows.
   */
  private scheduleWorkingDirectoryRefresh(session: PtySession): void {
    if (!session.canTrackWorkingDirectory || session.exited) return;
    if (session.workingDirectoryTimer) clearTimeout(session.workingDirectoryTimer);
    session.workingDirectoryTimer = setTimeout(async () => {
      session.workingDirectoryTimer = null;
      const cwd = await processWorkingDirectory(session.pty.pid);
      if (!cwd || cwd === session.cwd || session.exited) return;
      session.cwd = cwd;
      for (const listener of session.workingDirectoryListeners) listener(cwd);
    }, 250);
  }

  resize(id: string, cols: number, rows: number): void {
    const session = this.requireSession(id);
    if (session.exited) return;
    if (session.cols === cols && session.rows === rows) return;
    session.cols = cols;
    session.rows = rows;
    session.redrawUntil = Date.now() + 1_500;
    session.pty.resize(cols, rows);
  }

  kill(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.stopping = true;
    if (session.idleTimer) clearTimeout(session.idleTimer);
    if (session.deliveryTimer) clearTimeout(session.deliveryTimer);
    if (session.workingDirectoryTimer) clearTimeout(session.workingDirectoryTimer);
    this.rejectDeliveries(session, new Error(`Sessão PTY ${id} encerrada.`));
    if (!session.exited) {
      try {
        this.killProcessTree(session.pty, session.ownsProcessTree);
      } catch {
        // processo já morreu
      }
    }
    this.sessions.delete(id);
    return true;
  }

  /** Encerra processos efêmeros antes de remover o estado persistido deles. */
  killWorkspace(workspaceId: string): number {
    const sessions = [...this.sessions.values()]
      .filter((session) => session.workspaceId === workspaceId);
    const ids = sessions.map((session) => session.id);
    for (const session of sessions) {
      session.workspaceId = null;
      session.nodeId = null;
    }
    for (const id of ids) this.kill(id);
    return ids.length;
  }

  /** Ends every PTY owned by one canvas node, optionally preserving one. */
  killNode(workspaceId: string, nodeId: string, keepSessionId?: string): number {
    const sessions = [...this.sessions.values()].filter(
      (session) => session.workspaceId === workspaceId
        && session.nodeId === nodeId
        && session.id !== keepSessionId,
    );
    for (const session of sessions) {
      session.workspaceId = null;
      session.nodeId = null;
    }
    for (const session of sessions) this.kill(session.id);
    return sessions.length;
  }

  /** Retire owned duplicates or unclaimed orphans, never another node's PTY. */
  /**
   * Pauses or resumes every live process tree of a node (SIGSTOP/SIGCONT on the
   * PTY's own process group). Only owned trees are signalled, so external CLIs
   * are never touched; Windows has no equivalent and returns 0.
   */
  setNodePaused(workspaceId: string, nodeId: string, paused: boolean): number {
    if (platform() === 'win32') return 0;
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.workspaceId !== workspaceId || session.nodeId !== nodeId || session.exited || !session.ownsProcessTree) continue;
      if (Boolean(session.paused) === paused) continue;
      const pid = Number(session.pty.pid);
      if (!Number.isSafeInteger(pid) || pid <= 1) continue;
      try {
        const processGroup = Number(execFileSync('/bin/ps', ['-o', 'pgid=', '-p', String(pid)], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
          timeout: 2_000,
        }).trim());
        if (processGroup !== pid) continue;
        process.kill(-processGroup, paused ? 'SIGSTOP' : 'SIGCONT');
        session.paused = paused;
        count += 1;
      } catch {
        // The process exited between the check and the signal.
      }
    }
    return count;
  }

  /** Latest output of the node's live session (raw, bounded); null when none is live. */
  outputTail(workspaceId: string, nodeId: string, chars = 8_000): string | null {
    const latest = this.liveNodeSession(workspaceId, nodeId);
    return latest ? latest.scrollback.slice(-Math.max(200, chars)) : null;
  }

  /** Where a node's live terminal output stands now, to read later only what came after. */
  outputMark(workspaceId: string, nodeId: string): { sessionId: string; length: number } | null {
    const latest = this.liveNodeSession(workspaceId, nodeId);
    return latest ? { sessionId: latest.id, length: latest.outputLength } : null;
  }

  /**
   * The output a node's terminal wrote after `mark`, as far as the scrollback
   * still holds it; null when that terminal is gone or was restarted since.
   */
  outputSince(workspaceId: string, nodeId: string, mark: { sessionId: string; length: number }): string | null {
    const latest = this.liveNodeSession(workspaceId, nodeId);
    if (!latest || latest.id !== mark.sessionId) return null;
    const retainedFrom = latest.outputLength - latest.scrollback.length;
    return latest.scrollback.slice(Math.max(0, mark.length - retainedFrom));
  }

  private liveNodeSession(workspaceId: string, nodeId: string): PtySession | null {
    let latest: PtySession | null = null;
    for (const session of this.sessions.values()) {
      if (session.workspaceId !== workspaceId || session.nodeId !== nodeId || session.exited) continue;
      if (!latest || session.createdAt > latest.createdAt) latest = session;
    }
    return latest;
  }

  pausedNodes(workspaceId: string): string[] {
    const ids = new Set<string>();
    for (const session of this.sessions.values()) {
      if (session.workspaceId === workspaceId && session.paused && !session.exited && session.nodeId) ids.add(session.nodeId);
    }
    return [...ids];
  }

  killAgentSession(provider: string, agentSessionId: string, owner: { workspaceId: string; nodeId: string }, keepSessionId?: string): number {
    const sessions = [...this.sessions.values()].filter(
      (session) => !session.exited
        && session.provider === provider
        && (session.agentSessionId === agentSessionId || session.args.includes(agentSessionId))
        && (!session.workspaceId || session.workspaceId === owner.workspaceId)
        && (!session.nodeId || session.nodeId === owner.nodeId)
        && session.id !== keepSessionId,
    );
    for (const session of sessions) {
      session.workspaceId = null;
      session.nodeId = null;
    }
    for (const session of sessions) this.kill(session.id);
    return sessions.length;
  }

  /**
   * Texto + Enter em writes separados (~200ms): TUIs como o Codex tratam o
   * \r colado ao texto como quebra de linha no composer em vez de submit.
   * O texto passa por sanitizeComposerText: newlines soltas virariam Enters
   * (submit parcial no Claude) e bytes de controle disparam atalhos do TUI.
   */
  writeWithSubmit(id: string, text: string, submitDelayMs = 200): Promise<void> {
    return this.queueWithSubmit(id, text, submitDelayMs).submitted;
  }

  /**
   * Envia uma mensagem e exige atividade do TUI depois do Enter. Em ConPTY +
   * WSL, prompts longos podem chegar ao composer depois do primeiro Enter; um
   * retry só acontece se o provider não produziu nenhuma saída desde o submit.
   */
  async writeWithConfirmedSubmit(
    id: string,
    text: string,
    options: {
      submitDelayMs?: number;
      confirmationWindowMs?: number;
      maxAttempts?: number;
      queueTimeoutMs?: number;
      isAccepted?: () => Promise<boolean>;
      isStillRelevant?: () => Promise<boolean>;
      signal?: AbortSignal;
      onSubmitted?: (mark: PtyOutputMark) => void;
    } = {},
  ): Promise<void> {
    const session = this.requireSession(id);
    // Share an in-flight read with the barrier reconciler. UNC reads may hang;
    // never accumulate another read for the same submission on every poll.
    let acceptanceRead: Promise<boolean> | undefined;
    const confirmAcceptance = options.isAccepted ? () => {
      acceptanceRead ??= Promise.resolve().then(options.isAccepted!).finally(() => { acceptanceRead = undefined; });
      return acceptanceRead;
    } : undefined;
    const queued = this.queueWithSubmit(id, text, options.submitDelayMs ?? 200, Boolean(confirmAcceptance), confirmAcceptance, options.onSubmitted);
    if (options.signal?.aborted) {
      queued.cancel();
      throw new Error('Agent message delivery cancelled.');
    }
    const cancelQueuedDelivery = () => queued.cancel();
    const queueDeadline = Date.now() + (options.queueTimeoutMs ?? 300_000);
    options.signal?.addEventListener('abort', cancelQueuedDelivery, { once: true });
    try {
      while (true) {
        let poll: ReturnType<typeof setTimeout> | undefined;
        const submitted = await Promise.race([
          queued.submitted.then(() => true),
          new Promise<false>((resolvePromise) => {
            poll = setTimeout(() => resolvePromise(false), 200);
          }),
        ]).finally(() => clearTimeout(poll));
        if (submitted) break;
        if (Date.now() >= queueDeadline) {
          const error = new Error('Terminal delivery queue timed out. The message was not submitted; check the terminal draft or startup dialog before retrying.');
          if (queued.cancel(error)) {
            await queued.submitted.catch(() => undefined);
            throw error;
          }
        }
        if (options.signal?.aborted) {
          queued.cancel();
          throw new Error('Agent message delivery cancelled.');
        }
        if (options.isStillRelevant) {
          try {
            if (await options.isStillRelevant()) continue;
            const error = new ObsoletePtyDeliveryError();
            if (queued.cancel(error)) await queued.submitted.catch(() => undefined);
            throw error;
          } catch (error) {
            const reason = error instanceof Error ? error : new Error(String(error));
            if (queued.cancel(reason)) await queued.submitted.catch(() => undefined);
            throw reason;
          }
        }
      }
    } finally {
      options.signal?.removeEventListener('abort', cancelQueuedDelivery);
    }
    if (options.signal?.aborted) throw new Error('Agent message delivery cancelled.');
    if (!session.provider) return;
    if (!session.conptySubmitGuard && !options.isAccepted) return;

    const confirmationWindowMs = options.confirmationWindowMs ?? (session.conptySubmitGuard ? 4_000 : 180_000);
    const maxAttempts = Math.max(1, options.maxAttempts ?? (session.conptySubmitGuard ? 3 : 1));
    let revisionAtSubmit = session.lastSubmitOutputRevision;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const confirmed = confirmAcceptance
        ? await this.waitForAcceptance(confirmAcceptance, confirmationWindowMs, options.signal)
        : await this.waitForOutputAfter(id, revisionAtSubmit, confirmationWindowMs, options.signal);
      if (confirmed) {
        if (options.isAccepted) queued.acknowledge();
        return;
      }
      const current = this.requireSession(id);
      if (current.exited) throw new Error(`Sessão PTY ${id} finalizada antes de confirmar o envio.`);
      if (options.signal?.aborted) throw new Error('Agent message delivery cancelled.');
      if (attempt === maxAttempts) break;
      revisionAtSubmit = current.outputRevision;
      if (!this.submitIfComposerFree(id)) {
        throw new Error(`A sessão PTY ${id} não pôde confirmar o envio porque o composer está ocupado.`);
      }
    }
    // A busy TUI can queue input internally and persist it only after its
    // current tool/model turn ends. No further Enter is safe at this point.
    if (confirmAcceptance && session.conptySubmitGuard && options.confirmationWindowMs === undefined
      && await this.waitForAcceptance(confirmAcceptance, 180_000, options.signal)) {
      queued.acknowledge();
      return;
    }
    throw new Error(`A sessão PTY ${id} não confirmou o envio após ${maxAttempts} tentativas.`);
  }

  /** Aguarda o primeiro prompt do TUI estabilizar antes de injetar contexto. */
  async waitUntilIdle(id: string, timeoutMs = 20_000): Promise<boolean> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const session = this.sessions.get(id);
      if (!session || session.exited) return false;
      if (!session.provider) return true;
      if (session.waiting && (!session.startupGuard || session.startupGuard.canAcceptMessages)) return true;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
    }
    return false;
  }

  /** Aguarda somente a primeira estabilizacao do TUI; depois disso nao bloqueia trabalho enfileirado. */
  hasReachedInitialIdle(id: string): boolean {
    const session = this.sessions.get(id);
    return Boolean(session && !session.exited && (!session.startupGuard || session.startupGuard.canAcceptMessages) && (!session.provider || session.initialIdleObserved));
  }

  async waitUntilInitialIdle(id: string, timeoutMs = 20_000): Promise<boolean> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const session = this.sessions.get(id);
      if (!session || session.exited) return false;
      if (this.hasReachedInitialIdle(id)) return true;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
    }
    return false;
  }

  queueWithSubmit(
    id: string,
    text: string,
    submitDelayMs = 200,
    requiresAcceptance = false,
    confirmAcceptance?: () => Promise<boolean>,
    onSubmitted?: (mark: PtyOutputMark) => void,
  ): ComposerDeliveryHandle {
    const session = this.requireSession(id);
    if (session.exited) {
      return {
        submitted: Promise.reject(new Error(`Sessão PTY ${id} já finalizada.`)),
        acknowledge: () => {},
        cancel: () => false,
      };
    }
    const sanitized = sanitizeComposerText(text);
    if (!sanitized) {
      return {
        submitted: Promise.reject(new Error('A mensagem para o terminal está vazia.')),
        acknowledge: () => {},
        cancel: () => false,
      };
    }

    let delivery!: ComposerDelivery;
    const submitted = new Promise<void>((resolve, reject) => {
      delivery = { text: sanitized, submitDelayMs, resolve, reject, requiresAcceptance, confirmAcceptance, onSubmitted };
      session.deliveryQueue.push(delivery);
      this.drainDeliveryQueue(session);
    });
    return {
      submitted,
      acknowledge: () => {
        if (session.exited || session.lastSubmittedDelivery !== delivery) return;
        session.lastDeliveryAccepted = true;
        // Exact transcript acceptance replaces the conservative redraw delay.
        // Waiting eight seconds again serializes independent team handoffs.
        session.deliveryReadyAt = Date.now();
        this.releaseDeliveryBarrierWhenReady(session);
      },
      cancel: (reason = new Error('Entrega ao terminal cancelada antes do envio.')) => {
        const index = session.deliveryQueue.indexOf(delivery);
        if (index < 0) return false;
        session.deliveryQueue.splice(index, 1);
        delivery.reject(reason);
        return true;
      },
    };
  }

  /** Read-only gate for optional supervision, not a reservation or delivery receipt. */
  canAcceptAutomaticMessage(id: string): boolean {
    const session = this.sessions.get(id);
    return Boolean(session && !session.exited && session.waiting && session.scrollback.length > 0
      && !session.deliveryInProgress && !session.awaitingDeliveryIdle && !session.deliveryQueue.length
      && session.humanComposerLength === 0
      && (!session.startupGuard || session.startupGuard.canAcceptMessages));
  }

  /** Only an idle, empty composer may recover an unconfirmed automatic submit. */
  pendingAutomaticDeliveryAt(id: string): number | null {
    const session = this.sessions.get(id);
    return session && !session.exited && session.waiting && session.scrollback.length > 0
      && !session.deliveryInProgress && session.humanComposerLength === 0
      && (!session.startupGuard || session.startupGuard.canAcceptMessages)
      && session.awaitingDeliveryIdle && session.lastSubmittedDelivery?.requiresAcceptance
      && !session.lastDeliveryAccepted ? session.lastSubmittedDelivery.submittedAt ?? null : null;
  }

  /** Immutable identity of the most recent automatic Enter, including while the TUI is busy. */
  automaticDeliverySubmittedAt(id: string): number | null {
    const session = this.sessions.get(id);
    return session && !session.exited && session.lastSubmittedDelivery?.requiresAcceptance
      ? session.lastSubmittedDelivery.submittedAt ?? null : null;
  }

  /**
   * A newer structured turn has started AND ended in this exact conversation.
   * This frees the composer, but never acknowledges the old prompt or retypes it.
   * An old observation cannot release another delivery, a dialog or a human draft.
   */
  releaseAutomaticDeliveryAfterTurn(id: string, submittedAt: number, startedAt: number, finishedAt: number): boolean {
    if (![submittedAt, startedAt, finishedAt].every(Number.isFinite) || startedAt < submittedAt || finishedAt < startedAt
      || this.pendingAutomaticDeliveryAt(id) !== submittedAt) return false;
    const session = this.sessions.get(id)!;
    session.awaitingDeliveryIdle = false;
    session.lastSubmittedDelivery = null;
    session.lastDeliveryAccepted = false;
    if (session.deliveryTimer) clearTimeout(session.deliveryTimer);
    session.deliveryTimer = null;
    this.drainDeliveryQueue(session);
    return true;
  }

  /** Retry only Enter for a proven automatic paste that never began a turn. */
  retryPendingAutomaticPaste(id: string, submittedAt: number, lastFinishedAt: number): boolean {
    const session = this.sessions.get(id);
    const delivery = session?.lastSubmittedDelivery;
    if (!session || !delivery || session.conptySubmitGuard
      || !Number.isFinite(lastFinishedAt) || lastFinishedAt >= submittedAt
      || this.pendingAutomaticDeliveryAt(id) !== submittedAt
      || delivery.humanInputRevision !== session.humanInputRevision || session.deferredHumanInput.length
      || (delivery.pasteRetryCount ?? 0) >= 2
      || Date.now() - (delivery.pasteRetryAt ?? submittedAt) < 5000
      || Date.now() - session.lastOutputAt < SESSION_IDLE_MS
      || !session.startupGuard?.hasPendingPaste(session.scrollback)) return false;
    if (!this.submitIfComposerFree(id)) return false;
    delivery.pasteRetryCount = (delivery.pasteRetryCount ?? 0) + 1;
    delivery.pasteRetryAt = Date.now();
    session.outputBurst = true;
    this.recordLifecycle(session, 'working');
    return true;
  }

  /** Reenvia Enter apenas se não houver um rascunho humano em andamento. */
  submitIfComposerFree(id: string): boolean {
    const session = this.requireSession(id);
    if (session.exited || session.deliveryInProgress || session.humanComposerLength > 0 || (session.startupGuard && !session.startupGuard.canAcceptMessages)) return false;
    this.write(id, '\r');
    return true;
  }

  /** Mata todas as sessões (shutdown do servidor). */
  killAll(): void {
    for (const id of [...this.sessions.keys()]) this.kill(id);
  }

  private scheduleAttentionCheck(session: PtySession): void {
    if (session.idleTimer) clearTimeout(session.idleTimer);
    session.idleTimer = setTimeout(() => {
      if (session.startupGuard && !session.startupGuard.canAcceptMessages) return;
      if (session.outputBurst && session.waiting) {
        session.outputBurst = false;
        this.recordLifecycle(session, 'idle');
      }
      this.setWaiting(session, true);
      this.releaseDeliveryBarrierWhenReady(session);
      this.drainDeliveryQueue(session);
    }, SESSION_IDLE_MS);
  }

  private setWaiting(session: PtySession, waiting: boolean): void {
    if (waiting) session.initialIdleObserved = true;
    if (!waiting) session.outputBurst = false;
    if (session.waiting === waiting) return;
    session.waiting = waiting;
    for (const listener of session.attentionListeners) listener(waiting);
    if (waiting) this.recordLifecycle(session, 'idle');
  }

  private recordLifecycle(session: PtySession, state: 'starting' | 'working' | 'idle' | 'error' | 'disconnected', action: string | null = null): void {
    if (!session.workspaceId || !session.nodeId) return;
    const recorder = (globalThis as unknown as {
      __orkestraiRecordActivity?: (input: {
        workspaceId: string;
        nodeId: string;
        state: typeof state;
        action?: string | null;
        metadata?: Record<string, unknown>;
      }) => void;
    }).__orkestraiRecordActivity;
    recorder?.({
      workspaceId: session.workspaceId,
      nodeId: session.nodeId,
      state,
      action,
      metadata: { sessionId: session.id, provider: session.provider ?? null },
    });
  }

  private drainDeliveryQueue(session: PtySession): void {
    if (
      session.exited ||
      (session.startupGuard && !session.startupGuard.canAcceptMessages) ||
      session.deliveryInProgress ||
      session.awaitingDeliveryIdle ||
      session.humanComposerLength > 0
    ) {
      return;
    }
    const delivery = session.deliveryQueue.shift();
    if (!delivery) return;

    session.activeDelivery = delivery;
    session.deliveryInProgress = true;
    const outputRevisionAtWrite = session.outputRevision;
    const textWrittenAt = Date.now();
    delivery.humanInputRevision = session.humanInputRevision;
    try {
      // Explicit paste boundaries avoid provider heuristics turning a large
      // handoff and its following Enter into a single never-submitted paste.
      this.write(session.id, session.bracketedPaste
        ? `\x1b[200~${delivery.text}\x1b[201~`
        : delivery.text);
    } catch (error) {
      session.deliveryInProgress = false;
      session.activeDelivery = null;
      delivery.reject(error instanceof Error ? error : new Error(String(error)));
      this.drainDeliveryQueue(session);
      return;
    }

    // ConPTY/WSL precisa de mais tempo para processar prompts grandes antes do
    // Enter. Alem do piso adaptativo, esperamos o redraw do composer ficar
    // quieto: um timeout fixo deixava o Enter ultrapassar a colagem no Windows.
    const submitDelayMs = session.provider && session.conptySubmitGuard
      ? Math.max(delivery.submitDelayMs, Math.min(2_000, 250 + Math.ceil(delivery.text.length / 8)))
      : delivery.submitDelayMs;
    const submit = () => {
      if (session.exited || this.sessions.get(session.id) !== session) return;
      const now = Date.now();
      const elapsed = now - textWrittenAt;
      const sawComposerOutput = session.outputRevision > outputRevisionAtWrite;
      const outputQuiet = !sawComposerOutput || now - session.lastOutputAt >= COMPOSER_OUTPUT_QUIET_MS;
      if (elapsed < submitDelayMs || (!outputQuiet && elapsed < COMPOSER_SETTLE_LIMIT_MS)) {
        session.deliveryTimer = setTimeout(submit, Math.min(100, Math.max(20, submitDelayMs - elapsed)));
        session.deliveryTimer.unref?.();
        return;
      }
      try {
        if (session.startupGuard && !session.startupGuard.canAcceptMessages) {
          throw new Error('Complete the provider workspace trust confirmation in its terminal before sending agent messages.');
        }
        session.lastSubmitOutputRevision = session.outputRevision;
        const submittedAt: PtyOutputMark = { sessionId: session.id, length: session.outputLength };
        delivery.submittedAt = Date.now();
        this.write(session.id, '\r');
        if (session.provider) {
          // Like a prompt the owner submits: the agent works from here on, and
          // `write` cleared `waiting` without a report, so every screen would
          // keep showing it idle until its next quiet spell.
          session.outputBurst = true;
          this.recordLifecycle(session, 'working');
        }
        session.lastSubmittedDelivery = delivery;
        session.lastDeliveryAccepted = false;
        delivery.resolve();
        session.awaitingDeliveryIdle = true;
        session.deliveryReadyAt = Date.now() + this.deliverySettleMs(session);
        this.scheduleDeliveryBarrierFallback(session);
        try {
          delivery.onSubmitted?.(submittedAt);
        } catch {
          // An observer never undoes a submitted delivery.
        }
      } catch (error) {
        delivery.reject(error instanceof Error ? error : new Error(String(error)));
      } finally {
        session.deliveryInProgress = false;
        session.activeDelivery = null;
        if (!session.exited && this.sessions.get(session.id) === session) {
          this.flushDeferredHumanInput(session);
          this.drainDeliveryQueue(session);
        } else {
          session.deferredHumanInput.length = 0;
        }
      }
    };
    session.deliveryTimer = setTimeout(submit, Math.min(100, submitDelayMs));
    session.deliveryTimer.unref?.();
  }

  private async waitForOutputAfter(id: string, revision: number, timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (!signal?.aborted && Date.now() < deadline) {
      const session = this.sessions.get(id);
      if (!session || session.exited) return false;
      if (session.outputRevision > revision) return true;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    }
    return false;
  }

  private async waitForAcceptance(
    isAccepted: () => Promise<boolean>,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (!signal?.aborted && Date.now() < deadline) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let cancel: (() => void) | undefined;
      const pending = new Promise<never>((_resolve, reject) => {
        cancel = () => reject(new Error('Agent message delivery cancelled.'));
        signal?.addEventListener('abort', cancel, { once: true });
        timer = setTimeout(() => reject(new Error('Transcript confirmation timed out. Delivery is uncertain; inspect the terminal before retrying.')), Math.max(1, deadline - Date.now()));
      });
      let accepted: boolean;
      try {
        // A stalled UNC/network read is unknown delivery, not a missing Enter.
        // Never send another Enter while that confirmation is unresolved.
        accepted = await Promise.race([isAccepted(), pending]);
      } finally {
        clearTimeout(timer);
        if (cancel) signal?.removeEventListener('abort', cancel);
      }
      if (accepted) return true;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
    }
    return false;
  }

  private scheduleDeliveryBarrierFallback(session: PtySession): void {
    if (session.deliveryTimer) clearTimeout(session.deliveryTimer);
    const delay = Math.max(SESSION_IDLE_MS, session.deliveryReadyAt - Date.now());
    session.deliveryTimer = setTimeout(() => this.releaseDeliveryBarrierWhenReady(session), delay);
    session.deliveryTimer.unref?.();
  }

  private deliverySettleMs(session: PtySession): number {
    return session.provider
      ? AGENT_DELIVERY_SETTLE_MS
      : SHELL_DELIVERY_SETTLE_MS;
  }

  private releaseDeliveryBarrierWhenReady(session: PtySession): void {
    if (!session.awaitingDeliveryIdle || session.exited) return;
    if (session.lastSubmittedDelivery?.requiresAcceptance && !session.lastDeliveryAccepted) {
      const delivery = session.lastSubmittedDelivery;
      if (delivery.confirmAcceptance && !delivery.confirmationPending) {
        delivery.confirmationPending = true;
        // The caller can time out or disconnect after a successful paste.
        // Late exact acceptance must still release the session's queue.
        void delivery.confirmAcceptance().then((accepted) => {
          if (!accepted || session.exited || session.lastSubmittedDelivery !== delivery) return;
          session.lastDeliveryAccepted = true;
          session.deliveryReadyAt = Date.now();
          this.releaseDeliveryBarrierWhenReady(session);
        }).catch(() => undefined).finally(() => {
          delivery.confirmationPending = false;
          if (!session.exited && session.lastSubmittedDelivery === delivery) this.scheduleDeliveryBarrierFallback(session);
        });
      }
      return;
    }
    const now = Date.now();
    const outputQuiet = session.lastOutputAt === 0 || now - session.lastOutputAt >= SESSION_IDLE_MS;
    if (now < session.deliveryReadyAt || (!outputQuiet && !session.lastDeliveryAccepted)) {
      this.scheduleDeliveryBarrierFallback(session);
      return;
    }
    session.awaitingDeliveryIdle = false;
    session.lastSubmittedDelivery = null;
    session.lastDeliveryAccepted = false;
    if (session.deliveryTimer) clearTimeout(session.deliveryTimer);
    session.deliveryTimer = null;
    this.drainDeliveryQueue(session);
  }

  private flushDeferredHumanInput(session: PtySession): void {
    const chunks = session.deferredHumanInput.splice(0);
    for (const chunk of chunks) this.writeHumanInputNow(session, chunk.data, chunk.imagePaste);
  }

  private writeHumanInputNow(session: PtySession, data: string, imagePaste = false): void {
    session.startupGuard?.humanInput(data);
    const prompts = session.provider ? trackHumanDraft(session.humanDraft, data) : [];
    const submitted = this.updateHumanComposerState(session, data, imagePaste);
    this.write(session.id, data);
    if (session.provider && submitted) {
      // The owner just started a turn: the agent is working from here on.
      // Typing cleared `waiting` without a report, so say it explicitly.
      session.outputBurst = true;
      this.recordLifecycle(session, 'working');
      for (const text of prompts) this.emitHumanPrompt(session, text);
      session.lastSubmittedDelivery = null;
      session.lastDeliveryAccepted = false;
      // The renderer may submit a human prompt while an automatic handoff is
      // already queued. Give the TUI time to consume Enter and keep the queue
      // behind any response; otherwise both prompts can become one turn.
      session.awaitingDeliveryIdle = true;
      session.deliveryReadyAt = Math.max(
        session.deliveryReadyAt,
        Date.now() + HUMAN_SUBMIT_SETTLE_MS,
      );
      this.scheduleDeliveryBarrierFallback(session);
      return;
    }
    if (session.humanComposerLength === 0) queueMicrotask(() => this.drainDeliveryQueue(session));
  }

  /** Hands a line the owner submitted in the terminal to the Chat mirror. */
  private emitHumanPrompt(session: PtySession, text: string): void {
    if (!session.workspaceId || !session.nodeId) return;
    const mirror = (globalThis as {
      __orkestraiHumanPrompt?: (input: { workspaceId: string; nodeId: string; sessionId: string; text: string; at: number }) => void;
    }).__orkestraiHumanPrompt;
    mirror?.({ workspaceId: session.workspaceId, nodeId: session.nodeId, sessionId: session.id, text, at: Date.now() });
  }

  private updateHumanComposerState(session: PtySession, data: string, imagePaste = false): boolean {
    return session.humanComposerInput.consume(data, char => {
      const code = char.charCodeAt(0);
      if (char === '\r' || char === '\n' || code === 0x03 || code === 0x15 || code === 0x1b) {
        session.humanComposerLength = 0;
      } else if (code === 0x7f || code === 0x08) {
        session.humanComposerLength = Math.max(0, session.humanComposerLength - 1);
      } else if (code >= 0x20 || (code === 0x16 && imagePaste)) {
        // Ctrl+V with an image on the clipboard (the renderer asks the app)
        // becomes a chip in the CLI's own field: a draft the inbox must not
        // type over. Without one the CLI pastes nothing, and nothing is held.
        session.humanComposerLength += 1;
      }
    });
  }

  private rejectDeliveries(session: PtySession, error: Error): void {
    session.activeDelivery?.reject(error);
    session.activeDelivery = null;
    for (const delivery of session.deliveryQueue.splice(0)) delivery.reject(error);
    session.deliveryInProgress = false;
    session.awaitingDeliveryIdle = false;
    session.lastSubmittedDelivery = null;
    session.lastDeliveryAccepted = false;
  }

  private requireSession(id: string): PtySession {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Sessão PTY não encontrada: ${id}`);
    return session;
  }

  private toInfo(session: PtySession): PtySessionInfo {
    return {
      id: session.id,
      command: session.command,
      args: session.args,
      cwd: session.cwd,
      cols: session.cols,
      rows: session.rows,
      createdAt: session.createdAt,
      lastActivityAt: new Date(session.lastOutputAt || Date.parse(session.createdAt)).toISOString(),
      exited: session.exited,
      exitCode: session.exitCode,
      waiting: session.waiting,
      label: session.label,
      workspace: session.workspace,
      workspaceId: session.workspaceId,
      nodeId: session.nodeId,
      provider: session.provider,
      agentSessionId: session.agentSessionId,
      transcriptHome: session.transcriptHome,
      transcriptCwd: session.transcriptCwd,
      runtimeKey: session.runtimeKey,
      /** Já produziu algum output (boot comecou/terminou) — usado na prontidao do ask. */
      hasOutput: session.scrollback.length > 0,
    };
  }
}

// Import dinamico adiado para não carregar o nativo fora do servidor.
// Em producao empacotada (macOS 15+), o spawn-helper do node-pty não executa
// de dentro do bundle não-notarizado — o Electron extrai o módulo para o
// userData e aponta ORKESTRAI_PTY_MODULE para la.
import { createRequire } from 'node:module';

const nodeRequire = createRequire(import.meta.url);
const { spawn: ptySpawn } = nodeRequire(process.env.ORKESTRAI_PTY_MODULE ?? 'node-pty') as typeof import('node-pty');

/**
 * Singleton process-wide via globalThis: o código SSR e bundlado pelo vite
 * (build/server/chunks) enquanto a camada WS roda direto do src via type
 * stripping — sem isso cada copia teria seu proprio "singleton" e as sessões
 * PTY criadas pelo WS ficariam invisiveis para os services (rotinas, bridge).
 */
const globalRef = globalThis as unknown as { __orkestraiPtyManager?: PtySessionManager };
export const ptySessionManager = (globalRef.__orkestraiPtyManager ??= new PtySessionManager(ptySpawn));
