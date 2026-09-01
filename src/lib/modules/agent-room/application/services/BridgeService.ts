import { randomBytes } from 'node:crypto';
import { Event } from '@beeblock/svelar/events';
import { uuidv7 } from '@beeblock/svelar/support';
import { access, chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import type { AgentActivityState, CanvasNode, ModelEffort, Workspace, WorkspaceExecutionRuntime } from '../../domain/types.js';
import { findFreeCanvasPosition, type CanvasPlacementRect } from '../../domain/canvas-placement.js';
import { AgentWorkspace } from '../../domain/models/AgentWorkspace.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { ptySessionManager, sanitizeComposerText } from '../../infrastructure/pty/PtySessionManager.ts';
import { agentSessionTracker } from '../../infrastructure/pty/AgentSessionTracker.js';
import { findReplyToPrompt, type MatchedTranscriptReply } from '../../infrastructure/transcript/AgentTranscript.js';
import { floorService } from './FloorService.js';
import { getAgentAdapter, hasAgentAdapter, listAgentAdapters, materializeInteractiveAgentCommand } from '../adapters/registry.js';
import { nativeNotificationService, type NativeNotificationKind } from './NativeNotificationService.js';
import { defaultShell } from '../../infrastructure/workspace.js';
import { FIGMA_MCP_URL, repairLegacyCodexMcpConfig } from '../../infrastructure/codex-mcp-config.js';
import { repairConfigFileAtomically } from '../../infrastructure/atomic-config-repair.js';
import { updateOrkestraiGitExclude } from '../../infrastructure/bridge-git-exclude.js';
import { controlCenterService } from './ControlCenterService.js';
import { AutomationTriggerReceived } from '../../domain/events/AutomationTriggerReceived.js';
import { agentSessionService } from './AgentSessionService.js';
import { roleService } from './RoleService.js';
import { providerProfileService } from './ProviderProfileService.js';

export function resolveAgentReplyText(
  transcriptText: string | null,
  rawTerminalText: string,
  provider: string | null | undefined,
  targetTitle: string
): string {
  if (transcriptText) return transcriptText;
  if (provider) {
    throw new Error(
      `A resposta de "${targetTitle}" chegou ao terminal, mas o transcript estruturado da sessão não pôde ser confirmado. ` +
      'Recarregue esse terminal para reparar a associação da conversa e tente novamente.'
    );
  }
  return sanitizeComposerText(rawTerminalText);
}

export type BridgeAgent = {
  nodeId: string;
  title: string;
  provider: string | null;
  command: string | null;
  sessionId: string | null;
  sessionAlive: boolean;
  /** true quando o agente e o líder do time (Modo Maestro). */
  maestro: boolean;
};

export type BridgePortal = {
  id: string;
  title: string;
  url: string;
  /** null quando a chamada não tem a identidade de um agente para comparar. */
  connected: boolean | null;
};

type BridgeAskInput = {
  to: string;
  message: string;
  from?: string | null;
  timeoutMs?: number;
  signal?: AbortSignal;
  messageId?: string;
  metadata?: Record<string, unknown>;
};

type BridgeAskResult = {
  to: string;
  reply: string;
  delivered: boolean;
  replyConfirmed: boolean;
  timedOut: boolean;
  messageId: string;
  deliveryState: 'replied' | 'failed';
};

function occupiedOnFloor(nodes: CanvasNode[], floorId: string | null): CanvasPlacementRect[] {
  return nodes
    .filter((node) => (node.floorId ?? null) === floorId)
    .map((node) => ({ x: node.x, y: node.y, width: node.width, height: node.height }));
}

// Remove sequencias ANSI (cores, cursor, etc.) do output de TUIs.
const ANSI_PATTERN = /[[][0-9;?]*[a-zA-Z]|\][^]*|[()][0-9A-B]/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '').replace(/\r\n/g, '\n').trim();
}

/** Título curto de no: primeira linha, max 48 chars (títulos-frase quebram o header). */
function shortTitle(title: string, max = 48): string {
  const first = title.split('\n')[0].trim();
  return first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first;
}

/** URL sem esquema: http para hosts locais (dev server), https para o resto. */
function defaultPortalUrl(url: string): string {
  const local = /^(localhost|127\.|0\.0\.0\.0|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?)/.test(url);
  return `${local ? 'http' : 'https'}://${url}`;
}

function normalizePortalUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (trimmed.length > 2_048) throw new Error('A URL do portal excede o limite de 2048 caracteres.');
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : defaultPortalUrl(trimmed);
  const parsed = new URL(candidate);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('O portal aceita apenas URLs HTTP ou HTTPS.');
  if (parsed.username || parsed.password) throw new Error('A URL do portal não pode conter credenciais.');
  const normalized = parsed.toString();
  return parsed.pathname === '/' && !parsed.search && !parsed.hash ? normalized.slice(0, -1) : normalized;
}

function comparablePortalUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(normalizePortalUrl(rawUrl));
    parsed.hash = '';
    const normalized = parsed.toString();
    return parsed.pathname === '/' && !parsed.search ? normalized.slice(0, -1) : normalized;
  } catch {
    return null;
  }
}

/**
 * Ponte agente<->app: autentica chamadas da CLI `orkestrai` por token de
 * workspace, lista agentes, injeta mensagens em terminais PTY (ask com
 * resposta), le/escreve notas e provisiona arquivos de skill/config.
 */
export class BridgeService {
  private readonly askTails = new Map<string, Promise<void>>();

  /** Resolve o workspace dono do token; lanca erro se inválido. */
  async resolveWorkspaceByToken(token: string): Promise<Workspace> {
    const model = await AgentWorkspace.query().where('bridge_token', token).first();
    if (!model) throw new Error('Token de bridge inválido.');
    const workspace = await workspaceRepository.getWorkspace(model.getAttribute('id'));
    if (!workspace) throw new Error('Workspace não encontrado.');
    return workspace;
  }

  /** Token do workspace, gerando (e persistindo config) se ainda não existir. */
  async getOrCreateToken(workspaceId: string, apiUrl?: string): Promise<string> {
    const workspace = await workspaceRepository.getWorkspace(workspaceId);
    if (!workspace) throw new Error('Workspace não encontrado.');

    const existing = await AgentWorkspace.query().where('id', workspaceId).first();
    const token = existing?.getAttribute('bridge_token') as string | null;
    if (token) {
      await this.writeBridgeConfig(workspace, token, apiUrl);
      return token;
    }

    const generated = randomBytes(24).toString('hex');
    await AgentWorkspace.query().where('id', workspaceId).update({ bridge_token: generated });
    await this.writeBridgeConfig(workspace, generated, apiUrl);
    return generated;
  }

  /** Lista os terminais (agentes) do workspace com estado da sessão PTY. */
  async listAgents(workspaceId: string): Promise<BridgeAgent[]> {
    const nodes = await workspaceRepository.listNodes(workspaceId);
    return nodes
      .filter((node) => node.type === 'terminal')
      .map((node) => {
        const payload = node.payload as { provider?: string; command?: string; sessionId?: string; maestro?: boolean };
        const sessionId = payload.sessionId ?? null;
        const session = sessionId ? ptySessionManager.get(sessionId) : null;
        return {
          nodeId: node.id,
          title: node.title ?? 'terminal',
          provider: payload.provider ?? null,
          command: payload.command ?? null,
          sessionId,
          sessionAlive: Boolean(session && !session.exited),
          maestro: Boolean(payload.maestro),
        };
      });
  }

  /**
   * Envia uma mensagem ao terminal de destino e aguarda a resposta:
   * escreve no PTY, acumula a saída e resolve quando o alvo fica ocioso
   * (deteccao de atenção) ou estoura o timeout. Se `from` for informado,
   * a resposta também e injetada de volta no terminal de origem.
   */
  /** Envia bytes brutos ao terminal (controlar TUIs/pagers interativos). */
  async askRaw(workspaceId: string, input: { to: string; message: string; from?: string | null }): Promise<{ to: string; sent: boolean; messageId: string; deliveryState: 'delivered' }> {
    const agents = await this.listAgents(workspaceId);
    const target = this.findAgent(agents, input.to);
    if (!target.sessionId || !target.sessionAlive) {
      throw new Error(`O agente "${target.title}" não tem uma sessão PTY ativa.`);
    }
    const origin = input.from ? this.findAgent(agents, input.from) : null;
    const messageId = uuidv7();
    await controlCenterService.recordDelivery({
      messageId,
      workspaceId,
      fromNodeId: origin?.nodeId ?? null,
      toNodeId: target.nodeId,
      state: 'queued',
      content: input.message,
      metadata: { raw: true },
    });
    await controlCenterService.recordDelivery({
      messageId,
      workspaceId,
      fromNodeId: origin?.nodeId ?? null,
      toNodeId: target.nodeId,
      state: 'sent',
      content: input.message,
      metadata: { raw: true },
    });
    ptySessionManager.write(target.sessionId, input.message);
    await controlCenterService.recordDelivery({
      messageId,
      workspaceId,
      fromNodeId: origin?.nodeId ?? null,
      toNodeId: target.nodeId,
      state: 'delivered',
      content: input.message,
      metadata: { raw: true },
    });
    // Pulso de "conversando" na edge (raw não tem ciclo de resposta).
    this.broadcastTalking(workspaceId, null, target.nodeId, true);
    const pulse = setTimeout(() => this.broadcastTalking(workspaceId, null, target.nodeId, false), 6_000);
    pulse.unref?.();
    return { to: target.title, sent: true, messageId, deliveryState: 'delivered' };
  }

  /** Envia uma mensagem submetida sem aguardar resposta, para handoffs e feedback de review. */
  async sendOneWay(
    workspaceId: string,
    input: { to: string; message: string; kind?: string },
  ): Promise<{ to: string; sent: boolean; messageId: string; deliveryState: 'delivered' }> {
    const target = this.findAgent(await this.listAgents(workspaceId), input.to);
    if (!target.sessionId || !target.sessionAlive) {
      throw new Error(`O agente "${target.title}" não tem uma sessão PTY ativa.`);
    }
    const messageId = uuidv7();
    const metadata = { oneWay: true, kind: input.kind ?? 'handoff' };
    await controlCenterService.recordDelivery({
      messageId,
      workspaceId,
      fromNodeId: null,
      toNodeId: target.nodeId,
      state: 'queued',
      content: input.message,
      metadata,
    });
    const delivery = ptySessionManager.queueWithSubmit(target.sessionId, input.message, 120);
    await delivery.submitted;
    await controlCenterService.recordDelivery({
      messageId,
      workspaceId,
      fromNodeId: null,
      toNodeId: target.nodeId,
      state: 'delivered',
      content: input.message,
      metadata,
    });
    this.broadcastTalking(workspaceId, null, target.nodeId, true);
    const pulse = setTimeout(() => this.broadcastTalking(workspaceId, null, target.nodeId, false), 4_000);
    pulse.unref?.();
    return { to: target.title, sent: true, messageId, deliveryState: 'delivered' };
  }

  async ask(workspaceId: string, input: BridgeAskInput): Promise<BridgeAskResult> {
    const target = this.findAgent(await this.listAgents(workspaceId), input.to);
    const key = `${workspaceId}:${target.nodeId}`;
    const previous = this.askTails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.catch(() => undefined).then(() => gate);
    this.askTails.set(key, tail);

    try {
      if (input.signal?.aborted) throw new Error('Agent request cancelled.');
      if (input.signal) {
        await new Promise<void>((resolve, reject) => {
          const onAbort = () => {
            input.signal?.removeEventListener('abort', onAbort);
            reject(new Error('Agent request cancelled.'));
          };
          input.signal?.addEventListener('abort', onAbort, { once: true });
          previous.catch(() => undefined).then(() => {
            input.signal?.removeEventListener('abort', onAbort);
            resolve();
          });
        });
      } else {
        await previous.catch(() => undefined);
      }
      return await this.performAsk(workspaceId, input);
    } finally {
      release();
      void tail.finally(() => {
        if (this.askTails.get(key) === tail) this.askTails.delete(key);
      });
    }
  }

  private async performAsk(workspaceId: string, input: BridgeAskInput): Promise<BridgeAskResult> {
    const agents = await this.listAgents(workspaceId);
    const target = this.findAgent(agents, input.to);
    if (!target.sessionId || !target.sessionAlive) {
      throw new Error(`O agente "${target.title}" não tem uma sessão PTY ativa.`);
    }

    const origin = input.from ? this.findAgent(agents, input.from) : null;
    if (origin) await this.ensureEdge(workspaceId, origin.nodeId, target.nodeId);
    const messageId = input.messageId ?? uuidv7();
    const requestStartedAt = Date.now();
    const metadata = input.metadata ?? {};
    await controlCenterService.recordDelivery({
      messageId,
      workspaceId,
      fromNodeId: origin?.nodeId ?? null,
      toNodeId: target.nodeId,
      state: 'queued',
      content: input.message,
      metadata,
    });
    await controlCenterService.recordDelivery({
      messageId,
      workspaceId,
      fromNodeId: origin?.nodeId ?? null,
      toNodeId: target.nodeId,
      state: 'sent',
      content: input.message,
      metadata,
    });

    this.broadcastTalking(workspaceId, origin?.nodeId ?? null, target.nodeId, true);
    let reply: { text: string; timedOut: boolean };
    let transcriptMatch: MatchedTranscriptReply | null = null;
    let terminalDelivered = false;
    const transcriptAbort = new AbortController();
    const abortFromCaller = () => transcriptAbort.abort();
    input.signal?.addEventListener('abort', abortFromCaller, { once: true });
    let markSubmitted: (() => void) | null = null;
    const submitted = new Promise<void>((resolve) => {
      markSubmitted = resolve;
    });
    try {
      const terminalReply = this.askAndWait(
        target.sessionId,
        input.message,
        input.timeoutMs ?? 180_000,
        transcriptAbort.signal,
        target.provider,
        async () => {
          terminalDelivered = true;
          await controlCenterService.recordDelivery({
            messageId,
            workspaceId,
            fromNodeId: origin?.nodeId ?? null,
            toNodeId: target.nodeId,
            state: 'delivered',
            content: input.message,
            metadata,
          });
          await controlCenterService.recordActivity({
            workspaceId,
            nodeId: target.nodeId,
            state: 'working',
            action: 'system:message_received',
            metadata: { ...metadata, fromTitle: origin?.title ?? null },
            category: 'message',
            verb: 'received',
            objectType: 'message',
            objectId: messageId,
            objectTitle: input.message.slice(0, 120),
            outcome: null,
            correlationId: typeof metadata.correlationId === 'string' ? metadata.correlationId : `message:${messageId}`,
            sourceType: 'bridge',
            sourceId: messageId,
          });
          markSubmitted?.();
        },
      );
      const structuredReply = submitted.then(() => this.waitForTranscriptReply(
        workspaceId,
        target.nodeId,
        target.sessionId!,
        input.message,
        requestStartedAt,
        input.timeoutMs ?? 180_000,
        transcriptAbort.signal,
      ));
      const winner = await Promise.race([
        terminalReply.then((value) => ({ kind: 'terminal' as const, value })),
        structuredReply.then((value) => ({ kind: 'transcript' as const, value })),
      ]);
      if (winner.kind === 'transcript' && winner.value) {
        transcriptMatch = winner.value;
        reply = { text: '', timedOut: false };
        transcriptAbort.abort();
        await terminalReply.catch(() => undefined);
      } else {
        reply = winner.kind === 'terminal' ? winner.value : await terminalReply;
        const immediate = await this.transcriptReply(
          workspaceId,
          target.nodeId,
          target.sessionId,
          input.message,
          requestStartedAt,
        ).catch(() => null);
        if (immediate?.complete) transcriptMatch = immediate;
        else if (immediate) transcriptMatch = await structuredReply ?? immediate;
      }
    } catch (error) {
      await controlCenterService.recordDelivery({
        messageId,
        workspaceId,
        fromNodeId: origin?.nodeId ?? null,
        toNodeId: target.nodeId,
        state: 'failed',
        content: input.message,
        error: error instanceof Error ? error.message : String(error),
        metadata,
      });
      throw error;
    } finally {
      transcriptAbort.abort();
      input.signal?.removeEventListener('abort', abortFromCaller);
      this.broadcastTalking(workspaceId, origin?.nodeId ?? null, target.nodeId, false);
    }

    // O transcrito estruturado evita ANSI/redraw e só é aceito quando a última
    // pergunta coincide exatamente com a mensagem injetada nesta chamada.
    let incompleteTranscript: MatchedTranscriptReply | null = null;
    const immediateTranscript = await this.transcriptReply(
      workspaceId,
      target.nodeId,
      target.sessionId,
      input.message,
      requestStartedAt,
    ).catch(() => null);
    if (immediateTranscript?.complete) transcriptMatch ??= immediateTranscript;
    else incompleteTranscript = immediateTranscript;
    if (!transcriptMatch) {
      const node = await workspaceRepository.getNode(target.nodeId);
      const payload = (node?.payload ?? {}) as { provider?: string; agentSessionId?: string };
      // Só espera quando a sessão da CLI já foi identificada; sem isso não há
      // um transcrito estruturado que possa confirmar a resposta com segurança.
      if (payload.provider && payload.agentSessionId) {
        const deadline = Date.now() + 90_000;
        while (!transcriptMatch && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 2_000));
          const candidate = await this.transcriptReply(
            workspaceId,
            target.nodeId,
            target.sessionId,
            input.message,
            requestStartedAt,
          ).catch(() => null);
          if (candidate?.complete) transcriptMatch = candidate;
          else if (candidate) incompleteTranscript = candidate;
        }
      }
    }
    transcriptMatch ??= incompleteTranscript;
    const transcriptText = transcriptMatch?.text ?? null;
    // Usa o provider da sessao PTY real, não apenas o metadata do nó. Isso
    // mantém shells explícitos utilizáveis e protege somente TUIs de agentes.
    const activeProvider = target.sessionId
      ? ptySessionManager.get(target.sessionId)?.provider ?? target.provider
      : target.provider;
    let replyText: string;
    try {
      replyText = resolveAgentReplyText(transcriptText, reply.text, activeProvider, target.title);
    } catch (error) {
      await controlCenterService.recordDelivery({
        messageId,
        workspaceId,
        fromNodeId: origin?.nodeId ?? null,
        toNodeId: target.nodeId,
        state: 'failed',
        content: input.message,
        error: error instanceof Error ? error.message : String(error),
        metadata,
      });
      throw error;
    }
    const replyConfirmed = Boolean(transcriptText) || (!activeProvider && !reply.timedOut && Boolean(replyText));

    if (terminalDelivered && (reply.text || transcriptText)) {
      await controlCenterService.recordDelivery({
        messageId,
        workspaceId,
        fromNodeId: origin?.nodeId ?? null,
        toNodeId: target.nodeId,
        state: 'acknowledged',
        content: input.message,
        metadata,
      });
    }
    if (replyConfirmed) {
      await controlCenterService.recordDelivery({
        messageId,
        workspaceId,
        fromNodeId: origin?.nodeId ?? null,
        toNodeId: target.nodeId,
        state: 'replied',
        content: input.message,
        reply: replyText,
        metadata,
      });
      await controlCenterService.recordActivity({
        workspaceId,
        nodeId: target.nodeId,
        state: 'idle',
        action: 'system:message_replied',
        metadata: { ...metadata, toTitle: origin?.title ?? null },
        category: 'message',
        verb: 'replied',
        objectType: 'message',
        objectId: messageId,
        objectTitle: input.message.slice(0, 120),
        outcome: replyText.slice(0, 240),
        severity: 'success',
        correlationId: typeof metadata.correlationId === 'string' ? metadata.correlationId : `message:${messageId}`,
        sourceType: 'bridge',
        sourceId: messageId,
      });
    } else {
      await controlCenterService.recordDelivery({
        messageId,
        workspaceId,
        fromNodeId: origin?.nodeId ?? null,
        toNodeId: target.nodeId,
        state: 'failed',
        content: input.message,
        error: reply.timedOut ? 'Reply timed out' : 'Reply could not be confirmed',
        metadata,
      });
    }

    // A resposta chega ao agente de origem pelo RETORNO do comando (stdout da
    // CLI / resultado da tool MCP). NAO injetamos mais no composer de origem:
    // o texto digitado colidia com o que o usuário estava escrevendo naquele
    // terminal (mensagem emendada/corrompida).
    // Voz de volta: o no alvo pode ler a resposta em voz alta (toggle por
    // terminal; TTS na voz/idioma configurados — ver /api/agent-room/voice/speak).
    const broadcast = (globalThis as { __orkestraiBroadcast?: (payload: Record<string, unknown>) => void }).__orkestraiBroadcast;
    broadcast?.({ type: 'agentReply', workspaceId, to: target.nodeId, from: origin?.title ?? null, text: replyText });
    await Event.dispatch(new AutomationTriggerReceived(
      workspaceId,
      'message',
      'received',
      `message:${messageId}`,
      {
        message: input.message,
        reply: replyText,
        fromNodeId: origin?.nodeId ?? null,
        fromTitle: origin?.title ?? null,
        toNodeId: target.nodeId,
        toTitle: target.title,
      },
    )).catch(() => undefined);

    return {
      to: target.title,
      reply: replyText,
      delivered: terminalDelivered,
      replyConfirmed,
      timedOut: reply.timedOut && !replyConfirmed,
      messageId,
      deliveryState: replyConfirmed ? 'replied' : 'failed',
    };
  }

  private async waitForTranscriptReply(
    workspaceId: string,
    nodeId: string,
    ptySessionId: string,
    prompt: string,
    since: number,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<MatchedTranscriptReply | null> {
    const deadline = Date.now() + timeoutMs;
    let incomplete: MatchedTranscriptReply | null = null;
    while (!signal.aborted && Date.now() < deadline) {
      const match = await this.transcriptReply(workspaceId, nodeId, ptySessionId, prompt, since).catch(() => null);
      if (match?.complete) return match;
      if (match) incomplete = match;
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
    return incomplete;
  }

  /** Resposta vinculada à pergunta exata e à sessão real do terminal alvo. */
  private async transcriptReply(
    workspaceId: string,
    nodeId: string,
    ptySessionId: string,
    prompt: string,
    since: number,
  ): Promise<MatchedTranscriptReply | null> {
    const node = await workspaceRepository.getNode(nodeId);
    const payload = (node?.payload ?? {}) as { provider?: string; agentSessionId?: string };
    const preferredSessionId = agentSessionTracker.agentSessionIdForPty(ptySessionId) ?? payload.agentSessionId ?? null;
    if (!node || !payload.provider) return null;
    const workspace = await workspaceRepository.getWorkspace(workspaceId);
    let cwd = workspace?.workingDir ?? '.';
    if (node.floorId) {
      const floor = await floorService.get(node.floorId).catch(() => null);
      if (floor?.path) cwd = floor.path;
    }
    const match = await findReplyToPrompt(payload.provider, cwd, preferredSessionId, prompt, since);
    if (!match || match.sessionId === payload.agentSessionId) return match;
    await workspaceRepository.updateNode(node.id, {
      payload: { ...payload, agentSessionId: match.sessionId } as never,
    });
    const broadcast = (globalThis as { __orkestraiBroadcast?: (frame: Record<string, unknown>) => void }).__orkestraiBroadcast;
    broadcast?.({ type: 'workspaceChanged', workspaceId, nodeId: node.id });
    return match;
  }

  /** Avisa o canvas (via broadcast WS) que uma edge esta conversando. */
  private broadcastTalking(workspaceId: string, from: string | null, to: string, talking: boolean) {
    const broadcast = (globalThis as { __orkestraiBroadcast?: (payload: Record<string, unknown>) => void }).__orkestraiBroadcast;
    broadcast?.({ type: 'talking', workspaceId, from, to, talking });
  }

  /** Avisa o canvas para recarregar o conteúdo do workspace (nos/edges/andares). */
  notifyWorkspaceChanged(workspaceId: string) {
    const broadcast = (globalThis as { __orkestraiBroadcast?: (payload: Record<string, unknown>) => void }).__orkestraiBroadcast;
    broadcast?.({ type: 'workspaceChanged', workspaceId });
  }

  async readNote(workspaceId: string, nodeId: string): Promise<{ nodeId: string; title: string; content: string }> {
    const node = await this.requireNoteNode(workspaceId, nodeId);
    const payload = node.payload as {
      content?: string;
      attachments?: Array<{ name?: string; path?: string | null; url?: string | null }>;
    };
    const attachmentList = (payload.attachments ?? [])
      .map((attachment) => `- ${attachment.name ?? 'attachment'}: ${attachment.path ?? attachment.url ?? ''}`)
      .join('\n');
    const content = [
      String(payload.content ?? ''),
      attachmentList ? `Attachments:\n${attachmentList}` : '',
    ].filter(Boolean).join('\n\n');
    return { nodeId: node.id, title: node.title ?? 'nota', content };
  }

  /** Cria uma nota no canvas (e opcionalmente já conecta a um agente ou a todos). */
  async createNote(
    workspaceId: string,
    input: { title: string; content?: string; connect?: string | null }
  ): Promise<{ nodeId: string; title: string; connectedTo: string | null }> {
    const siblings = await workspaceRepository.listNodes(workspaceId);
    const position = findFreeCanvasPosition(occupiedOnFloor(siblings, null), {
      x: 120,
      y: 120,
      width: 320,
      height: 220,
    });
    const note = await workspaceRepository.createNode({
      workspaceId,
      type: 'note',
      title: input.title.trim(),
      x: position.x,
      y: position.y,
      width: 320,
      height: 220,
      payload: { content: input.content ?? '' },
    });
    let connectedTo: string | null = null;
    if (input.connect === 'all') {
      // Specs/briefs do líder: visiveis para o time inteiro.
      const agents = await this.listAgents(workspaceId);
      for (const agent of agents) {
        await this.ensureEdge(workspaceId, note.id, agent.nodeId);
      }
      connectedTo = 'todos os agentes';
    } else if (input.connect) {
      const agents = await this.listAgents(workspaceId);
      const agent = this.findAgent(agents, input.connect);
      await this.ensureEdge(workspaceId, note.id, agent.nodeId);
      connectedTo = agent.title;
    }
    this.notifyWorkspaceChanged(workspaceId);
    return { nodeId: note.id, title: note.title ?? input.title, connectedTo };
  }

  async writeNote(workspaceId: string, nodeId: string, content: string) {
    const node = await this.requireNoteNode(workspaceId, nodeId);
    const payload = { ...(node.payload as Record<string, unknown>), content };
    await workspaceRepository.updateNode(node.id, { payload });
    return { nodeId: node.id, written: content.length };
  }

  async editNote(workspaceId: string, nodeId: string, oldText: string, newText: string) {
    const node = await this.requireNoteNode(workspaceId, nodeId);
    const content = String((node.payload as { content?: string }).content ?? '');
    if (!content.includes(oldText)) {
      throw new Error('Trecho antigo não encontrado na nota.');
    }
    const next = content.replace(oldText, newText);
    const payload = { ...(node.payload as Record<string, unknown>), content: next };
    await workspaceRepository.updateNode(node.id, { payload });
    return { nodeId: node.id, edited: true };
  }

  /** Notas conectadas a um agente (arestas terminal<->nota do workspace). */
  async notesForAgent(workspaceId: string, agentNodeId: string): Promise<string[]> {
    const edges = await workspaceRepository.listEdges(workspaceId);
    const noteIds = new Set<string>();
    for (const edge of edges) {
      if (edge.sourceNodeId === agentNodeId) noteIds.add(edge.targetNodeId);
      if (edge.targetNodeId === agentNodeId) noteIds.add(edge.sourceNodeId);
    }
    const nodes = await workspaceRepository.listNodes(workspaceId);
    return nodes.filter((node) => noteIds.has(node.id) && node.type === 'note').map((node) => node.id);
  }

  /** Descoberta tipada para agentes: notas conectadas, ou todas sem identidade. */
  async listNotes(workspaceId: string, agentNodeId?: string | null): Promise<Array<{
    nodeId: string;
    title: string;
    preview: string;
  }>> {
    const connectedIds = agentNodeId
      ? new Set(await this.notesForAgent(workspaceId, agentNodeId))
      : null;
    const nodes = await workspaceRepository.listNodes(workspaceId);
    return nodes
      .filter((node) => node.type === 'note' && (!connectedIds || connectedIds.has(node.id)))
      .map((node) => ({
        nodeId: node.id,
        title: node.title ?? 'Nota',
        preview: String((node.payload as { content?: string }).content ?? '').trim().slice(0, 280),
      }));
  }

  /** Todos os portais do workspace, com conexão relativa ao agente explicitada. */
  async listPortals(workspaceId: string, agentNodeId?: string | null): Promise<BridgePortal[]> {
    const connectedIds = new Set<string>();
    if (agentNodeId) {
      const edges = await workspaceRepository.listEdges(workspaceId);
      for (const edge of edges) {
        if (edge.sourceNodeId === agentNodeId) connectedIds.add(edge.targetNodeId);
        if (edge.targetNodeId === agentNodeId) connectedIds.add(edge.sourceNodeId);
      }
    }
    const nodes = await workspaceRepository.listNodes(workspaceId);
    return nodes
      .filter((node) => node.type === 'portal')
      .map((node) => ({
        id: node.id,
        title: node.title ?? 'portal',
        url: String((node.payload as { url?: string }).url ?? ''),
        connected: agentNodeId ? connectedIds.has(node.id) : null,
      }));
  }

  /** Resolve portal por id, nome exato ou trecho único, sempre confinado ao workspace. */
  async resolvePortal(workspaceId: string, query: string): Promise<BridgePortal> {
    const portals = await this.listPortals(workspaceId);
    const normalized = query.trim().toLocaleLowerCase();
    const byId = portals.find((portal) => portal.id === query);
    if (byId) return byId;
    const exact = portals.filter((portal) => portal.title.toLocaleLowerCase() === normalized);
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) {
      throw new Error(`Há mais de um portal chamado "${query}". Use o ID: ${exact.map((portal) => portal.id).join(', ')}.`);
    }
    const partial = portals.filter((portal) => portal.title.toLocaleLowerCase().includes(normalized));
    if (partial.length === 1) return partial[0];
    if (partial.length > 1) {
      throw new Error(
        `O nome "${query}" corresponde a vários portais: ${partial.map((portal) => `"${portal.title}" (${portal.id})`).join(', ')}.`
      );
    }
    throw new Error(`Portal "${query}" não encontrado neste workspace.`);
  }

  /** Compatibilidade interna para consumidores que precisam apenas dos conectados. */
  async portalsForAgent(workspaceId: string, agentNodeId: string): Promise<Array<{ id: string; title: string; url: string }>> {
    return (await this.listPortals(workspaceId, agentNodeId))
      .filter((portal) => portal.connected)
      .map(({ id, title, url }) => ({ id, title, url }));
  }

  /** Designs conectados ao agente, usados pelo briefing automatico da ponte. */
  async designsForAgent(workspaceId: string, agentNodeId: string): Promise<Array<{ id: string; title: string }>> {
    const edges = await workspaceRepository.listEdges(workspaceId);
    const designIds = new Set<string>();
    for (const edge of edges) {
      if (edge.sourceNodeId === agentNodeId) designIds.add(edge.targetNodeId);
      if (edge.targetNodeId === agentNodeId) designIds.add(edge.sourceNodeId);
    }
    const nodes = await workspaceRepository.listNodes(workspaceId);
    return nodes
      .filter((node) => designIds.has(node.id) && node.type === 'design')
      .map((node) => ({ id: node.id, title: node.title ?? 'design' }));
  }

  async notify(
    workspace: Workspace,
    input: { message: string; kind?: NativeNotificationKind; title?: string | null; from?: string | null }
  ): Promise<{ notified: boolean }> {
    if (input.from) {
      const agent = this.findAgent(await this.listAgents(workspace.id), input.from);
      const state: AgentActivityState = input.kind === 'attention'
        ? 'waiting_input'
        : input.kind === 'task' || input.kind === 'project'
          ? 'done'
          : 'idle';
      await controlCenterService.recordActivity({
        workspaceId: workspace.id,
        nodeId: agent.nodeId,
        state,
        action: input.title?.trim() || input.message,
        category: input.kind === 'task' ? 'task' : 'system',
        verb: input.kind === 'attention' ? 'requested' : 'notified',
        objectType: input.kind ?? 'notification',
        objectTitle: input.title?.trim() || input.message,
        outcome: input.message,
        severity: input.kind === 'attention' ? 'warning' : input.kind === 'task' || input.kind === 'project' ? 'success' : 'info',
        sourceType: 'notification',
        attentionRequired: input.kind === 'attention',
      });
    }
    return nativeNotificationService.send(workspace, input);
  }

  async reportActivity(
    workspaceId: string,
    input: { from: string; state: AgentActivityState; action?: string | null; taskId?: string | null },
  ): Promise<{ recorded: boolean; nodeId: string; state: AgentActivityState }> {
    const agent = this.findAgent(await this.listAgents(workspaceId), input.from);
    const event = await controlCenterService.recordActivity({
      workspaceId,
      nodeId: agent.nodeId,
      state: input.state,
      action: input.action,
      taskId: input.taskId,
    });
    return { recorded: Boolean(event), nodeId: agent.nodeId, state: input.state };
  }


  // -- Modo Maestro -----------------------------------------------------------

  /** Garante que o agente `from` tem permissao de maestro no workspace. */
  private async requireMaestro(workspaceId: string, from: string): Promise<BridgeAgent> {
    const agents = await this.listAgents(workspaceId);
    const origin = this.findAgent(agents, from);
    const node = await workspaceRepository.getNode(origin.nodeId);
    const maestro = Boolean((node?.payload as { maestro?: boolean } | undefined)?.maestro);
    if (!maestro) {
      throw new Error(`O agente "${origin.title}" não está no Modo Maestro. Ative no nó do terminal.`);
    }
    return origin;
  }

  /**
   * Recruta um novo agente: cria um no terminal no canvas com o comando TUI
   * do provider. Com `replace`, substitui o recruta existente (preserva
   * posicao/nome, troca o comando).
   */
  async recruit(
    workspaceId: string,
    input: { from: string; title: string; provider?: string | null; profile?: string | null; model?: string | null; effort?: ModelEffort | null; role?: string | null; x?: number; y?: number; replace?: string | null; floorId?: string | null }
  ) {
    const origin = await this.requireMaestro(workspaceId, input.from);
    const originNode = await workspaceRepository.getNode(origin.nodeId);
    const inheritedRuntime = (originNode?.payload as { executionRuntime?: unknown } | undefined)?.executionRuntime;
    const targetFloorId = input.floorId ?? originNode?.floorId ?? null;

    if (input.profile && !input.provider) {
      throw new Error('Use --provider together with --profile when recruiting an agent.');
    }
    const profileId = input.provider && input.profile
      ? (await providerProfileService.resolveByIdOrName(input.provider, input.profile))?.id ?? (() => { throw new Error(`Perfil "${input.profile}" não encontrado para o provider "${input.provider}".`); })()
      : null;
    const command = this.commandForProvider(input.provider, { model: input.model, effort: input.effort });
    // Fail before changing the canvas when a profile is incomplete, without
    // serializing its resolved environment (which may contain a token).
    if (profileId) await providerProfileService.resolveEnv(profileId, input.provider!);
    if (targetFloorId) {
      const floor = (await floorService.list(workspaceId)).find((candidate) => candidate.id === targetFloorId);
      if (!floor) throw new Error('Andar ativo não encontrado neste workspace.');
    }

    if (input.replace) {
      const agents = await this.listAgents(workspaceId);
      const existing = this.findAgent(agents, input.replace);
      const node = (await workspaceRepository.getNode(existing.nodeId))!;
      const previousPayload = { ...(node.payload as Record<string, unknown>) };
      const previousTitle = node.title;
      let payload: Record<string, unknown> = {
        ...(node.payload as Record<string, unknown>),
        ...command,
        env: command.env,
        provider: input.provider ?? null,
        profileId,
        model: input.model ?? null,
        effort: input.effort ?? null,
        role: input.role ?? (node.payload as { role?: string }).role,
        sessionId: undefined,
        agentSessionId: undefined,
      };
      delete payload.sessionId;
      delete payload.agentSessionId;
      const role = input.role ? await roleService.launchContext(workspaceId, input.role).catch(() => null) : null;
      payload = materializeInteractiveAgentCommand(payload, role).payload;
      ptySessionManager.killNode(workspaceId, node.id);
      const previousProvider = typeof previousPayload.provider === 'string' ? previousPayload.provider : null;
      const previousAgentSessionId = typeof previousPayload.agentSessionId === 'string' ? previousPayload.agentSessionId : null;
      if (previousProvider && previousAgentSessionId) {
        ptySessionManager.killAgentSession(previousProvider, previousAgentSessionId);
      }
      const previousSessionId = typeof previousPayload.sessionId === 'string' ? previousPayload.sessionId : null;
      if (previousSessionId && ptySessionManager.get(previousSessionId)) ptySessionManager.kill(previousSessionId);
      const updated = await workspaceRepository.updateNode(node.id, { payload, title: input.title || node.title });
      try {
        const active = await agentSessionService.ensure(workspaceId, node.id);
        this.notifyWorkspaceChanged(workspaceId);
        return { nodeId: updated!.id, title: updated!.title, replaced: true, sessionId: active.sessionId, sessionState: active.state };
      } catch (error) {
        await workspaceRepository.updateNode(node.id, { payload: previousPayload as never, title: previousTitle });
        this.notifyWorkspaceChanged(workspaceId);
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`Não foi possível iniciar o agente substituto "${input.title || node.title}": ${detail}`);
      }
    }

    // Sem coordenadas explicitas: organograma — fileira abaixo do maestro.
    const position = input.x == null || input.y == null
      ? await this.orgChartPosition(workspaceId, origin.nodeId, targetFloorId)
      : null;

    let payload: Record<string, unknown> = {
      ...command,
      provider: input.provider ?? null,
      profileId,
      model: input.model ?? null,
      effort: input.effort ?? null,
      role: input.role ? shortTitle(input.role, 60) : null,
      ...(inheritedRuntime ? { executionRuntime: inheritedRuntime } : {}),
    };
    const role = input.role ? await roleService.launchContext(workspaceId, input.role).catch(() => null) : null;
    payload = materializeInteractiveAgentCommand(payload, role).payload;

    const node = await workspaceRepository.createNode({
      workspaceId,
      type: 'terminal',
      title: await this.uniqueAgentTitle(workspaceId, shortTitle(input.title)),
      x: input.x ?? position!.x,
      y: input.y ?? position!.y,
      width: 640,
      height: 400,
      payload,
      floorId: targetFloorId,
    });
    try {
      // O recruit só confirma depois de o nó ter um PTY funcional. Isso evita
      // agentes fantasma quando a UI ainda não renderizou o canvas, sobretudo no WSL.
      await this.ensureEdge(workspaceId, origin.nodeId, node.id);
      const active = await agentSessionService.ensure(workspaceId, node.id);
      this.notifyWorkspaceChanged(workspaceId);
      return { nodeId: node.id, title: node.title, replaced: false, sessionId: active.sessionId, sessionState: active.state };
    } catch (error) {
      await workspaceRepository.deleteNode(node.id);
      this.notifyWorkspaceChanged(workspaceId);
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Não foi possível recrutar "${node.title}": ${detail}`);
    }
  }

  /** Título único por workspace: "Dev" ocupado vira "Dev 2", "Dev 3"... (ask ambiguo quebra o roteamento). */
  private async uniqueAgentTitle(workspaceId: string, title: string): Promise<string> {
    const agents = await this.listAgents(workspaceId);
    const taken = new Set(agents.map((agent) => agent.title.toLowerCase()));
    if (!taken.has(title.toLowerCase())) return title;
    for (let suffix = 2; ; suffix += 1) {
      const candidate = `${title} ${suffix}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  }

  /** Cria a aresta se o par ainda não estiver conectado (qualquer direcao). */
  private async ensureEdge(workspaceId: string, a: string, b: string): Promise<string | null> {
    if (a === b) return null;
    const edges = await workspaceRepository.listEdges(workspaceId);
    const existing = edges.find(
      (edge) =>
        (edge.sourceNodeId === a && edge.targetNodeId === b) ||
        (edge.sourceNodeId === b && edge.targetNodeId === a)
    );
    if (existing) return existing.id;
    const created = await workspaceRepository.createEdge({ workspaceId, sourceNodeId: a, targetNodeId: b });
    return created.id;
  }

  /**
   * Posicao de organograma para um novo recruta: fileiras de 3 abaixo do
   * maestro, offsets estaveis (nos já postos nunca se movem). O maestro só
   * recruta reports diretos, entao uma árvore de 1 nível basta.
   */
  private async orgChartPosition(workspaceId: string, maestroNodeId: string, floorId?: string | null) {
    const maestro = await workspaceRepository.getNode(maestroNodeId);
    const nodes = await workspaceRepository.listNodes(workspaceId);
    const targetFloor = floorId !== undefined ? floorId : ((maestro as { floorId?: string | null } | null)?.floorId ?? null);
    const recruits = nodes.filter(
      (node) => node.type === 'terminal' && node.id !== maestroNodeId && ((node as { floorId?: string | null }).floorId ?? null) === targetFloor
    );
    const index = recruits.length;
    const perRow = 3;
    const row = Math.floor(index / perRow);
    const col = index % perRow;
    const leaderCenterX = (maestro?.x ?? 0) + (maestro?.width ?? 640) / 2;
    const leaderBottomY = (maestro?.y ?? 0) + (maestro?.height ?? 400);
    const preferred = {
      x: Math.round(leaderCenterX + (col - 1) * 700 - 320),
      y: Math.round(leaderBottomY + 80 + row * 480),
      width: 640,
      height: 400,
    };
    return findFreeCanvasPosition(occupiedOnFloor(nodes, targetFloor), preferred, { rowsPerColumn: 3 });
  }

  /** Cria um portal (browser embutido) no canvas e conecta a um agente (default: o maestro). */
  async createPortal(
    workspaceId: string,
    input: { from: string; url: string; title?: string | null; connect?: string | null; forceNew?: boolean }
  ): Promise<{ nodeId: string; title: string; url: string; connectedTo: string | null; reused: boolean }> {
    const maestro = await this.requireMaestro(workspaceId, input.from);
    const maestroNode = await workspaceRepository.getNode(maestro.nodeId);
    const url = normalizePortalUrl(input.url);
    const portals = (await workspaceRepository.listNodes(workspaceId)).filter((candidate) => candidate.type === 'portal');
    const matchingPortal = portals.find((candidate) => {
      const existingUrl = String((candidate.payload as { url?: string }).url ?? '');
      return comparablePortalUrl(existingUrl) === comparablePortalUrl(url);
    });
    if (matchingPortal) {
      const connectedTo = await this.connectPortal(workspaceId, matchingPortal.id, maestro, input.connect);
      this.notifyWorkspaceChanged(workspaceId);
      return {
        nodeId: matchingPortal.id,
        title: matchingPortal.title ?? url,
        url: String((matchingPortal.payload as { url?: string }).url ?? url),
        connectedTo,
        reused: true,
      };
    }
    if (portals.length > 0 && !input.forceNew) {
      const available = portals.map((portal) => `"${portal.title ?? 'portal'}" (${portal.id})`).join(', ');
      throw new Error(
        `O workspace já possui portal: ${available}. Reutilize-o com portal_navigate/orkestrai portal <nodeId> navigate <url>. ` +
        'Crie outro apenas quando o usuário pedir explicitamente, usando forceNew/--force-new.'
      );
    }
    const portalPosition = findFreeCanvasPosition(occupiedOnFloor(await workspaceRepository.listNodes(workspaceId), null), {
      x: (maestroNode?.x ?? 0) + (maestroNode?.width ?? 640) + 80,
      y: maestroNode?.y ?? 120,
      width: 560,
      height: 400,
    });
    const node = await workspaceRepository.createNode({
      workspaceId,
      type: 'portal',
      title: shortTitle(input.title?.trim() || new URL(url).hostname),
      x: portalPosition.x,
      y: portalPosition.y,
      width: 560,
      height: 400,
      payload: { url },
    });
    const connectedTo = await this.connectPortal(workspaceId, node.id, maestro, input.connect);
    this.notifyWorkspaceChanged(workspaceId);
    return { nodeId: node.id, title: node.title ?? url, url, connectedTo, reused: false };
  }

  private async connectPortal(
    workspaceId: string,
    portalNodeId: string,
    maestro: BridgeAgent,
    connect?: string | null,
  ): Promise<string> {
    if (connect && connect !== 'all') {
      const agents = await this.listAgents(workspaceId);
      const agent = this.findAgent(agents, connect);
      await this.ensureEdge(workspaceId, agent.nodeId, portalNodeId);
      return agent.title;
    }
    if (connect === 'all') {
      const agents = await this.listAgents(workspaceId);
      for (const agent of agents) await this.ensureEdge(workspaceId, agent.nodeId, portalNodeId);
      return 'todos os agentes';
    }
    await this.ensureEdge(workspaceId, maestro.nodeId, portalNodeId);
    return maestro.title;
  }

  /**
   * Garante que existe um no de quadro (tasks) no canvas — criado na primeira
   * tarefa para o kanban não ficar invisivel "por baixo dos panos". O quadro
   * nasce conectado ao maestro (ou ao primeiro terminal).
   */
  async ensureTasksBoard(workspaceId: string): Promise<void> {
    const nodes = await workspaceRepository.listNodes(workspaceId);
    if (nodes.some((node) => node.type === 'tasks')) return;
    const anchor = nodes.find((node) => node.type === 'terminal' && Boolean((node.payload as { maestro?: boolean }).maestro))
      ?? nodes.find((node) => node.type === 'terminal');
    const boardPosition = findFreeCanvasPosition(occupiedOnFloor(nodes, null), {
      x: (anchor?.x ?? 0) + (anchor?.width ?? 640) + 80,
      y: (anchor?.y ?? 120) + 80,
      width: 480,
      height: 360,
    });
    const board = await workspaceRepository.createNode({
      workspaceId,
      type: 'tasks',
      title: 'Tarefas',
      x: boardPosition.x,
      y: boardPosition.y,
      width: 480,
      height: 360,
      payload: {},
    });
    if (anchor) await this.ensureEdge(workspaceId, anchor.id, board.id);
    this.notifyWorkspaceChanged(workspaceId);
  }

  /** Dispensa um recruta: mata a sessão PTY e remove o no do canvas. */
  async dismiss(workspaceId: string, input: { from: string; target: string }) {
    const origin = await this.requireMaestro(workspaceId, input.from);
    const agents = await this.listAgents(workspaceId);
    const target = this.findAgent(agents, input.target);
    if (target.nodeId === origin.nodeId) throw new Error('O maestro não pode dispensar a si mesmo.');
    ptySessionManager.killNode(workspaceId, target.nodeId);
    const targetNode = await workspaceRepository.getNode(target.nodeId);
    const targetPayload = (targetNode?.payload ?? {}) as { provider?: string; agentSessionId?: string };
    if (targetPayload.provider && targetPayload.agentSessionId) {
      ptySessionManager.killAgentSession(targetPayload.provider, targetPayload.agentSessionId);
    }
    if (target.sessionId && ptySessionManager.get(target.sessionId)) ptySessionManager.kill(target.sessionId);
    await workspaceRepository.deleteNode(target.nodeId);
    this.notifyWorkspaceChanged(workspaceId);
    return { dismissed: target.title };
  }

  /** Reatribui papel (e opcionalmente prompt) de um recruta, preservando o no. */
  async reassignRole(workspaceId: string, input: { from: string; target: string; role: string; prompt?: string | null }) {
    await this.requireMaestro(workspaceId, input.from);
    const agents = await this.listAgents(workspaceId);
    const target = this.findAgent(agents, input.target);
    const node = (await workspaceRepository.getNode(target.nodeId))!;
    const payload: Record<string, unknown> = { ...(node.payload as Record<string, unknown>), role: input.role };
    if (input.prompt != null) payload.rolePrompt = input.prompt;
    await workspaceRepository.updateNode(node.id, { payload });
    return { nodeId: node.id, role: input.role };
  }

  /** Conecta dois nos do canvas (qualquer par), exigindo maestro. */
  async connectNodes(workspaceId: string, input: { from: string; source?: string | null; to: string }) {
    const maestro = await this.requireMaestro(workspaceId, input.from);
    const agents = await this.listAgents(workspaceId);
    const origin = input.source ? this.findAgent(agents, input.source) : maestro;
    const target = this.findAgent(agents, input.to);
    const edgeId = await this.ensureEdge(workspaceId, origin.nodeId, target.nodeId);
    this.notifyWorkspaceChanged(workspaceId);
    return { edgeId, from: origin.title, to: target.title };
  }

  private commandForProvider(provider?: string | null, options?: { model?: string | null; effort?: ModelEffort | null }): { command: string; args: string[]; env?: Record<string, string> } {
    if (!provider) return { command: defaultShell(), args: [] };
    if (!hasAgentAdapter(provider)) throw new Error(`Provider desconhecido: ${provider}.`);
    const spec = getAgentAdapter(provider).interactiveCommand({
      model: options?.model ?? undefined,
      effort: options?.effort ?? undefined,
    });
    return { command: spec.command, args: spec.args, env: spec.env };
  }

  /** Conteúdo da skill da ponte (extraido para comparar/atualizar installs antigas). */
  bridgeSkillContent(): string {
    const providerIds = listAgentAdapters().map((adapter) => adapter.id).join('|');
    return `---
name: orkestrai-bridge
description: Ponte com o canvas do Orkestrai. Use SEMPRE que precisar falar com outro agente, participar de huddles, consultar cotas de providers, montar/orquestrar um time, distribuir tarefas, consultar ou registrar memória com fontes, consultar o grafo de código, criar notas, criar/testar coleções de API, ler ou editar designs nativos, controlar portais/devices, ou gerenciar andares.
---

# Ponte Orkestrai

Você está rodando dentro de um workspace do Orkestrai. A CLI \`orkestrai\` dá acesso à ponte.
Sua identidade já está no ambiente (ORKESTRAI_NODE_ID) — a CLI sabe quem você é, então \`--from\` e \`--agent\` são opcionais.
Se \`orkestrai\` não resolver no seu shell (acontece em alguns executores, ex.: Codex no Windows), execute o launcher da variável ORKESTRAI_CLI DIRETO (SEM prefixar \`node\`): \`"$ORKESTRAI_CLI" ...\` (Linux/macOS), \`%ORKESTRAI_CLI% ...\` (cmd.exe) ou \`& $env:ORKESTRAI_CLI ...\` (PowerShell). ORKESTRAI_CLI aponta para um launcher autocontido que já chama o runtime certo — funciona sempre, sem depender de PATH. NUNCA rode o caminho \`...orkestrai.js\` cru no Windows: o shell o abre pelo Windows Script Host e falha ("Caractere inválido").
Se as tools \`orkestrai\` (list/usage/ask/huddle_*/memory_*/code_graph_*/note_*/api_client_*/image_workflow_*/design_*/task_*/portal_*/floor_*/device_*/notify/port/recruit/dismiss) estiverem disponíveis como MCP neste ambiente, PREFIRA elas (chamadas tipadas, sem parse de shell) — a CLI continua valendo como fallback.

- \`orkestrai list\` — lista os agentes do workspace (título, provider, sessão viva), suas notas/designs conectados e TODOS os portais do workspace. Cada portal informa nome, URL, id e se está conectado a você; "não conectado" significa que ele JÁ EXISTE, não que deve ser criado. O agente marcado com [LIDER] e o maestro do time: "Maestro" e o PAPEL, não um título — fale com o líder pelo TITULO dele (ex.: \`orkestrai ask "Líder" ...\`), nunca por \`orkestrai ask "Maestro"\` (esse agente não existe).
- \`orkestrai usage\` — consulta as cotas reais e a política do nó Usage; perfis de multi-conta aparecem como linhas próprias (\`profileId\`/\`profileName\`). Quando \`shouldFallback\` for verdadeiro, direcione NOVAS tarefas e tarefas ainda pendentes ao \`recommendedProvider\` (se ele tiver \`:profile:\`, use \`--provider\` + \`--profile\` juntos no recruit). Não troque silenciosamente o provider ou perfil de um terminal que já executa trabalho.
- \`orkestrai ask "<TituloDoAgente>" "<mensagem>"\` — envia uma mensagem a outro agente e aguarda uma resposta confirmada. Só diga que falou/consultou o agente quando o comando terminar com sucesso e imprimir \`Resposta confirmada de ...\`. Timeout, erro ou \`Resposta nao confirmada\` significam que a conversa NÃO foi concluída — informe isso sem inventar resposta.
- Tools MCP \`huddle_list\` e \`huddle_say\` (ou \`orkestrai huddle list/say\`) — acompanhe a transcrição de um huddle e registre sua contribuição quando você for participante. \`huddle_say\` apenas registra sua fala; não use para simular outra pessoa nem para disparar fan-out recursivo.
- Tools MCP \`code_graph_status/index/search/symbol/neighbors/changes/contracts/quality/semantic/evidence/context/operations/explain/locate/revisions/compare/investigation/handoff\` (ou \`orkestrai graph ...\`) — consulte o grafo compartilhado antes de explicar arquitetura, dependências ou impacto. Use \`explain\` para procedência, \`locate\` para sincronizar código e grafo, \`operations\` para agentes/tarefas/Floors e conflitos, \`context\` para pacotes revisáveis com orçamento explícito, \`compare\` para revisões e \`investigation\` para salvar/restaurar visão, filtros, seleção, câmera e arquivo. Consulte \`changes\` antes de integrar, \`contracts\` para APIs, \`quality\` como evidência e \`semantic\` somente após construir o índice local. Importe \`evidence\` apenas de caminho relativo confinado. Use \`handoff\` para Review Center ou tarefa rastreável; líder, agente e Council recebem revisão e ids de origem. Nunca invente relações ausentes nem peça SQL/Cypher arbitrário.
- \`orkestrai status working "<ação atual>" --task <taskId>\` — registra o trabalho atual no Control Center. Use \`waiting_input\`, \`waiting_permission\`, \`blocked\`, \`idle\`, \`done\` ou \`error\` sempre que houver uma transição real; não use como heartbeat.
- Tools MCP \`memory_search/add/revise/archive\` — consulte memória sob demanda antes de decisões relevantes. Registre somente conhecimento reutilizável (decisão, fato, preferência, restrição, referência ou aprendizado) com uma fonte explícita. Nunca injete toda a memória no prompt nem salve conversa solta automaticamente. Para corrigir algo, use \`memory_revise\` com a revisão retornada pela busca; não duplique nem sobrescreva concorrência.
- \`orkestrai memory list [consulta] --json\` / \`memory add ... --source-label ...\` / \`memory revise ...\` / \`memory archive <id>\` — fallbacks CLI para a mesma memória durável e versionada.
- \`orkestrai note read <nodeId>\` — lê uma nota conectada a você.
- \`orkestrai note create "<título>" [--content "<texto>"] [--connect "<Agente>"|all]\` — cria uma nota no canvas (default: conecta ao time inteiro).
- \`orkestrai note write <nodeId> "<conteúdo>"\` — substitui o conteúdo da nota.
- \`orkestrai note edit <nodeId> "<trecho antigo>" "<trecho novo>"\` — edição pontual.
- \`orkestrai notes\` — lista \`nodeId\`, título e prévia das notas acessíveis. Rode antes de criar; se a nota já existe, use \`note read\` e \`note write/edit\` em vez de duplicar.
- \`orkestrai api list\` — lista requests dos Clientes de API conectados, sem revelar credenciais.
- Tool MCP \`api_client_reference\` (ou \`orkestrai api reference\`) — consulte antes de autorar uma coleção: retorna o contrato completo e exemplos de testes/variáveis nos runtimes Bruno, Postman e Orkestrai.
- Tools MCP \`api_client_import/create/read/replace/sync_status/pull/push/export\` — importam coleções Bruno/Postman do repositório e editam requests, pastas, ambientes, runners, scripts e testes no mesmo node que o usuário vê. Para um projeto existente, use \`api_client_import\` com caminho relativo ou um alias de repositório listado por \`orkestrai list\` (ex.: \`@api-tests/bruno\`); o vínculo acompanha a origem e \`replace\` grava nela por padrão. Sempre faça \`read\` antes de \`replace\` e envie o \`fingerprint\`; conflito exige \`sync_status\` e resolução explícita, nunca sobrescreva silenciosamente. O marcador \`__ORKESTRAI_REDACTED__\` preserva segredos locais.
- Tool MCP \`api_client_run_runner\` — executa o runner salvo com ordem, ambiente, iterações, dados por linha, variáveis encadeadas, testes e parada em falha; revise o resumo antes de exportar.
- Ao escrever testes, escolha o runtime da coleção: Bruno usa \`test(...)/expect(...)\` e \`bru.*\`; Postman usa \`pm.test/pm.expect\`; Orkestrai aceita \`pm.test/pm.expect\` e os aliases \`test/expect\`. O export preserva JavaScript, não traduz dialetos silenciosamente.
- \`orkestrai api import <path>\` / \`api read <nodeId>\` / \`api create <titulo> --file <json>\` / \`api replace <nodeId> --file <json> --fingerprint <sha256>\` / \`api sync-status|pull|push <nodeId>\` / \`api run-runner <nodeId> <runnerId>\` / \`api export <nodeId> <bruno|postman>\` — fallbacks CLI para a mesma autoria completa e persistência no repositório.
- \`orkestrai api run <nodeId> <requestId> [--variables '{"baseUrl":"..."}']\` — executa um request salvo com as variáveis informadas.
- Tools MCP \`image_workflow_*\` (ou \`orkestrai image ...\`) — controle completo dos fluxos nativos executados por Codex: crie e configure sem executar, conecte/reordene Notas e Imagens, adicione referencias do workspace, gere de 1 a 10 resultados, valide cada arquivo, conclua, cancele ou remova. Leia o contrato, use somente a tool nativa \`image_gen.imagegen\` com \`referenced_image_paths\`, copie cada resultado para o destino pre-alocado e chame \`image_workflow_validate\`. Se alpha real for exigido e a validacao falhar, chame \`image_gen.imagegen\` novamente com a propria saida invalida como unica referencia e o prompt corretivo retornado pelo validador; substitua o arquivo e valide novamente, ate tres tentativas por output. Toda mudanca visual, inclusive remover fundo, precisa vir de \`image_gen.imagegen\`: nunca use Python, Pillow, ImageMagick, ffmpeg, remove-bg, mascaras geradas ou processamento local de pixels. So depois valide todos com \`image_workflow_complete\`. Nunca peça chave de API, chame a API Images diretamente ou use \`scripts/image_gen.py\`.
- \`orkestrai design list\` / \`design read <nodeId>\` — lista e lê o scene graph de documentos visuais nativos conectados ao trabalho. Leia sempre a revisão atual antes de alterar.
- Tool MCP \`design_reference\` — consulte UMA vez o tópico necessário para obter campos e exemplos exatos. Em explorações, faça primeiro um conceito de 1 desktop + 1 mobile com \`design_import_code\` (HTML/CSS semântico) ou um lote pequeno de \`design_create_elements\`, entregue a primeira revisão em até 5 minutos e AGUARDE o gate humano. Só a direção aprovada recebe o blueprint completo com tokens, componentes, protótipo e motion. NUNCA inspecione o código/instalação do Orkestrai, faça operações de teste ou crie scratch scripts apenas para descobrir o schema.
- Tool MCP \`design_apply_operations\` — escape hatch do command bus completo para operações não cobertas pelas tools de lote. As tools \`design_create_element\`, \`design_update_element\` e \`design_delete_element\` são atalhos para operações pontuais. Passe \`taskId\` quando a alteração pertence a uma task; conflito exige reler, nunca sobrescrever o trabalho humano.
- Tools MCP \`design_comment\`, \`design_propose\` e \`design_decide_proposal\` — colaboram no documento nativo com autoria, threads e propostas pendentes. Propor não altera o design aprovado; nunca simule aprovação humana. Use Floors para variantes paralelas e Council quando perspectivas independentes forem úteis.
- Tools MCP \`design_import_code\` e \`design_generate_code_preview/apply\` — transformam HTML/Svelte/React/Vue em scene graph nativo ou entregam seleções em Svelar/Svelte, React/Next, Vue e HTML/Tailwind. Gere preview primeiro; o apply valida hash do arquivo e revisão do documento antes de escrever e registra o artefato no Design Studio.
- Tools MCP \`design_figma_inspect/import/sync_preview/sync_apply\` — inspecionam links do Figma, importam a seleção como scene graph nativo e exigem preview antes de resolver alterações remotas, locais ou conflitos. Combine-as com o MCP oficial \`figma\` quando ele estiver disponível; preserve mappings de Code Connect e nunca sobrescreva uma resolução humana.
- \`orkestrai design apply <nodeId> '<operations-json>' --revision <n> [--task <taskId>]\` — fallback CLI para as mesmas operações transacionais. Nunca edite \`.orkestrai/designs/*.json\` diretamente.
- \`orkestrai task list\` — quadro de tarefas do workspace. Tarefas podem ter IMAGENS DE REFERÊNCIA (paths relativos ao workspace, ex.: .orkestrai/images/x.png) — leia o arquivo se a referência for útil para a execução.
- \`orkestrai task columns\` — lista as etapas configuradas pelo usuário neste quadro. Nunca suponha que todo workspace usa somente "a fazer / fazendo / feito".
- \`orkestrai task add "<título>" --assign "<Agente>" [--column "<etapa>"]\` — cria tarefa, opcionalmente numa etapa específica, e já despacha para o agente.
- \`orkestrai task move <taskId> "<etapa>"\` — move o trabalho entre as etapas personalizadas. O líder deve refletir no quadro o estado real de cada entrega.
- \`orkestrai task done <taskId>\` — marca a tarefa atribuída a você como concluída.
- \`orkestrai task archive <taskId>\` / \`task archive-done\` — arquiva concluídas: saem do quadro, ficam no histórico. Lidere a limpeza do quadro ao fechar uma frente.
- \`orkestrai task history\` — histórico do workspace (concluídas + arquivadas, da mais recente): o "o que já foi feito" do projeto.
- \`orkestrai task add "<título>" --note "<título-da-nota>"\` / \`task link <taskId> <nota>\` / \`task unlink <taskId>\` — vincula a tarefa à sua nota de spec. SEMPRE vincule: tarefa com spec vinculada é autossuficiente. Regras: UMA nota por tarefa (a mesma nota pode servir várias tarefas); ao arquivar a tarefa, a nota sai do canvas JUNTO (fica acessível pelo histórico); nota vinculada não é apagada pelo X do canvas — só sai de verdade junto com a tarefa (ou se desvinculada).
- \`orkestrai portal create "<url>" [--title "<t>"] [--connect "<Agente>"|all] [--force-new]\` — antes de criar, rode \`orkestrai list\`. A mesma URL reutiliza o portal existente; se já houver outro portal, navegue-o para a URL desejada. Use \`--force-new\` SOMENTE quando o usuário pedir explicitamente mais um portal.
- \`orkestrai portal <nome-ou-nodeId> navigate "<url>"\` — abre uma URL no portal escolhido por nome único ou id. \`eval\`, \`dom\` e \`screenshot\` aceitam o mesmo identificador.
- \`orkestrai portal <nodeId> eval "<js>"\` — executa JS na página e retorna o resultado.
- \`orkestrai portal <nodeId> dom\` — devolve o HTML atual (ler telas, pesquisar, testar o que você está construindo).
- \`orkestrai portal <nodeId> screenshot\` — captura a tela do portal.
- \`orkestrai floor create "<nome>" [--clone]\` — cria um andar (worktree git com branch própria) para trabalho isolado.
- \`orkestrai floor list\` / \`floor preview <id>\` / \`floor land <id>\` / \`floor remove <id>\` — gerencia andares; preview mostra conflitos ANTES do merge.
- \`orkestrai device list\` / \`device attach <id>\` / \`device stop\` — lista e controla a sessão mobile visível no Workbench. iOS usa Simulator no Apple Silicon; Android usa AVD ou aparelho ADB já autorizado. Por segurança, o usuário precisa anexar aparelhos Android físicos pela UI e confirmar o acesso antes de o agente controlá-los.
- \`orkestrai device tap|swipe|pinch|type|button|rotate\` — interage com o device ativo usando coordenadas normalizadas de 0 a 1.
- \`orkestrai device install|launch|permissions|logs|tree|screenshot\` — instala/abre o app, altera permissões explicitamente e coleta evidência limitada. Trabalhe SEMPRE no ciclo observar (tree/screenshot) → agir → observar novamente; nunca afirme que um gesto funcionou sem verificar o estado seguinte.
- \`orkestrai notify "<mensagem>" --kind attention\` — notificação NATIVA quando precisar de atenção do usuário.
- \`orkestrai notify "<resumo>" --kind project --title "<projeto>"\` — conclusão do PROJETO inteiro; use somente depois de confirmar que não há tarefas pendentes. \`task done\` já notifica a conclusão da tarefa automaticamente — nunca envie outro aviso para a mesma tarefa.
- \`orkestrai port\` — devolve uma porta LIVRE para subir servidores; \`orkestrai port --check <porta>\` testa se uma porta está livre.
- \`orkestrai fs read <path>\` / \`fs write <path> <conteúdo>\` / \`fs search <termo> [--content]\` — arquivos do workspace via ponte.
- \`orkestrai run <taskId>\` — re-despacha a tarefa para o responsável (re-tentar/re-briefar).
- \`orkestrai say "<texto>"\` — fala em voz alta no desktop do usuário, na voz configurada.
- \`orkestrai portals\` — lista rapidamente os portais acessíveis.
- \`orkestrai clip\` — lê a área de transferência local.

## Portas e processos (varios workspaces rodam AO MESMO TEMPO nesta maquina)

- Ao subir QUALQUER servidor (dev server, preview, API local), NUNCA assuma a porta padrão (5173, 3000...): ela pode estar em uso por OUTRO workspace/time. Pegue uma porta livre e use-a: \`PORTA=$(orkestrai port)\` e então ex.: \`npm run dev -- --port $PORTA\` ou \`npx vite --port $PORTA\`.
- NUNCA mate processos por porta (\`kill $(lsof -ti :5173)\`, \`fuser -k\`, Stop-Process etc.) — o processo pode ser de outro time e você derruba o trabalho dele. Porta ocupada? Escolha OUTRA com \`orkestrai port\`; não mate nada.
- Depois de subir o servidor, REGISTRE a porta: diga ao líder (\`orkestrai ask\`) ou escreva na nota do projeto — o portal e o time precisam da URL certa.

Ao aterrissar (land), conflitos NÃO são resolvidos automaticamente — o erro lista os arquivos em conflito; resolva-os você mesmo no checkout principal (ou atribua a um agente) e repita o land.

Use \`--json\` para saída estruturada em qualquer comando.

## Orquestrar times (Modo Maestro) — OBRIGATÓRIO para o líder

Se você é o líder (Modo Maestro), você NUNCA executa o trabalho sozinho: você orquestra — isso vale INCLUSIVE quando o time trava, demora ou erra. Se der ruim, você DESBLOQUEIA o time (passo 7); assumir o trabalho é falha de orquestração, não solução. Ao receber um projeto/tarefa grande:

PROIBIDO usar subagentes internos da sua CLI (Task, background agents, subagentes em segundo plano) para montar o time: eles NÃO aparecem no canvas, NÃO têm terminal próprio e o usuário não vê nem gerencia nada. TODO agente do time precisa existir no canvas — recrute SEMPRE com \`orkestrai recruit\`.

Antes de propor o time e antes de cada nova rodada de delegação, consulte \`orkestrai usage\`. Cada perfil de multi-conta configurado na Central de Providers aparece como uma linha própria (\`profileId\`/\`profileName\`), roteável separadamente da conta padrão do mesmo provider. Se \`shouldFallback\` vier verdadeiro, use o \`recommendedProvider\` para novas tarefas — se ele tiver \`:profile:\`, passe o \`--provider\` base e o \`--profile\` (nome do perfil) juntos no recruit; ou reatribua somente tarefas que ainda não começaram. Se não houver fallback saudável, avise o usuário com \`orkestrai notify --kind attention\`; nunca invente estimativas de cota e nunca interrompa um agente no meio de uma tarefa apenas para trocar de provider ou perfil.

1. PRIMEIRO proponha o time: liste os agentes sugeridos (título, provider, role de cada um) e pergunte quais ele quer criar — não crie nada sem aprovação. VARIE os providers instalados: times com 3+ agentes devem combinar perspectivas diferentes — NUNCA crie o time inteiro com um provider só.
2. Aprovado, crie com \`orkestrai recruit "<Título>" [--provider ${providerIds}] [--profile <nome-do-perfil>] [--model <id>] [--effort medium|high|xhigh] [--role <papel>]\`. \`--profile\` usa uma conta alternativa já cadastrada na Central de Providers para esse provider (multi-conta); sem isso, usa a conta padrão. Recrutas nascem CONECTADOS a você no organograma (não precisa de \`connect\`). Para composição visual estruturada, use \`medium\` ou \`high\`: \`xhigh\` aumenta muito a latência de payloads sem melhorar o gate visual. Use títulos CURTOS (2-3 palavras, ex.: "Dev API", "Designer UI") e roles de UMA palavra ("frontend", "qa", "design") — descrições longas vão para a nota de briefing.
3. Escreva o spec/briefing do projeto numa nota: \`orkestrai note create "Spec — <projeto>" --content "..." --connect all\` (sem --connect, a nota já conecta ao time inteiro por padrão).
4. Trabalho em código? Cada agente trabalha no PRÓPRIO ANDAR (worktree isolada): \`orkestrai floor create "<frente>"\` antes do agente começar — NUNCA deixe vários agentes codando na mesma branch. Integre depois com \`orkestrai floor preview\` (vê conflitos) e \`orkestrai floor land\`.
5. Distribua TODO trabalho com \`orkestrai task add --assign\` ANTES de usar \`orkestrai ask\` para o handoff (o quadro kanban aparece no canvas sozinho na primeira tarefa). É PROIBIDO delegar trabalho apenas por mensagem direta. Use notas com \`orkestrai note create\`; cada task tem que ser AUTOSSUFICIENTE (a descrição diz o que fazer e onde está o spec) OU citar o id de uma nota que JÁ EXISTE e já está conectada ao agente — NUNCA atribua uma task que depende de uma nota/artefato que você ainda não criou. E cada agente PRODUZ os próprios artefatos: o designer CRIA a nota de design com \`orkestrai note create\`; não fica esperando o líder mandar uma — deixe isso explícito na descrição da task.
6. Projeto web? Rode \`orkestrai list\` e REUTILIZE um Portal existente pelo nome/id, navegando-o para \`http://localhost:<porta-do-dev-server>\`. Só crie um se a listagem confirmar que não existe nenhum; nunca deduza ausência a partir do estado de conexão. Use \`orkestrai portal <nome-ou-nodeId> dom|screenshot|eval\` para testar o que o time está construindo. A porta do dev server vem de \`orkestrai port\` (NUNCA a padrão 5173/3000 — outro workspace pode estar usando).
   Projeto mobile? Use \`orkestrai device list\`, anexe um iOS Simulator ou Android AVD e valide pelo ciclo tree/screenshot → ação → tree/screenshot. Aparelhos Android físicos exigem que o usuário inicie e confirme a sessão na UI. Instalações ficam confinadas ao workspace e o usuário acompanha a sessão ao vivo no Workbench.
7. Acompanhe o quadro com \`orkestrai task list\`, \`orkestrai design list\`, cobre os agentes com \`orkestrai ask\` e integre os andares com \`floor preview/land\`. \`design list\` marca uma direção como \`stalled\` quando há trabalho ativo sem revisão nova por 5 minutos; interrompa e reoriente para um conceito menor em vez de aguardar dezenas de minutos. Em exploração visual, \`audit\` sem erros NÃO é aprovação: abra o resultado e espere \`reviewStatus: approved\` na revisão atual. DESBLOQUEIO (regra dura): se um agente travar, ficar em silêncio ou pedir algo, resolva na hora; implementar você mesmo é o último recurso e reatribuir continua preferível.
8. NUNCA afirme que consultou/falou com outro agente sem uma execução bem-sucedida de \`orkestrai ask\` e a confirmação explícita retornada pela ponte. \`orkestrai task done\` avisa o líder automaticamente, além da notificação nativa de TAREFA CONCLUÍDA. Não duplique esse aviso. Quando precisar de atenção/aprovação, use \`orkestrai notify "<pedido>" --kind attention\`. Somente ao concluir o PROJETO inteiro, após conferir o quadro, use \`orkestrai notify "<resumo>" --kind project --title "<projeto>"\`.
9. Mantenha o Control Center fiel: reporte somente MUDANÇAS semânticas com \`orkestrai status\` (trabalhando, bloqueado, aguardando entrada/permissão, concluído ou erro). O ciclo do PTY já cobre inicialização/atividade/ociosidade; não envie pulsos repetidos.
9. Ao finalizar uma frente, dispense o que não precisa mais com \`orkestrai dismiss <agente>\` — o time nasce e morre sob demanda.

Se uma tarefa exigir uma habilidade que você não tem, você pode AUTORAR uma skill: crie \`.claude/skills/<nome>/SKILL.md\` (frontmatter com name/description + instruções). Skills novas são descobertas nas próximas sessões do agente.
`;
  }

  /**
   * Provisiona a skill da ponte nos diretórios convencionais dos agentes
   * de Claude, Cline, Devin, Antigravity e no formato portavel do Orkestrai.
   */
  async provisionSkill(workspace: Workspace, token: string, bridgeRuntime?: WorkspaceExecutionRuntime): Promise<void> {
    const skill = this.bridgeSkillContent();
    const wslRuntime = bridgeRuntime?.kind === 'wsl'
      ? bridgeRuntime
      : workspace.runtimeKind === 'wsl' && workspace.wslDistribution && workspace.wslWorkingDir
        ? { kind: 'wsl' as const, distribution: workspace.wslDistribution, linuxWorkingDir: workspace.wslWorkingDir }
        : null;
    try {
      const dirs = [
        resolve(workspace.workingDir, '.claude', 'skills', 'orkestrai'),
        resolve(workspace.workingDir, '.cline', 'skills', 'orkestrai'),
        resolve(workspace.workingDir, '.devin', 'skills', 'orkestrai'),
        resolve(workspace.workingDir, '.agents', 'skills', 'orkestrai'),
        resolve(workspace.workingDir, '.orkestrai'),
      ];
      for (const dir of dirs) {
        await mkdir(dir, { recursive: true });
        await writeFile(resolve(dir, 'SKILL.md'), skill);
      }
      if (wslRuntime) {
        const launcherDir = resolve(workspace.workingDir, '.orkestrai', 'bin');
        const launcherPath = resolve(launcherDir, 'orkestrai');
        const shellQuote = (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`;
        const cliRuntime = process.env.ORKESTRAI_CLI_RUNTIME ?? process.execPath;
        const cliEntry = process.env.ORKESTRAI_CLI_JS ?? resolve(process.cwd(), 'packages', 'orkestrai-cli', 'bin', 'orkestrai.js');
        await mkdir(launcherDir, { recursive: true });
        await writeFile(launcherPath, [
          '#!/bin/sh',
          'set -eu',
          `runtime="$(wslpath -u ${shellQuote(cliRuntime)})"`,
          'export ELECTRON_RUN_AS_NODE=1',
          `exec "$runtime" ${shellQuote(cliEntry)} "$@"`,
          '',
        ].join('\n'));
        await chmod(launcherPath, 0o755).catch(() => undefined);
      }
      // Cada CLI descobre MCP em um caminho proprio. Todos recebem o mesmo
      // launch absoluto (inclusive no Windows) e o merge preserva servidores.
      for (const [relativePath, figmaFormat] of [
        ['.mcp.json', 'http'],
        ['.cursor/mcp.json', 'url'],
        ['.cline/mcp.json', null],
        ['.devin/mcp_config.json', null],
        ['.agents/mcp_config.json', null],
      ] as const) {
        await this.provisionStandardMcp(resolve(workspace.workingDir, relativePath), wslRuntime, figmaFormat);
      }
      await this.provisionAgentsMd(workspace.workingDir);
      await this.repairLegacyCodexMcp(workspace, wslRuntime);
      await this.provisionOpenCodeMcp(workspace, wslRuntime);
      // Apenas artefatos inequivocamente gerados pela ponte ficam fora do
      // status. Configs e AGENTS.md pertencem ao usuario e devem ser visiveis.
      const gitDir = resolve(workspace.workingDir, '.git');
      if (await this.pathExists(gitDir)) {
        const excludePath = resolve(gitDir, 'info', 'exclude');
        const currentExclude = await this.readText(excludePath);
        const nextExclude = updateOrkestraiGitExclude(currentExclude);
        if (nextExclude !== currentExclude) {
          await mkdir(resolve(gitDir, 'info'), { recursive: true });
          await writeFile(excludePath, nextExclude);
        }
      }
    } catch (error) {
      // Sem permissao de escrita no working_dir não bloqueia a conexão, mas o
      // diagnostico precisa explicar por que a ponte não foi provisionada.
      console.error('[orkestrai] Failed to provision workspace bridge files:', error);
    }
    await this.writeBridgeConfig(workspace, token);
  }

  /** Bloco portavel lido pelos providers que nao usam a skill do Claude. */
  private agentsMdBlock(): string {
    return [
      '<!-- orkestrai:begin -->',
      '## Ponte Orkestrai (agentes)',
      '',
      'Este projeto roda dentro de um workspace do Orkestrai. Você tem a CLI `orkestrai` e/ou tools MCP `orkestrai` disponíveis para colaborar com o time no canvas:',
      '- `orkestrai list` — agentes do workspace, notas e portais conectados. O [LIDER] marcado e o maestro do time: fale com ele pelo TITULO ("Maestro" e o papel, não um nome de agente).',
      '- Repositórios adicionais aprovados aparecem em `orkestrai list` como aliases `@nome`; use esses aliases em caminhos de tools como `api_client_import`, nunca tente escapar com `../`.',
      '- `orkestrai usage` — cotas reais e recomendação do nó Usage; líderes consultam antes de delegar e roteiam novas tarefas ao recommendedProvider quando shouldFallback=true.',
      '- `orkestrai ask "<Agente>" "<mensagem>"` — fala com outro agente e aguarda a resposta.',
      '- `huddle_list` / `huddle_say` — acompanha huddles ativos e registra somente a contribuição deste agente no transcript.',
      '- `code_graph_status/index/search/symbol/neighbors/changes/contracts/quality/semantic/evidence/context/operations/explain/locate/revisions/compare/investigation/handoff` / `orkestrai graph ...` — consulta o mesmo grafo nativo visível no Canvas e Workbench. Use `explain` para procedência, `locate` para sincronizar código e grafo, `operations` para agentes/tarefas/Floors e conflitos, `context` para pacotes revisáveis com orçamento explícito, `compare` para revisões e `investigation` para salvar/restaurar visão, filtros, seleção, câmera e arquivo. Consulte `changes` antes de integrar, `contracts` para APIs, `quality` como evidência e `semantic` somente após construir o índice local. Importe `evidence` apenas de caminho relativo confinado. Use `handoff` para Review Center ou tarefa rastreável; líder, agente e Council recebem revisão e ids de origem. Nunca invente relações ausentes nem peça SQL/Cypher arbitrário.',
      '- `orkestrai note read/write/edit/create` — notas compartilhadas no canvas.',
      '- `image_workflow_*` — controle completo dos fluxos nativos de imagem executados por Codex: crie/configure sem rodar, conecte ou reordene Notas e Imagens, adicione referencias do workspace, gere de 1 a 10 outputs, valide, conclua, cancele ou remova. Leia o contrato, use somente `image_gen.imagegen` com `referenced_image_paths`, copie cada output para o destino do workspace e chame `image_workflow_validate`. Se alpha real for exigido e falhar, chame `image_gen.imagegen` novamente usando apenas a saida invalida como referencia e o prompt corretivo retornado, depois valide o resultado, no maximo tres tentativas. Toda mudanca visual, inclusive remover fundo, deve vir da tool nativa: nunca use Python, Pillow, ImageMagick, ffmpeg, remove-bg, mascaras geradas ou processamento local de pixels. Chame `image_workflow_complete` apenas quando todos validarem. Nunca peça chave de API nem use API/script paralelo.',
      '- `orkestrai design list/read/reference/apply` — documentos visuais nativos. Em exploração, produza primeiro 1 desktop + 1 mobile com design_import_code ou lote pequeno, entregue a primeira revisão em até 5 minutos e espere o gate visual humano. Só expanda a direção aprovada com blueprint completo. design list sinaliza stalled e o reviewStatus da revisão atual.',
      '- `design_comment` / `design_propose` / `design_decide_proposal` — colaboracao visual com autoria e revisao: propostas ficam pendentes ate decisao explicita e podem ser comparadas em Floors/Council.',
      '- `design_import_code` / `design_generate_code_preview/apply` — importacao estrutural de HTML/Svelte/React/Vue e entrega para Svelar/Svelte, React/Next, Vue ou HTML/Tailwind; sempre revise o preview e preserve os component mappings antes de aplicar.',
      '- `design_figma_inspect/import/sync_preview/sync_apply` — interoperabilidade estrutural com Figma; combine com o MCP oficial `figma`, sempre revise conflitos antes de sincronizar e preserve Code Connect.',
      '- `orkestrai task list/columns/add/move/done` — quadro do time; consulte `task columns` e respeite as etapas personalizadas pelo usuário.',
      '- `orkestrai floor create/preview/land` — andares (worktrees git) isolados por frente.',
      '- `orkestrai device list/attach/tap/swipe/pinch/type/permissions/tree/screenshot/stop` — device mobile visivel no Workbench; aparelhos Android fisicos so podem ser anexados pelo usuario apos confirmacao na UI.',
      '- `orkestrai ask "<Agente>" "<mensagem>"` — só afirme que falou/consultou alguém quando a ponte retornar uma resposta confirmada; timeout ou erro NÃO contam como conversa.',
      '- `orkestrai task done <id>` — conclui a tarefa, avisa o líder e envia uma notificação identificada; não duplique com notify.',
      '- `orkestrai notify "<msg>" --kind attention|project` — atenção ou conclusão do projeto inteiro (somente após conferir o quadro).',
      '- Todo trabalho delegado precisa de uma task no Kanban ANTES da mensagem direta; nunca execute ou delegue trabalho sem rastreamento.',
      '- Sua identidade está no ambiente (ORKESTRAI_NODE_ID) — `--from`/`--agent` são opcionais. Se `orkestrai` não resolver no PATH, execute o launcher `"$ORKESTRAI_CLI" ...` DIRETO (sem `node`; no Windows `%ORKESTRAI_CLI%`/`& $env:ORKESTRAI_CLI`) — nunca rode o `...orkestrai.js` cru.',
      '- Se as tools MCP `orkestrai` estiverem disponíveis, PREFIRA elas (chamadas tipadas); a CLI e o fallback.',
      '- Detalhes completos: `.claude/skills/orkestrai/SKILL.md`, `.cline/skills/orkestrai/SKILL.md`, `.devin/skills/orkestrai/SKILL.md`, `.agents/skills/orkestrai/SKILL.md` ou `.orkestrai/SKILL.md`.',
      '<!-- orkestrai:end -->',
    ].join('\n');
  }

  /** Escreve/mescla o bloco da ponte no AGENTS.md (preserva o conteúdo do usuário). */
  private async provisionAgentsMd(workingDir: string): Promise<void> {
    const path = resolve(workingDir, 'AGENTS.md');
    const block = this.agentsMdBlock();
    const current = await this.readText(path);
    const pattern = /<!-- orkestrai:begin -->[\s\S]*?<!-- orkestrai:end -->/;
    if (pattern.test(current)) {
      const next = current.replace(pattern, block);
      if (next !== current) await writeFile(path, next);
      return;
    }
    await writeFile(path, `${current.replace(/\s*$/, '\n\n')}${block}\n`);
  }

  /**
   * Repara somente a assinatura de corrupcao escrita por versoes antigas.
   * Novas sessoes recebem os MCPs por overrides efemeros e não editam dotfiles.
   */
  private async repairLegacyCodexMcp(
    workspace: Workspace,
    wslRuntime: Extract<WorkspaceExecutionRuntime, { kind: 'wsl' }> | null,
  ): Promise<void> {
    if (process.env.VITEST) return;
    const dir = wslRuntime ? resolve(workspace.workingDir, '.codex') : resolve(homedir(), '.codex');
    if (!(await this.pathExists(dir))) return;
    const path = resolve(dir, 'config.toml');
    const repaired = await repairConfigFileAtomically(path, repairLegacyCodexMcpConfig);
    if (repaired) console.info(`[orkestrai] Repaired legacy Codex MCP config; backup: ${path}.before-orkestrai-repair`);
  }

  /** Formato MCP padrao usado por Claude/Kimi, Cursor, Cline, Devin e Antigravity. */
  private async provisionStandardMcp(
    path: string,
    wslRuntime: Extract<WorkspaceExecutionRuntime, { kind: 'wsl' }> | null,
    figmaFormat: 'http' | 'url' | null,
  ): Promise<void> {
    let config: { mcpServers?: Record<string, unknown> } & Record<string, unknown> = {};
    try {
      config = JSON.parse(await readFile(path, 'utf8'));
    } catch {
      // Ausente ou invalido: cria o documento minimo.
    }
    const launch = this.mcpLaunch(wslRuntime);
    const desired = {
      command: launch.command,
      args: launch.args,
      ...(launch.electronRuntime ? { env: { ELECTRON_RUN_AS_NODE: '1' } } : {}),
    };
    const figma = figmaFormat === 'http' ? { type: 'http', url: FIGMA_MCP_URL } : { url: FIGMA_MCP_URL };
    if (
      JSON.stringify(config.mcpServers?.orkestrai ?? null) === JSON.stringify(desired)
      && (!figmaFormat || JSON.stringify(config.mcpServers?.figma ?? null) === JSON.stringify(figma))
    ) return;
    await mkdir(dirname(path), { recursive: true });
    config.mcpServers = {
      ...(config.mcpServers ?? {}),
      orkestrai: desired,
      ...(figmaFormat ? { figma } : {}),
    };
    await writeFile(path, `${JSON.stringify(config, null, 2)}\n`);
  }

  /** OpenCode le MCP do opencode.json do projeto (secao "mcp", type local). */
  private async provisionOpenCodeMcp(
    workspace: Workspace,
    wslRuntime: Extract<WorkspaceExecutionRuntime, { kind: 'wsl' }> | null,
  ): Promise<void> {
    const path = resolve(workspace.workingDir, 'opencode.json');
    let config: { mcp?: Record<string, unknown> } & Record<string, unknown> = {};
    try {
      config = JSON.parse(await readFile(path, 'utf8'));
    } catch {
      // não existe ou inválido — cria do zero
    }
    // Pina o runtime + .js absoluto (nunca o nome nu "orkestrai"): no Windows o
    // nome nu podia resolver para orkestrai.js e o executor abri-lo pela
    // associacao (.js -> Windows Script Host), quebrando o handshake MCP.
    const launch = this.mcpLaunch(wslRuntime);
    const desired = {
      type: 'local',
      command: [launch.command, ...launch.args],
      ...(launch.electronRuntime ? { environment: { ELECTRON_RUN_AS_NODE: '1' } } : {}),
      enabled: true,
    };
    if (JSON.stringify(config.mcp?.orkestrai ?? null) === JSON.stringify(desired)) return;
    config.mcp = { ...(config.mcp ?? {}), orkestrai: desired };
    await writeFile(path, `${JSON.stringify(config, null, 2)}\n`);
  }

  private mcpLaunch(wslRuntime: Extract<WorkspaceExecutionRuntime, { kind: 'wsl' }> | null): {
    command: string;
    args: string[];
    electronRuntime: boolean;
  } {
    if (wslRuntime) {
      return {
        command: 'wsl.exe',
        args: [
          '--distribution',
          wslRuntime.distribution,
          '--exec',
          '/bin/sh',
          `${wslRuntime.linuxWorkingDir.replace(/\/$/, '')}/.orkestrai/bin/orkestrai`,
          'mcp',
        ],
        electronRuntime: false,
      };
    }
    return {
      command: process.env.ORKESTRAI_CLI_RUNTIME ?? process.execPath,
      args: [
        process.env.ORKESTRAI_CLI_JS ?? resolve(process.cwd(), 'packages', 'orkestrai-cli', 'bin', 'orkestrai.js'),
        'mcp',
      ],
      electronRuntime: process.env.ORKESTRAI_CLI_RUNTIME_IS_ELECTRON === '1' || Boolean(process.versions.electron),
    };
  }

  // -- Internos ---------------------------------------------------------------

  private findAgent(agents: BridgeAgent[], query: string): BridgeAgent {
    const normalized = query.trim().toLowerCase();
    const exact = agents.filter((item) => item.title.toLowerCase() === normalized);
    if (exact.length > 1) {
      throw new Error(`Há ${exact.length} agentes chamados "${query}" — renomeie um deles (duplo-clique no título do no) ou use o id do no.`);
    }
    const agent =
      agents.find((item) => item.nodeId === query) ??
      exact[0] ??
      agents.find((item) => item.title.toLowerCase().includes(normalized));
    if (!agent) {
      throw new Error(`Agente "${query}" não encontrado. Use orkestrai list para ver os disponíveis.`);
    }
    return agent;
  }

  private async requireNoteNode(workspaceId: string, nodeId: string): Promise<CanvasNode> {
    const node = await workspaceRepository.getNode(nodeId);
    if (!node || node.workspaceId !== workspaceId || node.type !== 'note') {
      throw new Error('Nota não encontrada neste workspace.');
    }
    return node;
  }

  private askAndWait(
    sessionId: string,
    message: string,
    timeoutMs: number,
    signal?: AbortSignal,
    provider?: string | null,
    onSubmitted?: () => Promise<void>,
  ): Promise<{ text: string; timedOut: boolean }> {
    return new Promise((resolvePromise, reject) => {
      let captured = '';
      let capturedAtSend = 0;
      let done = false;
      const sentAt = Date.now();
      let lastOutputAt = sentAt;

      // Conclusao por silencio: só termina depois de saída real seguida de
      // QUIET_MS sem novos bytes, e nunca antes de MIN_AFTER_SEND_MS — sem o
      // piso, um agente já ocioso dispara "waiting" no eco da propria
      // mensagem e a resposta se perde.
      const MIN_AFTER_SEND_MS = 3_500;
      const QUIET_MS = 2_000;
      let retryTimer: ReturnType<typeof setInterval> | null = null;

      let cancelQueuedDelivery: (() => boolean) | null = null;
      const finish = (timedOut: boolean) => {
        if (done) return;
        done = true;
        cancelQueuedDelivery?.();
        if (timer) clearTimeout(timer);
        if (quietTimer) clearTimeout(quietTimer);
        if (retryTimer) clearInterval(retryTimer);
        signal?.removeEventListener('abort', onAbort);
        detach();
        // Só conta o que saiu DEPOIS do envio (boot paint não e resposta).
        resolvePromise({ text: stripAnsi(captured.slice(capturedAtSend)), timedOut });
      };

      let quietTimer: ReturnType<typeof setTimeout> | null = null;
      let sent = false;
      let sentRealAt = 0;
      const maybeFinish = () => {
        if (done || !sent) return; // boot quieto NAO e resposta — só vale depois do envio
        const now = Date.now();
        const quietFor = now - lastOutputAt;
        const elapsed = now - sentRealAt;
        // TUIs de provider precisam de tempo para pensar (8s pos-envio); o
        // quieto imediato após o eco não e resposta — e o retry do Enter atua
        // nessa janela. Shell puro segue o piso classico.
        const sessInfo = ptySessionManager.get(sessionId);
        const isTui = Boolean(provider && sessInfo?.provider);
        const minElapsed = isTui ? 8_000 : MIN_AFTER_SEND_MS;
        if (captured.length > capturedAtSend && quietFor >= QUIET_MS && elapsed >= minElapsed) {
          finish(false);
          return;
        }
        const wait = Math.min(Math.max(QUIET_MS - quietFor, minElapsed - elapsed, 250), 3_000);
        quietTimer = setTimeout(maybeFinish, wait);
      };

      const onAbort = () => finish(true);
      let timer: ReturnType<typeof setTimeout> | null = null;

      let detachFn: (() => void) | null = null;
      try {
        const attached = ptySessionManager.attach(
          sessionId,
          (data) => {
            captured += data;
            lastOutputAt = Date.now();
          },
          undefined,
          (waiting) => {
            if (waiting) maybeFinish();
          }
        );
        detachFn = attached.detach;
      } catch (error) {
        if (timer) clearTimeout(timer);
        reject(error);
        return;
      }
      const detach = () => detachFn?.();

      if (signal?.aborted) {
        finish(true);
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });

      const send = () => {
        const delivery = ptySessionManager.queueWithSubmit(sessionId, message, 120);
        cancelQueuedDelivery = delivery.cancel;
        delivery.submitted
          .then(async () => {
            if (done) return;
            await onSubmitted?.();
            cancelQueuedDelivery = null;
            // Ignora boot/eco/comandos observados enquanto a mensagem aguardava
            // um rascunho humano ser enviado. Daqui em diante e resposta real.
            capturedAtSend = captured.length;
            sent = true;
            sentRealAt = Date.now();
            lastOutputAt = sentRealAt;
            timer = setTimeout(() => finish(true), timeoutMs);
            // Seguro contra Enter engolido: o eco do texto engana o "output
            // novo". O que conta e ATIVIDADE RECENTE: se ficou quieto de novo
            // (composer parado, nada processando), tenta reenviar o \r. O
            // gerenciador recusa se o usuário já tiver iniciado outro rascunho.
            let retries = 0;
            retryTimer = setInterval(() => {
              if (done || retries >= 3) {
                if (retryTimer) clearInterval(retryTimer);
                return;
              }
              if (Date.now() - lastOutputAt < 3_500) return; // atividade recente: segue
              retries += 1;
              try {
                ptySessionManager.submitIfComposerFree(sessionId);
              } catch {
                finish(true);
              }
            }, 4_000);
            retryTimer.unref?.();
            // Rede de segurança caso o evento de ociosidade nunca dispare.
            quietTimer = setTimeout(maybeFinish, MIN_AFTER_SEND_MS);
          })
          .catch(() => finish(true));
      };

      // PRONTIDAO: escrever durante o boot faz o Enter virar newline no
      // composer (Kimi) ou cair no limbo. Agente de provider (TUI): só escreve
      // quando JA PRODUZIU output E ficou ocioso E a sessão tem idade minima
      // (o boot do Kimi e bifasico: paint, depois MCP/sessão — o ocioso de
      // 2.5s dispara no meio). Shell puro/desconhecido: escreve na hora.
      const readyDeadline = Date.now() + 30_000;
      const waitReady = () => {
        if (done) return;
        const sess = ptySessionManager.get(sessionId);
        const ageMs = sess ? Date.now() - Date.parse(sess.createdAt) : 0;
        // A espera só vale para TUIs de providers registrados; shell puro (ou
        // provider simulado em teste) recebe a mensagem imediatamente.
        const isTui = Boolean(provider && sess?.provider);
        const ready = Boolean(sess?.hasOutput && sess.waiting && ageMs >= 12_000);
        if (!sess || sess.exited || !isTui || ready || Date.now() >= readyDeadline) {
          send();
          return;
        }
        setTimeout(waitReady, 400);
      };
      waitReady();
    });
  }

  private async pathExists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  private async readText(path: string): Promise<string> {
    try {
      return await readFile(path, 'utf8');
    } catch {
      return '';
    }
  }

  private async writeBridgeConfig(workspace: Workspace, token: string, apiUrl?: string): Promise<void> {
    try {
      const dir = resolve(workspace.workingDir, '.orkestrai');
      await mkdir(dir, { recursive: true });
      await writeFile(
        resolve(dir, 'workspace.json'),
        JSON.stringify(
          {
            workspaceId: workspace.id,
            workspaceName: workspace.name,
            token,
            apiUrl: apiUrl ?? process.env.ORKESTRAI_API_URL ?? 'http://127.0.0.1:4173',
            repositories: workspace.repositoryRoots.map(({ alias }) => ({ alias, reference: `@${alias}` })),
          },
          null,
          2
        )
      );
    } catch {
      // Config local e conveniencia; não bloqueia o fluxo.
    }
  }
}

export const bridgeService = new BridgeService();
