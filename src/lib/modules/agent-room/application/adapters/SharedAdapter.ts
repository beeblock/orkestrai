import type { AgentAdapter } from './types.js';
import type { AgentModelOption } from '../../domain/types.js';
export const sharedAdapter: AgentAdapter = {
  id: 'shared', bundled: true, displayName: 'Orkestrai', supportsResume: true, sessionStorage: 'orkestrai-jsonl',
  efforts: ['low','medium','high','xhigh','max','ultra'], profileStrategy: { kind: 'unsupported' }, setup: { docsUrl: 'https://orkestrai.app/docs' },
  imageWorkflowTool: { name: 'imagegen', normalizedName: 'mcp__guest__imagegen', workspaceReferences: true },
  async supportsImageWorkflows(value) {
    if (!value) return false; const [connectionId, offeringId] = value.split('/');
    const { modelAccessService } = await import('$lib/modules/model-access/application/services/ModelAccessService.js');
    const { connections } = await modelAccessService.status(); const connection = connections.find(item => item.id === connectionId && item.status === 'active' && item.state === 'connected');
    return Boolean(connection?.policy?.offerings.some(item => item.id === offeringId && item.providerId === 'codex' && item.images));
  },
  // This CLI ships with the app; received access controls models, not installation.
  async detect() { return { installed: true }; },
  interactiveCommand(options) { return { command: 'orkestrai', args: ['model-access-agent', ...(options?.model ? ['--model', options.model] : []), ...(options?.effort ? ['--effort', options.effort] : [])] }; },
  buildCommand(request) { return { command: 'orkestrai', args: ['model-access-agent','--once', ...(request.model ? ['--model', request.model] : []), ...(request.effort ? ['--effort', request.effort] : [])] }; },
  resumeArgs(id) { return id ? ['--session-id', id] : []; }, freshSessionArgs(id) { return ['--session-id', id]; },
  initialRoleArgs(role) { return ['--instructions', role.prompt]; },
  parseOutput(stdout) { return { content: stdout.trim() }; }, runMetadata() { return { inference: 'delegated', tools: 'local' }; },
  async listModels(): Promise<AgentModelOption[]> {
    const { modelAccessService } = await import('$lib/modules/model-access/application/services/ModelAccessService.js');
    const status = await modelAccessService.status();
    return status.connections.filter(connection => connection.status === 'active' && connection.state === 'connected').flatMap(connection => connection.policy?.offerings.flatMap(offering => offering.availableModels.map(model => ({ provider: 'shared', value: `${connection.id}/${offering.id}/${model.value}`, label: `${connection.name} · ${offering.label} · ${model.label}`, efforts: model.efforts, description: offering.providerId }))) ?? []);
  },
};
