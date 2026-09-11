import { describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import type { ComputerAdapter } from '$lib/modules/agent-room/application/adapters/computers/types.js';
import type { ComputerCommandInput, ComputerPlatform, ComputerSnapshot } from '$lib/modules/agent-room/contracts/schemas/computer.schema.js';
import { ComputerService } from '$lib/modules/agent-room/application/services/ComputerService.js';
import { autonomyPolicyService } from '$lib/modules/agent-room/application/services/AutonomyPolicyService.js';
import { secretRefService } from '$lib/modules/agent-room/application/services/SecretRefService.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';

const platform: ComputerPlatform = process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux';
const snapshot: ComputerSnapshot = {
  platform,
  available: true,
  reason: 'ready',
  detail: null,
  permissions: { accessibility: 'granted', screenRecording: 'granted' },
  displays: [{ id: 'primary', name: 'Primary', bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1, primary: true }],
  windows: [{ id: 'editor:1', appId: 'com.example.editor', appName: 'Editor', title: 'Project', bounds: { x: 10, y: 20, width: 1200, height: 800 }, focused: true }],
  focusedWindowId: 'editor:1',
};

class FakeAdapter implements ComputerAdapter {
  readonly platform = platform;
  type = vi.fn(async (): Promise<void> => undefined);
  typeSensitive = vi.fn(async () => undefined);
  snapshot = vi.fn(async () => structuredClone(snapshot));
  focus = vi.fn(async () => undefined);
  launch = vi.fn(async () => undefined);
  click = vi.fn(async () => undefined);
  shortcut = vi.fn(async () => undefined);
  screenshot = vi.fn(async (_input: Extract<ComputerCommandInput, { command: 'screenshot' }>) => ({ width: 1920, height: 1080 }));
  openSettings = vi.fn(async () => undefined);
}

describe('ComputerService', () => {
  useSvelarTest({ refreshDatabase: true });

  it('keeps computer control disabled until explicitly scoped', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'Computer disabled', workingDir: '/tmp' });
    await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'computer', title: 'Computer', payload: { computerConfig: { enabled: false, allowedApplications: [], allowedDisplays: [], evidenceRetentionDays: 14 } } });
    const adapter = new FakeAdapter();
    const service = new ComputerService([adapter]);
    await expect(service.execute(workspace.id, { command: 'type', text: 'hello' }, { actorType: 'user' })).rejects.toThrow('disabled');
    expect(adapter.type).not.toHaveBeenCalled();
  });

  it('limits agent inspection to explicitly allowed applications and displays', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'Computer inspect', workingDir: '/tmp' });
    await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'computer', title: 'Computer', payload: { computerConfig: { enabled: true, allowedApplications: ['com.example.editor'], allowedDisplays: [], evidenceRetentionDays: 14 } } });
    const service = new ComputerService([new FakeAdapter()]);
    const result = await service.execute(workspace.id, { command: 'inspect' }, { actorType: 'agent', actorId: 'agent-1' });
    expect(result.kind).toBe('snapshot');
    if (result.kind === 'snapshot') {
      expect(result.snapshot.windows.map((window) => window.appId)).toEqual(['com.example.editor']);
      expect(result.snapshot.displays).toEqual([]);
    }
  });

  it('rejects an unbounded native desktop inventory before exposing it', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'Computer native boundary', workingDir: '/tmp' });
    await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'computer', title: 'Computer', payload: {} });
    const adapter = new FakeAdapter();
    adapter.snapshot.mockResolvedValueOnce({
      ...snapshot,
      windows: Array.from({ length: 501 }, (_, index) => ({ ...snapshot.windows[0], id: `window-${index}` })),
    });
    await expect(new ComputerService([adapter]).snapshot(workspace.id)).rejects.toThrow();
  });

  it('collapses repeated native window and display records without changing their identities', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'Repeated native inventory', workingDir: '/tmp' });
    const adapter = new FakeAdapter();
    adapter.snapshot.mockResolvedValue({ ...snapshot, windows: [snapshot.windows[0], { ...snapshot.windows[0] }], displays: [snapshot.displays[0], { ...snapshot.displays[0] }] });
    const current = await new ComputerService([adapter]).snapshot(workspace.id);
    expect(current.snapshot.windows).toEqual(snapshot.windows);
    expect(current.snapshot.displays).toEqual(snapshot.displays);
  });

  it('never chooses a target when duplicate native IDs disagree about its application', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'Conflicting native inventory', workingDir: '/tmp' });
    await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'computer', payload: { computerConfig: { enabled: true, allowedApplications: ['com.example.editor'] } } });
    const adapter = new FakeAdapter();
    adapter.snapshot.mockResolvedValue({ ...snapshot, windows: [snapshot.windows[0], { ...snapshot.windows[0], appId: 'com.example.other' }] });
    const service = new ComputerService([adapter]);
    expect((await service.snapshot(workspace.id)).snapshot.windows).toEqual([]);
    await expect(service.execute(workspace.id, { command: 'type', text: 'private', targetId: 'editor:1' }, { actorType: 'user' })).rejects.toThrow('no longer available');
    expect(adapter.type).not.toHaveBeenCalled();
  });

  it('does not retarget a stale window to the focused application', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'Stale window', workingDir: '/tmp' });
    await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'computer', payload: { computerConfig: { enabled: true, allowedApplications: ['com.example.editor'] } } });
    const adapter = new FakeAdapter();
    const service = new ComputerService([adapter]);
    for (const input of [
      { command: 'type', text: 'private', targetId: 'missing' },
      { command: 'focus', windowId: 'missing' },
      { command: 'shortcut', keys: ['enter'], targetId: 'missing' },
    ] as ComputerCommandInput[]) {
      await expect(service.execute(workspace.id, input, { actorType: 'agent', actorId: 'agent' })).rejects.toThrow('no longer available');
    }
    expect(adapter.type).not.toHaveBeenCalled();
    expect(adapter.focus).not.toHaveBeenCalled();
    expect(adapter.shortcut).not.toHaveBeenCalled();
  });

  it('reuses the existing browser session and never launches an unauthorized app', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'Reuse desktop', workingDir: '/tmp' });
    await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'computer', payload: { computerConfig: { enabled: true, allowedApplications: ['com.example.editor', 'com.example.calculator'] } } });
    const adapter = new FakeAdapter();
    const service = new ComputerService([adapter]);
    await service.execute(workspace.id, { command: 'launch', applicationId: 'com.example.editor' }, { actorType: 'user' });
    expect(adapter.focus).toHaveBeenCalledWith('editor:1');
    expect(adapter.launch).not.toHaveBeenCalled();
    await service.execute(workspace.id, { command: 'launch', applicationId: 'com.example.calculator' }, { actorType: 'user' });
    expect(adapter.launch).toHaveBeenCalledWith('com.example.calculator');
    await expect(service.execute(workspace.id, { command: 'launch', applicationId: 'com.example.denied' }, { actorType: 'user' })).rejects.toThrow('not enabled');
    expect(adapter.launch).toHaveBeenCalledTimes(1);
  });

  it('blocks focus theft and never automatically replays a possibly partial failed action', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'Focus theft', workingDir: '/tmp' });
    await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'computer', payload: { computerConfig: { enabled: true, allowedApplications: ['com.example.editor'] } } });
    const adapter = new FakeAdapter();
    const service = new ComputerService([adapter]);
    adapter.snapshot.mockResolvedValueOnce(structuredClone(snapshot)).mockResolvedValueOnce({ ...structuredClone(snapshot), focusedWindowId: null, windows: [{ ...snapshot.windows[0], focused: false }] });
    const input: ComputerCommandInput = { command: 'type', text: 'private', targetId: 'editor:1' };
    const context = { actorType: 'agent' as const, actorId: 'agent', idempotencyKey: 'focus-test:1' };
    await expect(service.execute(workspace.id, input, context)).rejects.toThrow('No input was sent');
    expect(adapter.type).not.toHaveBeenCalled();
    await expect(service.execute(workspace.id, input, context)).rejects.toThrow('automatic replay is blocked');
  });

  it('holds the host input lock across different service instances', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'Host lock', workingDir: '/tmp' });
    await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'computer', payload: { computerConfig: { enabled: true, allowedApplications: ['com.example.editor'] } } });
    const adapter = new FakeAdapter();
    let release!: () => void;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => { started = resolve; });
    adapter.type.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; started(); }));
    const first = new ComputerService([adapter]).execute(workspace.id, { command: 'type', text: 'first', targetId: 'editor:1' }, { actorType: 'user' });
    try {
      await entered;
      await expect(new ComputerService([adapter]).execute(workspace.id, { command: 'type', text: 'second', targetId: 'editor:1' }, { actorType: 'user' })).rejects.toThrow('Another desktop action');
    } finally { release(); await first; }
    expect(adapter.type).toHaveBeenCalledTimes(1);
  });

  it('gates publication before input and binds approval to the exact content and attempt', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'Publication gate', workingDir: '/tmp' });
    await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'computer', payload: { computerConfig: { enabled: true, allowedApplications: ['com.example.editor'] } } });
    const policy = await autonomyPolicyService.get(workspace.id);
    await autonomyPolicyService.update(workspace.id, { enabled: true, mode: 'bounded', policy: { ...policy.policy, capabilities: ['computer'], allowedApps: ['com.example.editor'] } });
    const adapter = new FakeAdapter();
    const service = new ComputerService([adapter]);
    const context = { actorType: 'agent' as const, actorId: 'agent', idempotencyKey: 'send-email:1', risk: 'external_publication' as const };
    const input: ComputerCommandInput = { command: 'type', text: 'message A', targetId: 'editor:1' };
    await expect(service.execute(workspace.id, input, context)).rejects.toThrow('approval gate');
    expect(adapter.type).not.toHaveBeenCalled();
    const gate = (await autonomyPolicyService.listGates(workspace.id))[0];
    await autonomyPolicyService.resolveGate(workspace.id, gate.id, 'approved', 'workspace-owner');
    await service.execute(workspace.id, input, context);
    expect(adapter.type).toHaveBeenCalledTimes(1);
    await expect(service.execute(workspace.id, { ...input, text: 'message B' }, { ...context, idempotencyKey: 'send-email:2' })).rejects.toThrow('approval gate');
    expect(adapter.type).toHaveBeenCalledTimes(1);
  });

  it('applies app policy, redacts typed content, and deduplicates agent actions', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'Computer bounded', workingDir: '/tmp' });
    const node = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'computer', title: 'Computer', payload: { computerConfig: { enabled: false, allowedApplications: [], allowedDisplays: [], evidenceRetentionDays: 14 } } });
    const adapter = new FakeAdapter();
    const service = new ComputerService([adapter]);
    await service.configure(workspace.id, node.id, { enabled: true, allowedApplications: ['com.example.editor'], allowedDisplays: ['primary'], evidenceRetentionDays: 14 });
    const current = await autonomyPolicyService.get(workspace.id);
    await autonomyPolicyService.update(workspace.id, { enabled: true, mode: 'bounded', policy: { ...current.policy, capabilities: ['computer'], allowedApps: ['com.example.editor'] } });
    const context = { actorType: 'agent' as const, actorId: 'agent-1', idempotencyKey: 'task-1:type-report' };
    await service.execute(workspace.id, { command: 'type', text: 'private report text', targetId: 'editor:1' }, context);
    await service.execute(workspace.id, { command: 'type', text: 'private report text', targetId: 'editor:1' }, context);
    await expect(service.execute(workspace.id, { command: 'type', text: 'different private text', targetId: 'editor:1' }, context)).rejects.toThrow('different computer request');
    await expect(service.execute(workspace.id, { command: 'shortcut', keys: ['enter'], targetId: 'editor:1' }, context)).rejects.toThrow('different computer request');
    expect(adapter.type).toHaveBeenCalledTimes(1);
    const audit = await autonomyPolicyService.listAudit(workspace.id, 100);
    expect(JSON.stringify(audit)).not.toContain('private report text');
    expect(audit.some((event) => event.capability === 'computer' && event.eventType === 'completed')).toBe(true);
  });

  it('rejects an application missing from the node scope before input injection', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'Computer app boundary', workingDir: '/tmp' });
    await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'computer', title: 'Computer', payload: { computerConfig: { enabled: true, allowedApplications: ['different.app'], allowedDisplays: [], evidenceRetentionDays: 14 } } });
    const adapter = new FakeAdapter();
    const service = new ComputerService([adapter]);
    await expect(service.execute(workspace.id, { command: 'type', text: 'blocked' }, { actorType: 'user' })).rejects.toThrow('not enabled');
    expect(adapter.type).not.toHaveBeenCalled();
  });

  it('confines agent pixels to an allowed window and user screen actions to selected displays', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'Computer pixels', workingDir: '/tmp' });
    const node = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'computer', title: 'Computer', payload: { computerConfig: { enabled: true, allowedApplications: ['com.example.editor'], allowedDisplays: [], evidenceRetentionDays: 14 } } });
    const adapter = new FakeAdapter();
    const service = new ComputerService([adapter]);

    await expect(service.execute(workspace.id, { command: 'click', space: 'screen', x: 10, y: 10, button: 'left', count: 1 }, { actorType: 'agent', actorId: 'agent-1' })).rejects.toThrow('only inside');
    await expect(service.execute(workspace.id, { command: 'screenshot', target: 'all' }, { actorType: 'agent', actorId: 'agent-1' })).rejects.toThrow('only an explicitly allowed window');
    await expect(service.execute(workspace.id, { command: 'click', space: 'screen', x: 10, y: 10, button: 'left', count: 1 }, { actorType: 'user' })).rejects.toThrow('outside the enabled displays');

    await service.configure(workspace.id, node.id, { enabled: true, allowedApplications: ['com.example.editor'], allowedDisplays: ['primary'], evidenceRetentionDays: 14 });
    await service.execute(workspace.id, { command: 'click', space: 'window', targetId: 'editor:1', x: 0.5, y: 0.5, button: 'left', count: 1 }, { actorType: 'agent', actorId: 'agent-1', idempotencyKey: 'task-2:click-editor' });
    expect(adapter.click).toHaveBeenCalledWith(expect.objectContaining({ x: 610, y: 420 }));
  });

  it('types a SecretRef only into its explicitly bound window without persisting the value', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'Computer secret', workingDir: '/tmp' });
    await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'computer', title: 'Computer', payload: { computerConfig: { enabled: true, allowedApplications: ['com.example.editor'], allowedDisplays: [], evidenceRetentionDays: 14 } } });
    const secret = await secretRefService.create(workspace.id, {
      name: 'Editor login', purpose: 'Sign in autonomously', provider: 'host_vault',
      bindings: { integrations: ['computer'], operations: ['computer.type_secret'], destinations: ['com.example.editor'] },
    });
    const unbound = await secretRefService.create(workspace.id, {
      name: 'Unbound login', purpose: 'Must never reach an arbitrary app', provider: 'host_vault',
      bindings: { integrations: ['computer'], operations: ['computer.type_secret'], destinations: [] },
    });
    const state = globalThis as typeof globalThis & { __orkestraiHostVaultResolve?: (reference: string) => Promise<string | null> };
    state.__orkestraiHostVaultResolve = async (reference) => reference === secret.ref ? 'never-persist-this-value' : null;
    const adapter = new FakeAdapter();
    const service = new ComputerService([adapter]);
    try {
      await expect(service.execute(workspace.id, { command: 'type_secret', secretRef: unbound.ref, targetId: 'editor:1' }, { actorType: 'agent', actorId: 'agent-1', idempotencyKey: 'task-3:unbound-login' })).rejects.toThrow('target application');
      await service.execute(workspace.id, { command: 'type_secret', secretRef: secret.ref, targetId: 'editor:1' }, { actorType: 'agent', actorId: 'agent-1', idempotencyKey: 'task-3:editor-login' });
      expect(adapter.focus).toHaveBeenCalledWith('editor:1');
      expect(adapter.typeSensitive).toHaveBeenCalledWith('never-persist-this-value');
      expect(adapter.type).not.toHaveBeenCalledWith('never-persist-this-value');
      const audit = await autonomyPolicyService.exportAudit(workspace.id);
      expect(JSON.stringify(audit)).not.toContain('never-persist-this-value');
    } finally {
      delete state.__orkestraiHostVaultResolve;
    }
  });
});
