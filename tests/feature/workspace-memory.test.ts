import { describe, expect, it } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { workspaceMemoryService, WorkspaceMemoryConflictError } from '$lib/modules/agent-room/application/services/WorkspaceMemoryService.js';
import { workspaceMemoryRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceMemoryRepository.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { WorkspaceMemoryController } from '$lib/modules/agent-room/interface/http/controllers/WorkspaceMemoryController.js';

describe('WorkspaceMemoryService', () => {
  useSvelarTest({ refreshDatabase: true });

  it('creates and revises memory over workspace HTTP routes without mixing route ids into the strict body', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'HTTP memory', workingDir: '/tmp/memory' });
    const controller = new WorkspaceMemoryController();
    const event = (body: unknown, memoryId?: string) => {
      const url = new URL(`http://localhost/api/agent-room/workspaces/${workspace.id}/memory`);
      return { params: { id: workspace.id, ...(memoryId ? { memoryId } : {}) }, url,
        request: new Request(url, { method: memoryId ? 'PUT' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) } as never;
    };
    const input = { title: 'Validated project decision', content: 'Reuse the established deployment provider.', kind: 'decision', sources: [{ type: 'user', label: 'Owner' }] };
    const created = await controller.store(event(input));
    expect(created.status, await created.clone().text()).toBe(201);
    const original = (await created.json()).data;
    const revised = await controller.update(event({ ...input, content: 'Use the verified deployment provider.', baseRevision: original.revision, baseUpdatedAt: original.updatedAt }, original.id));
    expect(revised.status, await revised.clone().text()).toBe(200);
    expect((await revised.json()).data).toMatchObject({ revision: 2, content: 'Use the verified deployment provider.' });
    expect((await controller.store(event({ ...input, id: workspace.id }))).status).toBe(400);
  });

  it('persists sourced memory and finds it through source-aware search', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'Memory', workingDir: '/tmp/memory' });
    const entry = await workspaceMemoryService.create(workspace.id, {
      title: 'Public API authentication',
      content: 'Use OAuth 2.0 authorization code with PKCE for interactive clients.',
      kind: 'decision',
      confidence: 95,
      pinned: true,
      tags: ['API', 'security'],
      createdByNodeId: null,
      sources: [{ type: 'url', label: 'Architecture decision', uri: 'https://example.com/adr/auth', excerpt: 'PKCE is required.' }],
    });

    expect(entry).toMatchObject({ revision: 1, status: 'active', pinned: true, tags: ['api', 'security'] });
    expect(entry.sources[0].contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(await workspaceMemoryService.list(workspace.id, { query: 'pkce' })).toHaveLength(1);
    expect(await workspaceMemoryService.list(workspace.id, { query: 'architecture decision' })).toHaveLength(1);
  });

  it('revises without erasing provenance and rejects stale writes', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'Revisions', workingDir: '/tmp/revisions' });
    const original = await workspaceMemoryService.create(workspace.id, {
      title: 'Release cadence', content: 'Ship every Friday.', kind: 'preference', confidence: 80, pinned: false, tags: [], createdByNodeId: null,
      sources: [{ type: 'user', label: 'Workspace owner', excerpt: 'Friday release.' }],
    });
    const revised = await workspaceMemoryService.revise(workspace.id, original.id, {
      title: 'Release cadence', content: 'Ship every Thursday.', kind: 'preference', confidence: 100, pinned: false, tags: ['release'], createdByNodeId: null,
      sources: [{ type: 'user', label: 'Workspace owner', excerpt: 'Move release to Thursday.' }],
      baseUpdatedAt: original.updatedAt,
      baseRevision: original.revision,
    });

    expect(revised).toMatchObject({ revision: 2, supersedesId: original.id, status: 'active' });
    const history = await workspaceMemoryRepository.list(workspace.id, true);
    expect(history.map((item) => item.status).sort()).toEqual(['active', 'superseded']);
    await expect(workspaceMemoryService.revise(workspace.id, revised.id, {
      title: revised.title, content: revised.content, kind: revised.kind, confidence: revised.confidence, pinned: revised.pinned,
      tags: revised.tags, createdByNodeId: null, sources: [{ type: 'user', label: 'Owner' }], baseUpdatedAt: original.updatedAt, baseRevision: original.revision,
    })).rejects.toBeInstanceOf(WorkspaceMemoryConflictError);
  });

  it('rejects sources that point outside the workspace', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'Scoped', workingDir: '/tmp/scoped' });
    const other = await workspaceRepository.createWorkspace({ name: 'Other', workingDir: '/tmp/other' });
    const note = await workspaceRepository.createNode({ workspaceId: other.id, type: 'note', title: 'Private context' });
    await expect(workspaceMemoryService.create(workspace.id, {
      title: 'Foreign memory', content: 'Should fail.', kind: 'fact', confidence: 50, pinned: false, tags: [], createdByNodeId: null,
      sources: [{ type: 'note', sourceId: note.id, label: 'Other note' }],
    })).rejects.toThrow('does not belong');
  });
});
