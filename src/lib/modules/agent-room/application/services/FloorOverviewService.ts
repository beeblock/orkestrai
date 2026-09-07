import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { CanvasNode, Floor, TerminalNodePayload, Workspace } from '../../domain/types.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { ptySessionManager } from '../../infrastructure/pty/PtySessionManager.ts';
import { agentEnv } from '../../infrastructure/agent-path.js';
import { buildWorkspaceRuntimeLaunch } from '../../infrastructure/WslRuntime.js';
import { floorService } from './FloorService.js';
import { taskBoardService, type BoardTask } from './TaskBoardService.js';

const execFileAsync = promisify(execFile);

export type FloorAgentOverview = {
  id: string;
  title: string;
  provider: string | null;
  role: string | null;
  active: boolean;
  idle: boolean;
};

export type FloorTaskOverview = Pick<BoardTask, 'id' | 'title' | 'status' | 'assigneeTitle'>;

export type WorktreeOverview = {
  branch: string;
  dirty: boolean;
  changedFiles: number;
  ahead: number;
  behind: number;
  lastCommitAt: string | null;
  lastCommitTitle: string | null;
  available: boolean;
};

export type FloorOverview = {
  floor: Floor | null;
  floorId: string | null;
  agents: FloorAgentOverview[];
  tasks: FloorTaskOverview[];
  git: WorktreeOverview;
};

export type WorkspaceFloorOverview = {
  ground: FloorOverview;
  floors: FloorOverview[];
};

function agentsFor(nodes: CanvasNode[]): FloorAgentOverview[] {
  return nodes
    .filter((node) => node.type === 'terminal')
    .map((node) => {
      const payload = node.payload as TerminalNodePayload;
      const session = payload.sessionId ? ptySessionManager.get(payload.sessionId) : null;
      return {
        id: node.id,
        title: node.title ?? payload.provider ?? 'Terminal',
        provider: payload.provider ?? null,
        role: payload.role ?? null,
        active: Boolean(session && !session.exited),
        idle: Boolean(session?.waiting),
      };
    });
}

function tasksFor(nodes: CanvasNode[], tasks: BoardTask[], includeUnassigned: boolean): FloorTaskOverview[] {
  const nodeIds = new Set(nodes.map((node) => node.id));
  return tasks
    .filter((task) => (task.assigneeNodeId ? nodeIds.has(task.assigneeNodeId) : includeUnassigned))
    .map(({ id, title, status, assigneeTitle }) => ({ id, title, status, assigneeTitle }));
}

async function runGit(workspace: Workspace, path: string, args: string[]): Promise<string> {
  const launch = buildWorkspaceRuntimeLaunch({ workspace, command: 'git', args, hostCwd: path, hostEnv: agentEnv() });
  const { stdout } = await execFileAsync(launch.command, launch.args, {
    cwd: launch.cwd,
    env: launch.env,
    timeout: 10_000,
    windowsHide: true,
  });
  return stdout;
}

async function worktreeOverview(workspace: Workspace, path: string): Promise<WorktreeOverview> {
  try {
    const [statusOutput, logOutput] = await Promise.all([
      runGit(workspace, path, ['status', '--porcelain=v1', '--branch']),
      runGit(workspace, path, ['log', '-1', '--format=%cI%x00%s']),
    ]);
    const [branchLine = '', ...changes] = statusOutput.trimEnd().split('\n');
    const branch = branchLine.replace(/^##\s*/, '').split('...')[0]?.trim() || 'HEAD';
    const ahead = Number(branchLine.match(/ahead (\d+)/)?.[1] ?? 0);
    const behind = Number(branchLine.match(/behind (\d+)/)?.[1] ?? 0);
    const [lastCommitAt, lastCommitTitle] = logOutput.trim().split('\0');
    return {
      branch,
      dirty: changes.filter(Boolean).length > 0,
      changedFiles: changes.filter(Boolean).length,
      ahead,
      behind,
      lastCommitAt: lastCommitAt || null,
      lastCommitTitle: lastCommitTitle || null,
      available: true,
    };
  } catch {
    return {
      branch: '', dirty: false, changedFiles: 0, ahead: 0, behind: 0,
      lastCommitAt: null, lastCommitTitle: null, available: false,
    };
  }
}

/** Read model for the floor panel; lifecycle mutations remain in FloorService. */
export class FloorOverviewService {
  async get(workspaceId: string): Promise<WorkspaceFloorOverview> {
    const workspace = await workspaceRepository.getWorkspace(workspaceId);
    if (!workspace) throw new Error('Workspace não encontrado.');
    const [floors, nodes, tasks] = await Promise.all([
      floorService.list(workspaceId),
      workspaceRepository.listNodes(workspaceId),
      taskBoardService.list(workspaceId),
    ]);
    const groundNodes = nodes.filter((node) => node.floorId === null);
    const [groundGit, ...floorGit] = await Promise.all([
      worktreeOverview(workspace, workspace.workingDir),
      ...floors.map((floor) => worktreeOverview(workspace, floor.path)),
    ]);
    return {
      ground: {
        floor: null,
        floorId: null,
        agents: agentsFor(groundNodes),
        tasks: tasksFor(groundNodes, tasks, true),
        git: groundGit,
      },
      floors: floors.map((floor, index) => {
        const floorNodes = nodes.filter((node) => node.floorId === floor.id);
        return {
          floor,
          floorId: floor.id,
          agents: agentsFor(floorNodes),
          tasks: tasksFor(floorNodes, tasks, false),
          git: floorGit[index],
        };
      }),
    };
  }
}

export const floorOverviewService = new FloorOverviewService();
