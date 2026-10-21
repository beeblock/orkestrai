import { describe, expect, it } from 'vitest';
import { collaborationPolicy } from '$lib/modules/collaboration/domain/policies/CollaborationPolicy.js';
import { scopeSharedWorkspaceSnapshot } from '$lib/modules/collaboration/application/queries/SharedWorkspaceQuery.js';
import { collaborationCommandSchema } from '$lib/modules/collaboration/contracts/schemas/collaboration.schema.js';
import type { SharedWorkspaceDto } from '$lib/modules/collaboration/domain/types.js';

const item = { id: '01a14a44-5d87-7d1c-90e7-7b697f79bf77', title: 'Deploy', body: null, nodeTitle: null, severity: 'warning' as const, decision: 'gate' as const, options: [], question: false, createdAt: '2026-10-17T12:00:00.000Z' };
const base = {
  shareId: 's', revision: 1, workspace: { name: 'W', icon: null }, nodes: [], edges: [], columns: [], tasks: [], agents: [], conversations: [], huddles: [],
  floors: [], roles: [], reviews: [], designs: [], usage: [], activity: [], attention: [item], generatedAt: '2026-10-17T12:00:00.000Z',
} as SharedWorkspaceDto;

describe('remote attention', () => {
  it('shares owner requests only with guests that may view approvals', () => {
    expect(scopeSharedWorkspaceSnapshot(base, ['workspace.view', 'approvals.view']).attention).toHaveLength(1);
    expect(scopeSharedWorkspaceSnapshot(base, ['workspace.view']).attention).toEqual([]);
  });

  it('requires the decide scope for decisions and answers', () => {
    expect(collaborationPolicy.commandScope('attention.decide')).toBe('approvals.decide');
    expect(collaborationPolicy.commandScope('attention.answer')).toBe('approvals.decide');
    expect(collaborationPolicy.scopesForRole('viewer')).not.toContain('approvals.decide');
  });

  it('validates the new commands strictly', () => {
    expect(collaborationCommandSchema.safeParse({ type: 'attention.decide', itemId: item.id, decision: 'approve' }).success).toBe(true);
    expect(collaborationCommandSchema.safeParse({ type: 'attention.decide', itemId: item.id, decision: 'maybe' }).success).toBe(false);
    expect(collaborationCommandSchema.safeParse({ type: 'attention.answer', itemId: item.id, text: '' }).success).toBe(false);
  });
});
