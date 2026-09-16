import type { ComputerAccessibility, ComputerInteraction } from '../../../contracts/schemas/computer.schema.js';
import { NativeInteractionError } from './native-interaction-error.js';

/** Rebind a control only between two fresh views of the same exact window. */
export function nativeFileControl(selector: ComputerInteraction['element'], source: ComputerAccessibility, target: ComputerAccessibility) {
  if (!source.available || source.truncated || !target.available || target.truncated) throw new NativeInteractionError('A complete native file dialog observation is required.', false);
  const matches = (tree: ComputerAccessibility) => tree.elements.filter(element => element.role === selector.role && element.name === selector.name && (selector.value === undefined || selector.value === element.value) && !element.protected && element.enabled);
  const from = matches(source), to = matches(target);
  if (from.length !== 1 || from[0].id !== selector.id || to.length !== 1) throw new NativeInteractionError('The native file control is missing, changed or ambiguous. No input was attempted.', false);
  return { id: to[0].id, role: to[0].role, name: to[0].name, ...(selector.value === undefined ? {} : { value: to[0].value }) };
}
