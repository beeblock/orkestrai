import { CodeGraphConnection as Connection } from '$lib/database/code-graph-storage.js';
import { codeGraphRepository } from '../repositories/CodeGraphRepository.js';
import { revisionEntries } from './CodeGraphRevisionChunks.js';
import type { CodeGraphRevisionComparison, CodeGraphRevisionSymbol, CodeGraphRevisionRelationship } from '../../domain/code-graph.js';

/** Compare bounded streams in the analysis worker; never load two giant manifests into Core. */
export async function compareGraphRevisions(workspaceId: string, projectId: string, fromId?: string, toId?: string): Promise<CodeGraphRevisionComparison> {
  const summaries = await codeGraphRepository.revisionSummaries(workspaceId, projectId, 30);
  if (summaries.length < 2) throw new Error('Index this project at least twice before comparing revisions.');
  const to = toId ? summaries.find(item => item.id === toId) : summaries[0];
  const from = fromId ? summaries.find(item => item.id === fromId) : summaries.find(item => item.id !== to?.id);
  if (!from || !to) throw new Error('The selected revisions were not found for this project.');
  if (from.id === to.id) throw new Error('Select two different revisions to compare.');
  const rows = await Connection.raw('SELECT revision_id, manifest FROM agent_code_graph_revision_manifests WHERE workspace_id = ? AND project_id = ? AND revision_id IN (?, ?)', [workspaceId, projectId, from.id, to.id]);
  const before = rows.find((row: any) => row.revision_id === from.id)?.manifest;
  const after = rows.find((row: any) => row.revision_id === to.id)?.manifest;
  if (!before || !after) throw new Error('A selected revision no longer has a comparison manifest.');
  type Value = CodeGraphRevisionSymbol | CodeGraphRevisionRelationship;
  const limit = 2_000;
  const state = () => ({ hashes: new Map<string, string>(), added: [] as Value[], removed: [] as Value[], modified: new Map<string, { before?: Value; after: Value }>(), unchanged: 0, addedCount: 0, modifiedCount: 0 });
  const sections = { symbols: state(), relationships: state() };
  for await (const entry of revisionEntries(workspaceId, projectId, before)) sections[entry.section].hashes.set(entry.value.fingerprint, entry.value.contentHash);
  for await (const { section, value } of revisionEntries(workspaceId, projectId, after)) {
    const next = sections[section];
    const hash = next.hashes.get(value.fingerprint);
    if (hash === undefined) { next.addedCount++; if (next.added.length < limit) next.added.push(value); }
    else if (hash !== value.contentHash) { next.modifiedCount++; if (next.modified.size < limit) next.modified.set(value.fingerprint, { after: value }); }
    else next.unchanged++;
    next.hashes.delete(value.fingerprint);
  }
  for await (const { section, value } of revisionEntries(workspaceId, projectId, before)) {
    const next = sections[section];
    if (next.hashes.has(value.fingerprint) && next.removed.length < limit) next.removed.push(value);
    const modified = next.modified.get(value.fingerprint);
    if (modified) modified.before = value;
  }
  const symbols = sections.symbols, relationships = sections.relationships;
  return {
    projectId, projectName: to.projectName, from, to,
    added: symbols.added as CodeGraphRevisionSymbol[], removed: symbols.removed as CodeGraphRevisionSymbol[],
    modified: [...symbols.modified.values()] as Array<{ before: CodeGraphRevisionSymbol; after: CodeGraphRevisionSymbol }>,
    unchanged: symbols.unchanged,
    relationships: {
      added: relationships.added as CodeGraphRevisionRelationship[], removed: relationships.removed as CodeGraphRevisionRelationship[],
      modified: [...relationships.modified.values()] as Array<{ before: CodeGraphRevisionRelationship; after: CodeGraphRevisionRelationship }>,
      unchanged: relationships.unchanged,
    },
    truncated: Object.values(sections).some(section => section.addedCount > limit || section.modifiedCount > limit || section.hashes.size > limit),
  };
}
