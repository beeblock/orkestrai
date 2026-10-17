import { attentionDecisionService } from '$lib/modules/agent-room/application/services/AttentionDecisionService.js';
import { channelService, OWNER_QUESTION_SOURCE } from '$lib/modules/agent-room/application/services/ChannelService.js';
import { attentionRepository } from '$lib/modules/agent-room/infrastructure/repositories/AttentionRepository.js';
import { bridgeService } from '$lib/modules/agent-room/application/services/BridgeService.js';
import { reviewCenterService } from '$lib/modules/agent-room/application/services/ReviewCenterService.js';
import { taskBoardService } from '$lib/modules/agent-room/application/services/TaskBoardService.js';
import { DecideAgentReviewDto } from '$lib/modules/agent-room/application/dto/AgentReviewDto.js';
import { agentSessionService } from '$lib/modules/agent-room/application/services/AgentSessionService.js';
import { designDocumentService } from '$lib/modules/agent-room/application/services/DesignDocumentService.js';
import { ApplyDesignOperationsDto } from '$lib/modules/agent-room/application/dto/DesignDtos.js';
import type { DesignCollaborator, DesignOperation } from '$lib/modules/agent-room/contracts/schemas/designSchemas.js';
import { uuidv7 } from '@beeblock/svelar/support';
import { huddleService } from '$lib/modules/agent-room/application/services/HuddleService.js';
import { CreateHuddleDto, SubmitHuddleTurnDto, UpdateHuddleDto } from '$lib/modules/agent-room/application/dto/HuddleDtos.js';
import type { ExecuteCollaborationCommandDto } from '../dto/CollaborationDto.js';
import type { CollaborationCommand, CollaborationCommandResult } from '../../domain/types.js';
import { collaborationPolicy } from '../../domain/policies/CollaborationPolicy.js';
import { collaborationRepository } from '../../infrastructure/repositories/CollaborationRepository.js';
import { sanitizeAuditMetadata } from '../projections/sanitize-shared-data.js';
import { withCollaborationShareLock } from './CollaborationShareLock.js';

export class SharedWorkspaceCommandBus {
  async execute(shareId: string, deviceRecordId: string, dto: ExecuteCollaborationCommandDto): Promise<CollaborationCommandResult> {
    return withCollaborationShareLock(shareId, () => this.executeLocked(shareId, deviceRecordId, dto));
  }

  private async executeLocked(
    shareId: string,
    deviceRecordId: string,
    dto: ExecuteCollaborationCommandDto,
  ): Promise<CollaborationCommandResult> {
    const duplicate = await collaborationRepository.findCommand(dto.commandId);
    if (duplicate) {
      if (duplicate.shareId !== shareId || duplicate.deviceRecordId !== deviceRecordId) {
        return { commandId: dto.commandId, accepted: false, revision: duplicate.resultRevision, result: null, errorCode: 'COMMAND_ID_CONFLICT' };
      }
      return {
        commandId: duplicate.id,
        accepted: duplicate.status === 'accepted',
        revision: duplicate.resultRevision,
        result: duplicate.result,
        errorCode: duplicate.status === 'processing' ? 'COMMAND_IN_PROGRESS' : duplicate.errorCode,
      };
    }

    const [share, device] = await Promise.all([
      collaborationRepository.findShare(shareId),
      collaborationRepository.findDevice(deviceRecordId),
    ]);
    if (!share || !device || device.shareId !== shareId || device.workspaceId !== share.workspaceId) {
      return { commandId: dto.commandId, accepted: false, revision: share?.revision ?? 0, result: null, errorCode: 'ACCESS_DENIED' };
    }
    await collaborationRepository.startCommand({
      id: dto.commandId, shareId, workspaceId: share.workspaceId,
      deviceRecordId, revision: dto.revision, type: dto.command.type,
    });

    const reject = async (errorCode: string, metadata: Record<string, unknown> = {}): Promise<CollaborationCommandResult> => {
      const row = await collaborationRepository.finishCommand(dto.commandId, {
        accepted: false, revision: share.revision, errorCode,
      });
      await collaborationRepository.appendAudit({
        workspaceId: share.workspaceId, shareId, actorDeviceId: device.deviceId,
        eventType: 'command.rejected', metadata: { commandId: dto.commandId, commandType: dto.command.type, errorCode, ...metadata },
      });
      return { commandId: row.id, accepted: false, revision: row.resultRevision, result: null, errorCode };
    };

    if (share.status !== 'active' || new Date(share.expiresAt).getTime() <= Date.now()) return reject('SHARE_EXPIRED');
    if (!device.approvedAt || device.revokedAt) return reject('DEVICE_NOT_APPROVED');
    const requiredScope = collaborationPolicy.commandScope(dto.command.type);
    if (!collaborationPolicy.can(device.scopes, requiredScope)) return reject('SCOPE_DENIED', { requiredScope });
    if (dto.revision !== share.revision) return reject('REVISION_CONFLICT', { currentRevision: share.revision });

    try {
      const result = await this.perform(share.workspaceId, share.id, device.deviceId, device.displayName, dto.command);
      const revision = await collaborationRepository.incrementRevision(share.id);
      const safeResult = sanitizeAuditMetadata(result) as Record<string, unknown>;
      const row = await collaborationRepository.finishCommand(dto.commandId, {
        accepted: true, revision, result: safeResult,
      });
      await collaborationRepository.touchDevice(device.id);
      await collaborationRepository.appendAudit({
        workspaceId: share.workspaceId, shareId, actorDeviceId: device.deviceId,
        eventType: 'command.accepted', metadata: { commandId: dto.commandId, commandType: dto.command.type, revision },
      });
      return { commandId: row.id, accepted: true, revision, result: row.result, errorCode: null };
    } catch (error) {
      return reject('COMMAND_FAILED', { reason: error instanceof Error ? error.message : String(error) });
    }
  }

  private async perform(
    workspaceId: string,
    shareId: string,
    deviceId: string,
    deviceName: string,
    command: CollaborationCommand,
  ): Promise<Record<string, unknown>> {
    const remoteActor = { kind: 'remote' as const, id: deviceId, name: deviceName };
    if (command.type === 'huddle.create') {
      const huddle = await huddleService.create(workspaceId, CreateHuddleDto.from({
        title: command.title, agenda: command.agenda ?? null, agentNodeIds: command.agentNodeIds,
        facilitatorNodeId: command.facilitatorNodeId ?? null,
      }), remoteActor);
      return { huddleId: huddle.id, title: huddle.title, status: huddle.status };
    }
    if (command.type === 'huddle.turn') {
      const huddle = await huddleService.submit(workspaceId, command.huddleId, SubmitHuddleTurnDto.from({
        text: command.text, targetNodeIds: command.targetNodeIds,
      }), remoteActor);
      return { huddleId: huddle.id, turnCount: huddle.turns.length };
    }
    if (command.type === 'huddle.end') {
      const huddle = await huddleService.update(workspaceId, command.huddleId, UpdateHuddleDto.from({ operation: 'end' }));
      return { huddleId: huddle.id, status: huddle.status };
    }
    if (command.type === 'task.create') {
      const task = await taskBoardService.create(workspaceId, {
        title: command.title,
        description: command.description ?? null,
        status: command.status,
        assigneeNodeId: command.assigneeNodeId ?? null,
        createdBy: 'collaboration',
      });
      return { taskId: task.id, title: task.title, status: task.status };
    }
    if (command.type === 'task.update') {
      const task = await taskBoardService.update(workspaceId, command.taskId, {
        title: command.title,
        description: command.description,
        status: command.status,
        assigneeNodeId: command.assigneeNodeId,
      });
      return { taskId: task.id, title: task.title, status: task.status };
    }
    if (command.type === 'attention.decide') {
      const item = await attentionDecisionService.decide(workspaceId, command.itemId, command.decision, `remote:${deviceId}`);
      return { itemId: command.itemId, resolved: item?.status === 'resolved' };
    }
    if (command.type === 'attention.answer') {
      const item = await attentionRepository.find(workspaceId, command.itemId);
      if (!item || item.sourceType !== OWNER_QUESTION_SOURCE || !item.sourceId || typeof item.action?.channel !== 'string') throw new Error('Esta pergunta não está mais aberta.');
      const answer = await channelService.postOwner(workspaceId, item.action.channel, { body: command.text, replyToId: item.sourceId });
      return { itemId: command.itemId, delivered: answer.delivered.every((entry) => entry.ok) };
    }
    if (command.type === 'review.decide') {
      const decision = await reviewCenterService.decide(
        workspaceId,
        command.reviewId,
        new DecideAgentReviewDto(command.status, command.note ?? null),
      );
      return { reviewId: decision.review.id, status: decision.review.status, feedbackDelivered: decision.feedback?.delivered ?? null };
    }
    if (command.type === 'design.comment.create'
      || command.type === 'design.comment.reply'
      || command.type === 'design.comment.resolve'
      || command.type === 'design.proposal.create'
      || command.type === 'design.proposal.decide'
      || command.type === 'design.element.update') {
      const document = await designDocumentService.get(workspaceId, command.nodeId);
      const now = new Date().toISOString();
      const actor: DesignCollaborator = { kind: 'remote', id: deviceId, name: deviceName, color: '#7c3aed' };
      let operations: DesignOperation[];
      let summary: string;
      if (command.type === 'design.comment.create') {
        operations = [{
          kind: 'add-design-comment',
          comment: {
            id: uuidv7(), pageId: command.pageId, elementId: command.elementId ?? null,
            x: null, y: null, status: 'open',
            messages: [{ id: uuidv7(), author: actor, body: command.body, mentions: [], createdAt: now }],
            createdAt: now, updatedAt: now, resolvedAt: null, resolvedBy: null,
          },
        }];
        summary = 'Remote design comment';
      } else if (command.type === 'design.comment.reply') {
        operations = [{
          kind: 'add-design-comment-message', commentId: command.commentId,
          message: { id: uuidv7(), author: actor, body: command.body, mentions: [], createdAt: now },
        }];
        summary = 'Remote design comment reply';
      } else if (command.type === 'design.comment.resolve') {
        operations = [{ kind: 'set-design-comment-status', commentId: command.commentId, status: command.status, actor }];
        summary = 'Remote design comment status';
      } else if (command.type === 'design.proposal.create') {
        if (!document.elements.some((element) => element.id === command.elementId)) throw new Error('DESIGN_ELEMENT_NOT_FOUND');
        const proposed: DesignOperation = {
          kind: 'update',
          elementId: command.elementId,
          changes: {
            ...command.changes,
            fills: [{ type: 'solid', color: command.changes.fill, opacity: 1, visible: true }],
            fill: 'transparent',
          },
        };
        operations = [{
          kind: 'add-design-proposal',
          proposal: {
            id: uuidv7(), title: command.title, description: command.description ?? '', author: actor,
            baseRevision: document.revision, operations: [proposed], status: 'pending',
            floorId: null, councilId: null, createdAt: now, updatedAt: now,
            decidedAt: null, decidedBy: null, decisionNote: null,
          },
        }];
        summary = 'Remote design proposal';
      } else if (command.type === 'design.proposal.decide') {
        operations = [{
          kind: 'decide-design-proposal', proposalId: command.proposalId,
          status: command.status, actor, note: command.note ?? null,
        }];
        summary = 'Remote design proposal decision';
      } else {
        if (!document.elements.some((element) => element.id === command.elementId)) throw new Error('DESIGN_ELEMENT_NOT_FOUND');
        operations = [{
          kind: 'update',
          elementId: command.elementId,
          changes: {
            ...command.changes,
            fills: [{ type: 'solid', color: command.changes.fill, opacity: 1, visible: true }],
            fill: 'transparent',
          },
        }];
        summary = 'Remote direct design edit';
      }
      const updated = await designDocumentService.apply(new ApplyDesignOperationsDto(
        workspaceId, command.nodeId, document.revision, operations,
        { kind: 'user', id: deviceId, name: deviceName, taskId: null }, summary, deviceId,
      ));
      return { nodeId: command.nodeId, revision: updated.revision };
    }
    if (command.type === 'agent.invoke') {
      const session = await agentSessionService.ensure(workspaceId, command.agentNodeId);
      return { agentNodeId: command.agentNodeId, sessionId: session.sessionId, state: session.state };
    }
    if (command.type === 'agent.message') {
      const target = (await bridgeService.listAgents(workspaceId)).find((agent) => agent.nodeId === command.agentNodeId);
      if (!target) throw new Error('AGENT_NOT_FOUND');
      if (!target.sessionAlive) throw new Error('AGENT_SESSION_OFFLINE');
      const messageId = uuidv7();
      void bridgeService.ask(workspaceId, {
        to: target.nodeId,
        message: command.message,
        messageId,
        metadata: {
          remoteCollaboration: true,
          remoteShareId: shareId,
          remoteDeviceId: deviceId,
        },
      }).catch(() => undefined);
      return { messageId, agentNodeId: target.nodeId, agentTitle: target.title };
    }
    const leader = (await bridgeService.listAgents(workspaceId)).find((agent) => agent.maestro);
    if (!leader) throw new Error('Workspace leader is unavailable.');
    if (!leader.sessionAlive) throw new Error('Workspace leader is offline.');
    const messageId = uuidv7();
    void bridgeService.ask(workspaceId, {
      to: leader.nodeId,
      message: command.message,
      messageId,
      metadata: {
        remoteCollaboration: true,
        remoteShareId: shareId,
        remoteDeviceId: deviceId,
      },
    }).catch(() => undefined);
    return { messageId, agentNodeId: leader.nodeId, leaderTitle: leader.title };
  }
}

export const sharedWorkspaceCommandBus = new SharedWorkspaceCommandBus();
