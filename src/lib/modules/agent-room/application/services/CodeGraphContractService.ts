import { createHash } from 'node:crypto';
import { persistedApiClientRequestSchema } from '../../contracts/schemas/apiClient.schema.js';
import type {
  CodeGraphContractConflict,
  CodeGraphContractMatch,
  CodeGraphContractOptions,
  CodeGraphContractSnapshot,
  CodeGraphEdge,
  CodeGraphSymbol,
} from '../../domain/code-graph.js';
import { normalizeCodeGraphContractPath as normalizeContractPath } from '../../domain/code-graph-contract.js';
import { codeGraphRepository } from '../../infrastructure/repositories/CodeGraphRepository.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { codeGraphIndexService } from './CodeGraphIndexService.js';

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

function text(value: unknown, limit: number): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function descriptor(symbol: CodeGraphSymbol): { method: string; path: string } | null {
  const method = text(symbol.metadata.method, 10).toUpperCase();
  const path = normalizeContractPath(symbol.metadata.path);
  return method && path ? { method, path } : null;
}

function pathsCompatible(left: string, right: string): boolean {
  const leftSegments = left.split('/').filter(Boolean);
  const rightSegments = right.split('/').filter(Boolean);
  return leftSegments.length === rightSegments.length && leftSegments.every((segment, index) => (
    segment === rightSegments[index] || segment === '{param}' || rightSegments[index] === '{param}'
  ));
}

function artifactRequest(
  workspaceId: string,
  node: { id: string; title: string | null },
  request: { id: string; name: string; method: string; url: string },
  path: string,
): CodeGraphSymbol {
  const id = `artifact:${hash(`${workspaceId}:${node.id}:${request.id}`)}`;
  return {
    id,
    workspaceId,
    projectId: `artifact:${node.id}`,
    projectName: text(node.title, 200) || 'API Client',
    projectRelativePath: null,
    revisionId: 'live',
    fileId: null,
    path: null,
    language: null,
    parentSymbolId: null,
    kind: 'apiRequest',
    name: `${request.method} ${path}`.slice(0, 300),
    qualifiedName: `api-client:${node.id}:${request.id}`.slice(0, 1_000),
    signature: `${request.method} ${path}`.slice(0, 1_000),
    documentation: null,
    modifiers: ['canvas'],
    metadata: {
      contractType: 'request',
      source: 'apiClient',
      nodeId: node.id,
      requestId: request.id,
      requestName: text(request.name, 300),
      method: request.method,
      path,
    },
    exported: false,
    startLine: null,
    startColumn: null,
    endLine: null,
    endColumn: null,
  };
}

function matchEdge(workspaceId: string, request: CodeGraphSymbol, endpoint: CodeGraphSymbol, match: CodeGraphContractMatch): CodeGraphEdge {
  return {
    id: match.id,
    workspaceId,
    projectId: request.projectId,
    revisionId: 'live',
    sourceSymbolId: request.id,
    targetSymbolId: endpoint.id,
    kind: request.modifiers.includes('generated') && endpoint.metadata.framework === 'openapi' ? 'generatedFrom' : 'matches',
    confidence: match.confidence,
    sitePath: request.path,
    siteLine: request.startLine,
    siteColumn: request.startColumn,
    metadata: { reason: match.reason, crossProject: match.crossProject },
  };
}

function gatewayEdge(workspaceId: string, gateway: CodeGraphSymbol, endpoint: CodeGraphSymbol): CodeGraphEdge {
  return {
    id: `contract-gateway:${hash(`${gateway.id}:${endpoint.id}`)}`,
    workspaceId,
    projectId: gateway.projectId,
    revisionId: 'live',
    sourceSymbolId: gateway.id,
    targetSymbolId: endpoint.id,
    kind: 'routesTo',
    confidence: 85,
    sitePath: gateway.path,
    siteLine: gateway.startLine,
    siteColumn: gateway.startColumn,
    metadata: { reason: 'gateway-prefix', crossProject: gateway.projectId !== endpoint.projectId },
  };
}

export class CodeGraphContractService {
  async analyze(workspaceId: string, options: CodeGraphContractOptions = {}): Promise<CodeGraphContractSnapshot> {
    await codeGraphIndexService.status(workspaceId);
    const limit = Math.min(Math.max(options.limit ?? 500, 50), 1_000);
    const staticGraph = await codeGraphRepository.contractGraph(workspaceId, limit);
    const endpoints = staticGraph.nodes.filter((node) => node.kind === 'endpoint');
    const staticRequests = staticGraph.nodes.filter((node) => node.kind === 'apiRequest');
    const schemas = staticGraph.nodes.filter((node) => node.kind === 'schema');
    const gateways = staticGraph.nodes.filter((node) => node.kind === 'gateway');
    const artifactRequests = await this.apiClientRequests(workspaceId, Math.max(0, limit - staticRequests.length));
    const requests = [...staticRequests, ...artifactRequests].slice(0, limit);
    const gatewayPrefixes = gateways.flatMap((gateway) => {
      const prefix = normalizeContractPath(gateway.metadata.pathPrefix);
      return prefix ? [{ gateway, prefix }] : [];
    });

    const matches: CodeGraphContractMatch[] = [];
    const matchedRequests = new Set<string>();
    const matchedEndpoints = new Set<string>();
    for (const request of requests) {
      const source = descriptor(request);
      if (!source) continue;
      for (const endpoint of endpoints) {
        const target = descriptor(endpoint);
        if (!target || source.method !== target.method) continue;
        let reason: CodeGraphContractMatch['reason'] | null = pathsCompatible(source.path, target.path) ? 'exact' : null;
        const gateway = reason ? null : gatewayPrefixes.find(({ prefix }) => pathsCompatible(joinPrefix(prefix, target.path), source.path))?.gateway ?? null;
        if (gateway) reason = 'gateway-prefix';
        if (!reason) continue;
        const match: CodeGraphContractMatch = {
          id: `contract-match:${hash(`${request.id}:${endpoint.id}:${reason}`)}`,
          requestSymbolId: request.id,
          endpointSymbolId: endpoint.id,
          gatewaySymbolId: gateway?.id ?? null,
          confidence: reason === 'exact' ? 100 : 85,
          reason,
          crossProject: request.projectId !== endpoint.projectId,
        };
        matches.push(match);
        matchedRequests.add(request.id);
        matchedEndpoints.add(endpoint.id);
        if (matches.length >= limit * 4) break;
      }
      if (matches.length >= limit * 4) break;
    }

    const conflicts = this.conflicts(endpoints);
    const graphNodes = [...new Map([...staticGraph.nodes, ...artifactRequests].map((node) => [node.id, node])).values()];
    const endpointById = new Map(endpoints.map((endpoint) => [endpoint.id, endpoint]));
    const requestById = new Map(requests.map((request) => [request.id, request]));
    const gatewayById = new Map(gateways.map((gateway) => [gateway.id, gateway]));
    const dynamicEdges = [...new Map(matches.flatMap((match) => {
      const request = requestById.get(match.requestSymbolId);
      const endpoint = endpointById.get(match.endpointSymbolId);
      if (!request || !endpoint) return [];
      const gateway = match.gatewaySymbolId ? gatewayById.get(match.gatewaySymbolId) : null;
      return [
        matchEdge(workspaceId, request, endpoint, match),
        ...(gateway ? [gatewayEdge(workspaceId, gateway, endpoint)] : []),
      ];
    }).map((edge) => [edge.id, edge])).values()];
    const includeGraph = options.includeGraph ?? false;
    return {
      generatedAt: new Date().toISOString(),
      endpoints,
      requests,
      schemas,
      gateways,
      matches,
      conflicts,
      unmatchedRequestIds: requests.filter((request) => !matchedRequests.has(request.id)).map((request) => request.id),
      unmatchedEndpointIds: endpoints.filter((endpoint) => !matchedEndpoints.has(endpoint.id)).map((endpoint) => endpoint.id),
      graph: {
        nodes: includeGraph ? graphNodes : [],
        edges: includeGraph ? [...staticGraph.edges, ...dynamicEdges] : [],
        truncated: staticGraph.truncated || requests.length >= limit || matches.length >= limit * 4,
        depth: 1,
        centerSymbolId: null,
      },
      truncated: staticGraph.truncated || requests.length >= limit || matches.length >= limit * 4,
    };
  }

  private async apiClientRequests(workspaceId: string, limit: number): Promise<CodeGraphSymbol[]> {
    if (!limit) return [];
    const output: CodeGraphSymbol[] = [];
    for (const node of await workspaceRepository.listNodes(workspaceId)) {
      if (node.type !== 'apiClient') continue;
      const rawRequests = (node.payload as { requests?: unknown } | null)?.requests;
      if (!Array.isArray(rawRequests)) continue;
      for (const rawRequest of rawRequests.slice(0, 500)) {
        const parsed = persistedApiClientRequestSchema.safeParse(rawRequest);
        if (!parsed.success) continue;
        const request = parsed.data;
        if (!['http', 'graphql'].includes(request.protocol)) continue;
        const path = normalizeContractPath(request.url);
        if (!path) continue;
        output.push(artifactRequest(workspaceId, node, request, path));
        if (output.length >= limit) return output;
      }
    }
    return output;
  }

  private conflicts(endpoints: CodeGraphSymbol[]): CodeGraphContractConflict[] {
    const groups = new Map<string, CodeGraphSymbol[]>();
    for (const endpoint of endpoints) {
      const value = descriptor(endpoint);
      if (!value) continue;
      const key = `${value.method} ${value.path}`;
      groups.set(key, [...(groups.get(key) ?? []), endpoint]);
    }
    return [...groups.entries()].flatMap(([identity, candidates]) => {
      const projects = new Set(candidates.map((candidate) => candidate.projectId));
      if (candidates.length < 2 || projects.size < 2) return [];
      const space = identity.indexOf(' ');
      return [{
        id: `contract-conflict:${hash(identity)}`,
        method: identity.slice(0, space),
        path: identity.slice(space + 1),
        endpointSymbolIds: candidates.map((candidate) => candidate.id).slice(0, 50),
        projectNames: [...new Set(candidates.map((candidate) => candidate.projectName ?? candidate.projectId))].slice(0, 20),
      }];
    }).slice(0, 200);
  }
}

function joinPrefix(prefix: string, path: string): string {
  return normalizeContractPath(`${prefix}/${path}`) ?? path;
}

export const codeGraphContractService = new CodeGraphContractService();
