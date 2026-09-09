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
  type = vi.fn(async () => undefined);
  typeSensitive = vi.fn(async () => undefined);
  snapshot = vi.fn(async () => structuredClone(snapshot));
  focus = vi.fn(async () => undefined);
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
