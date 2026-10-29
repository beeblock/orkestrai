import type { ModelAccessConnection } from '../../domain/types.js';
import type { TerminalNodePayload } from '$lib/modules/agent-room/domain/types.js';
import type { GuestAgentInput } from '../../contracts/schemas/model-access.schema.js';

/** Public model selection only. Never fall back from an explicitly selected, unavailable account. */
type SelectionPayload = TerminalNodePayload & { model?: string; effort?: string };
export function guestAgentSelection(input: Pick<GuestAgentInput, 'model' | 'effort'>, payload: SelectionPayload, leader: SelectionPayload | undefined, connections: Array<ModelAccessConnection & { state: string }>) {
  const flag = (node: TerminalNodePayload | undefined, name: string) => {
    const args = Array.isArray(node?.args) ? node.args : []; const index = args.indexOf(name);
    return index >= 0 && typeof args[index + 1] === 'string' ? args[index + 1] : undefined;
  };
  let value = input.model ?? payload.model ?? flag(payload, '--model') ?? leader?.model ?? flag(leader, '--model');
  let effort = input.effort ?? payload.effort ?? flag(payload, '--effort') ?? leader?.effort ?? flag(leader, '--effort');
  if (!value) {
    const active = connections.filter(item => item.status === 'active' && item.state === 'connected');
    const choices = active.flatMap(connection => (connection.policy?.offerings ?? []).map(offering => ({ connection, offering })));
    if (choices.length !== 1 || !choices[0].offering.availableModels.length) throw new Error('INFERENCE_SELECT_MODEL');
    const { connection, offering } = choices[0]; value = `${connection.id}/${offering.id}/${offering.availableModels[0].value}`;
  }
  const [connectionId, offeringId, ...parts] = value.split('/'), model = parts.join('/');
  const connection = connections.find(item => item.id === connectionId && item.status === 'active' && item.state === 'connected');
  const offering = connection?.policy?.offerings.find(item => item.id === offeringId);
  const option = offering?.availableModels.find(item => item.value === model);
  if (!connection || !offering || !option || (offering.models && !offering.models.includes(model))) throw new Error('INFERENCE_POLICY_DENIED');
  const allowed = option.efforts.filter(item => !offering.efforts || offering.efforts.includes(item));
  effort ??= allowed.includes('high') ? 'high' : allowed[0];
  if (!effort || !allowed.includes(effort as any)) throw new Error('INFERENCE_POLICY_DENIED');
  return { value, model, connection, offering, effort: effort as NonNullable<GuestAgentInput['effort']> };
}
