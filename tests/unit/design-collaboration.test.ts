import { describe, expect, it } from 'vitest';
import { applyDesignOperations } from '$lib/modules/agent-room/application/services/DesignDocumentService.js';
import { designCollaborationService } from '$lib/modules/agent-room/application/services/DesignCollaborationService.js';
import {
  designDocumentSchema,
  designPresenceHeartbeatSchema,
  leaveDesignPresenceSchema,
  type DesignCollaborator,
  type DesignDocument,
} from '$lib/modules/agent-room/contracts/schemas/designSchemas.js';

const WORKSPACE_ID = '00000000-0000-7000-8000-000000000101';
const NODE_ID = '00000000-0000-7000-8000-000000000102';
const PAGE_ID = '00000000-0000-7000-8000-000000000103';
const FRAME_ID = '00000000-0000-7000-8000-000000000104';
const TEXT_ID = '00000000-0000-7000-8000-000000000105';
const COMMENT_ID = '00000000-0000-7000-8000-000000000106';
const MESSAGE_ID = '00000000-0000-7000-8000-000000000107';
const PROPOSAL_ID = '00000000-0000-7000-8000-000000000108';
const NOW = '2026-08-17T12:00:00.000Z';

const user: DesignCollaborator = { kind: 'user', id: 'local_designer', name: 'Designer', color: '#2563eb' };
const agent: DesignCollaborator = { kind: 'agent', id: 'agent_reviewer', name: 'Reviewer', color: '#059669' };

function document(): DesignDocument {
  return designDocumentSchema.parse({
    schemaVersion: 1,
    id: '00000000-0000-7000-8000-000000000100',
    nodeId: NODE_ID,
    workspaceId: WORKSPACE_ID,
    name: 'Collaboration',
    revision: 0,
    activePageId: PAGE_ID,
    pages: [{ id: PAGE_ID, name: 'Page 1', width: 1440, height: 1024, order: 0 }],
    elements: [
      { id: FRAME_ID, pageId: PAGE_ID, parentId: null, type: 'frame', name: 'Card', x: 10, y: 20, width: 320, height: 240, order: 0 },
      { id: TEXT_ID, pageId: PAGE_ID, parentId: FRAME_ID, type: 'text', name: 'Title', x: 30, y: 40, width: 200, height: 40, text: 'Before', order: 0 },
    ],
    createdAt: NOW,
    updatedAt: NOW,
  });
}

describe('colaboracao no Design Mode', () => {
  it('aceita os parametros de rota adicionados pelo FormRequest sem poluir o DTO', () => {
    const heartbeat = designPresenceHeartbeatSchema.parse({
      id: WORKSPACE_ID,
      nodeId: NODE_ID,
      participant: user,
      pageId: PAGE_ID,
      elementIds: [],
      cursor: null,
      viewport: { x: 3424, y: 3288, zoom: 0.82 },
      followParticipantId: null,
    });
    const leave = leaveDesignPresenceSchema.parse({ id: WORKSPACE_ID, nodeId: NODE_ID, participantId: user.id });

    expect(heartbeat).not.toHaveProperty('id');
    expect(heartbeat).not.toHaveProperty('nodeId');
    expect(leave).toEqual({ participantId: user.id });
  });

  it('mantem threads versionadas com autoria e resolucao', () => {
    const withComment = applyDesignOperations(document(), [{
      kind: 'add-design-comment',
      comment: {
        id: COMMENT_ID, pageId: PAGE_ID, elementId: TEXT_ID, x: 100, y: 60, status: 'open',
        messages: [{ id: MESSAGE_ID, author: user, body: 'Review @Reviewer', mentions: [agent.id], createdAt: NOW }],
        createdAt: NOW, updatedAt: NOW, resolvedAt: null, resolvedBy: null,
      },
    }], NOW);
    const replied = applyDesignOperations(withComment, [{
      kind: 'add-design-comment-message', commentId: COMMENT_ID,
      message: { id: '00000000-0000-7000-8000-000000000109', author: agent, body: 'Reviewed.', mentions: [], createdAt: NOW },
    }, { kind: 'set-design-comment-status', commentId: COMMENT_ID, status: 'resolved', actor: user }], NOW);

    expect(replied.comments[0].messages).toHaveLength(2);
    expect(replied.comments[0]).toMatchObject({ status: 'resolved', resolvedBy: user, resolvedAt: NOW });
  });

  it('nao aplica uma proposta antes da aprovacao e a aprova de forma transacional', () => {
    const proposed = applyDesignOperations(document(), [{
      kind: 'add-design-proposal',
      proposal: {
        id: PROPOSAL_ID, title: 'Rewrite title', description: 'Clearer hierarchy', author: agent,
        baseRevision: 0,
        operations: [{ kind: 'update', elementId: TEXT_ID, changes: { text: 'After', fontSize: 28 } }],
        status: 'pending', floorId: null, councilId: null, createdAt: NOW, updatedAt: NOW,
        decidedAt: null, decidedBy: null, decisionNote: null,
      },
    }], NOW);

    expect(proposed.elements.find((element) => element.id === TEXT_ID)?.text).toBe('Before');
    const approved = applyDesignOperations(proposed, [{
      kind: 'decide-design-proposal', proposalId: PROPOSAL_ID, status: 'approved', actor: user, note: 'Ship it',
    }], NOW);
    expect(approved.elements.find((element) => element.id === TEXT_ID)).toMatchObject({ text: 'After', fontSize: 28 });
    expect(approved.proposals[0]).toMatchObject({ status: 'approved', decidedBy: user, decisionNote: 'Ship it' });
  });

  it('reserva uma selecao e bloqueia edicao concorrente na sua hierarquia', () => {
    const source = document();
    const first = designCollaborationService.heartbeat(WORKSPACE_ID, NODE_ID, {
      participant: user, pageId: PAGE_ID, elementIds: [FRAME_ID], cursor: { x: 20, y: 30 }, viewport: null, followParticipantId: null,
    }, source);
    expect(first.leases[0].elementIds).toEqual([FRAME_ID]);

    const second = designCollaborationService.heartbeat(WORKSPACE_ID, NODE_ID, {
      participant: agent, pageId: PAGE_ID, elementIds: [TEXT_ID], cursor: null, viewport: null, followParticipantId: user.id,
    }, source);
    expect(second.leaseConflict?.participantId).toBe(user.id);
    expect(() => designCollaborationService.assertWritable(WORKSPACE_ID, NODE_ID, agent.id, [{ kind: 'update', elementId: TEXT_ID, changes: { text: 'Blocked' } }], source)).toThrow('Designer');

    designCollaborationService.leave(WORKSPACE_ID, NODE_ID, user.id);
    expect(() => designCollaborationService.assertWritable(WORKSPACE_ID, NODE_ID, agent.id, [{ kind: 'update', elementId: TEXT_ID, changes: { text: 'Allowed' } }], source)).not.toThrow();
    designCollaborationService.leave(WORKSPACE_ID, NODE_ID, agent.id);
  });
});
