import type { TerminalNodePayload, Workspace, WorkspaceExecutionRuntime } from './types.js';

/** Host paths and Linux paths are distinct when the workspace uses WSL. */
export function workspaceProjectContext(workspace: Pick<Workspace, 'id' | 'name' | 'workingDir' | 'runtimeKind' | 'wslDistribution' | 'wslWorkingDir'>) {
  return {
    id: workspace.id, name: workspace.name, workingDir: workspace.workingDir,
    runtimeKind: workspace.runtimeKind,
    wslDistribution: workspace.runtimeKind === 'wsl' ? workspace.wslDistribution : null,
    wslWorkingDir: workspace.runtimeKind === 'wsl' ? workspace.wslWorkingDir : null,
  };
}

export function workspaceExecutionRuntime(
  workspace: Pick<Workspace, 'runtimeKind' | 'wslDistribution' | 'wslWorkingDir'>,
): WorkspaceExecutionRuntime {
  if (workspace.runtimeKind !== 'wsl') return { kind: 'native' };
  if (!workspace.wslDistribution || !workspace.wslWorkingDir) {
    throw new Error('O runtime WSL do workspace está incompleto.');
  }
  return {
    kind: 'wsl',
    distribution: workspace.wslDistribution,
    linuxWorkingDir: workspace.wslWorkingDir,
  };
}

export function terminalExecutionRuntime(
  workspace: Pick<Workspace, 'runtimeKind' | 'wslDistribution' | 'wslWorkingDir'>,
  payload: Pick<TerminalNodePayload, 'executionRuntime'>,
): WorkspaceExecutionRuntime {
  const override = payload.executionRuntime;
  if (!override) return workspaceExecutionRuntime(workspace);
  if (override.kind === 'native') return { kind: 'native' };
  if (!override.distribution || !override.linuxWorkingDir) {
    throw new Error('O runtime WSL do terminal está incompleto.');
  }
  return {
    kind: 'wsl',
    distribution: override.distribution,
    linuxWorkingDir: override.linuxWorkingDir,
  };
}

export function executionRuntimeKey(runtime: WorkspaceExecutionRuntime): string {
  return runtime.kind === 'native'
    ? 'native'
    : `wsl:${runtime.distribution}:${runtime.linuxWorkingDir}`;
}
