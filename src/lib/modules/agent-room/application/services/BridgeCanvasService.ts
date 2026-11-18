import { createHash, createHmac, randomBytes } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { Connection } from '@beeblock/svelar/database';
import { uuidv7 } from '@beeblock/svelar/support';
import type { CanvasNode, TerminalNodePayload } from '../../domain/types.js';
import type { BridgeCanvasCommandDto } from '../dto/BridgeCanvasCommandDto.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { AgentBoardTask } from '../../domain/models/AgentBoardTask.js';
import { defaultShell } from '../../infrastructure/workspace.js';
import { findFreeCanvasPosition } from '../../domain/canvas-placement.js';
import { agentSessionService } from './AgentSessionService.js';
import { workspacePathService } from './WorkspacePathService.js';
import { autonomyPolicyService } from './AutonomyPolicyService.js';
import { attentionService } from './AttentionService.js';
import { normalizeSavedTerminalCommands } from '../../domain/terminal-commands.js';
import { ptySessionManager } from '../../infrastructure/pty/PtySessionManager.js';
import { portalGrantsAgent, portalProfileFromPayload } from '../../contracts/schemas/managed-portal.schema.js';

export function portalConfigurationSummary(node: CanvasNode) {
  if (node.type !== 'portal') return undefined;
  const profile = portalProfileFromPayload(node.payload as Record<string, unknown>);
  return { revision: createHmac('sha256', revisionKey).update(JSON.stringify([node.id, profile])).digest('hex'),
    allowedHosts: profile.allowedHosts };
}

// Shared with other server module copies, just like PTY ownership. Serialize
// configuration changes and restarts per node, never across the entire team.
const locks = ((globalThis as typeof globalThis & { __orkestraiShellLocks?: Map<string, Promise<unknown>> })
  .__orkestraiShellLocks ??= new Map<string, Promise<unknown>>());
const revisionKey = ((globalThis as typeof globalThis & { __orkestraiShellRevisionKey?: Buffer })
  .__orkestraiShellRevisionKey ??= randomBytes(32));
async function withShellLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = locks.get(key);
  const current = (previous ?? Promise.resolve()).catch(() => {}).then(operation);
  locks.set(key, current);
  try { return await current; } finally { if (locks.get(key) === current) locks.delete(key); }
}

export function shellSummary(node: CanvasNode) {
  const payload = node.payload as TerminalNodePayload & { bridgeShellCommandId?: string };
  if (node.type !== 'terminal' || payload.provider || !payload.shellStartupManaged) return undefined;
  const { sessionId: _sessionId, resumeRecovery: _recovery, ...configuration } = payload;
  const live = ptySessionManager.listLiveForNode(node.workspaceId, node.id);
  // Private payloads may include user env. An opaque keyed revision is not an
  // offline guessing oracle for their values. It need not survive app restart.
  return { revision: createHmac('sha256', revisionKey).update(JSON.stringify([node.title, configuration])).digest('hex'),
    sessionId: live.length === 1 ? live[0].id : null, ambiguousSession: live.length > 1,
    startupConfigured: normalizeSavedTerminalCommands(payload.savedCommands).some(item => item.runOnResume) };
}

/** No raw payloads: the canvas inventory must never expose agent env or grants. */
export function canvasNodeSummary(node: CanvasNode) {
  const layout = { x: node.x, y: node.y, width: node.width, height: node.height, zIndex: node.zIndex };
  return { nodeId: node.id, type: node.type, title: node.title, floorId: node.floorId, ...layout,
    revision: createHash('sha256').update(JSON.stringify([node.id, layout])).digest('hex') };
}

/** Image removal revisions include identity/content and layout, never raw payloads. */
export function canvasImageSummary(node: CanvasNode) {
  if (node.type !== 'image') return undefined;
  return { revision: createHmac('sha256', revisionKey).update(JSON.stringify([
    canvasNodeSummary(node), node.workspaceId, node.payload,
  ])).digest('hex') };
}

export class BridgeCanvasService {
  async list(workspaceId: string, input: { includeArchived: boolean; afterId?: string; limit: number }) {
    const activeIds = input.includeArchived
      ? new Set((await workspaceRepository.listNodes(workspaceId)).map(node => node.id)) : null;
    const nodes = (await workspaceRepository.listNodes(workspaceId, undefined, input.includeArchived))
      .sort((left, right) => left.id.localeCompare(right.id)).filter(node => !input.afterId || node.id > input.afterId);
    const page = nodes.slice(0, input.limit);
    return { nodes: page.map(node => ({ ...canvasNodeSummary(node), image: canvasImageSummary(node), shell: shellSummary(node), portal: portalConfigurationSummary(node), archived: activeIds ? !activeIds.has(node.id) : false })),
      nextCursor: nodes.length > page.length ? page.at(-1)!.id : null };
  }

  async execute(workspaceId: string, actorId: string, dto: BridgeCanvasCommandDto) {
    const workspace = await workspaceRepository.getWorkspace(workspaceId);
    if (!workspace || workspace.suspendedAt) throw new Error('Workspace is unavailable or explicitly suspended.');
    const input = dto.request.input;
    const request = { workspaceId, capability: input.command === 'configure_portal_hosts' ? 'browser' as const : 'tool' as const, operation: `canvas.${input.command}`,
      actorType: 'agent' as const, actorId, mutation: true,
      input: { command: input.command, taskId: dto.request.taskId, ...(input.command === 'remove_images' ? { images: input.images } : {}) },
      auditOutput: () => ({ command: input.command, ...(input.command === 'remove_images' ? { nodeIds: input.images.map(image => image.nodeId) } : {}) }) };
    return autonomyPolicyService.execute(request, async () => {
      let result: unknown;
      if (input.command === 'layout') {
        if (new Set(input.updates.map(item => item.nodeId)).size !== input.updates.length) throw new Error('Duplicate canvas nodes in layout batch.');
        result = await Connection.transaction(async () => {
          const nodes = await Promise.all(input.updates.map(async update => {
            const node = await this.requireNode(workspaceId, update.nodeId);
            const unchanged = Object.entries(update.changes).every(([key, value]) => node[key as keyof CanvasNode] === value);
            if (canvasNodeSummary(node).revision !== update.revision && !unchanged) throw new Error('Canvas layout changed. Read canvas_list and retry with the current revision.');
            return node;
          }));
          // Validate every target before the first write.
          return Promise.all(nodes.map(async (node, index) => canvasNodeSummary(
            (await workspaceRepository.updateNode(node.id, input.updates[index].changes))!)));
        });
      } else if (input.command === 'remove_images') {
        if (new Set(input.images.map(image => image.nodeId)).size !== input.images.length) throw new Error('Duplicate image nodes in removal batch.');
        result = await Connection.transaction(async () => {
          const currentWorkspace = await workspaceRepository.getWorkspace(workspaceId);
          const actor = await workspaceRepository.getActiveNode(workspaceId, actorId);
          const task = await AgentBoardTask.query().where('workspace_id', workspaceId).where('id', dto.request.taskId).first();
          if (!currentWorkspace || currentWorkspace.suspendedAt || actor?.type !== 'terminal' || !task
            || task.getAttribute('assignee_node_id') !== actorId || task.getAttribute('archived_at')
            || ['todo', 'done'].includes(String(task.getAttribute('status')))) {
            throw new Error('Image removal requires an available workspace and an active task assigned to this agent.');
          }
          const nodes = await Promise.all(input.images.map(async image => {
            const node = await this.requireNode(workspaceId, image.nodeId);
            if (node.type !== 'image' || !(await workspaceRepository.getActiveNode(workspaceId, node.id))) {
              throw new Error('Only active image nodes can be removed through this operation.');
            }
            if (canvasImageSummary(node)!.revision !== image.revision) {
              throw new Error('Canvas image changed. Read canvas_list and retry with image.revision.');
            }
            return node;
          }));
          // A pause, policy edit or task reassignment while waiting for the
          // database writer must take effect before the first deletion.
          const decision = await autonomyPolicyService.decide(request);
          if (decision.status !== 'allowed') throw new Error(decision.reason);
          // Validate the complete batch before deleting any node or edge.
          // This only removes database nodes/edges, never workspace image files.
          for (const node of nodes) await workspaceRepository.deleteNode(node.id);
          return { removedNodeIds: nodes.map(node => node.id), filesPreserved: true };
        });
        for (const image of input.images) await attentionService.resolveNode(workspaceId, image.nodeId).catch(() => 0);
      } else if (input.command === 'archive_note' || input.command === 'restore_note') {
        const node = await this.requireNode(workspaceId, input.nodeId);
        if (node.type !== 'note') throw new Error('Only notes can be archived or restored through this operation.');
        // Soft archive preserves content, task references and edges. No deletion.
        await workspaceRepository.setNodeArchived(workspaceId, node.id, input.command === 'archive_note');
        result = { nodeId: node.id, archived: input.command === 'archive_note', preserved: true };
      } else if (input.command === 'configure_portal_hosts') {
        const node = await this.requireNode(workspaceId, input.nodeId);
        if (node.type !== 'portal' || !(await workspaceRepository.getActiveNode(workspaceId, node.id))) {
          throw new Error('Only active Portals can be configured.');
        }
        const validate = (current: CanvasNode) => {
          if (current.type !== 'portal' || current.workspaceId !== workspaceId) throw new Error('Portal is not in this workspace.');
          const profile = portalProfileFromPayload(current.payload as Record<string, unknown>);
          if (profile.paused || profile.control !== 'interact' || !portalGrantsAgent(profile, actorId)) {
            throw new Error('Portal configuration is restricted by the explicit owner settings.');
          }
          if (portalConfigurationSummary(current)!.revision !== input.revision) {
            throw new Error('Portal configuration changed. Read canvas_list before retrying.');
          }
        };
        const updated = await workspaceRepository.updateNode(node.id, { payload: { portalAllowedHosts: input.allowedHosts } as never },
          { mergePortalPayload: true, validatePortal: validate });
        if (!updated) throw new Error('Portal disappeared before configuration.');
        result = { nodeId: updated.id, portal: portalConfigurationSummary(updated), updated: true };
      } else if (input.command === 'update_shell' || input.command === 'restart_shell') {
        result = await withShellLock(`${workspaceId}:${input.nodeId}`, async () => {
          // Resolve filesystem input before acquiring the SQLite write transaction.
          const cwd = input.command === 'update_shell' && input.changes.cwd !== undefined
            ? await workspacePathService.resolveExisting(workspace, input.changes.cwd) : undefined;
          if (cwd && !(await stat(cwd)).isDirectory()) throw new Error('Shell cwd must be an existing project directory.');
          if (input.command === 'restart_shell') {
            const node = await this.requireNode(workspaceId, input.nodeId);
            const summary = shellSummary(node);
            if (!summary || !(await workspaceRepository.getActiveNode(workspaceId, node.id))) throw new Error('Only active managed Shells can be configured or restarted.');
            if (summary.revision !== input.revision) throw new Error('Shell configuration changed. Read canvas_list before restarting.');
            if (!(await autonomyPolicyService.runWindow(workspaceId, 'shell_startup')).allowed) throw new Error('Shell startup is paused by the workspace policy.');
            const fresh = await workspaceRepository.getActiveNode(workspaceId, node.id);
            if (!fresh || shellSummary(fresh)?.revision !== input.revision) throw new Error('Shell configuration changed. Read canvas_list before restarting.');
            const live = ptySessionManager.listLiveForNode(workspaceId, node.id);
            const currentSessionId = live.length === 1 ? live[0].id : null;
            if (live.length > 1 || currentSessionId !== input.expectedSessionId) throw new Error('Shell session changed. Read canvas_list before restarting; do not blindly retry.');
            // No await separates ownership and kill; retries cannot kill the replacement.
            ptySessionManager.killNode(workspaceId, node.id);
            // Never hold a database transaction across process creation/policy I/O.
            const session = await agentSessionService.ensure(workspaceId, node.id);
            const startupSubmitted = await agentSessionService.startManagedShell(workspaceId, node.id, session.sessionId);
            return { ...canvasNodeSummary(node), shell: shellSummary((await workspaceRepository.getNode(node.id))!),
              sessionId: session.sessionId, startupSubmitted };
          }
          return Connection.transaction(async () => {
            const node = await this.requireNode(workspaceId, input.nodeId);
            const summary = shellSummary(node);
            if (!summary || !(await workspaceRepository.getActiveNode(workspaceId, node.id))) {
              throw new Error('Only active managed Shells can be configured or restarted.');
            }
            const payload = node.payload as TerminalNodePayload & { bridgeShellCommandId?: string; bridgeShellFingerprint?: string };
            const commands = normalizeSavedTerminalCommands(payload.savedCommands);
            // Earlier bridge-created Shells have one command but no command id.
            // Do not guess which command to replace in a multi-command legacy Shell.
            const managedId = payload.bridgeShellCommandId ?? (commands.length === 1 ? commands[0].id : undefined);
            if (!managedId && commands.length) throw new Error('Shell has ambiguous saved commands; no command was replaced.');
            const managed = commands.find(item => item.id === managedId);
            const title = input.changes.title ?? node.title ?? 'Shell';
            const nextCwd = cwd ?? payload.currentWorkingDir;
            const startupCommand = input.changes.startupCommand ?? managed?.command ?? '';
            const unchanged = title === node.title && nextCwd === payload.currentWorkingDir
              && (input.changes.startupCommand === undefined || startupCommand === (managed?.command ?? ''));
            if (summary.revision !== input.revision && !unchanged) throw new Error('Shell configuration changed. Read canvas_list and retry with the current revision.');
            if (unchanged) return { ...canvasNodeSummary(node), shell: summary, updated: false,
              restartRequired: ptySessionManager.listLiveForNode(workspaceId, node.id).length > 0 };
            const commandId = managedId ?? uuidv7();
            const replacement = { id: commandId, name: title.slice(0, 80), command: startupCommand, runOnResume: true };
            const nextCommands = input.changes.startupCommand === undefined ? commands
              : managed ? commands.flatMap(item => item.id !== commandId ? [item] : startupCommand ? [replacement] : [])
                : [...commands, ...(startupCommand ? [replacement] : [])];
            const updated = (await workspaceRepository.updateNode(node.id, { title, payload: { ...payload,
              currentWorkingDir: nextCwd, savedCommands: nextCommands, bridgeShellCommandId: commandId,
              bridgeShellFingerprint: createHash('sha256').update(JSON.stringify([title, nextCwd, startupCommand])).digest('hex'),
            } as never }))!;
            // Editing never injects into or interrupts the running process.
            return { ...canvasNodeSummary(updated), shell: shellSummary(updated), updated: true,
              restartRequired: ptySessionManager.listLiveForNode(workspaceId, node.id).length > 0 };
          });
        });
      } else {
        result = await withShellLock(`${workspaceId}:${input.nodeId}`, async () => {
        const cwd = await workspacePathService.resolveExisting(workspace, input.cwd);
        if (!(await stat(cwd)).isDirectory()) throw new Error('Shell cwd must be an existing project directory.');
        const fingerprint = createHash('sha256').update(JSON.stringify([input.title, cwd, input.startupCommand])).digest('hex');
        let node = await workspaceRepository.getNode(input.nodeId);
        if (node) {
          if (node.workspaceId !== workspaceId || node.type !== 'terminal' || (node.payload as Record<string, unknown>).provider
            || (node.payload as Record<string, unknown>).bridgeShellFingerprint !== fingerprint) throw new Error('Shell id already belongs to another node or configuration.');
          if (!(await workspaceRepository.getActiveNode(workspaceId, node.id))) throw new Error('Archived Shells cannot be started through creation retries.');
        } else {
          const siblings = await workspaceRepository.listNodes(workspaceId);
          const position = findFreeCanvasPosition(siblings.filter(item => !item.floorId), {
            x: input.x ?? 80, y: input.y ?? 80, width: 560, height: 360,
          });
          const commandId = uuidv7();
          node = await workspaceRepository.createNode({ id: input.nodeId, workspaceId, type: 'terminal', title: input.title,
            ...position, width: 560, height: 360, payload: {
              command: workspace.runtimeKind === 'wsl' ? '/bin/sh' : defaultShell({ preferWsl: false }),
              currentWorkingDir: cwd, shellStartupManaged: true, bridgeShellFingerprint: fingerprint, bridgeShellCommandId: commandId,
              savedCommands: input.startupCommand ? [{ id: commandId, name: input.title.slice(0, 80), command: input.startupCommand, runOnResume: true }] : [],
            } as never });
        }
        const session = input.start ? await agentSessionService.ensure(workspaceId, node.id) : null;
        const startupSubmitted = session ? await agentSessionService.startManagedShell(workspaceId, node.id, session.sessionId) : false;
        return { ...canvasNodeSummary(node), shell: shellSummary(node), sessionId: session?.sessionId ?? null, startupSubmitted };
        });
      }
      (globalThis as { __orkestraiBroadcast?: (frame: Record<string, unknown>) => void }).__orkestraiBroadcast?.({ type: 'workspaceChanged', workspaceId });
      return result;
    });
  }

  private async requireNode(workspaceId: string, nodeId: string) {
    const node = await workspaceRepository.getNode(nodeId);
    if (!node || node.workspaceId !== workspaceId) throw new Error('Canvas node is not in this workspace.');
    return node;
  }
}

export const bridgeCanvasService = new BridgeCanvasService();
