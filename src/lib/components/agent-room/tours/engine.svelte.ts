import type { Tour, TourAction, TourCheck, WorkspaceSnapshot } from './types.js';
import { TOURS_PT } from './catalog/pt-BR.js';
import { TOURS_EN } from './catalog/en.js';
import { TOURS_ES } from './catalog/es.js';
import { localeState } from '$lib/i18n/locale.svelte.js';
import * as m from '$lib/paraglide/messages.js';
import { checkPasses, isTourComplete } from './checks.js';
import { goto } from '$app/navigation';
import { getCsrfToken } from '@beeblock/svelar/http';

const CATALOGS: Record<string, Tour[]> = {
  'pt-BR': TOURS_PT,
  en: TOURS_EN,
  es: TOURS_ES,
};

/** Catalogo de tours no locale atual (fallback pt-BR). */
export function toursCatalog(): Tour[] {
  return CATALOGS[localeState.current] ?? TOURS_PT;
}

export function tourById(id: string): Tour | null {
  return toursCatalog().find((tour) => tour.id === id) ?? null;
}

/** Estado reativo do tour ativo (painel-guia no canvas). */
export const tourState = $state({
  tour: null as Tour | null,
  stepIndex: 0,
  busy: false,
  error: '',
  done: false,
  /** Ids dos passos auto-concluidos pelos checks. */
  autoCompleted: new Set<string>(),
  /** Passo cuja acao ja rodou (botao desabilita ate o passo virar — anti-duplicata). */
  actionDoneFor: null as string | null,
});

const POLL_MS = 3_000;
let poller: ReturnType<typeof setInterval> | null = null;
let workspaceId: string | null = null;

async function api<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    const csrf = getCsrfToken();
    const response = await fetch(path, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
        ...(init?.headers ?? {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.error) return null;
    return payload.data as T;
  } catch {
    return null;
  }
}

async function snapshot(): Promise<WorkspaceSnapshot> {
  const [nodes, edges, tasks, mcps, floors, routines] = await Promise.all([
    api<WorkspaceSnapshot['nodes']>(`/api/agent-room/workspaces/${workspaceId}/nodes`),
    api<WorkspaceSnapshot['edges']>(`/api/agent-room/workspaces/${workspaceId}/edges`),
    api<WorkspaceSnapshot['tasks']>(`/api/agent-room/workspaces/${workspaceId}/tasks`),
    api<WorkspaceSnapshot['mcps']>(`/api/agent-room/workspaces/${workspaceId}/mcps`),
    api<WorkspaceSnapshot['floors']>(`/api/agent-room/workspaces/${workspaceId}/floors`),
    api<WorkspaceSnapshot['routines']>(`/api/agent-room/workspaces/${workspaceId}/routines`),
  ]);
  return {
    nodes: nodes ?? [],
    edges: edges ?? [],
    tasks: tasks ?? [],
    mcps: mcps ?? [],
    floors: floors ?? [],
    routines: routines ?? [],
  };
}

/** Avalia os checks dos passos ate o atual; auto-conclui e marca. */
async function evaluateChecks(): Promise<void> {
  if (!tourState.tour) return;
  const snap = await snapshot();
  const steps = tourState.tour.steps;
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    if (!step.check || tourState.autoCompleted.has(step.id)) continue;
    if (checkPasses(step.check, snap)) {
      tourState.autoCompleted.add(step.id);
      // Avanca automaticamente se o passo atual foi concluido pelo usuario.
      if (i === tourState.stepIndex && i < steps.length - 1) tourState.stepIndex = i + 1;
    }
  }
  // Tour termina quando o ultimo passo tem check e ele passou (auto-conclusao).
  if (isTourComplete(tourState.tour, tourState.stepIndex, tourState.autoCompleted)) {
    tourState.done = true;
    stopPolling();
  }
}

function startPolling(): void {
  stopPolling();
  poller = setInterval(() => void evaluateChecks(), POLL_MS);
}

function stopPolling(): void {
  if (poller) clearInterval(poller);
  poller = null;
}

/** Inicia um tour (id do catalogo no locale atual). */
export async function startTour(id: string, workspace: string): Promise<void> {
  const tour = tourById(id);
  if (!tour) return;
  workspaceId = workspace;
  tourState.tour = tour;
  tourState.stepIndex = 0;
  tourState.done = false;
  tourState.error = '';
  tourState.actionDoneFor = null;
  tourState.autoCompleted = new Set();
  await evaluateChecks();
  startPolling();
}

export function stopTour(): void {
  stopPolling();
  tourState.tour = null;
  tourState.error = '';
  tourState.busy = false;
}

export function tourNext(): void {
  if (!tourState.tour) return;
  if (tourState.stepIndex < tourState.tour.steps.length - 1) {
    tourState.stepIndex += 1;
  } else {
    tourState.done = true;
    stopPolling();
  }
  tourState.actionDoneFor = null;
  tourState.error = '';
}

export function tourBack(): void {
  if (tourState.stepIndex > 0) tourState.stepIndex -= 1;
  tourState.error = '';
}

/** Marca o passo atual como concluido manualmente e avanca. */
export function tourCompleteCurrent(): void {
  if (!tourState.tour) return;
  const step = tourState.tour.steps[tourState.stepIndex];
  if (step) tourState.autoCompleted.add(step.id);
  tourNext();
}

/** Encontra um no por titulo (criacao de arestas/alvos). */
async function findNodeId(title: string): Promise<string | null> {
  const nodes = await api<WorkspaceSnapshot['nodes']>(`/api/agent-room/workspaces/${workspaceId}/nodes`);
  return nodes?.find((node) => (node.title ?? '').toLowerCase() === title.toLowerCase())?.id ?? null;
}

let positionSeq = 0;
function nextPosition() {
  positionSeq += 1;
  return { x: 80 + (positionSeq % 5) * 340, y: 80 + Math.floor(positionSeq / 5) * 300 };
}

/** Executa UMA acao (chamada em sequencia por tourRunAction). */
async function runAction(action: TourAction): Promise<void> {
    switch (action.kind) {
      case 'createAgent': {
        await api(`/api/agent-room/workspaces/${workspaceId}/nodes`, {
          method: 'POST',
          body: JSON.stringify({
            type: 'terminal',
            title: action.title,
            ...nextPosition(),
            width: 560,
            height: 340,
            payload: { command: action.provider, provider: action.provider, ...(action.leader ? { maestro: true } : {}) },
          }),
        });
        break;
      }
      case 'createNote': {
        await api(`/api/agent-room/workspaces/${workspaceId}/nodes`, {
          method: 'POST',
          body: JSON.stringify({ type: 'note', title: action.title, ...nextPosition(), width: 360, height: 260, payload: { content: action.content } }),
        });
        break;
      }
      case 'createTasksBoard': {
        await api(`/api/agent-room/workspaces/${workspaceId}/nodes`, {
          method: 'POST',
          body: JSON.stringify({ type: 'tasks', title: 'Tarefas', ...nextPosition(), width: 560, height: 360, payload: {} }),
        });
        break;
      }
      case 'createUsage': {
        await api(`/api/agent-room/workspaces/${workspaceId}/nodes`, {
          method: 'POST',
          body: JSON.stringify({
            type: 'usage',
            title: action.title,
            ...nextPosition(),
            width: 560,
            height: 440,
            payload: { enabled: true, sourceProvider: 'claude', fallbackProvider: 'codex', windowKind: 'weekly', thresholdPercent: 90 },
          }),
        });
        break;
      }
      case 'createApiClient': {
        await api(`/api/agent-room/workspaces/${workspaceId}/nodes`, {
          method: 'POST',
          body: JSON.stringify({
            type: 'apiClient',
            title: action.title,
            ...nextPosition(),
            width: 760,
            height: 520,
            payload: { requests: [], selectedRequestId: null, variables: {} },
          }),
        });
        break;
      }
      case 'createImageWorkflow': {
        await api(`/api/agent-room/workspaces/${workspaceId}/nodes`, {
          method: 'POST',
          body: JSON.stringify({
            type: 'imageWorkflow',
            title: action.title,
            ...nextPosition(),
            width: 440,
            height: 560,
            payload: {
              schemaVersion: 1,
              prompt: action.prompt,
              count: 2,
              transparentBackground: true,
              outputDirectory: 'generated/images',
              filePrefix: 'creative-image',
              status: 'idle',
              history: [],
            },
          }),
        });
        break;
      }
      case 'createShape': {
        await api(`/api/agent-room/workspaces/${workspaceId}/nodes`, {
          method: 'POST',
          body: JSON.stringify({
            type: 'shape',
            title: action.title,
            ...nextPosition(),
            width: action.shape === 'arrow' ? 260 : 220,
            height: action.shape === 'arrow' ? 100 : 140,
            payload: {
              shape: action.shape ?? 'rounded',
              label: action.title,
              fill: '#7C4DFF',
              fillOpacity: 0.08,
              stroke: '#7C4DFF',
              strokeWidth: 2,
              textColor: '#ffffff',
              fontSize: 14,
              fontWeight: 600,
              textAlign: 'center',
            },
          }),
        });
        break;
      }
      case 'createDevice': {
        const nodes = await api<WorkspaceSnapshot['nodes']>(`/api/agent-room/workspaces/${workspaceId}/nodes`);
        if (!nodes?.some((node) => node.type === 'device')) {
          await api(`/api/agent-room/workspaces/${workspaceId}/nodes`, {
            method: 'POST',
            body: JSON.stringify({
              type: 'device',
              title: action.title,
              ...nextPosition(),
              width: 560,
              height: 720,
              payload: {},
            }),
          });
        }
        break;
      }
      case 'createDesign': {
        const nodes = await api<WorkspaceSnapshot['nodes']>(`/api/agent-room/workspaces/${workspaceId}/nodes`);
        if (!nodes?.some((node) => node.type === 'design' && node.title === action.title)) {
          await api(`/api/agent-room/workspaces/${workspaceId}/nodes`, {
            method: 'POST',
            body: JSON.stringify({
              type: 'design',
              title: action.title,
              ...nextPosition(),
              width: 600,
              height: 420,
              payload: {},
            }),
          });
        }
        break;
      }
      case 'createTask': {
        const assigneeNodeId = action.assigneeTitle ? await findNodeId(action.assigneeTitle) : null;
        await api(`/api/agent-room/workspaces/${workspaceId}/tasks`, {
          method: 'POST',
          body: JSON.stringify({ title: action.title, assigneeNodeId }),
        });
        break;
      }
      case 'connect': {
        const [sourceNodeId, targetNodeId] = await Promise.all([findNodeId(action.fromTitle), findNodeId(action.toTitle)]);
        if (!sourceNodeId || !targetNodeId) throw new Error('Crie os dois agentes antes de conectar.');
        await api(`/api/agent-room/workspaces/${workspaceId}/edges`, {
          method: 'POST',
          body: JSON.stringify({ sourceNodeId, targetNodeId }),
        });
        break;
      }
      case 'createPortal': {
        await api(`/api/agent-room/workspaces/${workspaceId}/nodes`, {
          method: 'POST',
          body: JSON.stringify({ type: 'portal', title: action.title ?? 'Portal', ...nextPosition(), width: 720, height: 520, payload: { url: action.url } }),
        });
        break;
      }
      case 'createFlow': {
        await api(`/api/agent-room/workspaces/${workspaceId}/nodes`, {
          method: 'POST',
          body: JSON.stringify({ type: 'flow', title: action.title, ...nextPosition(), width: 480, height: 420, payload: { steps: action.steps, iterations: 1 } }),
        });
        break;
      }
      case 'createRoutine': {
        const targetNodeId = await findNodeId(action.targetTitle);
        if (!targetNodeId) throw new Error(`Agente "${action.targetTitle}" nao encontrado para a rotina.`);
        await api(`/api/agent-room/workspaces/${workspaceId}/routines`, {
          method: 'POST',
          body: JSON.stringify({ targetNodeId, prompt: action.prompt, intervalMinutes: action.intervalMinutes ?? null }),
        });
        break;
      }
      case 'createFloor': {
        await api(`/api/agent-room/workspaces/${workspaceId}/floors`, {
          method: 'POST',
          body: JSON.stringify({ name: action.name }),
        });
        break;
      }
      case 'installMcp': {
        const results = await api<Array<{ key: string }>>(`/api/agent-room/workspaces/${workspaceId}/mcp-market?q=${encodeURIComponent(action.key)}`);
        const entry = results?.find((item) => item.key === action.key) ?? results?.[0];
        if (!entry) throw new Error(`MCP "${action.key}" nao encontrado no marketplace.`);
        await api(`/api/agent-room/workspaces/${workspaceId}/mcp-market`, {
          method: 'POST',
          body: JSON.stringify({ entry, env: {} }),
        });
        break;
      }
      case 'openCouncil': {
        window.dispatchEvent(new CustomEvent('orkestrai:open-council', {
          detail: { workspaceId },
        }));
        break;
      }
      case 'openSharing': {
        window.dispatchEvent(new CustomEvent('orkestrai:open-sharing', {
          detail: { workspaceId },
        }));
        break;
      }
      case 'openDesign': {
        const nodeId = await findNodeId(action.title);
        if (!nodeId) throw new Error(`Design "${action.title}" nao encontrado.`);
        await goto(`/canvas?workspace=${encodeURIComponent(String(workspaceId))}&node=${encodeURIComponent(nodeId)}&design=1`);
        break;
      }
      case 'createDesignExploration': {
        const created = await api(`/api/agent-room/workspaces/${workspaceId}/design-explorations`, {
          method: 'POST',
          body: JSON.stringify({
            title: action.title,
            objective: action.objective,
            audience: action.audience,
            platform: 'responsive-web',
            codeTarget: 'svelar',
            constraints: '',
            references: '',
            includeDarkMode: true,
            executionMode: 'manual',
            leaderNodeId: null,
            locale: localeState.current,
          }),
        });
        if (!created) throw new Error(m['design.exploration_create_error']());
        break;
      }
      case 'openPage': {
        // Placeholder {workspace} resolve para o workspace do tour.
        await goto(action.path.replaceAll('{workspace}', String(workspaceId)));
        break;
      }
    }
}

/** Executa a(s) acao(oes) reais do passo ("Fazer por mim") — em sequencia. */
export async function tourRunAction(action: TourAction | TourAction[]): Promise<void> {
  if (tourState.busy) return; // clique duplo enquanto executa: ignora
  tourState.busy = true;
  tourState.error = '';
  try {
    for (const single of Array.isArray(action) ? action : [action]) {
      await runAction(single);
    }
    await evaluateChecks();
    const current = tourState.tour?.steps[tourState.stepIndex];
    if (!tourState.error && current) {
      // Marca o passo como feito: o botao desabilita ate o passo virar (sem
      // isso, clicar de novo antes do poll duplicava o agente/no criado).
      tourState.actionDoneFor = current.id;
      // Passo com acao SEM check nao tem o que esperar: avanca (ou conclui).
      if (!current.check) {
        tourState.autoCompleted.add(current.id);
        tourNext();
      }
    }
  } catch (error) {
    tourState.error = error instanceof Error ? error.message : 'Falha na acao.';
  } finally {
    tourState.busy = false;
  }
}
