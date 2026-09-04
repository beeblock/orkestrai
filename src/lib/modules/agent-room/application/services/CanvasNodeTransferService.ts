import { uuidv7 } from '@beeblock/svelar/support';
import { AgentRoutine } from '../../domain/models/AgentRoutine.js';
import type {
  CanvasNode,
  CanvasNodePayload,
  CanvasNodeTransferResult,
  ImageNodePayload,
  NoteNodePayload,
  Workspace,
  WorkspaceAttachment,
} from '../../domain/types.js';
import { findFreeCanvasPosition } from '../../domain/canvas-placement.js';
import { transferredNodePayload } from '../../domain/canvas-node-transfer.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { ptySessionManager } from '../../infrastructure/pty/PtySessionManager.ts';
import type { TransferCanvasNodesDto } from '../dto/TransferCanvasNodesDto.js';
import { designDocumentService } from './DesignDocumentService.js';
import { filesystemService } from './FilesystemService.js';
import { workspacePathService } from './WorkspacePathService.js';

export class CanvasNodeTransferError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'CanvasNodeTransferError';
  }
}

function safeName(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+|[.-]+$/g, '').slice(0, 120) || 'asset';
}

function bounds(nodes: CanvasNode[]) {
  const left = Math.min(...nodes.map((node) => node.x));
  const top = Math.min(...nodes.map((node) => node.y));
  const right = Math.max(...nodes.map((node) => node.x + node.width));
  const bottom = Math.max(...nodes.map((node) => node.y + node.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function uniqueTerminalTitle(title: string | null, occupied: Set<string>): string | null {
  if (!title) return title;
  const key = title.toLocaleLowerCase();
  if (!occupied.has(key)) {
    occupied.add(key);
    return title;
  }
  let index = 2;
  while (occupied.has(`${title} ${index}`.toLocaleLowerCase())) index += 1;
  const result = `${title} ${index}`;
  occupied.add(result.toLocaleLowerCase());
  return result;
}

export class CanvasNodeTransferService {
  async transfer(dto: TransferCanvasNodesDto): Promise<CanvasNodeTransferResult> {
    if (dto.sourceWorkspaceId === dto.destinationWorkspaceId) throw new CanvasNodeTransferError('canvas_transfer_same_workspace');
    const [sourceWorkspace, destinationWorkspace, sourceNodes, destinationNodes, sourceEdges] = await Promise.all([
      workspaceRepository.getWorkspace(dto.sourceWorkspaceId),
      workspaceRepository.getWorkspace(dto.destinationWorkspaceId),
      workspaceRepository.listNodes(dto.sourceWorkspaceId),
      workspaceRepository.listNodes(dto.destinationWorkspaceId, undefined, false, true),
      workspaceRepository.listEdges(dto.sourceWorkspaceId),
    ]);
    if (!sourceWorkspace || !destinationWorkspace) throw new CanvasNodeTransferError('canvas_transfer_workspace_not_found');
    const sourceById = new Map(sourceNodes.map((node) => [node.id, node]));
    const selected = dto.nodeIds.map((id) => sourceById.get(id)).filter((node): node is CanvasNode => Boolean(node));
    if (selected.length !== dto.nodeIds.length) throw new CanvasNodeTransferError('canvas_transfer_node_not_found');
    if (selected.some((node) => node.type === 'imageWorkflow' && (node.payload as { status?: string }).status === 'running')) {
      throw new CanvasNodeTransferError('canvas_transfer_workflow_running');
    }
    if (selected.some((node) => node.type === 'device') && destinationNodes.some((node) => node.type === 'device')) {
      throw new CanvasNodeTransferError('canvas_transfer_singleton_exists');
    }
    const singletonTypes = new Set(['usage', 'codeGraph']);
    if (selected.some((node) => singletonTypes.has(node.type)) && destinationNodes.some((node) => singletonTypes.has(node.type) && selected.some((source) => source.type === node.type))) {
      throw new CanvasNodeTransferError('canvas_transfer_singleton_exists');
    }
    if (dto.mode === 'move') {
      const routines = await AgentRoutine.query().where('workspace_id', dto.sourceWorkspaceId).whereIn('target_node_id', dto.nodeIds).where('enabled', true).get();
      if (routines.length) throw new CanvasNodeTransferError('canvas_transfer_active_routine');
    }

    const ids = new Map(selected.map((node) => [node.id, uuidv7()]));
    const selectedIds = new Set(dto.nodeIds);
    const sourceBounds = bounds(selected);
    const destinationPosition = findFreeCanvasPosition(destinationNodes.map((node) => ({
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
    })), { x: 80, y: 80, width: sourceBounds.width, height: sourceBounds.height });
    const offsetX = destinationPosition.x - sourceBounds.x;
    const offsetY = destinationPosition.y - sourceBounds.y;
    const destinationFiles: Array<{ workspaceId: string; path: string }> = [];
    const preparedDesignIds: string[] = [];
    const occupiedTerminalTitles = new Set(destinationNodes
      .filter((node) => node.type === 'terminal' && node.title)
      .map((node) => node.title!.toLocaleLowerCase()));
    let maestroAvailable = !destinationNodes.some((node) => node.type === 'terminal' && (node.payload as { maestro?: boolean }).maestro);

    let databaseCommitted = false;
    try {
      const preparedNodes = [] as Parameters<typeof workspaceRepository.commitNodeTransfer>[0]['nodes'];
      for (const node of selected) {
        const destinationNodeId = ids.get(node.id)!;
        const wantsMaestro = node.type === 'terminal' && (node.payload as { maestro?: boolean }).maestro === true;
        const keepMaestro = wantsMaestro && maestroAvailable;
        if (keepMaestro) maestroAvailable = false;
        let payload = transferredNodePayload(node.type, node.payload, ids, keepMaestro);
        if (node.type === 'note') payload = await this.copyNoteAttachments(sourceWorkspace, destinationWorkspace, payload as NoteNodePayload, destinationFiles);
        if (node.type === 'image') payload = await this.copyImage(sourceWorkspace, destinationWorkspace, destinationNodeId, payload as ImageNodePayload, destinationFiles);
        let title = node.type === 'terminal' ? uniqueTerminalTitle(node.title, occupiedTerminalTitles) : node.title;
        if (node.type === 'design') {
          title ||= 'Untitled design';
          await designDocumentService.cloneToWorkspace(dto.sourceWorkspaceId, node.id, dto.destinationWorkspaceId, destinationNodeId, title);
          preparedDesignIds.push(destinationNodeId);
        }
        preparedNodes.push({
          id: destinationNodeId,
          type: node.type,
          title,
          x: node.x + offsetX,
          y: node.y + offsetY,
          width: node.width,
          height: node.height,
          zIndex: node.zIndex,
          payload,
        });
      }
      const preparedEdges = sourceEdges
        .filter((edge) => selectedIds.has(edge.sourceNodeId) && selectedIds.has(edge.targetNodeId))
        .map((edge) => ({
          id: uuidv7(),
          sourceNodeId: ids.get(edge.sourceNodeId)!,
          targetNodeId: ids.get(edge.targetNodeId)!,
          style: edge.style,
        }));
      const committed = await workspaceRepository.commitNodeTransfer({
        sourceWorkspaceId: dto.sourceWorkspaceId,
        destinationWorkspaceId: dto.destinationWorkspaceId,
        mode: dto.mode,
        nodes: preparedNodes,
        edges: preparedEdges,
        sourceNodeIds: dto.nodeIds,
      });
      databaseCommitted = true;
      if (dto.mode === 'move') await this.cleanupMovedRuntime(dto.sourceWorkspaceId, selected);
      this.broadcast(dto.sourceWorkspaceId);
      this.broadcast(dto.destinationWorkspaceId);
      return {
        mode: dto.mode,
        sourceWorkspaceId: dto.sourceWorkspaceId,
        destinationWorkspaceId: dto.destinationWorkspaceId,
        sourceNodeIds: dto.nodeIds,
        ...committed,
      };
    } catch (error) {
      if (!databaseCommitted) {
        await Promise.all([
          ...destinationFiles.map(({ workspaceId, path }) => filesystemService.deleteFile(workspaceId, path).catch(() => false)),
          ...preparedDesignIds.map((nodeId) => designDocumentService.removeWorkspaceFiles(dto.destinationWorkspaceId, nodeId).catch(() => undefined)),
        ]);
      }
      if (error instanceof CanvasNodeTransferError) throw error;
      throw new CanvasNodeTransferError(error instanceof Error && error.message.startsWith('canvas_transfer_') ? error.message : 'canvas_transfer_failed');
    }
  }

  private async copyNoteAttachments(
    sourceWorkspace: Workspace,
    destinationWorkspace: Workspace,
    payload: NoteNodePayload,
    destinationFiles: Array<{ workspaceId: string; path: string }>,
  ): Promise<NoteNodePayload> {
    const attachments: WorkspaceAttachment[] = [];
    for (const attachment of payload.attachments ?? []) {
      if (attachment.kind === 'link') {
        attachments.push(structuredClone(attachment));
        continue;
      }
      if (!attachment.path) throw new CanvasNodeTransferError('canvas_transfer_asset_missing');
      await this.assertExistingAsset(sourceWorkspace, attachment.path);
      const file = await filesystemService.readBinary(sourceWorkspace.id, attachment.path).catch(() => null);
      if (!file) throw new CanvasNodeTransferError('canvas_transfer_asset_missing');
      const id = uuidv7();
      const path = `.orkestrai/attachments/${id}-${safeName(attachment.name)}`;
      await this.assertWritableAsset(destinationWorkspace, path);
      await filesystemService.writeBinary(destinationWorkspace.id, path, file.data);
      destinationFiles.push({ workspaceId: destinationWorkspace.id, path });
      attachments.push({ ...attachment, id, path });
    }
    return { ...payload, attachments };
  }

  private async copyImage(
    sourceWorkspace: Workspace,
    destinationWorkspace: Workspace,
    destinationNodeId: string,
    payload: ImageNodePayload,
    destinationFiles: Array<{ workspaceId: string; path: string }>,
  ): Promise<ImageNodePayload> {
    if (!payload.path) return payload;
    await this.assertExistingAsset(sourceWorkspace, payload.path);
    const file = await filesystemService.readBinary(sourceWorkspace.id, payload.path).catch(() => null);
    if (!file) throw new CanvasNodeTransferError('canvas_transfer_asset_missing');
    const path = `.orkestrai/transfers/${destinationNodeId}/${safeName(file.name)}`;
    await this.assertWritableAsset(destinationWorkspace, path);
    await filesystemService.writeBinary(destinationWorkspace.id, path, file.data);
    destinationFiles.push({ workspaceId: destinationWorkspace.id, path });
    return { ...payload, path };
  }

  private async assertExistingAsset(workspace: Workspace, path: string): Promise<void> {
    try {
      await workspacePathService.resolveExisting(workspace, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new CanvasNodeTransferError('canvas_transfer_asset_missing');
      throw new CanvasNodeTransferError('canvas_transfer_asset_invalid');
    }
  }

  private async assertWritableAsset(workspace: Workspace, path: string): Promise<void> {
    try {
      await workspacePathService.resolveWritable(workspace, path);
    } catch {
      throw new CanvasNodeTransferError('canvas_transfer_asset_invalid');
    }
  }

  private async cleanupMovedRuntime(workspaceId: string, nodes: CanvasNode[]): Promise<void> {
    for (const node of nodes) {
      if (node.type === 'terminal') {
        const payload = node.payload as Record<string, unknown>;
        try {
          ptySessionManager.killNode(workspaceId, node.id);
          const provider = typeof payload.provider === 'string' ? payload.provider : null;
          const agentSessionId = typeof payload.agentSessionId === 'string' ? payload.agentSessionId : null;
          if (provider && agentSessionId) ptySessionManager.killAgentSession(provider, agentSessionId);
          const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : null;
          if (sessionId && ptySessionManager.get(sessionId)) ptySessionManager.kill(sessionId);
        } catch {
          // The database transfer is already committed; stale PTYs self-expire.
        }
      }
      if (node.type === 'device') {
        await (globalThis as typeof globalThis & {
          __orkestraiStopWorkspaceDevice?: (targetWorkspaceId: string) => Promise<void>;
        }).__orkestraiStopWorkspaceDevice?.(workspaceId).catch(() => undefined);
      }
      if (node.type === 'design') await designDocumentService.removeWorkspaceFiles(workspaceId, node.id).catch(() => undefined);
    }
  }

  private broadcast(workspaceId: string): void {
    try {
      (globalThis as { __orkestraiBroadcast?: (payload: Record<string, unknown>) => void })
        .__orkestraiBroadcast?.({ type: 'workspaceChanged', workspaceId });
    } catch {
      // The next workspace load still reads the committed state.
    }
  }
}

export const canvasNodeTransferService = new CanvasNodeTransferService();
