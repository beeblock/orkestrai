import { createHash } from 'node:crypto';
import { basename, posix, relative, resolve, sep } from 'node:path';
import { uuidv7 } from '@beeblock/svelar/support';
import { PNG } from 'pngjs';
import type {
  CanvasNode,
  ImageNodePayload,
  ImageWorkflowActiveRun,
  ImageWorkflowNodePayload,
  ImageWorkflowOutputPreset,
  ImageWorkflowRun,
  NoteNodePayload,
  TerminalNodePayload,
  Workspace,
} from '../../domain/types.js';
import { findFreeCanvasPosition, type CanvasPlacementRect } from '../../domain/canvas-placement.js';
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
const MAX_OUTPUT_DIMENSION = 8_192;
const MAX_OUTPUT_PIXELS = 40_000_000;
const MIN_TRANSPARENT_PIXEL_RATIO = 0.005;
const MAX_CONTEXT_LENGTH = 16_000;
const HISTORY_LIMIT = 12;
const MAX_ATTEMPTS_PER_OUTPUT = 3;
const MAX_DELIVERY_ASPECT_DEVIATION = 0.005;
const MIN_RUN_TIMEOUT_MS = 20 * 60 * 1_000;
const RUN_TIMEOUT_PER_OUTPUT_MS = 9 * 60 * 1_000;
const MAX_RUN_TIMEOUT_MS = 90 * 60 * 1_000;

const TRANSPARENT_OUTPUT_CONTRACT = [
  'NON-NEGOTIABLE FILE OUTPUT: return an RGBA PNG with a real alpha channel.',
  'Every pixel outside the subject must be fully transparent (alpha 0).',
  'Do not draw or render a checkerboard, grid, white background, colored background, studio backdrop, shadow plane, glow, or fake transparency.',
  'Transparency is a file-format requirement, not a visual description. Keep the subject and required branding fully opaque and preserve clean antialiased edges.',
].join(' ');

const WHITE_MATTE_OUTPUT_CONTRACT = [
  'INTERMEDIATE COMPOSITING STEP: render the complete requested foreground on a pure, flat, uniform white (#FFFFFF) background.',
  'Do not render transparency, a checkerboard, grid, gradient, environment, texture, shadow plane, or background glow in this intermediate image.',
  'Keep the complete foreground subject, typography, logo, branding, and all intended foreground details fully visible and opaque with a clean silhouette.',
  'This white matte will be removed by a separate native ImageGen edit before the output is accepted.',
].join(' ');

const WHITE_MATTE_REMOVAL_PROMPT = [
  'Edit the referenced image by removing its entire white matte background.',
  'The white background is an intentional temporary compositing layer and must not appear in the result.',
  'Do not return the source unchanged and do not replace white with a checkerboard, grid, color, gradient, environment, shadow plane, or glow.',
  'Preserve the complete foreground subject, identity, composition, crop, colors, typography, logo, branding, proportions, and details.',
  'Return only the isolated foreground as an RGBA PNG with alpha 0 outside its silhouette and clean antialiased edges.',
].join(' ');

const CHECKERBOARD_REMOVAL_PROMPT = [
  'Isolate the subject and delete the background.',
  'Keep the subject and all visible logos and branding unchanged.',
  'Remove every checkerboard square and all background pixels.',
  'Return only the subject as a true transparent RGBA PNG cutout, with alpha 0 everywhere outside the subject.',
  'No visible checkerboard, no white or gray background, no matte, no shadow, no halo.',
  'Do not redraw the subject.',
].join(' ');

const TRANSPARENT_REPAIR_PROMPTS = [
  CHECKERBOARD_REMOVAL_PROMPT,
  [
    'The previous native background-removal edit failed machine alpha validation again and still returned an opaque image.',
    'Reconstruct ONLY the foreground subject on a new empty transparent canvas; use the referenced image only to preserve identity and foreground details, not as a canvas to copy.',
    'Do not render, retain, imitate, or replace the background with any checkerboard, grid, solid color, gradient, scene, shadow plane, or glow.',
    'Preserve the subject, composition, crop, colors, typography, logo, branding, proportions, and details.',
    'Return an RGBA PNG containing genuinely transparent pixels with alpha 0 everywhere outside the subject and clean antialiased edges.',
  ].join(' '),
] as const;

const OUTPUT_PRESET_DIMENSIONS: Record<Exclude<ImageWorkflowOutputPreset, 'auto' | 'custom'>, { width: number; height: number }> = {
  'instagram-square': { width: 1_080, height: 1_080 },
  'instagram-portrait': { width: 1_080, height: 1_350 },
  'instagram-story': { width: 1_080, height: 1_920 },
  tiktok: { width: 1_080, height: 1_920 },
};

function targetDimensions(config: Pick<ImageWorkflowConfigInput, 'outputPreset' | 'targetWidth' | 'targetHeight'>) {
  if (config.outputPreset === 'auto') return null;
  if (config.outputPreset === 'custom') {
    if (!config.targetWidth || !config.targetHeight) throw new ImageWorkflowError('image_workflow_target_dimensions_required');
    return { width: config.targetWidth, height: config.targetHeight };
  }
  return OUTPUT_PRESET_DIMENSIONS[config.outputPreset];
}

function safeAreaContract(preset: ImageWorkflowOutputPreset): string {
  if (preset === 'tiktok') {
    return 'SAFE AREA: keep every essential subject, face, logo, headline, subtitle, and call to action inside the central area bounded by 8% from the left, 16% from the right, 10% from the top, and 20% from the bottom. Only expendable background may enter the outer area reserved for platform controls.';
  }
  if (preset === 'instagram-story') {
    return 'SAFE AREA: keep every essential subject, face, logo, headline, subtitle, and call to action at least 8% from the left and right and 12% from the top and bottom. Only expendable background may enter those outer margins.';
  }
  return 'SAFE AREA: keep every essential subject, face, logo, headline, subtitle, and call to action at least 8% away from every edge. Only expendable background may enter those outer margins.';
}

function deliveryContract(target: { width: number; height: number } | null, preset: ImageWorkflowOutputPreset): string {
  if (!target) return '';
  const ratio = target.width / target.height;
  return [
    `DELIVERY FRAME CONTRACT: compose specifically for a ${target.width} x ${target.height} pixel canvas (${target.width}:${target.height}, aspect ratio ${ratio.toFixed(4)}).`,
    safeAreaContract(preset),
    'Fill the complete frame. Do not add letterboxing, pillarboxing, borders, a mock device, or a canvas shown inside another canvas.',
    'Do not crop, stretch, squeeze, or distort the composition to imitate the requested frame.',
    `The native tool may return a nearby pixel grid. Orkestrai accepts exact-size resampling only when its aspect ratio already matches this frame within ${(MAX_DELIVERY_ASPECT_DEVIATION * 100).toFixed(1)}%; otherwise native ImageGen must safely recompose it before delivery.`,
  ].join(' ');
}

function normalizedMasterPath(outputPath: string): string {
  const directory = posix.dirname(outputPath);
  const extension = posix.extname(outputPath);
  const stem = posix.basename(outputPath, extension);
  return posix.join(directory, '.masters', `${stem}-native${extension || '.png'}`);
}

function deliveryAspectDeviation(sourceWidth: number, sourceHeight: number, targetWidth: number, targetHeight: number): number {
  const sourceRatio = sourceWidth / sourceHeight;
  const targetRatio = targetWidth / targetHeight;
  return Math.abs(sourceRatio - targetRatio) / targetRatio;
}

/** Resample a composition whose aspect ratio already matches, preserving the entire frame. */
export function normalizePngDelivery(bytes: Uint8Array, width: number, height: number): Uint8Array {
  const source = PNG.sync.read(Buffer.from(bytes), { checkCRC: true });
  if (source.width === width && source.height === height) return bytes;
  if (deliveryAspectDeviation(source.width, source.height, width, height) > MAX_DELIVERY_ASPECT_DEVIATION) {
    throw new ImageWorkflowError('image_workflow_output_aspect_mismatch');
  }
  const output = new PNG({ width, height, colorType: 6 });

  for (let y = 0; y < height; y += 1) {
    const sourceY = ((y + 0.5) * source.height / height) - 0.5;
    const y0 = Math.max(0, Math.min(source.height - 1, Math.floor(sourceY)));
    const y1 = Math.max(0, Math.min(source.height - 1, y0 + 1));
    const fy = Math.max(0, Math.min(1, sourceY - Math.floor(sourceY)));
    for (let x = 0; x < width; x += 1) {
      const sourceX = ((x + 0.5) * source.width / width) - 0.5;
      const x0 = Math.max(0, Math.min(source.width - 1, Math.floor(sourceX)));
      const x1 = Math.max(0, Math.min(source.width - 1, x0 + 1));
      const fx = Math.max(0, Math.min(1, sourceX - Math.floor(sourceX)));
      const samples = [
        [x0, y0, (1 - fx) * (1 - fy)],
        [x1, y0, fx * (1 - fy)],
        [x0, y1, (1 - fx) * fy],
        [x1, y1, fx * fy],
      ] as const;
      let alpha = 0;
      let red = 0;
      let green = 0;
      let blue = 0;
      for (const [sampleX, sampleY, weight] of samples) {
        const offset = (sampleY * source.width + sampleX) * 4;
        const sampleAlpha = source.data[offset + 3] / 255;
        const weightedAlpha = sampleAlpha * weight;
        alpha += weightedAlpha;
        red += source.data[offset] * weightedAlpha;
        green += source.data[offset + 1] * weightedAlpha;
        blue += source.data[offset + 2] * weightedAlpha;
      }
      const outputOffset = (y * width + x) * 4;
      output.data[outputOffset] = alpha > 0 ? Math.round(red / alpha) : 0;
      output.data[outputOffset + 1] = alpha > 0 ? Math.round(green / alpha) : 0;
      output.data[outputOffset + 2] = alpha > 0 ? Math.round(blue / alpha) : 0;
      output.data[outputOffset + 3] = Math.round(alpha * 255);
    }
  }
  return Uint8Array.from(PNG.sync.write(output, { colorType: 6 }));
}

function transparentRepairPrompt(active: ImageWorkflowActiveRun, failedValidationCount: number): string {
  if (active.transparencyStrategy === 'white-matte-then-alpha' && failedValidationCount === 1) {
    return WHITE_MATTE_REMOVAL_PROMPT;
  }
  if (active.transparencyStrategy === 'white-matte-then-alpha' && failedValidationCount === 2) {
    return CHECKERBOARD_REMOVAL_PROMPT;
  }
  return TRANSPARENT_REPAIR_PROMPTS[Math.min(Math.max(0, failedValidationCount - 1), TRANSPARENT_REPAIR_PROMPTS.length - 1)];
}

function deliveryRepairPrompt(active: ImageWorkflowActiveRun, sourceWidth: number | null, sourceHeight: number | null): string {
  const width = active.targetWidth;
  const height = active.targetHeight;
  if (!width || !height) return '';
  const source = sourceWidth && sourceHeight ? `The previous result was ${sourceWidth} x ${sourceHeight} and does not match the required aspect ratio.` : 'The previous result does not match the required aspect ratio.';
  const transparency = active.transparentBackground
    ? 'Return a true transparent RGBA PNG and preserve genuine alpha outside the foreground.'
    : 'Extend or regenerate only the expendable background as needed to fill the complete frame.';
  return [
    `Recompose the referenced image for a ${width} x ${height} delivery frame (${width}:${height}, aspect ratio ${(width / height).toFixed(4)}).`,
    source,
    'Preserve the complete subject, identity, branding, typography, colors, and intended visual hierarchy.',
    'Do not crop, stretch, squeeze, or distort any existing content. Do not remove, truncate, or push text, logos, faces, limbs, products, or calls to action beyond the frame.',
    safeAreaContract(active.outputPreset ?? 'custom'),
    transparency,
    'Fill the frame itself; do not add letterboxing, pillarboxing, borders, a mock device, or a canvas inside another canvas.',
  ].join(' ');
}

export class ImageWorkflowError extends Error {
  constructor(public readonly code: string, public readonly status = 422) {
    super(code);
  }
}

function broadcast(workspaceId: string, nodeId: string): void {
  const send = (globalThis as { __orkestraiBroadcast?: (payload: Record<string, unknown>) => void }).__orkestraiBroadcast;
  send?.({ type: 'workspaceChanged', workspaceId, nodeId });
}

function occupiedOnFloor(nodes: CanvasNode[], floorId: string | null): CanvasPlacementRect[] {
  return nodes
    .filter((node) => (node.floorId ?? null) === floorId)
    .map((node) => ({ x: node.x, y: node.y, width: node.width, height: node.height }));
}

function imageMime(bytes: Uint8Array): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

function inspectPng(bytes: Uint8Array): { width: number; height: number; hasGenuineTransparency: boolean } {
  if (imageMime(bytes) !== 'image/png' || bytes.length < 33 || String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR') {
    throw new ImageWorkflowError('image_workflow_output_format_invalid');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (!width || !height || width > MAX_OUTPUT_DIMENSION || height > MAX_OUTPUT_DIMENSION || width * height > MAX_OUTPUT_PIXELS) {
    throw new ImageWorkflowError('image_workflow_output_dimensions_invalid');
  }
  try {
    const decoded = PNG.sync.read(Buffer.from(bytes), { checkCRC: true });
    const requiredTransparentPixels = Math.max(1, Math.ceil(width * height * MIN_TRANSPARENT_PIXEL_RATIO));
    let transparentPixels = 0;
    for (let index = 3; index < decoded.data.length; index += 4) {
      if (decoded.data[index] === 0 && ++transparentPixels >= requiredTransparentPixels) {
        return { width, height, hasGenuineTransparency: true };
      }
    }
    return { width, height, hasGenuineTransparency: false };
  } catch (error) {
    if (error instanceof ImageWorkflowError) throw error;
    throw new ImageWorkflowError('image_workflow_output_format_invalid');
  }
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

function contextPrompt(
  prompt: string,
  contexts: CanvasNode[],
  transparentBackground: boolean,
  transparencyStrategy: ImageWorkflowActiveRun['transparencyStrategy'] = 'direct-alpha',
  target: { width: number; height: number } | null = null,
  outputPreset: ImageWorkflowOutputPreset = 'auto',
): string {
  const blocks = contexts.flatMap((node) => {
    const content = String((node.payload as NoteNodePayload).content ?? '').trim();
    if (!content) return [];
    return [`Context from ${JSON.stringify(node.title ?? 'Note')}:\n${content.slice(0, MAX_CONTEXT_LENGTH)}`];
  });
  const transparent = transparentBackground
    ? transparencyStrategy === 'white-matte-then-alpha' ? WHITE_MATTE_OUTPUT_CONTRACT : TRANSPARENT_OUTPUT_CONTRACT
    : '';
  const body = [prompt, ...blocks, deliveryContract(target, outputPreset)].filter(Boolean).join('\n\n');
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
    outputPreset: active.outputPreset ?? 'auto',
    targetWidth: active.targetWidth ?? null,
    targetHeight: active.targetHeight ?? null,
    sourceMasterPaths: outputPaths.flatMap((path) => active.normalizedOutputMasters?.[path] ?? []),
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
    const nodes = await workspaceRepository.listNodes(dto.workspaceId);
    const position = findFreeCanvasPosition(occupiedOnFloor(nodes, actor.floorId ?? null), {
      x: actor.x + actor.width + 72,
      y: actor.y,
      width: 440,
      height: 560,
    });
    const workflow = await workspaceRepository.createNode({
      workspaceId: dto.workspaceId,
      type: 'imageWorkflow',
      title,
      x: position.x,
      y: position.y,
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
    targetDimensions({
      outputPreset: config.outputPreset ?? payload.outputPreset ?? 'auto',
      targetWidth: config.targetWidth === undefined ? payload.targetWidth ?? null : config.targetWidth,
      targetHeight: config.targetHeight === undefined ? payload.targetHeight ?? null : config.targetHeight,
    });
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
    const referencePosition = findFreeCanvasPosition(occupiedOnFloor(nodes, workflow.floorId ?? null), {
      x: workflow.x - 352,
      y: workflow.y,
      width: 280,
      height: 240,
    }, { columnDirection: -1 });
    const reference = existing ?? await workspaceRepository.createNode({
      workspaceId: dto.workspaceId,
      type: 'image',
      title: dto.input.title ?? basename(path),
      x: referencePosition.x,
      y: referencePosition.y,
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
      'Every visual change, including background removal, MUST be performed by another built-in image_gen.imagegen call. Never use Python, Pillow, ImageMagick, ffmpeg, remove-bg, generated masks, canvas pixel processing, or any other script/tool to alter image pixels. Shell/file commands may only create the assigned directory and copy the exact native ImageGen result to its assigned path.',
      execution.delivery.targetWidth
        ? `Compose for the requested ${execution.delivery.targetWidth} x ${execution.delivery.targetHeight} delivery frame and obey its safe-area contract. Do not resize or crop the file yourself: image_workflow_validate only performs exact-size resampling when the native aspect ratio already matches, and otherwise returns a native ImageGen reframe prompt.`
        : 'This workflow keeps the native ImageGen dimensions because its delivery size is Auto.',
      execution.transparencyStrategy === 'white-matte-then-alpha'
        ? 'This run uses the white-matte-then-alpha strategy because it has multiple image references. The first native ImageGen call intentionally composes the requested foreground on pure white. Copy and validate that intermediate output; the validator will return the exact native ImageGen background-removal edit for the second call. Do not skip either stage.'
        : 'This run uses direct alpha generation for its first native ImageGen call.',
      `Produce every requested output. For each output, copy the native result to its assigned workspace path and call image_workflow_validate before moving to the next output. You may make up to ${MAX_ATTEMPTS_PER_OUTPUT} native ImageGen attempts for each validation class; do not stop merely because a transparent result then needs a separate delivery-frame repair.`,
      'When validation reports missing genuine alpha, call image_gen.imagegen again with repairReferencedImagePaths and the exact repairPrompt returned by the validator. The prompt escalates after another opaque result, so never reuse or paraphrase an earlier repair prompt. Replace the same assigned file with that native result and validate it again.',
      'When validation reports an incompatible delivery aspect ratio, call image_gen.imagegen again with repairReferencedImagePaths and the exact repairPrompt. It must recompose or outpaint safely; never crop, stretch, or squeeze content.',
      'Use the original referenced_image_paths for the first attempt. For corrective alpha or delivery edits, use the invalid assigned output as the reference, and use it alone, so identity, composition, and branding are preserved.',
      'After every assigned output validates, call image_workflow_complete once. Only call image_workflow_fail after the allowed corrective attempts are exhausted or the native tool itself cannot run.',
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
    const transparencyStrategy: ImageWorkflowActiveRun['transparencyStrategy'] = dto.config.transparentBackground && references.length > 1
      ? 'white-matte-then-alpha'
      : 'direct-alpha';
    const target = targetDimensions(dto.config);
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
      promptSnapshot: contextPrompt(dto.config.prompt, contexts, dto.config.transparentBackground, transparencyStrategy, target, dto.config.outputPreset),
      requestedOutputs: dto.config.count,
      transparentBackground: dto.config.transparentBackground,
      outputPreset: dto.config.outputPreset,
      targetWidth: target?.width ?? null,
      targetHeight: target?.height ?? null,
      transparencyStrategy,
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
    let completedActive = active;
    for (const path of dto.outputPaths) {
      const validation = await this.validateOutputFile(dto.workspaceId, path, completedActive);
      totalBytes += validation.bytes;
      if (totalBytes > MAX_OUTPUT_TOTAL_BYTES) throw new ImageWorkflowError('image_workflow_outputs_too_large');
      if (!validation.valid) throw new ImageWorkflowError(validation.errorCode!);
      if (validation.sourceMasterPath) {
        completedActive = {
          ...completedActive,
          normalizedOutputMasters: {
            ...(completedActive.normalizedOutputMasters ?? {}),
            [path]: validation.sourceMasterPath,
          },
        };
      }
    }

    const [nodes, edges] = await Promise.all([workspaceRepository.listNodes(dto.workspaceId), workspaceRepository.listEdges(dto.workspaceId)]);
    const existingOutputCount = connectedNodes(workflow, nodes, edges).filter(({ node }) => (
      node.type === 'image' && (node.payload as ImageNodePayload).generatedBy?.workflowNodeId === workflow.id
    )).length;
    const outputNodeIds: string[] = [];
    const occupied = occupiedOnFloor(nodes, workflow.floorId ?? null);
    try {
      for (const [index, path] of dto.outputPaths.entries()) {
        const outputIndex = existingOutputCount + index;
        const preferred = {
          x: workflow.x + workflow.width + 72 + Math.floor(outputIndex / 4) * 312,
          y: workflow.y + (outputIndex % 4) * 272,
          width: 280,
          height: 240,
        };
        const position = findFreeCanvasPosition(occupied, preferred);
        const outputNode = await workspaceRepository.createNode({
          workspaceId: dto.workspaceId,
          type: 'image',
          title: `${workflow.title ?? 'Generated image'} ${outputIndex + 1}`,
          x: position.x,
          y: position.y,
          width: 280,
          height: 240,
          zIndex: workflow.zIndex,
          floorId: workflow.floorId,
          payload: {
            path,
            generatedBy: {
              workflowNodeId: workflow.id,
              runId: active.id,
              outputIndex: index,
              inputHash: active.inputHash,
              ...(completedActive.normalizedOutputMasters?.[path] ? { sourceMasterPath: completedActive.normalizedOutputMasters[path] } : {}),
              ...(completedActive.targetWidth && completedActive.targetHeight
                ? { targetWidth: completedActive.targetWidth, targetHeight: completedActive.targetHeight }
                : {}),
            },
          } satisfies ImageNodePayload,
        });
        occupied.push({ ...position, width: outputNode.width, height: outputNode.height });
        outputNodeIds.push(outputNode.id);
        await workspaceRepository.createEdge({ workspaceId: dto.workspaceId, sourceNodeId: workflow.id, targetNodeId: outputNode.id, style: 'cord' });
      }
      const current = ((await workspaceRepository.getNode(workflow.id))?.payload ?? payload) as ImageWorkflowNodePayload;
      const run = runRecord(completedActive, 'succeeded', new Date(), dto.outputPaths, outputNodeIds, null);
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

  async validateOutput(workspaceId: string, nodeId: string, runId: string, outputPath: string, actorNodeId: string) {
    const workflow = await workspaceRepository.getNode(nodeId);
    if (!workflow || workflow.workspaceId !== workspaceId || workflow.type !== 'imageWorkflow') throw new ImageWorkflowError('image_workflow_not_found', 404);
    const payload = (workflow.payload ?? {}) as ImageWorkflowNodePayload;
    const active = payload.activeRun;
    if (payload.status !== 'running' || !active || active.id !== runId) throw new ImageWorkflowError('image_workflow_run_not_active', 409);
    if (active.executorNodeId !== actorNodeId) throw new ImageWorkflowError('image_workflow_executor_unauthorized', 403);
    if (!active.outputPaths.includes(outputPath)) throw new ImageWorkflowError('image_workflow_output_path_mismatch');
    const result = await this.validateOutputFile(workspaceId, outputPath, active);
    let failedValidationCount = active.alphaValidationFailures?.[outputPath] ?? 0;
    let deliveryValidationCount = active.deliveryValidationFailures?.[outputPath] ?? 0;
    let currentActive = active;
    if (result.errorCode === 'image_workflow_output_alpha_missing') {
      failedValidationCount += 1;
      currentActive = {
        ...active,
        alphaValidationFailures: { ...(active.alphaValidationFailures ?? {}), [outputPath]: failedValidationCount },
      };
    }
    if (result.errorCode === 'image_workflow_output_aspect_mismatch') {
      deliveryValidationCount += 1;
      currentActive = {
        ...currentActive,
        deliveryValidationFailures: {
          ...(currentActive.deliveryValidationFailures ?? {}),
          [outputPath]: deliveryValidationCount,
        },
      };
    }
    if (result.sourceMasterPath) {
      currentActive = {
        ...currentActive,
        normalizedOutputMasters: {
          ...(currentActive.normalizedOutputMasters ?? {}),
          [outputPath]: result.sourceMasterPath,
        },
      };
    }
    if (currentActive !== active) {
      await workspaceRepository.updateNode(workflow.id, {
        payload: nextPayload(payload, {}, { activeRun: currentActive }),
      });
      broadcast(workspaceId, workflow.id);
    }
    const alphaRetryable = result.errorCode === 'image_workflow_output_alpha_missing'
      && failedValidationCount < MAX_ATTEMPTS_PER_OUTPUT;
    const deliveryRetryable = result.errorCode === 'image_workflow_output_aspect_mismatch'
      && deliveryValidationCount < MAX_ATTEMPTS_PER_OUTPUT;
    const repairPrompt = alphaRetryable
      ? transparentRepairPrompt(active, failedValidationCount)
      : deliveryRetryable
        ? deliveryRepairPrompt(active, result.width ?? null, result.height ?? null)
        : null;
    const attemptsRemaining = result.errorCode === 'image_workflow_output_alpha_missing'
      ? Math.max(0, MAX_ATTEMPTS_PER_OUTPUT - failedValidationCount)
      : result.errorCode === 'image_workflow_output_aspect_mismatch'
        ? Math.max(0, MAX_ATTEMPTS_PER_OUTPUT - deliveryValidationCount)
        : null;
    return {
      path: outputPath,
      valid: result.valid,
      errorCode: result.errorCode,
      retryable: alphaRetryable || deliveryRetryable || result.errorCode === 'image_workflow_output_missing',
      transparentBackground: active.transparentBackground,
      transparencyStrategy: active.transparencyStrategy ?? 'direct-alpha',
      expectedIntermediate: active.transparencyStrategy === 'white-matte-then-alpha' && failedValidationCount === 1,
      failedValidationCount,
      deliveryValidationCount,
      width: result.width ?? null,
      height: result.height ?? null,
      sourceWidth: result.sourceWidth ?? result.width ?? null,
      sourceHeight: result.sourceHeight ?? result.height ?? null,
      targetWidth: active.targetWidth,
      targetHeight: active.targetHeight,
      normalized: result.normalized ?? false,
      sourceMasterPath: result.sourceMasterPath ?? null,
      attemptsRemaining,
      repairTool: repairPrompt ? 'image_gen.imagegen' : null,
      repairPrompt,
      repairReferencedImagePaths: repairPrompt ? [outputPath] : [],
      repair: repairPrompt
        ? `Call image_gen.imagegen with only this invalid output in referenced_image_paths and the exact repairPrompt returned in this response. Do not use Python or any non-ImageGen pixel manipulation. Replace the same assigned file with that native result and validate again.`
        : null,
    };
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
    if (payload.status === 'running' && payload.activeRun) {
      const executorAlive = agents.some((agent) => agent.nodeId === payload.activeRun?.executorNodeId && agent.sessionAlive);
      const elapsed = Date.now() - new Date(payload.activeRun.startedAt).getTime();
      const timeout = Math.min(MAX_RUN_TIMEOUT_MS, Math.max(MIN_RUN_TIMEOUT_MS, payload.activeRun.requestedOutputs * RUN_TIMEOUT_PER_OUTPUT_MS));
      if (!executorAlive || !Number.isFinite(elapsed) || elapsed > timeout) {
        await this.finishFailure(
          workspaceId,
          node.id,
          payload.activeRun.id,
          executorAlive ? 'image_workflow_timed_out' : 'image_workflow_executor_offline',
        );
        return this.status(workspaceId, nodeId);
      }
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

  private async validateOutputFile(workspaceId: string, path: string, active: ImageWorkflowActiveRun) {
    const file = await filesystemService.readBinary(workspaceId, path).catch(() => null);
    if (!file) return { valid: false, errorCode: 'image_workflow_output_missing', bytes: 0 };
    if (file.data.length > MAX_OUTPUT_BYTES) return { valid: false, errorCode: 'image_workflow_output_too_large', bytes: file.data.length };
    try {
      const png = inspectPng(file.data);
      if (active.transparentBackground && !png.hasGenuineTransparency) {
        return { valid: false, errorCode: 'image_workflow_output_alpha_missing', bytes: file.data.length };
      }
      if (active.targetWidth && active.targetHeight && (png.width !== active.targetWidth || png.height !== active.targetHeight)) {
        if (deliveryAspectDeviation(png.width, png.height, active.targetWidth, active.targetHeight) > MAX_DELIVERY_ASPECT_DEVIATION) {
          return {
            valid: false,
            errorCode: 'image_workflow_output_aspect_mismatch',
            bytes: file.data.length,
            width: png.width,
            height: png.height,
            sourceWidth: png.width,
            sourceHeight: png.height,
            normalized: false,
          };
        }
        const normalized = normalizePngDelivery(file.data, active.targetWidth, active.targetHeight);
        if (normalized.length > MAX_OUTPUT_BYTES) {
          return { valid: false, errorCode: 'image_workflow_output_too_large', bytes: normalized.length };
        }
        const sourceMasterPath = normalizedMasterPath(path);
        await filesystemService.writeBinary(workspaceId, sourceMasterPath, file.data);
        await filesystemService.writeBinary(workspaceId, path, normalized);
        const final = inspectPng(normalized);
        return {
          valid: true,
          errorCode: null,
          bytes: normalized.length,
          width: final.width,
          height: final.height,
          sourceWidth: png.width,
          sourceHeight: png.height,
          normalized: true,
          sourceMasterPath,
        };
      }
      return { valid: true, errorCode: null, bytes: file.data.length, width: png.width, height: png.height, normalized: false };
    } catch (error) {
      return {
        valid: false,
        errorCode: error instanceof ImageWorkflowError ? error.code : 'image_workflow_output_format_invalid',
        bytes: file.data.length,
      };
    }
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
        maxAttemptsPerOutput: MAX_ATTEMPTS_PER_OUTPUT,
        maxAttemptsPerValidationIssue: MAX_ATTEMPTS_PER_OUTPUT,
      },
      delivery: {
        preset: active.outputPreset ?? 'auto',
        targetWidth: active.targetWidth ?? null,
        targetHeight: active.targetHeight ?? null,
        exactPixels: Boolean(active.targetWidth && active.targetHeight),
        normalization: active.targetWidth && active.targetHeight ? 'aspect-safe-bilinear' : 'native',
        maxAspectDeviation: active.targetWidth && active.targetHeight ? MAX_DELIVERY_ASPECT_DEVIATION : null,
        preservesNativeMaster: Boolean(active.targetWidth && active.targetHeight),
      },
      transparencyStrategy: active.transparencyStrategy ?? 'direct-alpha',
      workspaceRoot: workspace.runtimeKind === 'wsl' && workspace.wslWorkingDir ? workspace.wslWorkingDir : workspace.workingDir,
      outputPaths: active.outputPaths,
      outputAbsolutePaths: active.outputPaths.map((path) => agentPath(workspace, path)),
      validation: {
        tool: 'image_workflow_validate',
        arguments: { nodeId: workflow.id, runId: active.id, outputPath: '<one assigned output path>' },
        genuineAlphaRequired: active.transparentBackground,
        repair: active.transparentBackground ? {
          tool: 'image_gen.imagegen',
          prompt: transparentRepairPrompt(active, 1),
          escalationPrompt: transparentRepairPrompt(active, 2),
          referenced_image_paths: ['<the invalid assigned output path only>'],
          forbiddenPixelTools: ['python', 'pillow', 'imagemagick', 'ffmpeg', 'remove-bg', 'generated masks', 'canvas pixel processing'],
        } : null,
        deliveryRepair: active.targetWidth && active.targetHeight ? {
          tool: 'image_gen.imagegen',
          prompt: deliveryRepairPrompt(active, null, null),
          referenced_image_paths: ['<the invalid assigned output path only>'],
          rejectsCropping: true,
        } : null,
      },
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
        outputPreset: payload.outputPreset ?? 'auto',
        targetWidth: payload.targetWidth ?? null,
        targetHeight: payload.targetHeight ?? null,
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
