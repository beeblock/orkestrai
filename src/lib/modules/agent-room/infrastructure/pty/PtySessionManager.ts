import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readlink } from 'node:fs/promises';
import { platform } from 'node:os';
import { promisify } from 'node:util';
import type { IPty } from 'node-pty';
import type { WorkspaceExecutionRuntime } from '../../domain/types.ts';
import { executionRuntimeKey } from '../../domain/runtime.ts';
import { agentEnv, resolveCommand } from '../agent-path.ts';
import { buildWslLaunch } from '../WslRuntime.ts';

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
  exited: boolean;
  exitCode: number | null;
  /** true quando a sessão parou de produzir saída (estado neutro de ociosidade). */
  waiting: boolean;
  /** Já produziu algum output — usado na espera de prontidao antes de escrever. */
  hasOutput: boolean;
  /** Rotulos humanos (título do no / workspace) para notificações. */
  label?: string | null;
  workspace?: string | null;
  workspaceId?: string | null;
  nodeId?: string | null;
  /** Provider registrado; ausente em shells puros. */
  provider?: string | null;
  /** Stable native/WSL identity used to avoid cross-runtime reattachment. */
  runtimeKey: string;
};

export type PtySessionListener = (data: string) => void;
export type PtyExitListener = (exitCode: number) => void;
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

type PtySession = PtySessionInfo & {
  pty: IPty;
  scrollback: string;
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
  deliveryReadyAt: number;
  deferredHumanInput: string[];
  humanComposerLength: number;
  lastOutputAt: number;
  outputRevision: number;
  lastSubmitOutputRevision: number;
  conptySubmitGuard: boolean;
};

type ComposerDelivery = {
  text: string;
  submitDelayMs: number;
  resolve: () => void;
  reject: (error: Error) => void;
};

export type ComposerDeliveryHandle = {
  submitted: Promise<void>;
  /** Cancela somente enquanto a entrega ainda está aguardando na fila. */
  cancel: () => boolean;
};

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
};

const SCROLLBACK_LIMIT = 256 * 1024; // 256 KB por sessão
const SESSION_IDLE_MS = 2_500;
const AGENT_DELIVERY_SETTLE_MS = 8_000;
const SHELL_DELIVERY_SETTLE_MS = 400;

/**
 * Texto seguro para composers de TUI (Claude/Codex/Kimi): remove bytes de
 * controle (atalhos como Ctrl+X abrem o editor externo do Claude!) e achata
 * newlines — \n solto num composer e um Enter (submit parcial da mensagem).
 */
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

  constructor(spawnPty: typeof import('node-pty').spawn) {
    this.spawnPty = spawnPty;
  }

  create(input: CreatePtySessionInput): PtySessionInfo {
    const id = randomUUID();
    const cols = input.cols ?? 120;
    const rows = input.rows ?? 30;

    const env = { ...agentEnv(), ...input.env } as Record<string, string>;
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
      exited: false,
      exitCode: null,
      waiting: false,
      hasOutput: false,
      label: input.label ?? null,
      workspace: input.workspace ?? null,
      workspaceId: input.workspaceId ?? null,
      nodeId: input.nodeId ?? null,
      provider: input.provider ?? null,
      runtimeKey: executionRuntimeKey(input.runtime ?? { kind: 'native' }),
      pty: ptyProcess,
      scrollback: '',
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
      deliveryReadyAt: 0,
      deferredHumanInput: [],
      humanComposerLength: 0,
      lastOutputAt: 0,
      outputRevision: 0,
      lastSubmitOutputRevision: 0,
      conptySubmitGuard: platform() === 'win32' || input.runtime?.kind === 'wsl',
    };

    ptyProcess.onData((data) => {
      const firstOutput = session.scrollback.length === 0;
      const resumedFromIdle = session.waiting;
      session.lastOutputAt = Date.now();
      session.outputRevision += 1;
      session.scrollback = (session.scrollback + data).slice(-SCROLLBACK_LIMIT);
      for (const listener of session.listeners) listener(data);
      this.scheduleAttentionCheck(session);
      if (firstOutput || resumedFromIdle) this.recordLifecycle(session, 'working');
    });

    ptyProcess.onExit(({ exitCode }) => {
      session.exited = true;
      session.exitCode = exitCode;
      if (session.idleTimer) clearTimeout(session.idleTimer);
      if (session.deliveryTimer) clearTimeout(session.deliveryTimer);
      if (session.workingDirectoryTimer) clearTimeout(session.workingDirectoryTimer);
      this.rejectDeliveries(session, new Error(`Sessão PTY ${id} finalizada com código ${exitCode}.`));
      this.setWaiting(session, false);
      for (const listener of session.exitListeners) listener(exitCode);
      this.recordLifecycle(session, exitCode === 0 ? 'disconnected' : 'error', exitCode === 0 ? null : `PTY exited with code ${exitCode}`);
    });

    this.sessions.set(id, session);
    this.recordLifecycle(session, 'starting');
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

  get(id: string): PtySessionInfo | null {
    const session = this.sessions.get(id);
    return session ? this.toInfo(session) : null;
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

    const scrollback = session.scrollback;
    if (session.exited && onExit) {
      queueMicrotask(() => onExit(session.exitCode ?? 0));
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

  write(id: string, data: string): void {
    const session = this.requireSession(id);
    if (session.exited) throw new Error(`Sessão PTY ${id} já finalizada.`);
    this.setWaiting(session, false);
    session.pty.write(data);
  }

  /**
   * Entrada originada no terminal visivel. Enquanto uma entrega automatica
   * está entre o texto e o Enter, as teclas ficam em memória por alguns
   * milissegundos e são reproduzidas logo depois. Isso impede que o rascunho
   * humano seja concatenado a uma mensagem de outro agente.
   */
  writeHumanInput(id: string, data: string): void {
    const session = this.requireSession(id);
    if (session.exited) throw new Error(`Sessão PTY ${id} já finalizada.`);
    if (session.deliveryInProgress) {
      session.deferredHumanInput.push(data);
      return;
    }
    this.writeHumanInputNow(session, data);
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
    session.cols = cols;
    session.rows = rows;
    session.pty.resize(cols, rows);
  }

  kill(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    if (session.idleTimer) clearTimeout(session.idleTimer);
    if (session.deliveryTimer) clearTimeout(session.deliveryTimer);
    if (session.workingDirectoryTimer) clearTimeout(session.workingDirectoryTimer);
    this.rejectDeliveries(session, new Error(`Sessão PTY ${id} encerrada.`));
    if (!session.exited) {
      try {
        session.pty.kill();
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
    options: { submitDelayMs?: number; confirmationWindowMs?: number; maxAttempts?: number } = {},
  ): Promise<void> {
    const session = this.requireSession(id);
    await this.queueWithSubmit(id, text, options.submitDelayMs ?? 200).submitted;
    if (!session.provider || !session.conptySubmitGuard) return;

    const confirmationWindowMs = options.confirmationWindowMs ?? 4_000;
    const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
    let revisionAtSubmit = session.lastSubmitOutputRevision;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (await this.waitForOutputAfter(id, revisionAtSubmit, confirmationWindowMs)) return;
      const current = this.requireSession(id);
      if (current.exited) throw new Error(`Sessão PTY ${id} finalizada antes de confirmar o envio.`);
      if (attempt === maxAttempts) break;
      revisionAtSubmit = current.outputRevision;
      if (!this.submitIfComposerFree(id)) {
        throw new Error(`A sessão PTY ${id} não pôde confirmar o envio porque o composer está ocupado.`);
      }
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
      if (session.waiting) return true;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
    }
    return false;
  }

  queueWithSubmit(id: string, text: string, submitDelayMs = 200): ComposerDeliveryHandle {
    const session = this.requireSession(id);
    if (session.exited) {
      return {
        submitted: Promise.reject(new Error(`Sessão PTY ${id} já finalizada.`)),
        cancel: () => false,
      };
    }
    const sanitized = sanitizeComposerText(text);
    if (!sanitized) {
      return {
        submitted: Promise.reject(new Error('A mensagem para o terminal está vazia.')),
        cancel: () => false,
      };
    }

    let delivery!: ComposerDelivery;
    const submitted = new Promise<void>((resolve, reject) => {
      delivery = { text: sanitized, submitDelayMs, resolve, reject };
      session.deliveryQueue.push(delivery);
      this.drainDeliveryQueue(session);
    });
    return {
      submitted,
      cancel: () => {
        const index = session.deliveryQueue.indexOf(delivery);
        if (index < 0) return false;
        session.deliveryQueue.splice(index, 1);
        delivery.reject(new Error('Entrega ao terminal cancelada antes do envio.'));
        return true;
      },
    };
  }

  /** Reenvia Enter apenas se não houver um rascunho humano em andamento. */
  submitIfComposerFree(id: string): boolean {
    const session = this.requireSession(id);
    if (session.exited || session.deliveryInProgress || session.humanComposerLength > 0) return false;
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
      this.setWaiting(session, true);
      this.releaseDeliveryBarrierWhenReady(session);
    }, SESSION_IDLE_MS);
  }

  private setWaiting(session: PtySession, waiting: boolean): void {
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
    try {
      this.write(session.id, delivery.text);
    } catch (error) {
      session.deliveryInProgress = false;
      session.activeDelivery = null;
      delivery.reject(error instanceof Error ? error : new Error(String(error)));
      this.drainDeliveryQueue(session);
      return;
    }

    // ConPTY/WSL precisa de mais tempo para processar prompts grandes antes do
    // Enter. Shells mantêm o delay solicitado; TUIs usam um delay adaptativo.
    const submitDelayMs = session.provider && session.conptySubmitGuard
      ? Math.max(delivery.submitDelayMs, Math.min(2_000, 250 + Math.ceil(delivery.text.length / 8)))
      : delivery.submitDelayMs;
    const timer = setTimeout(() => {
      try {
        session.lastSubmitOutputRevision = session.outputRevision;
        this.write(session.id, '\r');
        delivery.resolve();
        session.awaitingDeliveryIdle = true;
        session.deliveryReadyAt = Date.now() + this.deliverySettleMs(session);
        this.scheduleDeliveryBarrierFallback(session);
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
    }, submitDelayMs);
    timer.unref?.();
  }

  private async waitForOutputAfter(id: string, revision: number, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const session = this.sessions.get(id);
      if (!session || session.exited) return false;
      if (session.outputRevision > revision) return true;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
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
    const now = Date.now();
    const outputQuiet = session.lastOutputAt === 0 || now - session.lastOutputAt >= SESSION_IDLE_MS;
    if (now < session.deliveryReadyAt || !outputQuiet) {
      this.scheduleDeliveryBarrierFallback(session);
      return;
    }
    session.awaitingDeliveryIdle = false;
    if (session.deliveryTimer) clearTimeout(session.deliveryTimer);
    session.deliveryTimer = null;
    this.drainDeliveryQueue(session);
  }

  private flushDeferredHumanInput(session: PtySession): void {
    const chunks = session.deferredHumanInput.splice(0);
    for (const chunk of chunks) this.writeHumanInputNow(session, chunk);
  }

  private writeHumanInputNow(session: PtySession, data: string): void {
    this.updateHumanComposerState(session, data);
    this.write(session.id, data);
    if (session.humanComposerLength === 0) queueMicrotask(() => this.drainDeliveryQueue(session));
  }

  private updateHumanComposerState(session: PtySession, data: string): void {
    // Remove sequencias CSI/OSC antes de estimar o conteúdo visivel. Não e um
    // parser de terminal: só precisamos distinguir rascunho de controles.
    const visible = data
      .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g, '')
      .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
      .replace(/\u001B./g, '');
    for (const char of visible) {
      const code = char.charCodeAt(0);
      if (char === '\r' || char === '\n' || code === 0x03 || code === 0x15 || code === 0x1b) {
        session.humanComposerLength = 0;
      } else if (code === 0x7f || code === 0x08) {
        session.humanComposerLength = Math.max(0, session.humanComposerLength - 1);
      } else if (code >= 0x20) {
        session.humanComposerLength += 1;
      }
    }
  }

  private rejectDeliveries(session: PtySession, error: Error): void {
    session.activeDelivery?.reject(error);
    session.activeDelivery = null;
    for (const delivery of session.deliveryQueue.splice(0)) delivery.reject(error);
    session.deliveryInProgress = false;
    session.awaitingDeliveryIdle = false;
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
      exited: session.exited,
      exitCode: session.exitCode,
      waiting: session.waiting,
      label: session.label,
      workspace: session.workspace,
      workspaceId: session.workspaceId,
      nodeId: session.nodeId,
      provider: session.provider,
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
