import type { AgentActivity, AgentActivitySnapshot, AgentActivityState, ControlCenterSnapshot } from '$lib/modules/agent-room/domain/types.js';
import { ATTENTION_STATES } from './agent-identity.js';

/**
 * Live status of the agents in the open workspace, shared by every surface
 * (canvas headers, Focus, Conversation). One fetch serves all consumers, and
 * the feed keeps its own socket while any is mounted: every view follows the
 * same events, so Canvas, Focus and Conversation never disagree about who is
 * working. Pages may still call `scheduleAgentStatusRefresh` after their own
 * changes; the refresh is debounced.
 */
export const agentStatus = $state<{
  workspaceId: string | null;
  agents: Record<string, AgentActivitySnapshot>;
  counts: Partial<Record<AgentActivityState, number>>;
  attention: number;
  loaded: boolean;
}>({ workspaceId: null, agents: {}, counts: {}, attention: 0, loaded: false });

/** One shared clock for "since" labels, ticking only while a consumer is mounted. */
export const statusClock = $state({ now: Date.now() });

let consumers = 0;
let clock: ReturnType<typeof setInterval> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> | null = null;
let dirty = false;
let generation = 0;
let socket: WebSocket | null = null;
let reconnect: ReturnType<typeof setTimeout> | null = null;
let heartbeat: ReturnType<typeof setInterval> | null = null;
let lastFrameAt = 0;
let closing: ReturnType<typeof setTimeout> | null = null;

// Frames that change what an agent is doing or whether it is still there.
const LIVE_EVENTS = ['controlCenterChanged', 'messageDelivery', 'workspaceChanged'];
const HEARTBEAT_MS = 10_000;
const SILENT_SOCKET_MS = 30_000;

async function load(workspaceId: string, ticket: number): Promise<void> {
  try {
    const response = await fetch(`/api/agent-room/workspaces/${encodeURIComponent(workspaceId)}/control-center`);
    const payload = await response.json().catch(() => null) as { data?: ControlCenterSnapshot } | ControlCenterSnapshot | null;
    if (!response.ok || !payload) return;
    const snapshot = ('data' in payload && payload.data ? payload.data : payload) as ControlCenterSnapshot;
    if (ticket !== generation || agentStatus.workspaceId !== workspaceId || !Array.isArray(snapshot.agents)) return;
    agentStatus.agents = Object.fromEntries(snapshot.agents.map((agent) => [agent.nodeId, agent]));
    agentStatus.counts = snapshot.counts ?? {};
    agentStatus.attention = snapshot.agents.filter((agent) => ATTENTION_STATES.has(agent.state)).length;
    agentStatus.loaded = true;
  } catch {
    // The previous snapshot stays on screen; the next event retries.
  }
}

function run(): void {
  const workspaceId = agentStatus.workspaceId;
  if (!workspaceId) return;
  if (inFlight) { dirty = true; return; }
  dirty = false;
  const ticket = generation;
  inFlight = load(workspaceId, ticket).finally(() => {
    inFlight = null;
    if (dirty) scheduleAgentStatusRefresh();
  });
}

/** Debounced refresh, safe to call on every activity frame. */
export function scheduleAgentStatusRefresh(delay = 300): void {
  if (!agentStatus.workspaceId || timer) return;
  timer = setTimeout(() => { timer = null; run(); }, delay);
}

function onVisibilityChange(): void {
  if (document.visibilityState === 'visible') scheduleAgentStatusRefresh(0);
}

/** The new state travels in the frame: show it at once, the debounced reload brings the rest. */
function applyActivity(nodeId: unknown, event: unknown): void {
  const current = typeof nodeId === 'string' ? agentStatus.agents[nodeId] : undefined;
  const activity = event as Partial<AgentActivity> | null;
  if (!current || !current.sessionAlive || typeof activity?.state !== 'string') return;
  // As in the snapshot: a plain shell printing output is a running tool, not a teammate at work.
  const state = !current.provider && (activity.state === 'working' || activity.state === 'starting') ? 'idle' : activity.state;
  agentStatus.agents[current.nodeId] = {
    ...current,
    state,
    stateSince: activity.createdAt ?? current.stateSince,
    lastAction: activity.action ?? current.lastAction,
    lastActionData: activity.metadata ?? current.lastActionData,
  };
}

function connect(): void {
  if (socket || consumers === 0 || typeof WebSocket === 'undefined') return;
  const live = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/agent-room/pty`);
  socket = live;
  lastFrameAt = Date.now();
  live.onopen = () => {
    live.send(JSON.stringify({ type: 'subscribe', events: LIVE_EVENTS }));
    // What changed while no socket was listening comes from a fresh load.
    scheduleAgentStatusRefresh(0);
  };
  live.onmessage = (message) => {
    lastFrameAt = Date.now();
    let frame: { type?: string; workspaceId?: string; nodeId?: string; event?: unknown };
    try { frame = JSON.parse(String(message.data)); } catch { return; }
    if (frame.type === 'pong' || !frame.type || !LIVE_EVENTS.includes(frame.type)) return;
    if (frame.workspaceId && frame.workspaceId !== agentStatus.workspaceId) return;
    if (frame.type === 'controlCenterChanged') applyActivity(frame.nodeId, frame.event);
    scheduleAgentStatusRefresh();
  };
  live.onclose = () => {
    if (socket === live) socket = null;
    if (consumers > 0 && !reconnect) reconnect = setTimeout(() => { reconnect = null; connect(); }, 3_000);
  };
}

// A socket can die without a close event (sleep, network change): ping it,
// and replace one that stopped answering, so no view freezes until remounted.
function checkSocket(): void {
  if (!socket) { connect(); return; }
  if (socket.readyState !== WebSocket.OPEN) return;
  if (Date.now() - lastFrameAt > SILENT_SOCKET_MS) { socket.close(); return; }
  socket.send(JSON.stringify({ type: 'ping' }));
}

function disconnect(): void {
  if (reconnect) clearTimeout(reconnect);
  if (heartbeat) clearInterval(heartbeat);
  closing = null;
  reconnect = null;
  heartbeat = null;
  const open = socket;
  socket = null;
  open?.close();
}

/** Starts (or retargets) the shared status feed; returns a release function. */
export function retainAgentStatus(workspaceId: string | null): () => void {
  consumers += 1;
  if (consumers === 1) {
    document.addEventListener('visibilitychange', onVisibilityChange);
    statusClock.now = Date.now();
    clock = setInterval(() => {
      if (document.visibilityState === 'visible') statusClock.now = Date.now();
    }, 30_000);
    // A page switching workspace releases and retains in one tick: keep its socket.
    if (closing) { clearTimeout(closing); closing = null; }
    connect();
    heartbeat ??= setInterval(checkSocket, HEARTBEAT_MS);
  }
  if (workspaceId !== agentStatus.workspaceId) {
    generation += 1;
    agentStatus.workspaceId = workspaceId;
    agentStatus.agents = {};
    agentStatus.counts = {};
    agentStatus.attention = 0;
    agentStatus.loaded = false;
  }
  if (workspaceId) {
    if (timer) { clearTimeout(timer); timer = null; }
    run();
  }
  return () => {
    consumers = Math.max(0, consumers - 1);
    if (consumers > 0) return;
    document.removeEventListener('visibilitychange', onVisibilityChange);
    if (timer) clearTimeout(timer);
    if (clock) clearInterval(clock);
    timer = null;
    clock = null;
    closing = setTimeout(disconnect, 2_000);
  };
}
