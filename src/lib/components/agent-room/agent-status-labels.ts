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

const VERB_LABELS: Record<string, () => string> = {
  updated: m['control_center.verb_updated'], started: m['control_center.verb_started'],
  stopped: m['control_center.verb_stopped'], ended: m['control_center.verb_ended'],
  executed: m['control_center.verb_executed'], analyzed: m['control_center.verb_analyzed'],
  completed: m['control_center.verb_completed'], failed: m['control_center.verb_failed'],
  synthesized: m['control_center.verb_synthesized'], decided: m['control_center.verb_decided'],
  received: m['control_center.verb_received'], replied: m['control_center.verb_replied'],
  requested: m['control_center.verb_requested'], resumed: m['control_center.verb_resumed'],
  controlled: m['control_center.verb_controlled'],
};

/** An activity verb from the backend in words; unknown verbs are kept as they came. */
export function activityVerbLabel(verb: string): string {
  return VERB_LABELS[verb]?.() ?? verb;
}

/** One line for an activity event in an agent's own timeline. */
export function activityEventLabel(event: { objectTitle: string | null; action: string | null; metadata: Record<string, unknown>; verb: string }): string {
  return event.objectTitle ?? agentActionLabel(event.action, event.metadata) ?? activityVerbLabel(event.verb);
}
