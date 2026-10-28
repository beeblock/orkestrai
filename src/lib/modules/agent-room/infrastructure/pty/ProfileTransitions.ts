/** Shared by the SSR services and the type-stripped WebSocket transport. */
export function profileTransitions(): Map<string, Promise<unknown>> {
  const globals = globalThis as typeof globalThis & { __orkestraiProfileChanges?: Map<string, Promise<unknown>> };
  return globals.__orkestraiProfileChanges ??= new Map();
}
