import type { NoteStack } from './note-stacks.js';

/** Stack state shared by the canvas page and the note nodes it renders. */
export const noteStackState = $state<{
  expanded: string[];
  tops: Record<string, { agentId: string; count: number; expanded: boolean }>;
}>({ expanded: [], tops: {} });

export function publishNoteStacks(stacks: readonly NoteStack[]): void {
  const expanded = new Set(noteStackState.expanded);
  const tops: Record<string, { agentId: string; count: number; expanded: boolean }> = {};
  for (const stack of stacks) {
    tops[stack.noteIds[stack.noteIds.length - 1]] = { agentId: stack.agentId, count: stack.noteIds.length, expanded: expanded.has(stack.agentId) };
  }
  const previous = noteStackState.tops;
  const same = Object.keys(previous).length === Object.keys(tops).length
    && Object.entries(tops).every(([id, top]) => previous[id]?.agentId === top.agentId && previous[id]?.count === top.count && previous[id]?.expanded === top.expanded);
  if (!same) noteStackState.tops = tops;
}

export function setNoteStackExpanded(agentId: string, expanded: boolean): void {
  const current = new Set(noteStackState.expanded);
  if (expanded) current.add(agentId);
  else current.delete(agentId);
  noteStackState.expanded = [...current];
}
