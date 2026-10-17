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
