import { afterEach, describe, expect, it, vi } from 'vitest';
import { AttentionDecisionService } from '$lib/modules/agent-room/application/services/AttentionDecisionService.js';
import { attentionService } from '$lib/modules/agent-room/application/services/AttentionService.js';
import { autonomyPolicyService } from '$lib/modules/agent-room/application/services/AutonomyPolicyService.js';
import { flowService } from '$lib/modules/agent-room/application/services/FlowService.js';
import { attentionRepository } from '$lib/modules/agent-room/infrastructure/repositories/AttentionRepository.js';

function item(action: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return { id: 'item', workspaceId: 'w', nodeId: 'node', status: 'open', sourceType: 'autonomy_gate', sourceId: 'gate', action, ...extra };
}

describe('AttentionDecisionService', () => {
  afterEach(() => vi.restoreAllMocks());

  it('decides a gate through the gate rules and closes the item', async () => {
    vi.spyOn(attentionRepository, 'find').mockResolvedValue(item({ decision: 'gate', gateId: 'gate' }) as never);
    const resolveGate = vi.spyOn(autonomyPolicyService, 'resolveGate').mockResolvedValue({} as never);
    const resolveSource = vi.spyOn(attentionService, 'resolveSource').mockResolvedValue(1);
    await new AttentionDecisionService().decide('w', 'item', 'reject');
    expect(resolveGate).toHaveBeenCalledWith('w', 'gate', 'denied', 'workspace-owner', null);
    expect(resolveSource).toHaveBeenCalledWith('w', 'autonomy_gate', 'gate');
  });

  it('approves or stops a waiting flow', async () => {
    vi.spyOn(attentionRepository, 'find').mockResolvedValue(item({ decision: 'flow' }, { sourceType: 'flow_approval', sourceId: 'node' }) as never);
    vi.spyOn(attentionService, 'resolveSource').mockResolvedValue(1);
    const approve = vi.spyOn(flowService, 'approve').mockReturnValue({ approved: true });
    await new AttentionDecisionService().decide('w', 'item', 'approve');
    expect(approve).toHaveBeenCalledWith('w', 'node');
  });

  it('refuses items without a decision and resolved items', async () => {
    vi.spyOn(attentionRepository, 'find').mockResolvedValueOnce(item({ target: 'node' }) as never).mockResolvedValueOnce(item({ decision: 'gate', gateId: 'g' }, { status: 'resolved' }) as never);
    await expect(new AttentionDecisionService().decide('w', 'item', 'approve')).rejects.toThrow();
    await expect(new AttentionDecisionService().decide('w', 'item', 'approve')).rejects.toThrow();
  });
});
