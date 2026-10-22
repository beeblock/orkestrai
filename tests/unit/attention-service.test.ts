import { afterEach, describe, expect, it, vi } from 'vitest';
import { attentionService } from '$lib/modules/agent-room/application/services/AttentionService.js';
import { attentionRepository } from '$lib/modules/agent-room/infrastructure/repositories/AttentionRepository.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';

const failure = {
  workspaceId: 'w',
  nodeId: 'gone',
  category: 'message' as const,
  severity: 'warning' as const,
  title: 'SUA VEZ, agora',
  body: 'O agente de destino não existe mais.',
  sourceType: 'bridge',
  sourceId: 'message',
  correlationId: 'message-failure:message',
};

describe('AttentionService.raise', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps an undelivered message to a removed agent out of Needs you', async () => {
    vi.spyOn(workspaceRepository, 'getNode').mockResolvedValue(null);
    const save = vi.spyOn(attentionRepository, 'save');
    await attentionService.raise(failure);
    expect(save).not.toHaveBeenCalled();
  });

  it('still raises an undelivered message to an agent that exists without a leader', async () => {
    const node = { id: 'gone', workspaceId: 'w', type: 'terminal', title: 'Shell', payload: {} };
    vi.spyOn(workspaceRepository, 'getNode').mockResolvedValue(node as never);
    vi.spyOn(workspaceRepository, 'listNodes').mockResolvedValue([node] as never);
    const save = vi.spyOn(attentionRepository, 'save').mockResolvedValue({ id: 'item' } as never);
    await attentionService.raise(failure);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ nodeId: 'gone', sourceType: 'bridge' }));
  });
});
