import type { CollaborationRole, CollaborationScope } from '../types.js';

const ROLE_SCOPES: Record<CollaborationRole, readonly CollaborationScope[]> = {
  viewer: ['workspace.view', 'activity.view', 'tasks.view', 'approvals.view', 'design.view', 'huddles.view'],
  collaborator: ['workspace.view', 'activity.view', 'tasks.view', 'tasks.write', 'approvals.view', 'design.view', 'design.comment', 'design.propose', 'huddles.view', 'huddles.speak'],
  operator: [
    'workspace.view', 'activity.view', 'tasks.view', 'tasks.write',
    'approvals.view', 'approvals.decide', 'design.view', 'design.comment', 'design.propose', 'design.decide', 'leader.message', 'voice.transcribe', 'agents.message', 'huddles.view', 'huddles.speak', 'huddles.manage',
  ],
  administrator: [
    'workspace.view', 'activity.view', 'tasks.view', 'tasks.write',
    'approvals.view', 'approvals.decide', 'design.view', 'design.comment', 'design.propose', 'design.decide', 'design.edit', 'leader.message', 'voice.transcribe', 'agents.message',
    'agents.invoke', 'huddles.view', 'huddles.speak', 'huddles.manage', 'peers.manage',
  ],
};

const COMMAND_SCOPE = {
  'task.create': 'tasks.write',
  'task.update': 'tasks.write',
  'review.decide': 'approvals.decide',
  'design.comment.create': 'design.comment',
  'design.comment.reply': 'design.comment',
  'design.comment.resolve': 'design.comment',
  'design.proposal.create': 'design.propose',
  'design.proposal.decide': 'design.decide',
  'design.element.update': 'design.edit',
  'leader.message': 'leader.message',
  'agent.message': 'agents.message',
  'agent.invoke': 'agents.invoke',
  'huddle.create': 'huddles.manage',
  'huddle.turn': 'huddles.speak',
  'huddle.end': 'huddles.manage',
  'attention.decide': 'approvals.decide',
  'attention.answer': 'approvals.decide',
} as const satisfies Record<string, CollaborationScope>;

export class CollaborationPolicy {
  scopesForRole(role: CollaborationRole): CollaborationScope[] {
    return [...ROLE_SCOPES[role]];
  }

  can(scopes: readonly CollaborationScope[], scope: CollaborationScope): boolean {
    return scopes.includes(scope);
  }

  commandScope(type: keyof typeof COMMAND_SCOPE): CollaborationScope {
    return COMMAND_SCOPE[type];
  }

  scopesForApproval(
    role: CollaborationRole,
    terminalAccess: boolean,
    designAccess: 'inherited' | 'none' | 'view' | 'comment' | 'propose' | 'edit' = 'inherited',
  ): CollaborationScope[] {
    let scopes = this.scopesForRole(role);
    if (designAccess !== 'inherited') {
      const designScopes = new Set<CollaborationScope>(['design.view', 'design.comment', 'design.propose', 'design.decide', 'design.edit']);
      scopes = scopes.filter((scope) => !designScopes.has(scope));
      if (designAccess !== 'none') scopes.push('design.view');
      if (designAccess === 'comment' || designAccess === 'propose' || designAccess === 'edit') scopes.push('design.comment');
      if (designAccess === 'propose' || designAccess === 'edit') scopes.push('design.propose');
      if (designAccess === 'edit') scopes.push('design.decide', 'design.edit');
    }
    if (terminalAccess && role === 'administrator') scopes.push('terminal.control');
    return scopes;
  }
}

export const collaborationPolicy = new CollaborationPolicy();
