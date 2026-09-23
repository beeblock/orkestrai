import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, stat, unlink } from 'node:fs/promises';
import { basename, dirname, extname } from 'node:path';
import { uuidv7 } from '@beeblock/svelar/support';
import { knowledgeNormalize, knowledgeTags, knowledgeTerms, knowledgeTextTruncated, knowledgeWikiLinks, textPassages, type KnowledgeDocument, type KnowledgeItem, type KnowledgeLink, type KnowledgeResult } from '../../domain/knowledge.js';
import type { CanvasNode } from '../../domain/types.js';
import { AgentBoardTask } from '../../domain/models/AgentBoardTask.js';
import { AgentFloor } from '../../domain/models/AgentFloor.js';
import { knowledgeRepository } from '../../infrastructure/repositories/KnowledgeRepository.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { workspaceMemoryRepository } from '../../infrastructure/repositories/WorkspaceMemoryRepository.js';
import { extractKnowledgeDocument } from '../../infrastructure/knowledge/DocumentExtractor.js';
import { workspacePathService } from './WorkspacePathService.js';
import { findFreeCanvasPosition } from '../../domain/canvas-placement.js';
import { assertKnowledgePath } from '../../domain/knowledge-files.js';
import { leaseKnowledgeWatch } from '../../infrastructure/knowledge/KnowledgeFileWatch.js';
import type { KnowledgeCommandDto } from '../dto/KnowledgeCommandDto.js';
import type { KnowledgeQuery } from '../../contracts/schemas/knowledge.schema.js';

export const MAX_KNOWLEDGE_FILE_BYTES = 25 * 1024 * 1024;
const locks = new Map<string, Promise<unknown>>();
const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const broadcast = (workspaceId: string) => (globalThis as { __orkestraiBroadcast?: (frame: Record<string, unknown>) => void }).__orkestraiBroadcast?.({ type: 'workspaceChanged', workspaceId });

export class KnowledgeService {
  async watch(workspaceId: string) {
    const workspace = await this.workspace(workspaceId);
    const paths: string[] = [];
    for (const node of (await workspaceRepository.listNodes(workspaceId)).slice(0, 2000)) {
      const path = (node.payload as Record<string, unknown>).path;
      if (node.type !== 'document' || typeof path !== 'string') continue;
      try {
        assertKnowledgePath(path);
        // Writable resolution also covers a deleted file that may be recreated.
        const full = await workspacePathService.resolveWritable(workspace, path);
        assertKnowledgePath((await workspacePathService.reference(workspace, full)) ?? path);
        paths.push(full);
      } catch { /* Unauthorized/missing roots remain visible as missing sources. */ }
    }
    await leaseKnowledgeWatch(workspaceId, paths, workspace.runtimeKind === 'wsl' || (process.platform === 'win32' && workspace.workingDir.startsWith('\\\\')));
  }

  private async workspace(id: string) {
    const workspace = await workspaceRepository.getWorkspace(id);
    if (!workspace) throw new Error('knowledge_workspace_missing');
    return workspace;
  }

  async upload(workspaceId: string, file: File, placement: { x?: number; y?: number; floorId?: string | null } = {}): Promise<CanvasNode> {
    if (!file || !file.size || file.size > MAX_KNOWLEDGE_FILE_BYTES) throw new Error('knowledge_file_size');
    assertKnowledgePath(file.name);
    const workspace = await this.workspace(workspaceId);
    const filename = file.name.replace(/[^\p{L}\p{N}._-]/gu, '-').replace(/^[.-]+/, '').slice(0, 140) || 'document';
    const path = `.orkestrai/knowledge/${uuidv7()}-${filename}`;
    const destination = await workspacePathService.resolveWritable(workspace, path);
    await mkdir(dirname(destination), { recursive: true });
    await workspacePathService.resolveWritable(workspace, path);
    const handle = await open(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    try { await handle.writeFile(new Uint8Array(await file.arrayBuffer())); }
    finally { await handle.close(); }
    try { return await this.attach(workspaceId, { command: 'attach', path, title: file.name.slice(0, 180), ...placement }); }
    catch (error) { await unlink(destination); throw error; }
  }

  private async attach(workspaceId: string, input: Extract<KnowledgeCommandDto['input'], { command: 'attach' }>) {
    const workspace = await this.workspace(workspaceId);
    assertKnowledgePath(input.path);
    const absolute = await workspacePathService.resolveExisting(workspace, input.path);
    assertKnowledgePath((await workspacePathService.reference(workspace, absolute)) ?? input.path);
    const info = await stat(absolute);
    if (!info.isFile() || info.size > MAX_KNOWLEDGE_FILE_BYTES) throw new Error('knowledge_file_size');
    const nodes = await workspaceRepository.listNodes(workspaceId);
    if (input.floorId && (await AgentFloor.find(input.floorId))?.getAttribute('workspace_id') !== workspaceId) throw new Error('knowledge_floor_missing');
    const position = findFreeCanvasPosition(nodes.filter(node => (node.floorId ?? null) === (input.floorId ?? null)), { x: input.x ?? 80, y: input.y ?? 80, width: 520, height: 460 });
    const node = await workspaceRepository.createNode({ workspaceId, type: 'document', title: input.title ?? input.path.split('/').at(-1), ...position, width: 520, height: 460, floorId: input.floorId, payload: { path: input.path, knowledgeTags: [] } });
    broadcast(workspaceId);
    return node;
  }

  async execute(dto: KnowledgeCommandDto) {
    await this.workspace(dto.workspaceId);
    if (dto.input.command === 'create') {
      const input = dto.input;
      if (input.floorId && (await AgentFloor.find(input.floorId))?.getAttribute('workspace_id') !== dto.workspaceId) throw new Error('knowledge_floor_missing');
      const nodes = await workspaceRepository.listNodes(dto.workspaceId);
      const position = findFreeCanvasPosition(nodes.filter(node => (node.floorId ?? null) === (input.floorId ?? null)), { x: input.x ?? 80, y: input.y ?? 80, width: 960, height: 620 });
      const node = await workspaceRepository.createNode({ workspaceId: dto.workspaceId, type: 'knowledge', title: dto.input.title, ...position, width: 960, height: 620, floorId: dto.input.floorId, payload: {} });
      broadcast(dto.workspaceId);
      return node;
    }
    if (dto.input.command === 'attach') {
      const author = dto.authorNodeId ? await workspaceRepository.getNode(dto.authorNodeId) : null;
      if (dto.authorNodeId && (!author || author.workspaceId !== dto.workspaceId || author.type !== 'terminal')) throw new Error('knowledge_source_missing');
      const node = await this.attach(dto.workspaceId, dto.input);
      if (author) { await workspaceRepository.createEdge({ workspaceId: dto.workspaceId, sourceNodeId: author.id, targetNodeId: node.id }); broadcast(dto.workspaceId); }
      return node;
    }
    if (dto.input.command === 'tags') {
      const node = await workspaceRepository.getNode(dto.input.nodeId);
      if (!node || node.workspaceId !== dto.workspaceId) throw new Error('knowledge_source_missing');
      await workspaceRepository.updateNode(node.id, { payload: { ...node.payload, knowledgeTags: dto.input.tags } });
      broadcast(dto.workspaceId);
    }
    return this.search(dto.workspaceId, { query: '', limit: 150 }, true);
  }

  private async snapshot(workspaceId: string, force = false): Promise<{ documents: KnowledgeDocument[]; links: KnowledgeLink[]; truncated: boolean }> {
    const running = locks.get(workspaceId);
    if (running && !force) return running as Promise<{ documents: KnowledgeDocument[]; links: KnowledgeLink[]; truncated: boolean }>;
    const previous = running ?? Promise.resolve();
    const work = previous.catch(() => undefined).then(() => this.synchronize(workspaceId, force));
    locks.set(workspaceId, work);
    try { return await work; }
    finally { if (locks.get(workspaceId) === work) locks.delete(workspaceId); }
  }

  private async synchronize(workspaceId: string, force: boolean) {
    const workspace = await this.workspace(workspaceId);
    const existing = new Map((await knowledgeRepository.list(workspaceId)).map(doc => [doc.id, doc]));
    const nodes = await workspaceRepository.listNodes(workspaceId);
    const edges = await workspaceRepository.listEdges(workspaceId);
    const tasks = await AgentBoardTask.query().where('workspace_id', workspaceId).limit(2000).get();
    const memories = await workspaceMemoryRepository.list(workspaceId);
    const documents: KnowledgeDocument[] = [];
    const links: KnowledgeLink[] = [];
    const put = async (input: Omit<KnowledgeDocument, 'revision' | 'indexedAt'>) => {
      const old = existing.get(input.id);
      const unchanged = old && old.fingerprint === input.fingerprint && old.hash === input.hash && old.status === input.status && old.title === input.title && old.truncated === input.truncated && JSON.stringify(old.tags) === JSON.stringify(input.tags) && (old.passages === input.passages || JSON.stringify(old.passages) === JSON.stringify(input.passages));
      const doc: KnowledgeDocument = unchanged ? old : { ...input, revision: (old?.revision ?? 0) + 1, indexedAt: new Date().toISOString() };
      if (!unchanged) await knowledgeRepository.save(workspaceId, doc);
      documents.push(doc);
    };
    for (const node of nodes.slice(0, 2000)) {
      if (!['note', 'document', 'image', 'design', 'codeGraph'].includes(node.type)) continue;
      const payload = node.payload as Record<string, unknown>;
      const id = `node:${node.id}`;
      const title = node.title ?? node.type;
      const content = node.type === 'note' ? String(payload.content ?? '') : '';
      const base = { id, title, kind: (node.type === 'document' ? 'file' : node.type) as KnowledgeDocument['kind'], nodeId: node.id, path: typeof payload.path === 'string' ? payload.path : null, tags: knowledgeTags(content, payload.knowledgeTags) };
      if (node.type !== 'document') {
        await put({ ...base, hash: digest(content + title), fingerprint: digest(content + title), passages: textPassages(content || title), truncated: knowledgeTextTruncated(content), status: 'ready' });
        continue;
      }
      try {
        if (!base.path) throw new Error();
        assertKnowledgePath(base.path);
        const full = await workspacePathService.resolveExisting(workspace, base.path);
        assertKnowledgePath((await workspacePathService.reference(workspace, full)) ?? base.path);
        const handle = await open(full, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        try {
          const info = await handle.stat();
          if (!info.isFile() || info.size > MAX_KNOWLEDGE_FILE_BYTES) throw new Error();
          const fingerprint = digest(JSON.stringify([base.path, info.size, info.mtimeMs, info.ctimeMs]));
          const old = existing.get(id);
          if (!force && old?.fingerprint === fingerprint) { await put({ ...old, ...base, tags: knowledgeTags(old.passages.map(p => p.text).join('\n'), base.tags) }); continue; }
          const bytes = Buffer.alloc(info.size + 1);
          let read = 0;
          while (read < bytes.length) {
            const part = await handle.read(bytes, read, bytes.length - read, read);
            if (!part.bytesRead) break;
            read += part.bytesRead;
          }
          const after = await handle.stat();
          if (read !== info.size || after.mtimeMs !== info.mtimeMs || after.ctimeMs !== info.ctimeMs) throw new Error();
          const data = bytes.subarray(0, read);
          const extracted = await extractKnowledgeDocument(data, extname(base.path).slice(1).toLowerCase());
          await put({ ...base, ...extracted, fingerprint, hash: digest(data), tags: knowledgeTags(extracted.passages.map(p => p.text).join('\n'), base.tags) });
        } finally { await handle.close(); }
      } catch {
        await put({ ...base, status: 'missing', hash: '', fingerprint: `unavailable:${base.path}`, passages: [], truncated: false });
      }
    }
    for (const task of tasks) {
      const id = `task:${task.getAttribute('id')}`;
      const content = `${task.getAttribute('title')}\n${task.getAttribute('description') ?? ''}\n${task.getAttribute('status')}`;
      await put({ id, kind: 'task', title: String(task.getAttribute('title')), nodeId: null, path: null, tags: knowledgeTags(content), status: 'ready', hash: digest(content), fingerprint: digest(content), passages: textPassages(content), truncated: knowledgeTextTruncated(content) });
      const note = task.getAttribute('note_node_id');
      if (note) links.push({ source: id, target: `node:${note}`, kind: 'task' });
    }
    for (const memory of memories.slice(0, 1000)) {
      const id = `memory:${memory.id}`;
      await put({ id, kind: 'memory', title: memory.title, nodeId: null, path: null, tags: memory.tags, status: 'ready', hash: digest(memory.content), fingerprint: digest(memory.content), passages: textPassages(memory.content), truncated: knowledgeTextTruncated(memory.content) });
      for (const source of memory.sources) if (source.sourceId) links.push({ source: id, target: `${source.type === 'task' ? 'task' : 'node'}:${source.sourceId}`, kind: 'source' });
    }
    const ids = new Set(documents.map(doc => doc.id));
    for (const edge of edges) links.push({ source: `node:${edge.sourceNodeId}`, target: `node:${edge.targetNodeId}`, kind: 'canvas' });
    const titles = new Map<string, string[]>();
    for (const doc of documents) {
      const key = knowledgeNormalize(doc.title);
      titles.set(key, [...(titles.get(key) ?? []), doc.id]);
    }
    for (const doc of documents) for (const ref of knowledgeWikiLinks(doc.passages.map(p => p.text).join('\n'))) {
      const targets = ids.has(ref) ? [ref] : titles.get(knowledgeNormalize(ref)) ?? [];
      if (targets.length === 1 && targets[0] !== doc.id) links.push({ source: doc.id, target: targets[0], kind: 'wiki' });
    }
    for (const id of existing.keys()) if (!ids.has(id)) await knowledgeRepository.remove(workspaceId, id);
    return { documents, links: links.filter(link => ids.has(link.source) && ids.has(link.target)), truncated: nodes.length > 2000 || tasks.length >= 2000 || memories.length > 1000 };
  }

  async search(workspaceId: string, query: KnowledgeQuery, force = false): Promise<KnowledgeResult> {
    const snapshot = await this.snapshot(workspaceId, force);
    const terms = knowledgeTerms(query.query);
    const items: KnowledgeItem[] = [];
    for (const doc of snapshot.documents) {
      if ((query.kind && query.kind !== doc.kind) || (query.tag && !doc.tags.includes(query.tag.toLowerCase()))) continue;
      const title = knowledgeNormalize(`${doc.title} ${doc.tags.join(' ')}`);
      const full = knowledgeNormalize(`${title} ${doc.passages.map(p => p.text).join(' ')}`);
      if (terms.length && !terms.every(term => full.includes(term))) continue;
      const passage = doc.passages.map(p => ({ ...p, score: terms.filter(term => knowledgeNormalize(p.text).includes(term)).length })).sort((a, b) => b.score - a.score)[0];
      const score = terms.reduce((sum, term) => sum + (title.includes(term) ? 4 : 0), 0) + (passage?.score ?? 0);
      const { passages: _, fingerprint: __, ...summary } = doc;
      const hit = passage?.text ?? '';
      const at = terms.length ? Math.max(0, knowledgeNormalize(hit).indexOf(terms[0]) - 100) : 0;
      items.push({ ...summary, score, excerpt: hit.slice(at, at + 700), locator: passage?.locator ?? '' });
    }
    items.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
    return { items: items.slice(0, query.limit), links: snapshot.links, total: items.length, truncated: items.length > query.limit || snapshot.truncated, indexedAt: new Date().toISOString() };
  }

  async read(workspaceId: string, id: string) {
    let snapshot = await this.snapshot(workspaceId);
    let document = snapshot.documents.find(doc => doc.id === id);
    // A batch import can attach another node while the first extraction runs.
    // That shared snapshot predates the new node; read it after the lock settles.
    if (!document) { snapshot = await this.snapshot(workspaceId); document = snapshot.documents.find(doc => doc.id === id); }
    if (!document) throw new Error('knowledge_source_missing');
    return { document, links: snapshot.links.filter(link => link.source === id || link.target === id), trust: 'untrusted_source_content' as const };
  }

  async file(workspaceId: string, nodeId: string) {
    const workspace = await this.workspace(workspaceId);
    const node = await workspaceRepository.getNode(nodeId);
    const path = (node?.payload as Record<string, unknown>)?.path;
    if (!node || node.workspaceId !== workspaceId || node.type !== 'document' || typeof path !== 'string') throw new Error('knowledge_source_missing');
    assertKnowledgePath(path);
    const full = await workspacePathService.resolveExisting(workspace, path);
    assertKnowledgePath((await workspacePathService.reference(workspace, full)) ?? path);
    const handle = await open(full, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > MAX_KNOWLEDGE_FILE_BYTES) throw new Error('knowledge_file_size');
      const bytes = Buffer.alloc(info.size + 1);
      let count = 0;
      while (count < bytes.length) { const result = await handle.read(bytes, count, bytes.length - count, count); if (!result.bytesRead) break; count += result.bytesRead; }
      const after = await handle.stat();
      if (count !== info.size || after.mtimeMs !== info.mtimeMs || after.ctimeMs !== info.ctimeMs) throw new Error('knowledge_source_missing');
      return { name: basename(path), extension: extname(path).toLowerCase(), bytes: new Uint8Array(bytes.subarray(0, count)) };
    } finally { await handle.close(); }
  }
}
export const knowledgeService = new KnowledgeService();
