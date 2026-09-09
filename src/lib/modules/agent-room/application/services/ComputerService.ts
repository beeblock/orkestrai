import { createHash } from 'node:crypto';
import { mkdir, readdir, rm, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { uuidv7 } from '@beeblock/svelar/support';
import type { ComputerAdapter } from '../adapters/computers/types.js';
import { resolveComputerPoint } from '../adapters/computers/types.js';
import { LinuxComputerAdapter } from '../adapters/computers/LinuxComputerAdapter.js';
import { MacComputerAdapter } from '../adapters/computers/MacComputerAdapter.js';
import { WindowsComputerAdapter } from '../adapters/computers/WindowsComputerAdapter.js';
import {
  computerCommandSchema,
  computerNodeConfigSchema,
  computerSnapshotSchema,
  type ComputerCommandInput,
  type ComputerCommandResult,
  type ComputerNodeConfig,
  type ComputerSnapshot,
} from '../../contracts/schemas/computer.schema.js';
import { AgentComputerAction } from '../../domain/models/AgentComputerAction.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { autonomyPolicyService } from './AutonomyPolicyService.js';
import { secretRefService } from './SecretRefService.js';

export type ComputerExecutionContext = {
  actorType: 'agent' | 'automation' | 'user';
  actorId?: string | null;
  runId?: string | null;
  idempotencyKey?: string | null;
};

function metadata(result: ComputerCommandResult): Record<string, unknown> {
  if (result.kind === 'screenshot') return { kind: result.kind, path: result.path, evidenceId: result.evidenceId, width: result.width, height: result.height };
  return { kind: result.kind, completed: result.kind === 'action' ? result.completed : true };
}

function requestDigest(input: ComputerCommandInput): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

export class ComputerService {
  private readonly adapter: ComputerAdapter;

  constructor(adapters: ComputerAdapter[] = [new MacComputerAdapter(), new WindowsComputerAdapter(), new LinuxComputerAdapter()]) {
    const platform = process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux';
    this.adapter = adapters.find((candidate) => candidate.platform === platform) ?? adapters[0];
  }

  async snapshot(workspaceId: string): Promise<{ nodeId: string | null; config: ComputerNodeConfig; snapshot: ComputerSnapshot; lastEvidence: string | null }> {
    const workspace = await workspaceRepository.getWorkspace(workspaceId);
    if (!workspace) throw new Error('Workspace not found.');
    const node = (await workspaceRepository.listNodes(workspaceId)).find((candidate) => candidate.type === 'computer') ?? null;
    const payload = node?.payload && typeof node.payload === 'object' ? node.payload as Record<string, unknown> : {};
    const config = computerNodeConfigSchema.parse(payload.computerConfig ?? {});
    return { nodeId: node?.id ?? null, config, snapshot: await this.adapterSnapshot(), lastEvidence: typeof payload.computerLastEvidence === 'string' ? payload.computerLastEvidence : null };
  }

  async snapshotForAgent(workspaceId: string): Promise<Awaited<ReturnType<ComputerService['snapshot']>>> {
    const current = await this.snapshot(workspaceId);
    return { ...current, snapshot: this.scopedSnapshot(current.snapshot, current.config) };
  }

  async configure(workspaceId: string, nodeId: string, rawConfig: ComputerNodeConfig): Promise<ComputerNodeConfig> {
    const node = await workspaceRepository.getNode(nodeId);
    if (!node || node.workspaceId !== workspaceId || node.type !== 'computer') throw new Error('Computer node not found.');
    const config = computerNodeConfigSchema.parse(rawConfig);
    const payload = node.payload && typeof node.payload === 'object' ? node.payload as Record<string, unknown> : {};
    await workspaceRepository.updateNode(nodeId, { payload: { ...payload, computerConfig: config } });
    return config;
  }

  async execute(workspaceId: string, rawInput: ComputerCommandInput, context: ComputerExecutionContext): Promise<ComputerCommandResult> {
    const input = computerCommandSchema.parse(rawInput);
    const current = await this.snapshot(workspaceId);
    if (!current.nodeId) throw new Error('Add a Computer node to this workspace first.');
    if (input.command === 'inspect') return { kind: 'snapshot', snapshot: context.actorType === 'user' ? current.snapshot : this.scopedSnapshot(current.snapshot, current.config) };
    if (input.command === 'open_settings') {
      if (context.actorType !== 'user') throw new Error('Only the workspace owner can open operating-system permission settings.');
      await this.adapter.openSettings(input.permission);
      return { kind: 'action', completed: true, snapshot: await this.adapterSnapshot() };
    }
    if (!current.config.enabled) throw new Error('Desktop control is disabled on this Computer node.');
    if (!current.snapshot.available) throw new Error(current.snapshot.detail ?? 'Desktop control is unavailable on this system.');
    if (context.actorType !== 'user' && input.command === 'click' && input.space !== 'window') {
      throw new Error('Agents may click only inside an explicitly allowed window.');
    }
    if (context.actorType !== 'user' && input.command === 'screenshot' && input.target !== 'window') {
      throw new Error('Agents may capture only an explicitly allowed window.');
    }
    if (context.actorType !== 'user' && (input.command === 'type' || input.command === 'type_secret' || input.command === 'shortcut') && !input.targetId) {
      throw new Error('Agents must bind keyboard input to an explicitly allowed window.');
    }

    const scopedWindow = this.scopedWindow(input, current.snapshot);
    const appId = scopedWindow?.appId ?? this.focusedApp(current.snapshot);
    if ((input.command === 'type' || input.command === 'type_secret' || input.command === 'shortcut') && !appId) {
      throw new Error('The focused application could not be identified.');
    }
    if (appId && !current.config.allowedApplications.some((allowed) => allowed.toLowerCase() === appId.toLowerCase())) {
      throw new Error('The target application is not enabled on this Computer node.');
    }
    this.assertDisplayScope(input, current.snapshot, current.config);

    const key = context.idempotencyKey ?? `user:${uuidv7()}`;
    const inputDigest = requestDigest(input);
    const previous = await AgentComputerAction.query().where('workspace_id', workspaceId).where('idempotency_key', key).first();
    if (previous && (String(previous.getAttribute('command')) !== input.command || String(previous.getAttribute('request_digest')) !== inputDigest)) {
      throw new Error('This idempotency key is already bound to a different computer request.');
    }
    if (previous && String(previous.getAttribute('status')) === 'succeeded') {
      const stored = JSON.parse(String(previous.getAttribute('result_json') ?? '{}')) as Record<string, unknown>;
      return this.scopeResult({ kind: 'action', completed: true, snapshot: await this.adapterSnapshot(), ...stored } as ComputerCommandResult, current.config, context.actorType);
    }
    const actionId = previous ? String(previous.getAttribute('id')) : uuidv7();
    const now = new Date();
    if (!previous) await AgentComputerAction.create({ id: actionId, workspace_id: workspaceId, node_id: current.nodeId, actor_type: context.actorType, actor_id: context.actorId ?? null, command: input.command, idempotency_key: key, request_digest: inputDigest, status: 'running', result_json: null, error: null, created_at: now, updated_at: now });
    else await AgentComputerAction.query().where('id', actionId).update({ status: 'running', error: null, updated_at: now });

    try {
      const result = await autonomyPolicyService.execute({
        workspaceId,
        runId: context.runId ?? null,
        capability: 'computer',
        operation: `computer.${input.command}`,
        target: scopedWindow ? `${scopedWindow.appName}:${scopedWindow.title}` : appId ?? input.command,
        mutation: input.command !== 'screenshot' && input.command !== 'wait',
        actorType: context.actorType,
        actorId: context.actorId ?? null,
        input: input.command === 'type' ? { command: 'type', characters: input.text.length } : input,
        auditOutput: (result) => metadata(result as ComputerCommandResult),
        certainty: 'semantic',
        ...(appId ? { application: { id: appId } } : {}),
      }, () => this.executeUnchecked(workspaceId, current.nodeId!, current.config, input, current.snapshot, appId));
      await AgentComputerAction.query().where('id', actionId).update({ status: 'succeeded', result_json: JSON.stringify(metadata(result)), error: null, updated_at: new Date() });
      return this.scopeResult(result, current.config, context.actorType);
    } catch (error) {
      await AgentComputerAction.query().where('id', actionId).update({ status: 'failed', error: String(error instanceof Error ? error.message : error).slice(0, 2_000), updated_at: new Date() });
      throw error;
    }
  }

  async evidence(workspaceId: string, evidenceId: string): Promise<string> {
    if (!/^[0-9a-f-]{36}$/i.test(evidenceId)) throw new Error('Invalid computer evidence reference.');
    const workspace = await workspaceRepository.getWorkspace(workspaceId);
    if (!workspace) throw new Error('Workspace not found.');
    const path = join(workspace.workingDir, '.orkestrai', 'computer', 'evidence', `${evidenceId}.png`);
    await stat(path);
    return path;
  }

  async removeEvidence(workspaceId: string): Promise<void> {
    const workspace = await workspaceRepository.getWorkspace(workspaceId);
    if (!workspace) return;
    await rm(join(workspace.workingDir, '.orkestrai', 'computer', 'evidence'), { recursive: true, force: true });
  }

  private async executeUnchecked(workspaceId: string, nodeId: string, config: ComputerNodeConfig, input: Exclude<ComputerCommandInput, { command: 'inspect' | 'open_settings' }>, snapshot: ComputerSnapshot, appId: string | null): Promise<ComputerCommandResult> {
    if (input.command === 'focus') await this.adapter.focus(input.windowId);
    else if (input.command === 'click') await this.adapter.click(resolveComputerPoint(input, snapshot));
    else if (input.command === 'type') {
      if (input.targetId) await this.adapter.focus(input.targetId);
      await this.adapter.type(input.text);
    }
    else if (input.command === 'type_secret') {
      if (!appId) throw new Error('The focused application could not be identified.');
      const manifest = (await secretRefService.list(workspaceId)).find((secret) => secret.ref === input.secretRef);
      if (!manifest || !manifest.bindings.integrations.includes('computer') || !manifest.bindings.operations.includes('computer.type_secret')) {
        throw new Error('SecretRef must be explicitly bound to computer.type_secret.');
      }
      const normalizedAppId = appId.toLowerCase();
      if (!manifest.bindings.destinations.length || !manifest.bindings.destinations.some((allowed) => allowed === normalizedAppId || (allowed.startsWith('*.') && normalizedAppId.endsWith(allowed.slice(1))))) {
        throw new Error('SecretRef must be explicitly bound to the target application.');
      }
      const secret = await secretRefService.resolve(workspaceId, input.secretRef, { integration: 'computer', operation: 'computer.type_secret', destination: appId });
      if (input.targetId) await this.adapter.focus(input.targetId);
      await this.adapter.typeSensitive(secret.revealInsideTrustedExecutor());
    }
    else if (input.command === 'shortcut') {
      if (input.targetId) await this.adapter.focus(input.targetId);
      await this.adapter.shortcut(input.keys);
    }
    else if (input.command === 'wait') await this.wait(input, config);
    else if (input.command === 'screenshot') {
      const workspace = await workspaceRepository.getWorkspace(workspaceId);
      if (!workspace) throw new Error('Workspace not found.');
      const evidenceId = uuidv7();
      const directory = join(workspace.workingDir, '.orkestrai', 'computer', 'evidence');
      await mkdir(directory, { recursive: true });
      await this.cleanupEvidence(directory, config.evidenceRetentionDays);
      const absolute = join(directory, `${evidenceId}.png`);
      const dimensions = await this.adapter.screenshot(input, { evidencePath: absolute });
      const path = `.orkestrai/computer/evidence/${evidenceId}.png`;
      const node = await workspaceRepository.getNode(nodeId);
      if (node) await workspaceRepository.updateNode(nodeId, { payload: { ...(node.payload as Record<string, unknown>), computerLastEvidence: path } });
      return { kind: 'screenshot', path, evidenceId, ...dimensions, snapshot: await this.adapterSnapshot() };
    }
    return { kind: 'action', completed: true, snapshot: await this.adapterSnapshot() };
  }

  private scopedWindow(input: ComputerCommandInput, snapshot: ComputerSnapshot) {
    if (input.command === 'focus') return snapshot.windows.find((window) => window.id === input.windowId) ?? null;
    if ((input.command === 'click' && input.space === 'window') || (input.command === 'screenshot' && input.target === 'window')) return snapshot.windows.find((window) => window.id === input.targetId) ?? null;
    if ((input.command === 'type' || input.command === 'type_secret' || input.command === 'shortcut') && input.targetId) return snapshot.windows.find((window) => window.id === input.targetId) ?? null;
    return null;
  }

  private focusedApp(snapshot: ComputerSnapshot): string | null {
    return snapshot.windows.find((window) => window.id === snapshot.focusedWindowId)?.appId ?? null;
  }

  private scopedSnapshot(snapshot: ComputerSnapshot, config: ComputerNodeConfig): ComputerSnapshot {
    const windows = snapshot.windows.filter((window) => config.allowedApplications.some((allowed) => allowed.toLowerCase() === window.appId.toLowerCase()));
    const displays = snapshot.displays.filter((display) => config.allowedDisplays.includes(display.id));
    return { ...snapshot, windows, displays, focusedWindowId: windows.some((window) => window.id === snapshot.focusedWindowId) ? snapshot.focusedWindowId : null };
  }

  private scopeResult(result: ComputerCommandResult, config: ComputerNodeConfig, actorType: ComputerExecutionContext['actorType']): ComputerCommandResult {
    return actorType === 'user' ? result : { ...result, snapshot: this.scopedSnapshot(result.snapshot, config) };
  }

  private assertDisplayScope(input: ComputerCommandInput, snapshot: ComputerSnapshot, config: ComputerNodeConfig): void {
    if (input.command === 'screenshot') {
      if (input.target === 'display' && !config.allowedDisplays.includes(input.targetId ?? '')) {
        throw new Error('The target display is not enabled on this Computer node.');
      }
      if (input.target === 'all' && snapshot.displays.some((display) => !config.allowedDisplays.includes(display.id))) {
        throw new Error('Every visible display must be explicitly enabled before capturing the complete desktop.');
      }
      return;
    }
    if (input.command !== 'click' || input.space === 'window') return;
    if (input.space === 'display') {
      if (!config.allowedDisplays.includes(input.targetId ?? '')) throw new Error('The target display is not enabled on this Computer node.');
      return;
    }
    const display = snapshot.displays.find((candidate) => input.x >= candidate.bounds.x && input.y >= candidate.bounds.y && input.x <= candidate.bounds.x + candidate.bounds.width && input.y <= candidate.bounds.y + candidate.bounds.height);
    if (!display || !config.allowedDisplays.includes(display.id)) throw new Error('The screen coordinate is outside the enabled displays.');
  }

  private async wait(input: Extract<ComputerCommandInput, { command: 'wait' }>, config: ComputerNodeConfig): Promise<void> {
    const deadline = Date.now() + input.timeoutMs;
    const needle = input.value.toLowerCase();
    while (Date.now() <= deadline) {
      const snapshot = await this.adapterSnapshot();
      const found = snapshot.windows.filter((window) => config.allowedApplications.some((allowed) => allowed.toLowerCase() === window.appId.toLowerCase())).some((window) => {
        const matches = `${window.appId} ${window.appName} ${window.title}`.toLowerCase().includes(needle);
        return matches && (input.condition === 'window_exists' || window.focused);
      });
      if (found) return;
      await new Promise((resolve) => setTimeout(resolve, input.pollMs));
    }
    throw new Error('Timed out while waiting for the desktop condition.');
  }

  private async cleanupEvidence(directory: string, retentionDays: number): Promise<void> {
    const cutoff = Date.now() - retentionDays * 86_400_000;
    const files = await readdir(directory, { withFileTypes: true }).catch(() => []);
    await Promise.all(files.filter((file) => file.isFile() && /^[0-9a-f-]{36}\.png$/i.test(file.name)).map(async (file) => {
      const path = join(directory, file.name);
      const info = await stat(path).catch(() => null);
      if (info && info.mtimeMs < cutoff) await unlink(path).catch(() => undefined);
    }));
  }

  private async adapterSnapshot(): Promise<ComputerSnapshot> {
    return computerSnapshotSchema.parse(await this.adapter.snapshot());
  }
}

export const computerService = new ComputerService();
