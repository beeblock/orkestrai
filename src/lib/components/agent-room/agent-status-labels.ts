import type { AgentActivityState } from '$lib/modules/agent-room/domain/types.js';
import * as m from '$lib/paraglide/messages.js';
import type { elapsedParts } from './agent-identity.js';

export function agentStateLabel(state: AgentActivityState): string {
  if (state === 'starting') return m['control_center.state_starting']();
  if (state === 'working') return m['control_center.state_working']();
  if (state === 'waiting_input') return m['control_center.state_waiting_input']();
  if (state === 'waiting_permission') return m['control_center.state_waiting_permission']();
  if (state === 'blocked') return m['control_center.state_blocked']();
  if (state === 'idle') return m['control_center.state_idle']();
  if (state === 'done') return m['control_center.state_done']();
  if (state === 'error') return m['control_center.state_error']();
  return m['control_center.state_disconnected']();
}

export function elapsedLabel(parts: NonNullable<ReturnType<typeof elapsedParts>>): string {
  if (parts.unit === 'seconds') return m['control_center.elapsed_seconds']({ count: parts.count });
  if (parts.unit === 'minutes') return m['control_center.elapsed_minutes']({ count: parts.count });
  if (parts.unit === 'hours') return m['control_center.elapsed_hours']({ count: parts.count });
  return m['agent_status.elapsed_days']({ count: parts.count });
}

/**
 * What an agent last did, in words: known system events get a sentence and
 * other internal codes (`system:…`, `runtime:…`) are never shown raw. Free text
 * an agent reported about itself is kept as written.
 */
export function agentActionLabel(lastAction: string | null | undefined, data: Record<string, unknown> = {}): string | null {
  const action = lastAction?.trim();
  if (!action) return null;
  const value = (key: string) => String(data[key] ?? m['control_center.workspace_user']());
  if (action === 'system:message_received') return m['control_center.action_message_received']({ name: value('fromTitle') });
  if (action === 'system:message_replied') return m['control_center.action_message_replied']({ name: value('toTitle') });
  if (action === 'system:task_completed') return m['control_center.action_task_completed']({ title: value('taskTitle') });
  if (action === 'system:task_review') return m['control_center.action_task_review']({ title: value('taskTitle') });
  if (action === 'system:task_working') return m['control_center.action_task_working']({ title: value('taskTitle') });
  if (/^(?:system|runtime|lifecycle):/.test(action)) return null;
  return action;
}

/** One line for "what is this agent doing": its action, else its task, else its state. */
export function agentDoingLabel(agent: { lastAction: string | null; lastActionData?: Record<string, unknown>; currentTask?: { title: string } | null; state: AgentActivityState; sessionAlive?: boolean }): string {
  return agentActionLabel(agent.lastAction, agent.lastActionData ?? {})
    ?? agent.currentTask?.title
    ?? agentStateLabel(agent.sessionAlive === false ? 'disconnected' : agent.state);
}
