import { computerAccessibilitySchema, type ComputerAccessibility } from '../../../contracts/schemas/computer.schema.js';

export const unavailableAccessibility = (): ComputerAccessibility => ({ available: false, truncated: false, elements: [] });

export function parseAccessibility(raw: unknown): ComputerAccessibility {
  const tree = computerAccessibilitySchema.parse(raw);
  const seen = new Set<string>();
  let characters = 0;
  for (const element of tree.elements) {
    if (seen.has(element.id)) throw new Error('Ambiguous accessibility element identity.');
    seen.add(element.id);
    if (element.protected) { element.name = ''; element.value = ''; element.actions = []; }
    characters += element.name.length + element.value.length;
    if (characters > 100_000) throw new Error('Accessibility content exceeds the safe limit.');
  }
  return tree;
}
