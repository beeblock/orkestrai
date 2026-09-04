import { describe, expect, it } from 'vitest';
import {
  canvasNodeTypeSchema,
  createCanvasNodeSchema,
} from '$lib/modules/agent-room/contracts/schemas/workspaceSchemas.js';
import { transferCanvasNodesSchema } from '$lib/modules/agent-room/contracts/schemas/transfer-canvas-nodes.schema.js';

describe('workspaceSchemas — tipos de nó do canvas', () => {
  it('aceita todos os tipos suportados, incluindo image, device e design', () => {
    const types = ['terminal', 'note', 'fileTree', 'editor', 'diff', 'portal', 'loop', 'group', 'shape', 'tasks', 'flow', 'image', 'usage', 'device', 'design'];
    for (const type of types) {
      expect(canvasNodeTypeSchema.safeParse(type).success).toBe(true);
    }
    expect(canvasNodeTypeSchema.safeParse('video').success).toBe(false);
  });

  it('cria nó de imagem com payload de path', () => {
    const parsed = createCanvasNodeSchema.safeParse({
      type: 'image',
      title: 'Referência',
      x: 10,
      y: 20,
      width: 320,
      height: 240,
      payload: { path: '.orkestrai/images/ref.png' },
    });
    expect(parsed.success).toBe(true);
  });

  it('validates bounded cross-workspace transfers and removes duplicate ids', () => {
    const destinationWorkspaceId = '00000000-0000-7000-8000-000000000001';
    const nodeId = '00000000-0000-7000-8000-000000000002';
    expect(transferCanvasNodesSchema.parse({ destinationWorkspaceId, nodeIds: [nodeId, nodeId], mode: 'copy' }).nodeIds).toEqual([nodeId]);
    expect(transferCanvasNodesSchema.safeParse({ destinationWorkspaceId, nodeIds: [], mode: 'move' }).success).toBe(false);
    expect(transferCanvasNodesSchema.safeParse({ destinationWorkspaceId, nodeIds: [nodeId], mode: 'clone' }).success).toBe(false);
  });
});
