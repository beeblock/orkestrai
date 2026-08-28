import { json, type RequestHandler } from '@sveltejs/kit';
import type { AgentProviderInfo } from '$lib/modules/agent-room/domain/types.js';
import { listAgentAdapters } from '$lib/modules/agent-room/application/adapters/registry.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { resolveTerminalRuntimeOverride, terminalExecutionRuntime, withWorkspaceExecutionRuntime, workspaceExecutionRuntime } from '$lib/modules/agent-room/infrastructure/WslRuntime.js';

export const GET: RequestHandler = async ({ url }) => {
  const workspaceId = url.searchParams.get('workspaceId');
  const workspace = workspaceId ? await workspaceRepository.getWorkspace(workspaceId) : null;
  const nodeId = url.searchParams.get('nodeId');
  const node = nodeId ? await workspaceRepository.getNode(nodeId) : null;
  let runtime = workspace && node?.workspaceId === workspace.id && node.type === 'terminal'
    ? terminalExecutionRuntime(workspace, node.payload as never)
    : workspace
      ? workspaceExecutionRuntime(workspace)
      : { kind: 'native' as const };
  const runtimeMode = url.searchParams.get('runtimeMode');
  if (workspace && (runtimeMode === 'default' || runtimeMode === 'native' || runtimeMode === 'wsl')) {
    runtime = (await resolveTerminalRuntimeOverride({
      mode: runtimeMode,
      workingDir: workspace.workingDir,
      wslDistribution: url.searchParams.get('wslDistribution'),
      wslWorkingDir: url.searchParams.get('wslWorkingDir'),
    })) ?? workspaceExecutionRuntime(workspace);
  }
  const providers: AgentProviderInfo[] = await Promise.all(
    listAgentAdapters().map(async (adapter) => {
      const detection = await withWorkspaceExecutionRuntime(runtime, () => adapter.detect());
      const tui = adapter.interactiveCommand();
      const models = await withWorkspaceExecutionRuntime(runtime, () => adapter.listModels()).catch(() => []);
      return {
        id: adapter.id,
        displayName: adapter.displayName,
        supportsResume: adapter.supportsResume,
        efforts: adapter.efforts,
        sessionStorage: adapter.sessionStorage,
        setup: adapter.setup,
        profileStrategy: adapter.profileStrategy,
        installed: detection.installed,
        detail: detection.detail,
        tui: {
          command: tui.command,
          args: tui.args,
          env: tui.env,
          exactResumeArgs: adapter.resumeArgs('__ORKESTRAI_SESSION_ID__'),
          freshSessionArgs: adapter.freshSessionArgs?.('__ORKESTRAI_SESSION_ID__') ?? null,
        },
        models,
      };
    })
  );

  // Mantem as chaves por id (codex/claude) para compatibilidade e expoe
  // a lista `providers` para UIs dinamicas.
  const byId = Object.fromEntries(providers.map((provider) => [provider.id, { installed: provider.installed, detail: provider.detail }]));

  return json({
    data: {
      ...byId,
      providers,
      runtime,
    },
  });
};
