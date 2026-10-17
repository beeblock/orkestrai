import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { attentionService } from './AttentionService.js';
import { bridgeService } from './BridgeService.js';
import { agentSessionService } from './AgentSessionService.js';

export type FlowStep = {
  kind: 'agent' | 'approval';
  /** Titulo do agente alvo (passo 'agent'). */
  target?: string;
  /** Template do prompt; {{input}} = saida do passo anterior. */
  prompt?: string;
};

export type FlowRunStep = {
  index: number;
  label: string;
  status: 'pending' | 'running' | 'waiting' | 'done' | 'error';
  excerpt?: string;
};

export type FlowRun = {
  active: boolean;
  iteration: number;
  iterations: number;
  startedAt: string;
  steps: FlowRunStep[];
};

export type FlowFinishedRun = {
  ok: boolean;
  error?: string;
  startedAt: string;
  finishedAt: string;
  steps: FlowRunStep[];
};

type RunHandle = { cancelled: boolean; onCancel?: () => void };

const MAX_ITERATIONS = 5;
const STEP_TIMEOUT_MS = 300_000;
/** Profundidade maxima do encadeamento fluxo->fluxo (rede de seguranca extra ao visited). */
const MAX_CHAIN_DEPTH = 10;

/** Avisa o canvas para recarregar (progresso do fluxo aparece ao vivo). */
function notifyWorkspaceChanged(workspaceId: string) {
  const broadcast = (globalThis as { __orkestraiBroadcast?: (payload: Record<string, unknown>) => void }).__orkestraiBroadcast;
  broadcast?.({ type: 'workspaceChanged', workspaceId });
}

/**
 * Flow runner: executa os passos de um no 'flow' em sequencia (DAG linear +
 * repeticao com limite). Passo 'agent' conversa com o agente via bridge ask
 * (as arestas acendem sozinhas); passo 'approval' pausa ate o humano aprovar.
 * O progresso e persistido no payload do no — sobrevive a reload e aparece
 * ao vivo no canvas.
 */
export const FLOW_APPROVAL_SOURCE = 'flow_approval';

export class FlowService {
  private running = new Map<string, RunHandle>();
  private approvalWaiters = new Map<string, () => void>();

  async run(workspaceId: string, nodeId: string, input: string, chain?: { visited?: string[] }): Promise<{ started: boolean }> {
    const node = await workspaceRepository.getNode(nodeId);
    if (!node || node.workspaceId !== workspaceId || node.type !== 'flow') throw new Error('Fluxo nao encontrado neste workspace.');
    const payload = (node.payload ?? {}) as { steps?: FlowStep[]; iterations?: number };
    const steps = payload.steps ?? [];
    if (!steps.length) throw new Error('Adicione ao menos um passo ao fluxo.');
    for (const step of steps) {
      if (step.kind === 'agent' && !step.target?.trim()) throw new Error('Passo do tipo agente sem alvo.');
    }
    if (this.running.has(nodeId)) throw new Error('Este fluxo ja esta rodando.');

    // Cadeia de fluxos: visited evita ciclo (A->B->A) no encadeamento.
    const visited = [...(chain?.visited ?? []), nodeId];
    const handle: RunHandle = { cancelled: false };
    this.running.set(nodeId, handle);
    void this.execute(workspaceId, nodeId, input, handle)
      .then(async (result) => {
        // Encadeamento: sucesso alimenta os fluxos conectados com a saida final.
        if (result.ok && visited.length <= MAX_CHAIN_DEPTH) {
          await this.chainDownstream(workspaceId, nodeId, result.output, visited);
        }
      })
      .catch(() => {})
      .finally(() => this.running.delete(nodeId));
    return { started: true };
  }

  /** Dispara os fluxos conectados a este (arestas do canvas) com a saida final como entrada. */
  private async chainDownstream(workspaceId: string, nodeId: string, output: string, visited: string[]): Promise<void> {
    const edges = await workspaceRepository.listEdges(workspaceId);
    const connectedIds = edges
      .filter((edge) => edge.sourceNodeId === nodeId || edge.targetNodeId === nodeId)
      .map((edge) => (edge.sourceNodeId === nodeId ? edge.targetNodeId : edge.sourceNodeId));
    for (const id of connectedIds) {
      if (visited.includes(id) || this.running.has(id)) continue;
      const node = await workspaceRepository.getNode(id);
      if (!node || node.type !== 'flow') continue;
      const steps = ((node.payload ?? {}) as { steps?: unknown[] }).steps ?? [];
      if (!steps.length) continue;
      await this.run(workspaceId, id, output, { visited }).catch(() => {});
    }
  }

  /** Aprova o passo 'approval' que esta esperando. */
  approve(workspaceId: string, nodeId: string): { approved: boolean } {
    void workspaceId;
    const waiter = this.approvalWaiters.get(nodeId);
    if (!waiter) throw new Error('Nenhum passo aguardando aprovacao neste fluxo.');
    this.approvalWaiters.delete(nodeId);
    waiter();
    return { approved: true };
  }

  /** Interrompe a execucao atual do fluxo. */
  stop(workspaceId: string, nodeId: string): { stopped: boolean } {
    void workspaceId;
    const handle = this.running.get(nodeId);
    if (!handle) throw new Error('Este fluxo nao esta rodando.');
    handle.cancelled = true;
    handle.onCancel?.();
    return { stopped: true };
  }

  isRunning(nodeId: string): boolean {
    return this.running.has(nodeId);
  }

  private async execute(workspaceId: string, nodeId: string, input: string, handle: RunHandle): Promise<{ ok: boolean; output: string }> {
    const startedAt = new Date().toISOString();
    const node = await workspaceRepository.getNode(nodeId);
    const payload = (node?.payload ?? {}) as { steps?: FlowStep[]; iterations?: number };
    const steps = payload.steps ?? [];
    const iterations = Math.min(MAX_ITERATIONS, Math.max(1, payload.iterations ?? 1));
    const runSteps: FlowRunStep[] = steps.map((step, index) => ({
      index,
      label: step.kind === 'approval' ? 'Aprovacao (voce)' : (step.target ?? '?'),
      status: 'pending',
    }));

    const persist = async (run: FlowRun | null) => {
      const fresh = await workspaceRepository.getNode(nodeId);
      if (!fresh) return;
      await workspaceRepository.updateNode(nodeId, { payload: { ...((fresh.payload ?? {}) as object), run } as never });
      notifyWorkspaceChanged(workspaceId);
    };

    let currentInput = input;
    let previousTarget: string | null = null;
    try {
      for (let iteration = 1; iteration <= iterations; iteration += 1) {
        for (let i = 0; i < steps.length; i += 1) {
          if (handle.cancelled) throw new Error('Fluxo interrompido pelo usuario.');
          const step = steps[i];
          runSteps[i] = { ...runSteps[i], status: step.kind === 'approval' ? 'waiting' : 'running' };
          await persist({ active: true, iteration, iterations, startedAt, steps: [...runSteps] });

          if (step.kind === 'approval') {
            const flowNode = await workspaceRepository.getNode(nodeId);
            await attentionService.raise({
              workspaceId,
              nodeId,
              category: 'workflow',
              severity: 'warning',
              title: flowNode?.title?.trim() || 'Fluxo',
              body: currentInput.slice(0, 500) || null,
              sourceType: FLOW_APPROVAL_SOURCE,
              sourceId: nodeId,
              correlationId: `${FLOW_APPROVAL_SOURCE}:${nodeId}`,
              action: { target: 'node', decision: 'flow' },
            }).catch(() => undefined);
            try {
              await new Promise<void>((resolveApproval, rejectApproval) => {
                this.approvalWaiters.set(nodeId, resolveApproval);
                handle.onCancel = () => rejectApproval(new Error('Fluxo interrompido pelo usuario.'));
              });
            } finally {
              this.approvalWaiters.delete(nodeId);
              await attentionService.resolveSource(workspaceId, FLOW_APPROVAL_SOURCE, nodeId).catch(() => 0);
            }
            runSteps[i] = { ...runSteps[i], status: 'done', excerpt: 'aprovado' };
            await persist({ active: true, iteration, iterations, startedAt, steps: [...runSteps] });
            continue;
          }

          const message = (step.prompt?.trim() || '{{input}}').replaceAll('{{input}}', currentInput);
          await agentSessionService.ensureByTitle(workspaceId, step.target!);
          const result = await bridgeService.ask(workspaceId, {
            to: step.target!,
            message,
            from: previousTarget,
            timeoutMs: STEP_TIMEOUT_MS,
          });
          currentInput = result.reply;
          previousTarget = step.target!;
          runSteps[i] = { ...runSteps[i], status: 'done', excerpt: result.reply.slice(0, 280) };
          await persist({ active: true, iteration, iterations, startedAt, steps: [...runSteps] });
        }
      }
      await this.finish(workspaceId, nodeId, { ok: true, startedAt, finishedAt: new Date().toISOString(), steps: runSteps });
      return { ok: true, output: currentInput };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha no fluxo.';
      const failedIndex = runSteps.findIndex((step) => step.status === 'running' || step.status === 'waiting');
      if (failedIndex >= 0) runSteps[failedIndex] = { ...runSteps[failedIndex], status: 'error', excerpt: message.slice(0, 280) };
      await this.finish(workspaceId, nodeId, {
        ok: false,
        error: message,
        startedAt,
        finishedAt: new Date().toISOString(),
        steps: runSteps,
      });
      return { ok: false, output: currentInput };
    }
  }

  /** Encerra a run: limpa o estado ativo e empilha no historico (ultimas 5). */
  private async finish(workspaceId: string, nodeId: string, run: FlowFinishedRun): Promise<void> {
    const fresh = await workspaceRepository.getNode(nodeId);
    if (!fresh) return;
    const payload = (fresh.payload ?? {}) as { runs?: FlowFinishedRun[] };
    const runs = [run, ...(payload.runs ?? [])].slice(0, 5);
    await workspaceRepository.updateNode(nodeId, { payload: { ...(fresh.payload as object), run: null, runs } as never });
    notifyWorkspaceChanged(workspaceId);
  }
}

export const flowService = new FlowService();
