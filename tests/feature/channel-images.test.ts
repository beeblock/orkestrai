import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { bridgeService } from '$lib/modules/agent-room/application/services/BridgeService.js';
import { canvasRectsOverlap } from '$lib/modules/agent-room/domain/canvas-placement.js';

describe('images an agent shows in the Conversa', () => {
  useSvelarTest({ refreshDatabase: true });
  const directories: string[] = [];
  afterEach(async () => { for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); });

  it('land on the Canvas beside the agent, once per file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ork-channel-images-'));
    directories.push(dir);
    await mkdir(join(dir, 'branding'), { recursive: true });
    await writeFile(join(dir, 'branding', 'board.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    await writeFile(join(dir, 'notes.txt'), 'not an image');
    const ws = await workspaceRepository.createWorkspace({ name: 'Channel images', workingDir: dir });
    const leader = await workspaceRepository.createNode({ workspaceId: ws.id, type: 'terminal', title: 'Lead', x: 0, y: 0, width: 640, height: 480, payload: { provider: 'claude', maestro: true } });
    const designer = await workspaceRepository.createNode({ workspaceId: ws.id, type: 'terminal', title: 'Designer', x: 720, y: 0, width: 500, height: 380, payload: { provider: 'codex' } });

    await bridgeService.postToChannel(ws.id, {
      from: 'Designer',
      message: [
        'Round 1 ![Board A](branding/board.png)',
        '![Again](./branding/board.png) ![Outside](../escape.png) ![Web](https://example.com/a.png)',
        '![Missing](branding/missing.png) ![Text](notes.txt)',
      ].join('\n'),
    });

    const nodes = await workspaceRepository.listNodes(ws.id);
    const images = nodes.filter((node) => node.type === 'image');
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ title: 'Board A', floorId: null, payload: { path: 'branding/board.png' } });
    for (const other of [leader, designer]) expect(canvasRectsOverlap(images[0], other)).toBe(false);
    const edges = await workspaceRepository.listEdges(ws.id);
    expect(edges.some((edge) => [edge.sourceNodeId, edge.targetNodeId].sort().join() === [designer.id, images[0].id].sort().join())).toBe(true);

    // Showing the same file again, from another agent, reuses the node and connects that agent too.
    await bridgeService.postToChannel(ws.id, { from: 'Lead', message: 'Approved: ![Board](branding/board.png)', channel: 'team' });
    expect((await workspaceRepository.listNodes(ws.id)).filter((node) => node.type === 'image')).toHaveLength(1);
    const after = await workspaceRepository.listEdges(ws.id);
    expect(after.some((edge) => [edge.sourceNodeId, edge.targetNodeId].sort().join() === [leader.id, images[0].id].sort().join())).toBe(true);
  });
});
