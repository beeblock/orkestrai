import { relative } from 'node:path';
import type {
  CanvasNode,
  Workspace,
  WorkspaceSearchResult,
  WorkspaceSearchResultKind,
} from '../../domain/types.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { filesystemService } from './FilesystemService.js';
import { roleService } from './RoleService.js';
import { skillMarketService } from './SkillMarketService.js';
import { taskBoardService } from './TaskBoardService.js';
import { routineService } from './RoutineService.js';
import { designDocumentService } from './DesignDocumentService.js';
import { controlCenterRepository } from '../../infrastructure/repositories/ControlCenterRepository.js';
import { attentionRepository } from '../../infrastructure/repositories/AttentionRepository.js';
import { workspaceMemoryService } from './WorkspaceMemoryService.js';
import { huddleRepository } from '../../infrastructure/repositories/HuddleRepository.js';
import type { WorkspaceSearchDto } from '../dto/WorkspaceSearchDto.js';

const INDEX_TTL_MS = 15_000;
const INDEX_LIMIT_PER_WORKSPACE = 500;

type IndexedResult = Omit<WorkspaceSearchResult, 'score'> & {
  searchable: string;
};

type SearchOperators = {
  text: string;
  type: string | null;
  agent: string | null;
  workspace: string | null;
  status: string | null;
  hasError: boolean;
  before: number | null;
  after: number | null;
};

function normalize(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase();
}

function clip(value: unknown, limit = 180): string | null {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ');
  return text ? text.slice(0, limit) : null;
}

function nodeKind(node: CanvasNode): WorkspaceSearchResultKind {
  if (node.type === 'terminal') return 'agent';
  if (node.type === 'note') return 'note';
  return 'artifact';
}

function nodePreview(node: CanvasNode): string | null {
  const payload = node.payload as Record<string, unknown>;
  if (node.type === 'terminal') return clip([payload.provider, payload.role].filter(Boolean).join(' · '));
  if (node.type === 'note') return clip(payload.content);
  if (node.type === 'apiClient') {
    const requests = Array.isArray(payload.requests) ? payload.requests as Array<{ method?: string; name?: string; url?: string }> : [];
    return clip(requests.slice(0, 8).map((request) => [request.method, request.name, request.url].filter(Boolean).join(' ')).join(' · '));
  }
  return clip(payload.path ?? payload.url ?? payload.objective ?? payload.description);
}

function nodeAttachmentSearchText(node: CanvasNode): string {
  const attachments = (node.payload as { attachments?: Array<{ name?: string; path?: string | null; url?: string | null }> }).attachments;
  if (!Array.isArray(attachments)) return '';
  return attachments.flatMap((attachment) => [attachment.name, attachment.path, attachment.url]).filter(Boolean).join(' ');
}

function nodeContentSearchText(node: CanvasNode): string {
  if (node.type !== 'apiClient') return '';
  const requests = (node.payload as { requests?: Array<{ method?: string; name?: string; url?: string }> }).requests;
  return Array.isArray(requests)
    ? requests.flatMap((request) => [request.method, request.name, request.url]).filter(Boolean).join(' ')
    : '';
}

function indexed(input: Omit<WorkspaceSearchResult, 'score'>, extra: unknown[] = []): IndexedResult {
  return {
    ...input,
    searchable: normalize([input.title, input.subtitle, input.preview, ...extra].filter(Boolean).join(' ')),
  };
}

function parseDate(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseOperators(query: string): SearchOperators {
  const values = new Map<string, string>();
  const text = query.replace(/\b(type|agent|workspace|status|has|before|after):(?:"([^"]+)"|(\S+))/gi, (_match, key, quoted, plain) => {
    values.set(String(key).toLowerCase(), String(quoted ?? plain ?? '').trim());
    return ' ';
  }).replace(/\s+/g, ' ').trim();
  return {
    text: normalize(text),
    type: values.has('type') ? normalize(values.get('type')) : null,
    agent: values.has('agent') ? normalize(values.get('agent')) : null,
    workspace: values.has('workspace') ? normalize(values.get('workspace')) : null,
    status: values.has('status') ? normalize(values.get('status')) : null,
    hasError: normalize(values.get('has')) === 'error',
    before: parseDate(values.get('before') ?? null),
    after: parseDate(values.get('after') ?? null),
  };
}

function matchesOperators(result: IndexedResult, operators: SearchOperators): boolean {
  if (operators.text && !result.searchable.includes(operators.text)) return false;
  if (operators.type) {
    const haystack = normalize([result.kind, result.facets?.category].filter(Boolean).join(' '));
    if (!haystack.includes(operators.type)) return false;
  }
  if (operators.agent && !normalize(result.facets?.agent).includes(operators.agent)) return false;
  if (operators.workspace && !normalize(`${result.workspaceName} ${result.workspaceId}`).includes(operators.workspace)) return false;
  if (operators.status && !normalize(result.facets?.status).includes(operators.status)) return false;
  if (operators.hasError && result.facets?.severity !== 'error' && result.facets?.status !== 'failed' && !result.searchable.includes('error')) return false;
  const occurredAt = result.occurredAt ? Date.parse(result.occurredAt) : null;
  if (operators.before && (!occurredAt || occurredAt >= operators.before)) return false;
  if (operators.after && (!occurredAt || occurredAt <= operators.after)) return false;
  return true;
}

function score(result: IndexedResult, query: string, activeWorkspaceId: string | null): number {
  const title = normalize(result.title);
  const subtitle = normalize(result.subtitle);
  let value = title === query ? 1_000 : title.startsWith(query) ? 700 : title.includes(query) ? 450 : 200;
  if (subtitle.includes(query)) value += 80;
  if (result.workspaceId === activeWorkspaceId) value += 60;
  if (result.kind === 'agent' || result.kind === 'task') value += 20;
  return value;
}

export class WorkspaceSearchService {
  private index: IndexedResult[] = [];
  private indexedAt = 0;
  private indexing: Promise<IndexedResult[]> | null = null;

  async search(dto: WorkspaceSearchDto): Promise<WorkspaceSearchResult[]> {
    const operators = parseOperators(dto.query.replace(/^content:/i, '').trim());
    const normalizedQuery = operators.text;
    if (!normalizedQuery && !operators.type && !operators.agent && !operators.workspace && !operators.status && !operators.hasError && !operators.before && !operators.after) return [];
    let index = await this.getIndex();
    let indexedMatches = index.filter((result) => matchesOperators(result, operators));
    // A write can happen immediately after the last cached lookup. Refresh on a
    // miss so newly created tasks/nodes are discoverable without waiting 15 s.
    if (!indexedMatches.length && this.indexedAt) {
      index = await this.buildIndex();
      indexedMatches = index.filter((result) => matchesOperators(result, operators));
    }
    const matches = indexedMatches
      .map(({ searchable: _searchable, ...result }) => ({
        ...result,
        score: score({ ...result, searchable: '' }, normalizedQuery || normalize(result.title), dto.workspaceId),
      }));

    if (dto.includeFiles && dto.workspaceId && normalizedQuery.length >= 2) {
      const workspace = await workspaceRepository.getWorkspace(dto.workspaceId);
      if (workspace) {
        const byContent = /^content:/i.test(dto.query);
        const files = await filesystemService.search(dto.workspaceId, dto.query.replace(/^content:/i, '').trim(), {
          byContent,
          limit: Math.min(30, dto.limit),
        }).catch(() => []);
        for (const file of files) {
          const path = relative(workspace.workingDir, file.path);
          matches.push({
            id: `file:${workspace.id}:${path}:${file.line ?? 0}`,
            kind: 'file',
            title: path.split(/[\\/]/).at(-1) ?? path,
            subtitle: file.line ? `${path}:${file.line}` : path,
            preview: clip(file.preview),
            workspaceId: workspace.id,
            workspaceName: workspace.name,
            nodeId: null,
            taskId: null,
            path,
            route: `/canvas?workspace=${workspace.id}`,
            score: 360 + (file.preview ? 30 : 0),
          });
        }
      }
    }

    return matches
      .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
      .slice(0, dto.limit);
  }

  private async getIndex(): Promise<IndexedResult[]> {
    if (this.indexedAt && Date.now() - this.indexedAt < INDEX_TTL_MS) return this.index;
    if (this.indexing) return this.indexing;
    this.indexing = this.buildIndex().finally(() => {
      this.indexing = null;
    });
    return this.indexing;
  }

  private async buildIndex(): Promise<IndexedResult[]> {
    const workspaces = await workspaceRepository.listWorkspaces();
    const groups = await Promise.all(workspaces.map((workspace) => this.indexWorkspace(workspace)));
    this.index = groups.flat();
    this.indexedAt = Date.now();
    return this.index;
  }

  private async indexWorkspace(workspace: Workspace): Promise<IndexedResult[]> {
    const results: IndexedResult[] = [indexed({
      id: `workspace:${workspace.id}`,
      kind: 'workspace',
      title: workspace.name,
      subtitle: workspace.workingDir,
      preview: clip(workspace.instructions),
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      nodeId: null,
      taskId: null,
      path: null,
      route: `/canvas?workspace=${workspace.id}`,
    })];
    const [nodes, tasks, roles, skills, automations, activity, envelopes, attention, memory, huddles] = await Promise.all([
      workspaceRepository.listNodes(workspace.id).catch(() => []),
      taskBoardService.list(workspace.id).catch(() => []),
      roleService.list(workspace.id).catch(() => []),
      skillMarketService.listInstalled(workspace.id).catch(() => []),
      routineService.list(workspace.id).catch(() => []),
      controlCenterRepository.listActivity(workspace.id, 250).catch(() => []),
      controlCenterRepository.listEnvelopes(workspace.id, 150).catch(() => []),
      attentionRepository.list({ workspaceId: workspace.id, includeResolved: true, limit: 150 }).catch(() => []),
      workspaceMemoryService.list(workspace.id, { includeHistory: true, limit: 300 }).catch(() => []),
      huddleRepository.list(workspace.id).catch(() => []),
    ]);
    const taskBoardNode = nodes.find((node) => node.type === 'tasks');
    const nodeTitles = new Map(nodes.map((node) => [node.id, node.title ?? node.type]));

    for (const node of nodes.slice(0, INDEX_LIMIT_PER_WORKSPACE)) {
      if (node.type === 'group' || node.type === 'shape') continue;
      const title = node.title || node.type;
      const preview = nodePreview(node);
      results.push(indexed({
        id: `node:${node.id}`,
        kind: nodeKind(node),
        title,
        subtitle: workspace.name,
        preview,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        nodeId: node.id,
        taskId: null,
        path: null,
        route: `/terminal?workspace=${workspace.id}&node=${node.id}`,
      }, [node.type, (node.payload as Record<string, unknown>).provider, nodeAttachmentSearchText(node), nodeContentSearchText(node)]));
    }

    const designDocuments = await Promise.all(nodes
      .filter((node) => node.type === 'design')
      .map(async (node) => ({ node, document: await designDocumentService.get(workspace.id, node.id).catch(() => null) })));
    const { creativeStoryboardService } = await import('$lib/modules/creative-media/application/services/CreativeStoryboardService.js');
    for (const node of nodes.filter(item => item.type === 'storyboard')) {
      const board = await creativeStoryboardService.read(workspace.id, node.id).catch(() => null);
      for (const scene of board?.storyboard.document.scenes ?? []) results.push(indexed({
        id: `storyboard-scene:${node.id}:${scene.id}`, kind: 'artifact', title: scene.title,
        subtitle: `${workspace.name} · ${board!.storyboard.document.title}`, preview: clip(scene.direction),
        workspaceId: workspace.id, workspaceName: workspace.name, nodeId: node.id, taskId: null, path: null,
        route: `/terminal?workspace=${workspace.id}&node=${node.id}`,
      }, ['storyboard scene cena escena', scene.direction, scene.dialogue, scene.language]));
    }
    for (const { node, document } of designDocuments) {
      if (!document) continue;
      const route = `/terminal?workspace=${workspace.id}&node=${node.id}`;
      for (const component of document.components.slice(0, INDEX_LIMIT_PER_WORKSPACE)) {
        results.push(indexed({
          id: `design-component:${node.id}:${component.id}`,
          kind: 'artifact',
          title: component.name,
          subtitle: `${workspace.name} · ${document.name}`,
          preview: clip(component.description || component.key),
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          nodeId: node.id,
          taskId: null,
          path: null,
          route,
        }, ['design component componente componente de diseño', component.key, Object.values(component.variantValues), component.codeConnect?.path]));
      }
      for (const variable of document.variables.slice(0, INDEX_LIMIT_PER_WORKSPACE)) {
        const collection = document.variableCollections.find((candidate) => candidate.id === variable.collectionId);
        results.push(indexed({
          id: `design-variable:${node.id}:${variable.id}`,
          kind: 'artifact',
          title: variable.name,
          subtitle: `${workspace.name} · ${collection?.name ?? document.name}`,
          preview: clip(variable.description || variable.type),
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          nodeId: node.id,
          taskId: null,
          path: null,
          route,
        }, ['design token variável variable', variable.type, collection?.codeSource?.path]));
      }
      for (const link of document.figmaLinks.slice(0, INDEX_LIMIT_PER_WORKSPACE)) {
        results.push(indexed({
          id: `design-figma:${node.id}:${link.id}`,
          kind: 'artifact',
          title: link.fileName,
          subtitle: `${workspace.name} · ${document.name}`,
          preview: clip(link.url),
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          nodeId: node.id,
          taskId: null,
          path: null,
          route,
        }, ['figma design source origem fuente linked sync', link.sourceNodeIds]));
      }
      for (const artifact of document.codeArtifacts.slice(0, INDEX_LIMIT_PER_WORKSPACE)) {
        results.push(indexed({
          id: `design-code:${node.id}:${artifact.id}`,
          kind: 'artifact',
          title: artifact.name,
          subtitle: `${workspace.name} · ${document.name}`,
          preview: clip(artifact.path),
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          nodeId: node.id,
          taskId: null,
          path: artifact.path,
          route,
        }, ['generated code codigo generado', artifact.framework, artifact.path, artifact.componentMappings]));
      }
      for (const flow of document.prototypeFlows.slice(0, INDEX_LIMIT_PER_WORKSPACE)) {
        const interactions = document.prototypeInteractions.filter((interaction) => interaction.sourceElementId === flow.startFrameId);
        results.push(indexed({
          id: `design-prototype:${node.id}:${flow.id}`,
          kind: 'artifact',
          title: flow.name,
          subtitle: `${workspace.name} · ${document.name}`,
          preview: clip(flow.description || `${interactions.length} interactions`),
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          nodeId: node.id,
          taskId: null,
          path: null,
          route,
        }, ['prototype prototipo prototipo flow fluxo flujo interaction interacao interaccion', interactions.map((interaction) => interaction.action.type)]));
      }
      for (const token of document.motionTokens.slice(0, INDEX_LIMIT_PER_WORKSPACE)) {
        results.push(indexed({
          id: `design-motion:${node.id}:${token.id}`,
          kind: 'artifact',
          title: token.name,
          subtitle: `${workspace.name} · ${document.name}`,
          preview: `${token.durationMs} ms`,
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          nodeId: node.id,
          taskId: null,
          path: null,
          route,
        }, ['motion animation animacao animacion easing timeline keyframe', token.easing]));
      }
    }

    for (const task of tasks.slice(0, INDEX_LIMIT_PER_WORKSPACE)) {
      results.push(indexed({
        id: `task:${task.id}`,
        kind: 'task',
        title: task.title,
        subtitle: `${workspace.name} · ${task.status}`,
        preview: clip(task.description),
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        nodeId: taskBoardNode?.id ?? null,
        taskId: task.id,
        path: null,
        route: taskBoardNode
          ? `/terminal?workspace=${workspace.id}&node=${taskBoardNode.id}`
          : `/canvas?workspace=${workspace.id}`,
      }, [
        task.assigneeTitle,
        task.status,
        ...task.attachments.flatMap((attachment) => [attachment.name, attachment.path, attachment.url]),
      ]));
    }

    for (const role of roles) {
      results.push(indexed({
        id: `role:${workspace.id}:${role.slug}`,
        kind: 'role',
        title: role.name,
        subtitle: workspace.name,
        preview: clip(role.prompt),
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        nodeId: null,
        taskId: null,
        path: null,
        route: `/canvas?workspace=${workspace.id}`,
      }));
    }

    for (const skill of skills) {
      results.push(indexed({
        id: `skill:${workspace.id}:${skill.skillId}`,
        kind: 'skill',
        title: skill.name,
        subtitle: workspace.name,
        preview: clip(skill.description),
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        nodeId: null,
        taskId: null,
        path: null,
        route: `/skills?workspace=${workspace.id}`,
      }, [skill.skillId]));
    }
    for (const automation of automations) {
      results.push(indexed({
        id: `automation:${automation.id}`,
        kind: 'automation',
        title: automation.name,
        subtitle: `${workspace.name} · ${automation.triggerType}`,
        preview: clip(automation.prompt || automation.actionConfig.message || automation.actionConfig.title),
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        nodeId: `workbench-automations:${workspace.id}`,
        taskId: null,
        path: null,
        route: `/terminal?workspace=${workspace.id}&node=${encodeURIComponent(`workbench-automations:${workspace.id}`)}`,
      }, [automation.triggerType, automation.actionType, JSON.stringify(automation.triggerConfig)]));
    }

    for (const event of activity) {
      const agent = nodeTitles.get(event.nodeId) ?? event.nodeId.slice(0, 8);
      results.push(indexed({
        id: `activity:${event.id}`,
        kind: 'activity',
        title: event.objectTitle ?? event.action ?? event.verb,
        subtitle: `${workspace.name} · ${agent}`,
        preview: clip(event.outcome ?? event.metadata.taskTitle ?? event.state),
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        nodeId: event.nodeId,
        taskId: event.taskId,
        path: null,
        route: `/canvas?workspace=${workspace.id}&node=${event.nodeId}${event.taskId ? `&task=${event.taskId}` : ''}`,
        occurredAt: event.createdAt,
        facets: { agent, category: event.category, status: event.state, severity: event.severity },
      }, [event.category, event.verb, event.objectType, event.objectId, event.sourceType, event.sourceId, event.correlationId, JSON.stringify(event.metadata)]));
    }

    for (const message of envelopes) {
      const from = message.fromNodeId ? nodeTitles.get(message.fromNodeId) ?? message.fromNodeId.slice(0, 8) : null;
      const to = nodeTitles.get(message.toNodeId) ?? message.toNodeId.slice(0, 8);
      results.push(indexed({
        id: `message:${message.id}`,
        kind: 'message',
        title: clip(message.content, 96) ?? message.id,
        subtitle: `${workspace.name} · ${from ? `${from} → ` : ''}${to}`,
        preview: clip(message.reply ?? message.error),
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        nodeId: message.toNodeId,
        taskId: null,
        path: null,
        route: `/canvas?workspace=${workspace.id}&node=${message.toNodeId}`,
        occurredAt: message.updatedAt,
        facets: { agent: `${from ?? ''} ${to}`.trim(), category: 'message', status: message.state, severity: message.state === 'failed' ? 'error' : 'info' },
      }, [message.kind, message.correlationId, message.dedupKey, message.error]));
    }

    for (const item of attention) {
      const agent = item.nodeId ? nodeTitles.get(item.nodeId) ?? item.nodeId.slice(0, 8) : null;
      results.push(indexed({
        id: `attention:${item.id}`,
        kind: 'attention',
        title: item.title,
        subtitle: `${workspace.name} · ${item.status}`,
        preview: clip(item.body),
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        nodeId: item.nodeId,
        taskId: item.taskId,
        path: null,
        route: `/canvas?workspace=${workspace.id}${item.nodeId ? `&node=${item.nodeId}` : ''}${item.taskId ? `&task=${item.taskId}` : ''}`,
        occurredAt: item.updatedAt,
        facets: { agent, category: item.category, status: item.status, severity: item.severity },
      }, [item.sourceType, item.sourceId, item.correlationId]));
    }
    for (const item of memory) {
      results.push(indexed({
        id: `memory:${item.id}`,
        kind: 'memory',
        title: item.title,
        subtitle: `${workspace.name} · ${item.kind} · v${item.revision}`,
        preview: clip(item.content),
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        nodeId: null,
        taskId: null,
        path: null,
        route: `/terminal?workspace=${workspace.id}&node=workbench-memory:${workspace.id}`,
        occurredAt: item.updatedAt,
        facets: { category: 'memory', status: item.status, severity: 'info' },
      }, [item.kind, item.status, ...item.tags, ...item.sources.flatMap((source) => [source.type, source.label, source.uri, source.excerpt])]));
    }
    for (const item of huddles) {
      const detail = await huddleRepository.find(workspace.id, item.id).catch(() => null);
      results.push(indexed({
        id: `huddle:${item.id}`,
        kind: 'huddle',
        title: item.title,
        subtitle: `${workspace.name} · ${item.status}`,
        preview: clip(item.agenda ?? detail?.turns.map((turn) => `${turn.speakerName}: ${turn.text}`).join(' ')),
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        nodeId: null,
        taskId: item.linkedTaskId,
        path: null,
        route: `/terminal?workspace=${workspace.id}&node=workbench-huddles:${workspace.id}`,
        occurredAt: item.updatedAt,
        facets: { category: 'huddle', status: item.status, severity: 'info' },
      }, [item.agenda, ...(detail?.participants.map((participant) => participant.displayName) ?? []), ...(detail?.turns.map((turn) => turn.text) ?? [])]));
    }
    return results;
  }
}

export const workspaceSearchService = new WorkspaceSearchService();
