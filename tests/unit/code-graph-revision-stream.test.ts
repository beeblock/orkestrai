import { describe, expect, it } from 'vitest';
import { gzipSync } from 'node:zlib';
import { revisionEntries, revisionChunkHeader } from '$lib/modules/agent-room/infrastructure/code-graph/CodeGraphRevisionChunks.js';

describe('bounded legacy revision streaming', () => {
  it('reads Unicode, escaped JSON, nested values and relationships without a full JSON.parse', async () => {
    const value = { fingerprint: 'a', contentHash: 'b', name: 'método "[{}]" \\ ✓', metadata: { nested: ['value'] } };
    const compressed = gzipSync(JSON.stringify({ version: 1, files: [{ path: 'método.ts' }], symbols: [value], relationships: [{ fingerprint: 'edge', contentHash: 'hash' }] }));
    expect(revisionChunkHeader(compressed)).toBeNull();
    const entries = [];
    for await (const entry of revisionEntries('workspace', 'project', compressed)) entries.push(entry);
    expect(entries).toEqual([{ section: 'symbols', value }, { section: 'relationships', value: { fingerprint: 'edge', contentHash: 'hash' } }]);
  });
  it('does not accept an incomplete legacy stream', async () => {
    const run = async () => { for await (const _ of revisionEntries('workspace', 'project', gzipSync('{"version":1,"symbols":[{"name":"broken'))) { /* consume */ } };
    await expect(run()).rejects.toThrow();
  });
});
