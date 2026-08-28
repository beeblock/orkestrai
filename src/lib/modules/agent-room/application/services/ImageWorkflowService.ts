import { createHash } from 'node:crypto';
import { basename, relative, resolve, sep } from 'node:path';
import { uuidv7 } from '@beeblock/svelar/support';
import type {
  CanvasNode,
  ImageNodePayload,
  ImageWorkflowActiveRun,
  ImageWorkflowNodePayload,
  ImageWorkflowRun,
  NoteNodePayload,
  TerminalNodePayload,
  Workspace,
} from '../../domain/types.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { filesystemService } from './FilesystemService.js';
import { bridgeService } from './BridgeService.js';
import {
  AddImageWorkflowReferenceDto,
  CompleteImageWorkflowDto,
  ConnectImageWorkflowNodeDto,
  CreateImageWorkflowDto,
  FailImageWorkflowDto,
  RunImageWorkflowDto,
  UpdateImageWorkflowDto,
} from '../dto/ImageWorkflowDtos.js';
import {
  imageWorkflowConfigSchema,
  type BridgeRunImageWorkflowInput,
  type ImageWorkflowConfigInput,
} from '../../contracts/schemas/imageWorkflowSchemas.js';

const MAX_REFERENCES = 5;
const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;
const MAX_REFERENCE_TOTAL_BYTES = 80 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const MAX_OUTPUTS = 10;
const MAX_OUTPUT_TOTAL_BYTES = MAX_OUTPUT_BYTES * MAX_OUTPUTS;
const MAX_CONTEXT_LENGTH = 16_000;
const HISTORY_LIMIT = 12;

export class ImageWorkflowError extends Error {
  constructor(public readonly code: string, public readonly status = 422) {
    super(code);
  }
}

function broadcast(workspaceId: string, nodeId: string): void {
  const send = (globalThis as { __orkestraiBroadcast?: (payload: Record<string, unknown>) => void }).__orkestraiBroadcast;
  send?.({ type: 'workspaceChanged', workspaceId, nodeId });
}

function imageMime(bytes: Uint8Array): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

function connectedNodes(workflow: CanvasNode, nodes: CanvasNode[], edges: Awaited<ReturnType<typeof workspaceRepository.listEdges>>) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return edges.flatMap((edge) => {
    if (edge.sourceNodeId !== workflow.id && edge.targetNodeId !== workflow.id) return [];
    const otherId = edge.sourceNodeId === workflow.id ? edge.targetNodeId : edge.sourceNodeId;
    const node = byId.get(otherId);
    return node ? [{ node, edge }] : [];
  });
}

function orderedNodes(nodes: CanvasNode[], order: string[] | undefined): CanvasNode[] {
  if (!order?.length) return nodes;
  const index = new Map(order.map((id, position) => [id, position]));
  return nodes.map((node, position) => ({ node, position })).sort((left, right) => {
    const leftOrder = index.get(left.node.id);
    const rightOrder = index.get(right.node.id);
    if (leftOrder == null && rightOrder == null) return left.position - right.position;
    if (leftOrder == null) return 1;
    if (rightOrder == null) return -1;
    return leftOrder - rightOrder;
  }).map(({ node }) => node);
}

function insertOrdered(ids: string[], nodeId: string, order?: number): string[] {
  const next = ids.filter((id) => id !== nodeId);
  next.splice(Math.min(order ?? next.length, next.length), 0, nodeId);
  return next;
}

function contextPrompt(prompt: string, contexts: CanvasNode[], transparentBackground: boolean): string {
  const blocks = contexts.flatMap((node) => {
    const content = String((node.payload as NoteNodePayload).content ?? '').trim();
    if (!content) return [];
    return [`Context from ${JSON.stringify(node.title ?? 'Note')}:\n${content.slice(0, MAX_CONTEXT_LENGTH)}`];
  });
  const transparent = transparentBackground
    ? 'Output contract: genuinely transparent background with a real alpha channel. Preserve the alpha channel in the final PNG. Avoid checkerboard patterns, white or colored backdrops, and fake transparency.'
    : '';
  const body = [prompt, ...blocks].filter(Boolean).join('\n\n');
  if (!transparent) return body.slice(0, 48_000);
  const separator = '\n\n';
  return `${body.slice(0, 48_000 - separator.length - transparent.length)}${separator}${transparent}`;
}

function runHash(config: ImageWorkflowConfigInput, contexts: CanvasNode[], references: Array<{ node: CanvasNode; data: Uint8Array }>): string {
  const hash = createHash('sha256');
  hash.update(JSON.stringify(config));
  for (const context of contexts) {
    hash.update(context.id);
    hash.update(String((context.payload as NoteNodePayload).content ?? ''));
  }
  for (const reference of references) {
    hash.update(reference.node.id);
    hash.update(reference.data);
  }
  return hash.digest('hex');
}

function nextPayload(existing: ImageWorkflowNodePayload, config: Partial<ImageWorkflowNodePayload>, changes: Partial<ImageWorkflowNodePayload>): ImageWorkflowNodePayload {
  return { ...existing, schemaVersion: 1, ...config, ...changes };
}

function relativeWorkspacePath(workspace: Workspace, absolutePath: string): string {
  const root = resolve(workspace.workingDir);
  const path = relative(root, absolutePath).replaceAll(sep, '/');
  if (!path || path === '..' || path.startsWith('../')) throw new ImageWorkflowError('image_workflow_reference_unavailable');
  return path;
}

function agentPath(workspace: Workspace, workspaceRelativePath: string): string {
  const normalized = workspaceRelativePath.replaceAll('\\', '/').replace(/^\/+/, '');
  if (workspace.runtimeKind === 'wsl' && workspace.wslWorkingDir) {
    return `${workspace.wslWorkingDir.replace(/\/$/, '')}/${normalized}`;
  }
  return resolve(workspace.workingDir, workspaceRelativePath);
}

function runRecord(active: ImageWorkflowActiveRun, status: ImageWorkflowRun['status'], completedAt: Date, outputPaths: string[], outputNodeIds: string[], errorCode: string | null): ImageWorkflowRun {
  return {
    id: active.id,
    status,
    startedAt: active.startedAt,
    completedAt: completedAt.toISOString(),
    durationMs: Math.max(0, completedAt.getTime() - new Date(active.startedAt).getTime()),
    actorNodeId: active.actorNodeId,
    executorNodeId: active.executorNodeId,
    contextNodeIds: active.contextNodeIds,
    referenceNodeIds: active.referenceNodeIds,
    inputHash: active.inputHash,
    tool: 'image_gen.imagegen',
    promptSnapshot: active.promptSnapshot,
    requestedOutputs: active.requestedOutputs,
    transparentBackground: active.transparentBackground,
    outputPaths,
    outputNodeIds,
    errorCode,
  };
}

export class ImageWorkflowService {
  async list(workspaceId: string) {
    const [nodes, edges] = await Promise.all([workspaceRepository.listNodes(workspaceId), workspaceRepository.listEdges(workspaceId)]);
    return Promise.all(nodes.filter((node) => node.type === 'imageWorkflow').map((node) => this.describe(node, nodes, edges)));
  }

  async read(workspaceId: string, nodeId: string) {
    const [node, nodes, edges] = await Promise.all([
      workspaceRepository.getNode(nodeId),
      workspaceRepository.listNodes(workspaceId),
      workspaceRepository.listEdges(workspaceId),
    ]);
    if (!node || node.workspaceId !== workspaceId || node.type !== 'imageWorkflow') throw new ImageWorkflowError('image_workflow_not_found', 404);
    return this.describe(node, nodes, edges);
  }

  async create(dto: CreateImageWorkflowDto) {
    const actor = await this.requireCodexActor(dto.workspaceId, dto.actorNodeId);
    const { from: _from, title, ...config } = dto.input;
    const workflow = await workspaceRepository.createNode({
      workspaceId: dto.workspaceId,
      type: 'imageWorkflow',
      title,
      x: actor.x + actor.width + 72,
      y: actor.y,
      width: 440,
      height: 560,
      zIndex: actor.zIndex,
      floorId: actor.floorId,
      payload: {
        schemaVersion: 1,
        ...config,
        contextOrder: [],
        referenceOrder: [],
        status: 'idle',
        activeRunId: null,
        activeRun: null,
        lastError: null,
        history: [],
      } satisfies ImageWorkflowNodePayload,
    });
    await workspaceRepository.createEdge({ workspaceId: dto.workspaceId, sourceNodeId: actor.id, targetNodeId: workflow.id, style: 'cord' });
    broadcast(dto.workspaceId, workflow.id);
    return this.read(dto.workspaceId, workflow.id);
  }

  async update(dto: UpdateImageWorkflowDto) {
    const { workflow } = await this.requireControl(dto.workspaceId, dto.nodeId, dto.actorNodeId);
    const payload = (workflow.payload ?? {}) as ImageWorkflowNodePayload;
    if (payload.status === 'running') throw new ImageWorkflowError('image_workflow_already_running', 409);
    const { from: _from, title, ...config } = dto.input;
    await workspaceRepository.updateNode(workflow.id, {
      ...(title === undefined ? {} : { title }),
      payload: nextPayload(payload, config, {}),
    });
    broadcast(dto.workspaceId, workflow.id);
    return this.read(dto.workspaceId, workflow.id);
  }

  async connect(dto: ConnectImageWorkflowNodeDto) {
    const { workflow, nodes, edges } = await this.requireControl(dto.workspaceId, dto.nodeId, dto.actorNodeId);
    const target = nodes.find((node) => node.id === dto.input.targetNodeId);
    if (!target) throw new ImageWorkflowError('image_workflow_connection_target_missing', 404);
    if (!['note', 'image', 'terminal'].includes(target.type)) throw new ImageWorkflowError('image_workflow_connection_type_invalid');
    if (target.type === 'terminal') {
      const provider = (target.payload as TerminalNodePayload).provider;
      if (target.id !== dto.actorNodeId || provider !== 'codex') throw new ImageWorkflowError('image_workflow_executor_unauthorized', 403);
    }

    const payload = (workflow.payload ?? {}) as ImageWorkflowNodePayload;
    if (payload.status === 'running') throw new ImageWorkflowError('image_workflow_already_running', 409);
    const connected = connectedNodes(workflow, nodes, edges).map(({ node }) => node);
    const alreadyConnected = connected.some((node) => node.id === target.id);
    if (target.type === 'note' && !alreadyConnected && connected.filter((node) => node.type === 'note').length >= 12) {
      throw new ImageWorkflowError('image_workflow_too_many_contexts');
    }
    if (
      target.type === 'image'
      && (target.payload as ImageNodePayload).generatedBy?.workflowNodeId !== workflow.id
      && !alreadyConnected
      && connected.filter((node) => node.type === 'image' && (node.payload as ImageNodePayload).generatedBy?.workflowNodeId !== workflow.id).length >= MAX_REFERENCES
    ) throw new ImageWorkflowError('image_workflow_too_many_references');

    let edge = edges.find((candidate) => (
      (candidate.sourceNodeId === workflow.id && candidate.targetNodeId === target.id)
      || (candidate.targetNodeId === workflow.id && candidate.sourceNodeId === target.id)
    ));
    edge ??= await workspaceRepository.createEdge({ workspaceId: dto.workspaceId, sourceNodeId: workflow.id, targetNodeId: target.id, style: 'cord' });

    const changes: Partial<ImageWorkflowNodePayload> = {};
    if (target.type === 'note') {
      changes.contextOrder = insertOrdered(
        payload.contextOrder ?? connected.filter((node) => node.type === 'note').map((node) => node.id),
        target.id,
        dto.input.order,
      );
    }
    if (target.type === 'image' && (target.payload as ImageNodePayload).generatedBy?.workflowNodeId !== workflow.id) {
      changes.referenceOrder = insertOrdered(
        payload.referenceOrder ?? connected.filter((node) => node.type === 'image' && (node.payload as ImageNodePayload).generatedBy?.workflowNodeId !== workflow.id).map((node) => node.id),
        target.id,
        dto.input.order,
      );
    }
    if (Object.keys(changes).length) await workspaceRepository.updateNode(workflow.id, { payload: nextPayload(payload, {}, changes) });
    broadcast(dto.workspaceId, workflow.id);
    return { edgeId: edge.id, workflow: await this.read(dto.workspaceId, workflow.id) };
  }

  async disconnect(dto: ConnectImageWorkflowNodeDto) {
    const { workflow, edges } = await this.requireControl(dto.workspaceId, dto.nodeId, dto.actorNodeId);
    const payload = (workflow.payload ?? {}) as ImageWorkflowNodePayload;
    if (payload.status === 'running') throw new ImageWorkflowError('image_workflow_already_running', 409);
    const edge = edges.find((candidate) => (
      (candidate.sourceNodeId === workflow.id && candidate.targetNodeId === dto.input.targetNodeId)
      || (candidate.targetNodeId === workflow.id && candidate.sourceNodeId === dto.input.targetNodeId)
    ));
    if (!edge) return { disconnected: false, workflow: await this.read(dto.workspaceId, workflow.id) };
    await workspaceRepository.deleteEdge(edge.id);
    await workspaceRepository.updateNode(workflow.id, {
      payload: nextPayload(payload, {}, {
        contextOrder: (payload.contextOrder ?? []).filter((id) => id !== dto.input.targetNodeId),
        referenceOrder: (payload.referenceOrder ?? []).filter((id) => id !== dto.input.targetNodeId),
      }),
    });
    broadcast(dto.workspaceId, workflow.id);
    return { disconnected: true, edgeId: edge.id, workflow: await this.read(dto.workspaceId, workflow.id) };
  }

  async addReference(dto: AddImageWorkflowReferenceDto) {
    const { workflow, nodes, edges } = await this.requireControl(dto.workspaceId, dto.nodeId, dto.actorNodeId);
    const payload = (workflow.payload ?? {}) as ImageWorkflowNodePayload;
    if (payload.status === 'running') throw new ImageWorkflowError('image_workflow_already_running', 409);
    const currentReferences = connectedNodes(workflow, nodes, edges).map(({ node }) => node).filter((node) => (
      node.type === 'image' && (node.payload as ImageNodePayload).generatedBy?.workflowNodeId !== workflow.id
    ));
    const [file, inspection, workspace] = await Promise.all([
      filesystemService.readBinary(dto.workspaceId, dto.input.path).catch(() => null),
      filesystemService.inspect(dto.workspaceId, dto.input.path).catch(() => null),
      workspaceRepository.getWorkspace(dto.workspaceId),
    ]);
    if (!file || !inspection || !workspace) throw new ImageWorkflowError('image_workflow_reference_unavailable');
    if (file.data.length > MAX_REFERENCE_BYTES) throw new ImageWorkflowError('image_workflow_reference_too_large');
    if (!imageMime(file.data)) throw new ImageWorkflowError('image_workflow_reference_format_invalid');
    const path = relativeWorkspacePath(workspace, inspection.path);
    const existing = nodes.find((node) => node.type === 'image' && (node.payload as ImageNodePayload).path === path);
    const alreadyConnected = existing && currentReferences.some((node) => node.id === existing.id);
    if (!alreadyConnected && currentReferences.length >= MAX_REFERENCES) throw new ImageWorkflowError('image_workflow_too_many_references');
    const reference = existing ?? await workspaceRepository.createNode({
      workspaceId: dto.workspaceId,
      type: 'image',
      title: dto.input.title ?? basename(path),
      x: workflow.x - 352,
      y: workflow.y + currentReferences.length * 272,
      width: 280,
      height: 240,
      zIndex: workflow.zIndex,
      floorId: workflow.floorId,
      payload: { path } satisfies ImageNodePayload,
    });
    const result = await this.connect(new ConnectImageWorkflowNodeDto(
      dto.workspaceId,
      dto.nodeId,
      { targetNodeId: reference.id, order: dto.input.order, from: dto.input.from },
      dto.actorNodeId,
    ));
    return { reference: { nodeId: reference.id, title: reference.title, path }, ...result };
  }

  async remove(workspaceId: string, nodeId: string, actorNodeId: string) {
    const { workflow } = await this.requireControl(workspaceId, nodeId, actorNodeId);
    const payload = (workflow.payload ?? {}) as ImageWorkflowNodePayload;
    if (payload.activeRun && payload.status === 'running') await this.finishFailure(workspaceId, nodeId, payload.activeRun.id, 'image_gen_cancelled');
    await workspaceRepository.deleteNode(nodeId);
    broadcast(workspaceId, nodeId);
    return { deleted: true, nodeId };
  }

  async runSaved(workspaceId: string, nodeId: string, input: BridgeRunImageWorkflowInput, actorNodeId: string | null) {
    if (!actorNodeId) throw new ImageWorkflowError('image_workflow_executor_unauthorized', 403);
    const node = await workspaceRepository.getNode(nodeId);
    if (!node || node.workspaceId !== workspaceId || node.type !== 'imageWorkflow') throw new ImageWorkflowError('image_workflow_not_found', 404);
    const { from: _from, ...overrides } = input;
    const config = imageWorkflowConfigSchema.parse({ ...(node.payload ?? {}), ...overrides });
    return this.begin(new RunImageWorkflowDto(workspaceId, nodeId, config, actorNodeId));
  }

  async dispatch(dto: RunImageWorkflowDto) {
    const execution = await this.begin(dto);
    const message = [
      '[Orkestrai Image Workflow]',
      `You are the Codex executor for workflow ${execution.workflowNodeId}, run ${execution.runId}.`,
      'Call image_workflow_read for this node to obtain the exact prompt, reference paths, and preallocated output paths.',
      'Use the built-in image_gen.imagegen tool only. Do not ask for an API key, do not call the OpenAI Images API directly, and do not use scripts/image_gen.py.',
      'Use referenced_image_paths when references exist. Make one built-in tool call per requested output, create only the assigned parent directory when needed, copy each returned file to its assigned workspace output path, then call image_workflow_complete.',
      'If generation cannot finish, call image_workflow_fail with the run id and a supported public error code.',
    ].join('\n');
    try {
      await bridgeService.sendOneWay(dto.workspaceId, { to: execution.executor.nodeId, message, kind: 'image-workflow' });
      return { ...execution, dispatched: true };
    } catch {
      await this.finishFailure(dto.workspaceId, dto.nodeId, execution.runId, 'image_workflow_executor_offline');
      throw new ImageWorkflowError('image_workflow_executor_offline', 409);
    }
  }

  async begin(dto: RunImageWorkflowDto) {
    const [workspace, workflow, nodes, edges, agents] = await Promise.all([
      workspaceRepository.getWorkspace(dto.workspaceId),
      workspaceRepository.getNode(dto.nodeId),
      workspaceRepository.listNodes(dto.workspaceId),
      workspaceRepository.listEdges(dto.workspaceId),
      bridgeService.listAgents(dto.workspaceId),
    ]);
    if (!workspace || !workflow || workflow.workspaceId !== dto.workspaceId || workflow.type !== 'imageWorkflow') throw new ImageWorkflowError('image_workflow_not_found', 404);
    const existingPayload = (workflow.payload ?? {}) as ImageWorkflowNodePayload;
    if (existingPayload.status === 'running' && existingPayload.activeRun) {
      if (dto.actorNodeId && existingPayload.activeRun.executorNodeId === dto.actorNodeId) return this.executionSpec(workspace, workflow, existingPayload.activeRun, agents);
      throw new ImageWorkflowError('image_workflow_already_running', 409);
    }

    const connected = connectedNodes(workflow, nodes, edges);
    const contexts = orderedNodes(
      connected.map(({ node }) => node).filter((node) => node.type === 'note'),
      existingPayload.contextOrder,
    ).slice(0, 12);
    const connectedExecutors = connected.map(({ node }) => node).filter((node) => (
      node.type === 'terminal' && (node.payload as TerminalNodePayload).provider === 'codex'
    ));
    const executorNode = dto.actorNodeId
      ? connectedExecutors.find((node) => node.id === dto.actorNodeId)
      : connectedExecutors.find((node) => agents.some((agent) => agent.nodeId === node.id && agent.sessionAlive));
    if (!executorNode) throw new ImageWorkflowError(dto.actorNodeId ? 'image_workflow_executor_unauthorized' : 'image_workflow_executor_missing', dto.actorNodeId ? 403 : 409);
    const executor = agents.find((agent) => agent.nodeId === executorNode.id);
    if (!executor?.sessionAlive) throw new ImageWorkflowError('image_workflow_executor_offline', 409);

    const imageNodes = orderedNodes(
      connected.map(({ node }) => node).filter((node) => (
        node.type === 'image' && (node.payload as ImageNodePayload).generatedBy?.workflowNodeId !== workflow.id
      )),
      existingPayload.referenceOrder,
    );
    if (imageNodes.length > MAX_REFERENCES) throw new ImageWorkflowError('image_workflow_too_many_references');

    const references: Array<{ node: CanvasNode; data: Uint8Array; path: string }> = [];
    let referenceBytes = 0;
    for (const node of imageNodes) {
      const path = String((node.payload as ImageNodePayload).path ?? '');
      if (!path) throw new ImageWorkflowError('image_workflow_reference_missing');
      const [file, inspection] = await Promise.all([
        filesystemService.readBinary(dto.workspaceId, path).catch(() => null),
        filesystemService.inspect(dto.workspaceId, path).catch(() => null),
      ]);
      if (!file || !inspection) throw new ImageWorkflowError('image_workflow_reference_unavailable');
      if (file.data.length > MAX_REFERENCE_BYTES) throw new ImageWorkflowError('image_workflow_reference_too_large');
      referenceBytes += file.data.length;
      if (referenceBytes > MAX_REFERENCE_TOTAL_BYTES) throw new ImageWorkflowError('image_workflow_references_too_large');
      if (!imageMime(file.data)) throw new ImageWorkflowError('image_workflow_reference_format_invalid');
      references.push({ node, data: file.data, path: relativeWorkspacePath(workspace, inspection.path) });
    }

    const runId = uuidv7();
    const suffix = runId.replaceAll('-', '').slice(-10);
    const outputPaths = Array.from({ length: dto.config.count }, (_, index) => (
      `${dto.config.outputDirectory.replace(/\/$/, '')}/${dto.config.filePrefix}-${suffix}-${index + 1}.png`
    ));
    const active: ImageWorkflowActiveRun = {
      id: runId,
      startedAt: new Date().toISOString(),
      actorNodeId: dto.actorNodeId,
      executorNodeId: executorNode.id,
      contextNodeIds: contexts.map((node) => node.id),
      referenceNodeIds: references.map(({ node }) => node.id),
      referencePaths: references.map(({ path }) => path),
      outputPaths,
      inputHash: runHash(dto.config, contexts, references),
      promptSnapshot: contextPrompt(dto.config.prompt, contexts, dto.config.transparentBackground),
      requestedOutputs: dto.config.count,
      transparentBackground: dto.config.transparentBackground,
    };
    await workspaceRepository.updateNode(workflow.id, {
      payload: nextPayload(existingPayload, dto.config, { status: 'running', activeRunId: runId, activeRun: active, lastError: null }),
    });
    broadcast(dto.workspaceId, workflow.id);
    return this.executionSpec(workspace, workflow, active, agents);
  }

  async complete(dto: CompleteImageWorkflowDto) {
    const [workspace, workflow] = await Promise.all([workspaceRepository.getWorkspace(dto.workspaceId), workspaceRepository.getNode(dto.nodeId)]);
    if (!workspace || !workflow || workflow.workspaceId !== dto.workspaceId || workflow.type !== 'imageWorkflow') throw new ImageWorkflowError('image_workflow_not_found', 404);
    const payload = (workflow.payload ?? {}) as ImageWorkflowNodePayload;
    const active = payload.activeRun;
    if (payload.status !== 'running' || !active || active.id !== dto.runId) throw new ImageWorkflowError('image_workflow_run_not_active', 409);
    if (active.executorNodeId !== dto.actorNodeId) throw new ImageWorkflowError('image_workflow_executor_unauthorized', 403);
    if (dto.outputPaths.length !== active.outputPaths.length || dto.outputPaths.some((path, index) => path !== active.outputPaths[index])) {
      throw new ImageWorkflowError('image_workflow_output_path_mismatch');
    }

    let totalBytes = 0;
    for (const path of dto.outputPaths) {
      const file = await filesystemService.readBinary(dto.workspaceId, path).catch(() => null);
      if (!file) throw new ImageWorkflowError('image_workflow_output_missing');
      if (file.data.length > MAX_OUTPUT_BYTES) throw new ImageWorkflowError('image_workflow_output_too_large');
      totalBytes += file.data.length;
      if (totalBytes > MAX_OUTPUT_TOTAL_BYTES) throw new ImageWorkflowError('image_workflow_outputs_too_large');
      if (imageMime(file.data) !== 'image/png') throw new ImageWorkflowError('image_workflow_output_format_invalid');
    }

    const [nodes, edges] = await Promise.all([workspaceRepository.listNodes(dto.workspaceId), workspaceRepository.listEdges(dto.workspaceId)]);
    const existingOutputCount = connectedNodes(workflow, nodes, edges).filter(({ node }) => (
      node.type === 'image' && (node.payload as ImageNodePayload).generatedBy?.workflowNodeId === workflow.id
    )).length;
    const outputNodeIds: string[] = [];
    try {
      for (const [index, path] of dto.outputPaths.entries()) {
        const outputIndex = existingOutputCount + index;
        const outputNode = await workspaceRepository.createNode({
          workspaceId: dto.workspaceId,
          type: 'image',
          title: `${workflow.title ?? 'Generated image'} ${outputIndex + 1}`,
          x: workflow.x + workflow.width + 72 + Math.floor(outputIndex / 4) * 312,
          y: workflow.y + (outputIndex % 4) * 272,
          width: 280,
          height: 240,
          zIndex: workflow.zIndex,
          floorId: workflow.floorId,
          payload: { path, generatedBy: { workflowNodeId: workflow.id, runId: active.id, outputIndex: index, inputHash: active.inputHash } } satisfies ImageNodePayload,
        });
        outputNodeIds.push(outputNode.id);
        await workspaceRepository.createEdge({ workspaceId: dto.workspaceId, sourceNodeId: workflow.id, targetNodeId: outputNode.id, style: 'cord' });
      }
      const current = ((await workspaceRepository.getNode(workflow.id))?.payload ?? payload) as ImageWorkflowNodePayload;
      const run = runRecord(active, 'succeeded', new Date(), dto.outputPaths, outputNodeIds, null);
      await workspaceRepository.updateNode(workflow.id, {
        payload: nextPayload(current, {}, {
          status: 'succeeded', activeRunId: null, activeRun: null, lastError: null,
          history: [...(current.history ?? []), run].slice(-HISTORY_LIMIT),
        }),
      });
      broadcast(dto.workspaceId, workflow.id);
      return { workflowNodeId: workflow.id, run, outputPaths: dto.outputPaths, outputNodeIds };
    } catch (error) {
      for (const nodeId of outputNodeIds) await workspaceRepository.deleteNode(nodeId).catch(() => false);
      throw error;
    }
  }

  async fail(dto: FailImageWorkflowDto) {
    const workflow = await workspaceRepository.getNode(dto.nodeId);
    const payload = (workflow?.payload ?? {}) as ImageWorkflowNodePayload;
    if (!workflow || workflow.workspaceId !== dto.workspaceId || workflow.type !== 'imageWorkflow') throw new ImageWorkflowError('image_workflow_not_found', 404);
    if (!payload.activeRun || payload.activeRun.id !== dto.runId || payload.status !== 'running') throw new ImageWorkflowError('image_workflow_run_not_active', 409);
    if (payload.activeRun.executorNodeId !== dto.actorNodeId) throw new ImageWorkflowError('image_workflow_executor_unauthorized', 403);
    return this.finishFailure(dto.workspaceId, dto.nodeId, dto.runId, dto.errorCode);
  }

  async status(workspaceId: string, nodeId: string) {
    const [node, nodes, edges, agents] = await Promise.all([
      workspaceRepository.getNode(nodeId), workspaceRepository.listNodes(workspaceId),
      workspaceRepository.listEdges(workspaceId), bridgeService.listAgents(workspaceId),
    ]);
    if (!node || node.workspaceId !== workspaceId || node.type !== 'imageWorkflow') throw new ImageWorkflowError('image_workflow_not_found', 404);
    const payload = (node.payload ?? {}) as ImageWorkflowNodePayload;
    if (payload.status === 'running' && !payload.activeRun) {
      await workspaceRepository.updateNode(node.id, { payload: nextPayload(payload, {}, { status: 'failed', activeRunId: null, activeRun: null, lastError: 'image_workflow_interrupted' }) });
      broadcast(workspaceId, node.id);
    }
    const connectedCodex = connectedNodes(node, nodes, edges).map(({ node: connected }) => connected).filter((connected) => (
      connected.type === 'terminal' && (connected.payload as TerminalNodePayload).provider === 'codex'
    ));
    const connectedAgents = connectedCodex.flatMap((connected) => {
      const agent = agents.find((candidate) => candidate.nodeId === connected.id);
      return agent ? [agent] : [];
    });
    const executor = connectedAgents.find((agent) => agent.sessionAlive) ?? connectedAgents[0] ?? null;
    return {
      running: payload.status === 'running' && Boolean(payload.activeRun),
      runId: payload.activeRun?.id ?? null,
      lastError: payload.lastError ?? null,
      executorReady: Boolean(executor?.sessionAlive),
      executorNodeId: executor?.nodeId ?? connectedCodex[0]?.id ?? null,
      executorTitle: executor?.title ?? connectedCodex[0]?.title ?? null,
    };
  }

  async cancel(workspaceId: string, nodeId: string, actorNodeId?: string | null) {
    if (actorNodeId) await this.requireControl(workspaceId, nodeId, actorNodeId);
    const node = await workspaceRepository.getNode(nodeId);
    if (!node || node.workspaceId !== workspaceId || node.type !== 'imageWorkflow') throw new ImageWorkflowError('image_workflow_not_found', 404);
    const payload = (node.payload ?? {}) as ImageWorkflowNodePayload;
    if (!payload.activeRun || payload.status !== 'running') return { cancelled: false };
    const runId = payload.activeRun.id;
    await this.finishFailure(workspaceId, nodeId, runId, 'image_gen_cancelled');
    return { cancelled: true, runId };
  }

  private async finishFailure(workspaceId: string, nodeId: string, runId: string, errorCode: string) {
    const node = await workspaceRepository.getNode(nodeId);
    if (!node || node.workspaceId !== workspaceId || node.type !== 'imageWorkflow') throw new ImageWorkflowError('image_workflow_not_found', 404);
    const payload = (node.payload ?? {}) as ImageWorkflowNodePayload;
    const active = payload.activeRun;
    if (!active || active.id !== runId) throw new ImageWorkflowError('image_workflow_run_not_active', 409);
    const cancelled = errorCode === 'image_gen_cancelled';
    const run = runRecord(active, cancelled ? 'cancelled' : 'failed', new Date(), [], [], errorCode);
    await workspaceRepository.updateNode(node.id, {
      payload: nextPayload(payload, {}, {
        status: cancelled ? 'cancelled' : 'failed', activeRunId: null, activeRun: null, lastError: cancelled ? null : errorCode,
        history: [...(payload.history ?? []), run].slice(-HISTORY_LIMIT),
      }),
    });
    broadcast(workspaceId, node.id);
    return { workflowNodeId: node.id, run };
  }

  private executionSpec(workspace: Workspace, workflow: CanvasNode, active: ImageWorkflowActiveRun, agents: Awaited<ReturnType<typeof bridgeService.listAgents>>) {
    const executor = agents.find((agent) => agent.nodeId === active.executorNodeId);
    return {
      workflowNodeId: workflow.id,
      runId: active.id,
      status: 'running' as const,
      executor: { nodeId: active.executorNodeId, title: executor?.title ?? 'Codex', provider: 'codex' as const },
      tool: {
        displayName: 'image_gen.imagegen', normalizedName: 'tools.image_gen__imagegen',
        prompt: active.promptSnapshot,
        referenced_image_paths: active.referencePaths.map((path) => agentPath(workspace, path)),
        calls: active.requestedOutputs,
      },
      workspaceRoot: workspace.runtimeKind === 'wsl' && workspace.wslWorkingDir ? workspace.wslWorkingDir : workspace.workingDir,
      outputPaths: active.outputPaths,
      outputAbsolutePaths: active.outputPaths.map((path) => agentPath(workspace, path)),
      completion: { tool: 'image_workflow_complete', arguments: { nodeId: workflow.id, runId: active.id, outputPaths: active.outputPaths } },
      failure: { tool: 'image_workflow_fail', arguments: { nodeId: workflow.id, runId: active.id, errorCode: 'image_gen_tool_failed' } },
    };
  }

  private async describe(workflow: CanvasNode, nodes: CanvasNode[], edges: Awaited<ReturnType<typeof workspaceRepository.listEdges>>) {
    const connected = connectedNodes(workflow, nodes, edges);
    const payload = (workflow.payload ?? {}) as ImageWorkflowNodePayload;
    const [workspace, agents] = await Promise.all([workspaceRepository.getWorkspace(workflow.workspaceId), bridgeService.listAgents(workflow.workspaceId)]);
    const summarize = (type: CanvasNode['type']) => connected.map(({ node }) => node).filter((node) => node.type === type).map((node) => ({
      nodeId: node.id, title: node.title ?? type,
      ...(type === 'terminal' ? { provider: (node.payload as TerminalNodePayload).provider ?? null } : {}),
    }));
    const references = orderedNodes(
      connected.map(({ node }) => node).filter((node) => (
        node.type === 'image' && (node.payload as ImageNodePayload).generatedBy?.workflowNodeId !== workflow.id
      )),
      payload.referenceOrder,
    ).map((node) => ({ nodeId: node.id, title: node.title ?? 'Image', path: (node.payload as ImageNodePayload).path ?? null }));
    const outputs = connected.map(({ node }) => node).filter((node) => (
      node.type === 'image' && (node.payload as ImageNodePayload).generatedBy?.workflowNodeId === workflow.id
    )).map((node) => ({ nodeId: node.id, title: node.title ?? 'Image', path: (node.payload as ImageNodePayload).path ?? null }));
    return {
      nodeId: workflow.id,
      title: workflow.title ?? 'Image workflow',
      config: {
        prompt: payload.prompt ?? '', count: payload.count ?? 1,
        transparentBackground: payload.transparentBackground ?? false,
        outputDirectory: payload.outputDirectory ?? 'generated/images', filePrefix: payload.filePrefix ?? 'orkestrai-image',
      },
      status: payload.status ?? 'idle',
      contexts: orderedNodes(
        connected.map(({ node }) => node).filter((node) => node.type === 'note'),
        payload.contextOrder,
      ).map((node) => ({ nodeId: node.id, title: node.title ?? 'Note' })),
      references, executors: summarize('terminal'), outputs,
      history: (payload.history ?? []).slice(-HISTORY_LIMIT),
      activeExecution: workspace && payload.activeRun ? this.executionSpec(workspace, workflow, payload.activeRun, agents) : null,
    };
  }

  private async requireCodexActor(workspaceId: string, actorNodeId: string) {
    const [node, agents] = await Promise.all([workspaceRepository.getNode(actorNodeId), bridgeService.listAgents(workspaceId)]);
    const actor = agents.find((agent) => agent.nodeId === actorNodeId);
    if (!node || node.workspaceId !== workspaceId || node.type !== 'terminal' || actor?.provider !== 'codex') {
      throw new ImageWorkflowError('image_workflow_executor_unauthorized', 403);
    }
    return node;
  }

  private async requireControl(workspaceId: string, nodeId: string, actorNodeId: string) {
    const [workflow, actor, nodes, edges] = await Promise.all([
      workspaceRepository.getNode(nodeId),
      this.requireCodexActor(workspaceId, actorNodeId),
      workspaceRepository.listNodes(workspaceId),
      workspaceRepository.listEdges(workspaceId),
    ]);
    if (!workflow || workflow.workspaceId !== workspaceId || workflow.type !== 'imageWorkflow') throw new ImageWorkflowError('image_workflow_not_found', 404);
    const connected = edges.some((edge) => (
      (edge.sourceNodeId === workflow.id && edge.targetNodeId === actor.id)
      || (edge.targetNodeId === workflow.id && edge.sourceNodeId === actor.id)
    ));
    if (!connected) throw new ImageWorkflowError('image_workflow_executor_unauthorized', 403);
    return { workflow, actor, nodes, edges };
  }
}

export const imageWorkflowService = new ImageWorkflowService();
