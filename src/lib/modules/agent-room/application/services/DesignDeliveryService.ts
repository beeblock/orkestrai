import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { uuidv7 } from '@beeblock/svelar/support';
import {
  designAppliedFileSchema,
  designDeliveryTargetSchema,
  designGeneratedFileSchema,
  designImportResultSchema,
  type ApplyDesignDeliveryInput,
  type CaptureDesignDeliveryInput,
  type DesignAppliedFile,
  type DesignDeliveryTarget,
  type DesignGeneratedFile,
  type DesignImportResult,
  type ImportDesignMarkupInput,
  type PreviewDesignDeliveryInput,
} from '../../contracts/schemas/design-delivery.schema.js';
import { generateDesignCode } from '../../domain/design-code-generation.js';
import { importMarkupToDesign } from '../../domain/design-code-import.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { designDocumentService } from './DesignDocumentService.js';
import { deviceService } from './DeviceService.js';
import { portalService } from './PortalService.js';

function hash(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

function dataUrl(buffer: Uint8Array, mimeType = 'image/png'): string {
  return `data:${mimeType};base64,${Buffer.from(buffer).toString('base64')}`;
}

export class DesignDeliveryService {
  private async workspace(workspaceId: string) {
    const workspace = await workspaceRepository.getWorkspace(workspaceId);
    if (!workspace) throw new Error('Workspace not found.');
    return workspace;
  }

  private async outputContext(workspaceId: string, pathInput: string): Promise<{ root: string; path: string; relativePath: string }> {
    const workspace = await this.workspace(workspaceId);
    const root = await realpath(resolve(workspace.workingDir));
    if (isAbsolute(pathInput)) throw new Error('Generated files require a workspace-relative path.');
    const path = resolve(root, pathInput);
    const distance = relative(root, path);
    if (!distance || distance === '..' || distance.startsWith(`..${sep}`) || isAbsolute(distance)) throw new Error('Generated files must stay inside the workspace.');
    const first = distance.split(sep)[0].toLowerCase();
    if (['.git', '.orkestrai', 'node_modules', 'build', 'dist'].includes(first)) throw new Error(`Generated files cannot be written inside ${first}.`);
    await this.assertResolvedInside(root, path);
    return { root, path, relativePath: distance.split(sep).join('/') };
  }

  private assertInside(root: string, path: string): void {
    const distance = relative(root, path);
    if (distance === '..' || distance.startsWith(`..${sep}`) || isAbsolute(distance)) {
      throw new Error('Generated files cannot follow a symlink outside the workspace.');
    }
  }

  private async assertResolvedInside(root: string, path: string): Promise<void> {
    let cursor = path;
    while (true) {
      try {
        this.assertInside(root, await realpath(cursor));
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        const parent = dirname(cursor);
        if (parent === cursor) throw error;
        cursor = parent;
      }
    }
  }

  private async existing(path: string): Promise<{ content: string | null; hash: string | null }> {
    try {
      const content = await readFile(path, 'utf8');
      if (content.includes('\0')) throw new Error('The selected output file is binary.');
      if (content.length > 2_000_000) throw new Error('The selected output file exceeds the 2 MB preview limit.');
      return { content, hash: hash(content) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { content: null, hash: null };
      throw error;
    }
  }

  async preview(workspaceId: string, nodeId: string, input: PreviewDesignDeliveryInput): Promise<DesignGeneratedFile> {
    const [document, output] = await Promise.all([
      designDocumentService.get(workspaceId, nodeId),
      this.outputContext(workspaceId, input.outputPath),
    ]);
    const generated = generateDesignCode(document, { ...input, outputPath: output.relativePath });
    const existing = await this.existing(output.path);
    return designGeneratedFileSchema.parse({
      sourceRevision: document.revision,
      path: output.relativePath,
      content: generated.content,
      existingContent: existing.content,
      existingHash: existing.hash,
      status: existing.content === null ? 'create' : existing.content === generated.content ? 'unchanged' : 'update',
      mappingsUsed: generated.mappingsUsed,
      warnings: generated.warnings,
    });
  }

  async apply(workspaceId: string, nodeId: string, input: ApplyDesignDeliveryInput): Promise<DesignAppliedFile> {
    const [output, document] = await Promise.all([
      this.outputContext(workspaceId, input.outputPath),
      designDocumentService.get(workspaceId, nodeId),
    ]);
    if (document.revision !== input.baseRevision) throw new Error('The design changed after preview. Preview it again before writing.');
    const current = await this.existing(output.path);
    if (current.hash !== input.expectedExistingHash) throw new Error('The output file changed after preview. Preview it again before writing.');
    const generated = generateDesignCode(document, { ...input, outputPath: output.relativePath });
    const status = current.content === null ? 'create' : current.content === generated.content ? 'unchanged' : 'update';
    if (status !== 'unchanged') {
      await mkdir(dirname(output.path), { recursive: true });
      await this.assertResolvedInside(output.root, dirname(output.path));
      const temporary = `${output.path}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(temporary, generated.content, 'utf8');
      try {
        const [latestDocument, latestFile] = await Promise.all([
          designDocumentService.get(workspaceId, nodeId),
          this.existing(output.path),
        ]);
        if (latestDocument.revision !== input.baseRevision) throw new Error('The design changed while writing. Preview it again before retrying.');
        if (latestFile.hash !== current.hash) throw new Error('The output file changed while writing. Preview it again before retrying.');
        await this.assertResolvedInside(output.root, dirname(output.path));
        await rename(temporary, output.path);
      } catch (error) {
        await rm(temporary, { force: true });
        throw error;
      }
    } else {
      const [latestDocument, latestFile] = await Promise.all([
        designDocumentService.get(workspaceId, nodeId),
        this.existing(output.path),
      ]);
      if (latestDocument.revision !== input.baseRevision || latestFile.hash !== current.hash) {
        throw new Error('The design or output file changed after preview. Preview it again before retrying.');
      }
    }
    const artifact = {
      id: uuidv7(),
      name: input.componentName,
      path: output.relativePath,
      framework: input.framework,
      elementIds: input.elementIds,
      sourceRevision: document.revision,
      contentHash: hash(generated.content),
      componentMappings: generated.mappingsUsed,
      generatedAt: new Date().toISOString(),
    };
    return designAppliedFileSchema.parse({
      sourceRevision: document.revision,
      path: output.relativePath,
      content: generated.content,
      existingContent: current.content,
      existingHash: current.hash,
      status,
      mappingsUsed: generated.mappingsUsed,
      warnings: generated.warnings,
      artifact,
    });
  }

  async import(workspaceId: string, nodeId: string, input: ImportDesignMarkupInput): Promise<DesignImportResult> {
    const document = await designDocumentService.get(workspaceId, nodeId);
    if (document.revision !== input.baseRevision) throw new Error('The design changed before import. Reload and try again.');
    if (input.parentId && !document.elements.some((element) => element.id === input.parentId && (element.type === 'frame' || element.type === 'group'))) {
      throw new Error('The selected import parent is not available.');
    }
    const pageId = input.parentId
      ? document.elements.find((element) => element.id === input.parentId)!.pageId
      : document.activePageId;
    return designImportResultSchema.parse(importMarkupToDesign({
      ...input,
      pageId,
      startOrder: Math.max(-1, ...document.elements.filter((element) => element.pageId === pageId).map((element) => element.order)) + 1,
      makeId: uuidv7,
    }));
  }

  async targets(workspaceId: string): Promise<DesignDeliveryTarget[]> {
    const [, nodes, device] = await Promise.all([
      this.workspace(workspaceId),
      workspaceRepository.listNodes(workspaceId, undefined, true),
      deviceService.snapshot(workspaceId, false),
    ]);
    const targets: DesignDeliveryTarget[] = nodes.filter((node) => node.type === 'portal').map((node) => ({
      kind: 'portal' as const,
      nodeId: node.id,
      title: node.title ?? 'Portal',
      available: true,
      detail: String((node.payload as { url?: string }).url ?? '') || null,
    }));
    targets.push({
      kind: 'device',
      nodeId: null,
      title: device.session?.deviceName ?? 'Mobile device',
      available: device.session?.status === 'streaming',
      detail: device.session ? `${device.session.platform} · ${device.session.deviceId}` : null,
    });
    return targets.map((target) => designDeliveryTargetSchema.parse(target));
  }

  async capture(workspaceId: string, input: CaptureDesignDeliveryInput): Promise<{ dataUrl: string; title: string }> {
    if (input.kind === 'portal') {
      const node = await workspaceRepository.getNode(input.nodeId);
      if (!node || node.workspaceId !== workspaceId || node.type !== 'portal') throw new Error('Portal not found in this workspace.');
      const command = portalService.enqueue(input.nodeId, 'screenshot', {}, workspaceId);
      const result = await portalService.waitResult(command.id, 15_000);
      const screenshot = result.ok && result.result && typeof result.result === 'object'
        ? (result.result as { dataUrl?: unknown }).dataUrl
        : null;
      if (typeof screenshot !== 'string' || !screenshot.startsWith('data:image/png;base64,')) throw new Error(result.error ?? 'The portal did not return a valid screenshot. Keep it open and try again.');
      return { dataUrl: screenshot, title: node.title ?? 'Portal' };
    }
    const response = await deviceService.execute(workspaceId, { command: 'screenshot' });
    if (response.result?.kind !== 'screenshot') throw new Error('The mobile device did not return a screenshot.');
    const workspace = await this.workspace(workspaceId);
    const root = await realpath(resolve(workspace.workingDir));
    const absolute = resolve(response.result.path);
    const distance = relative(root, absolute);
    if (distance === '..' || distance.startsWith(`..${sep}`) || isAbsolute(distance)) throw new Error('The device screenshot is outside this workspace.');
    const buffer = await readFile(absolute);
    if (buffer.length > 20 * 1024 * 1024) throw new Error('The device screenshot exceeds the 20 MB limit.');
    return { dataUrl: dataUrl(buffer), title: response.snapshot.session?.deviceName ?? 'Mobile device' };
  }
}

export const designDeliveryService = new DesignDeliveryService();
