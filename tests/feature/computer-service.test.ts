import { describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import type { ComputerAdapter } from '$lib/modules/agent-room/application/adapters/computers/types.js';
import type { ComputerAccessibility, ComputerCommandInput, ComputerPlatform, ComputerSnapshot } from '$lib/modules/agent-room/contracts/schemas/computer.schema.js';
import { ComputerService } from '$lib/modules/agent-room/application/services/ComputerService.js';
import { autonomyPolicyService } from '$lib/modules/agent-room/application/services/AutonomyPolicyService.js';
import { secretRefService } from '$lib/modules/agent-room/application/services/SecretRefService.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { ComputerCommandRequest } from '$lib/modules/agent-room/interface/http/requests/ComputerCommandRequest.js';
import { AgentComputerAction } from '$lib/modules/agent-room/domain/models/AgentComputerAction.js';
import { AutonomyGatePendingError } from '$lib/modules/agent-room/application/services/AutonomyPolicyService.js';
import { computerEvidenceService } from '$lib/modules/agent-room/application/services/ComputerEvidenceService.js';

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

  it('reports revoked macOS permission before missing-window errors or desktop effects', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'Revoked native permission', workingDir: '/tmp' });
    await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'computer', payload: { computerConfig: { enabled: true, allowedApplications: ['com.example.editor'] } } });
    const adapter = Object.assign(new FakeAdapter(), { read: vi.fn(), interact: vi.fn() });
    adapter.snapshot.mockResolvedValue({ ...snapshot, platform: 'macos', permissions: { ...snapshot.permissions, accessibility: 'denied' }, windows: [], focusedWindowId: null });
    const service = new ComputerService([adapter]);
    const context = { actorType: 'user' as const };
    await expect(service.execute(workspace.id, { command: 'inspect' }, context)).resolves.toMatchObject({ snapshot: { permissions: { accessibility: 'denied' } } });
    await expect(service.execute(workspace.id, { command: 'read', targetId: 'editor:1' }, context)).rejects.toThrow('The owner must enable');
    await expect(service.execute(workspace.id, { command: 'click', targetId: 'editor:1', space: 'window', x: 20, y: 20, button: 'left', count: 1 }, context)).rejects.toThrow('The owner must enable');
    await expect(service.observeAccessibility(workspace.id, 'editor:1', 'com.example.editor', async () => {})).rejects.toThrow('The owner must enable');
    await expect(service.observeWindow(workspace.id, 'editor:1', 'com.example.editor', async () => true, async () => {})).rejects.toThrow('The owner must enable');
    expect(adapter.read).not.toHaveBeenCalled();
    expect(adapter.click).not.toHaveBeenCalled();
    expect(adapter.screenshot).not.toHaveBeenCalled();
  });

  it('returns live native text without persisting it and gates guarded publication before native effects', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'Native guarded UI', workingDir: '/tmp' });
    await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'computer', payload: { computerConfig: { enabled: true, allowedApplications: ['com.example.editor'] } } });
    const policy = await autonomyPolicyService.get(workspace.id);
    await autonomyPolicyService.update(workspace.id, { enabled: true, mode: 'bounded', policy: { ...policy.policy, capabilities: ['computer'], allowedApps: ['com.example.editor'] } });
    const tree: ComputerAccessibility = { available: true, truncated: false, elements: [{ id: '0.0', role: 'text', name: 'private-recipient-fixture', value: 'private-draft-fixture', protected: false, enabled: true, focused: false, actions: ['press'] }] };
    const read = vi.fn(async () => structuredClone(tree));
    const interact = vi.fn(async () => structuredClone(tree));
    const adapter = Object.assign(new FakeAdapter(), { read, interact });
    const service = new ComputerService([adapter]);
    const context = { actorType: 'agent' as const, actorId: 'qa-agent', idempotencyKey: 'native-read-key' };
    const result = await service.execute(workspace.id, { command: 'batch', steps: [{ input: { command: 'read', targetId: 'editor:1' } }] }, context);
    expect(result).toMatchObject({ kind: 'batch', completed: true, steps: [{ result: { tree } }] });
    expect(adapter.screenshot).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledWith('editor:1', 'com.example.editor');
    const selector = { id: '0.0', role: 'text', name: 'private-recipient-fixture', value: 'private-draft-fixture' };
    const input = { command: 'interact' as const, targetId: 'editor:1', action: 'press' as const, element: selector, guards: [selector] };
    const sendContext = { ...context, idempotencyKey: 'native-send-key', risk: 'external_publication' as const };
    await expect(service.execute(workspace.id, input, sendContext)).rejects.toThrow('approval gate');
    expect(interact).not.toHaveBeenCalled();
    const gate = (await autonomyPolicyService.listGates(workspace.id))[0];
    await autonomyPolicyService.resolveGate(workspace.id, gate.id, 'approved', 'workspace-owner');
    expect(await service.execute(workspace.id, input, sendContext)).toMatchObject({ kind: 'accessibility', tree });
    expect(interact).toHaveBeenCalledTimes(1);
    expect(await service.execute(workspace.id, input, sendContext)).toMatchObject({ kind: 'action', completed: true });
    expect(interact).toHaveBeenCalledTimes(1);
    for (const persisted of [await autonomyPolicyService.exportAudit(workspace.id), await AgentComputerAction.query().where('workspace_id', workspace.id).get()]) {
      expect(JSON.stringify(persisted)).not.toMatch(/private-recipient-fixture|private-draft-fixture/);
    }
  });

  it.each(['read', 'observe'] as const)('allows background %s for the exact authorized window without native effects', async (operation) => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'Background observation', workingDir: '/tmp' });
    await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'computer', payload: { computerConfig: { enabled: true, allowedApplications: ['com.example.editor'], watch: { enabled: true, windowId: 'editor:1', applicationId: 'com.example.editor', routineId: workspace.id, taskId: workspace.id } } } });
    const policy = await autonomyPolicyService.get(workspace.id);
    await autonomyPolicyService.update(workspace.id, { enabled: true, mode: 'bounded', policy: { ...policy.policy, capabilities: ['computer'], allowedApps: ['com.example.editor'] } });
    const tree: ComputerAccessibility = { available: true, truncated: false, elements: [{ id: '0', role: 'text', name: 'Background content', value: '', protected: false, enabled: true, focused: false, actions: [] }] };
    const adapter = Object.assign(new FakeAdapter(), { read: vi.fn(async () => tree) });
    adapter.snapshot.mockResolvedValue({ ...structuredClone(snapshot), focusedWindowId: 'other:2', windows: [{ ...snapshot.windows[0], focused: false }, { ...snapshot.windows[0], id: 'other:2', appId: 'other.app', focused: true }] });
    const service = new ComputerService([adapter]);
    const result = operation === 'read'
      ? await service.execute(workspace.id, { command: 'read', targetId: 'editor:1' }, { actorType: 'user' })
      : await service.observeAccessibility(workspace.id, 'editor:1', 'com.example.editor', async () => {});
    expect(result).toMatchObject({ tree });
    expect(adapter.read).toHaveBeenCalledWith('editor:1', 'com.example.editor');
    for (const effect of [adapter.focus, adapter.type, adapter.typeSensitive, adapter.shortcut, adapter.click, adapter.screenshot]) expect(effect).not.toHaveBeenCalled();
    expect(JSON.stringify(await autonomyPolicyService.exportAudit(workspace.id))).not.toContain('Background content');
  });

  it('does not substitute a foreground window or another process for a missing observation target', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'Exact observation identity', workingDir: '/tmp' });
    await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'computer', payload: { computerConfig: { enabled: true, allowedApplications: ['com.example.editor'], watch: { enabled: true, windowId: 'editor:1', applicationId: 'com.example.editor', routineId: workspace.id, taskId: workspace.id } } } });
    const adapter = Object.assign(new FakeAdapter(), { read: vi.fn() });
    const service = new ComputerService([adapter]);
    for (const windows of [[], [{ ...snapshot.windows[0], id: 'other:2' }], [{ ...snapshot.windows[0], appId: 'other.app' }]]) {
      adapter.snapshot.mockResolvedValue({ ...snapshot, windows });
      await expect(service.observeAccessibility(workspace.id, 'editor:1', 'com.example.editor', async () => {})).rejects.toThrow('no longer available');
    }
    expect(adapter.read).not.toHaveBeenCalled();
    expect(adapter.focus).not.toHaveBeenCalled();
  });

  it.each([true, false])('uses only isolated capture for a background window (isolated=%s)', async (isolated) => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'Passive window capture', workingDir: '/tmp' });
    await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'computer', payload: { computerConfig: { enabled: true, allowedApplications: ['com.example.editor'], watch: { enabled: true, windowId: 'editor:1', applicationId: 'com.example.editor', routineId: workspace.id, taskId: workspace.id } } } });
    const policy = await autonomyPolicyService.get(workspace.id);
    await autonomyPolicyService.update(workspace.id, { enabled: true, mode: 'bounded', policy: { ...policy.policy, capabilities: ['computer'], allowedApps: ['com.example.editor'] } });
    const adapter = Object.assign(new FakeAdapter(), { backgroundWindowCapture: isolated });
    adapter.snapshot.mockResolvedValue({ ...snapshot, windows: [{ ...snapshot.windows[0], focused: false }], focusedWindowId: null });
    const accept = vi.fn(async () => false);
    const capture = vi.spyOn(computerEvidenceService, 'capture').mockImplementation(async (_workspace, _config, _passive, read, accept) => {
      await read('/tmp/passive-capture-fixture.png');
      await accept?.('/tmp/passive-capture-fixture.png');
      return null;
    });
    try {
      expect(await new ComputerService([adapter]).observeWindow(workspace.id, 'editor:1', 'com.example.editor', accept, async () => {})).toMatchObject({ state: isolated ? 'unchanged' : 'waiting_focus', capture: null });
      expect(adapter.screenshot).toHaveBeenCalledTimes(isolated ? 1 : 0);
      expect(accept).toHaveBeenCalledTimes(isolated ? 1 : 0);
      expect(adapter.focus).not.toHaveBeenCalled();
    } finally { capture.mockRestore(); }
  });

  it('fails a native fill with no draft precondition before touching the adapter', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'Native human draft', workingDir: '/tmp' });
    await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'computer', payload: { computerConfig: { enabled: true, allowedApplications: ['com.example.editor'] } } });
    const adapter = Object.assign(new FakeAdapter(), { interact: vi.fn() });
    const selector = { id: '0.0', role: 'text', name: 'Draft' };
    await expect(new ComputerService([adapter]).execute(workspace.id, { command: 'interact', action: 'fill', targetId: 'editor:1', text: 'new', element: selector, guards: [selector] }, { actorType: 'user' })).rejects.toThrow('exact existing draft');
    expect(adapter.interact).not.toHaveBeenCalled();
  });

  it('batches generic app actions with per-step idempotency and no plaintext in stored results', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'Batch', workingDir: '/tmp' });
    await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'computer', payload: { computerConfig: { enabled: true, allowedApplications: ['com.example.editor'] } } });
    const adapter = new FakeAdapter();
    const service = new ComputerService([adapter]);
    const input: ComputerCommandInput = { command: 'batch', steps: [{ input: { command: 'focus', windowId: 'editor:1' } }, { input: { command: 'type', text: 'private composed text', targetId: 'editor:1' } }, { input: { command: 'shortcut', keys: ['enter'], targetId: 'editor:1' } }] };
    const context = { actorType: 'user' as const, actorId: 'owner', idempotencyKey: 'test-batch-1' };
    expect(await service.execute(workspace.id, input, context)).toMatchObject({ kind: 'batch', completed: true, steps: [{ status: 'succeeded' }, { status: 'succeeded' }, { status: 'succeeded' }] });
    await service.execute(workspace.id, input, context);
    expect(adapter.type).toHaveBeenCalledTimes(1);
    expect(adapter.shortcut).toHaveBeenCalledTimes(1);
    const records = await AgentComputerAction.query().where('workspace_id', workspace.id).get();
    expect(records).toHaveLength(4);
    expect(JSON.stringify(records.map((row) => row.getAttribute('result_json')))).not.toContain('private composed text');
    await expect(service.execute(workspace.id, { ...input, steps: input.steps.slice(1) }, context)).rejects.toThrow('different request');
  });

  it('validates the complete batch before effects and blocks uncertain retries', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'Batch stop', workingDir: '/tmp' });
    await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'computer', payload: { computerConfig: { enabled: true, allowedApplications: ['com.example.editor'] } } });
    const adapter = new FakeAdapter();
    const service = new ComputerService([adapter]);
    await expect(service.execute(workspace.id, { command: 'batch', steps: [{ input: { command: 'type', text: 'text', targetId: 'editor:1' } }, { input: { command: 'unsafe' } }] } as never, { actorType: 'user' })).rejects.toThrow();
    expect(adapter.type).not.toHaveBeenCalled();
    adapter.type.mockRejectedValueOnce(new Error('Native input failed'));
    const input: ComputerCommandInput = { command: 'batch', steps: [{ input: { command: 'type', text: 'text', targetId: 'editor:1' } }, { input: { command: 'shortcut', keys: ['enter'], targetId: 'editor:1' } }] };
    const context = { actorType: 'user' as const, idempotencyKey: 'uncertain-batch' };
    expect(await service.execute(workspace.id, input, context)).toMatchObject({ completed: false, steps: [{ index: 0, status: 'failed' }] });
    expect(adapter.shortcut).not.toHaveBeenCalled();
    await expect(service.execute(workspace.id, input, context)).rejects.toThrow('automatic replay');
  });

  it('stops a batch at the publication gate and reports the exact gate ID', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'Batch gate', workingDir: '/tmp' });
    await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'computer', payload: { computerConfig: { enabled: true, allowedApplications: ['com.example.editor'] } } });
    const adapter = new FakeAdapter();
    const service = new ComputerService([adapter]);
    const execute = vi.spyOn(autonomyPolicyService, 'execute');
    execute.mockImplementationOnce(async (_request, action) => action());
    execute.mockRejectedValueOnce(new AutonomyGatePendingError({ id: 'approval-gate-1' } as never));
    try {
      const result = await service.execute(workspace.id, { command: 'batch', steps: [{ input: { command: 'type', text: 'hello', targetId: 'editor:1' } }, { input: { command: 'shortcut', keys: ['enter'], targetId: 'editor:1' } }, { input: { command: 'type', text: 'never', targetId: 'editor:1' } }] }, { actorType: 'user', idempotencyKey: 'gated-batch' });
      expect(result).toMatchObject({ completed: false, steps: [{ index: 0, status: 'succeeded' }, { index: 1, status: 'gated', gateId: 'approval-gate-1' }] });
      expect(adapter.type).toHaveBeenCalledTimes(1);
      expect(adapter.shortcut).not.toHaveBeenCalled();
    } finally { execute.mockRestore(); }
  });

  it('revalidates the active task between batch steps', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'Batch task revoked', workingDir: '/tmp' });
    await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'computer', payload: { computerConfig: { enabled: true, allowedApplications: ['com.example.editor'] } } });
    const adapter = new FakeAdapter();
    const relevant = vi.fn(async () => { if (adapter.type.mock.calls.length) throw new Error('Task was revoked'); });
    const result = await new ComputerService([adapter]).execute(workspace.id, { command: 'batch', steps: [{ input: { command: 'type', text: 'draft', targetId: 'editor:1' } }, { input: { command: 'shortcut', keys: ['enter'], targetId: 'editor:1' } }] }, { actorType: 'agent', actorId: 'agent', idempotencyKey: 'revoked-batch', assertRelevant: relevant });
    expect(result).toMatchObject({ completed: false, steps: [{ status: 'succeeded' }, { status: 'failed', error: 'Task was revoked' }] });
    expect(adapter.shortcut).not.toHaveBeenCalled();
  });

  it('validates manual commands through the real FormRequest boundary without leaking route parameters', async () => {
    const event = (body: unknown) => ({
      params: { id: '00000000-0000-7000-8000-000000000001' },
      url: new URL('http://localhost/computers/command'),
      request: new Request('http://localhost/computers/command', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      }),
    }) as never;
    const command = { command: 'screenshot', target: 'window', targetId: '42:cg:9' };
    await expect(ComputerCommandRequest.validate(event(command))).resolves.toMatchObject({ command });
    await expect(ComputerCommandRequest.validate(event({ ...command, bypassGate: true }))).rejects.toThrow();
    await expect(ComputerCommandRequest.validate(event({ command: 'shortcut', keys: ['cmd', 'a'], targetId: '42:cg:9' })))
      .resolves.toMatchObject({ command: { command: 'shortcut', keys: ['cmd', 'a'], targetId: '42:cg:9' } });
  });

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

  it.each(['user', 'agent'] as const)('uses fresh target observations and preserves the %s response scope', async (actorType) => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'Scoped native observations', workingDir: '/tmp' });
    await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'computer', payload: { computerConfig: { enabled: true, allowedApplications: ['com.example.editor'] } } });
    const adapter = new FakeAdapter();
    const service = new ComputerService([adapter]);
    await service.execute(workspace.id, { command: 'type', text: 'Ol\u00e1', targetId: 'editor:1' }, { actorType, actorId: 'qa-agent', idempotencyKey: 'unicode-input:1' });
    expect(adapter.snapshot).toHaveBeenCalledTimes(3);
    expect(adapter.snapshot).toHaveBeenNthCalledWith(1, { windowId: 'editor:1' });
    expect(adapter.snapshot).toHaveBeenNthCalledWith(2, { windowId: 'editor:1' });
    expect(adapter.snapshot).toHaveBeenNthCalledWith(3, actorType === 'user' ? undefined : { windowId: 'editor:1' });
    expect(adapter.type).toHaveBeenCalledWith('Ol\u00e1', { targetId: 'editor:1', appId: 'com.example.editor' });
    adapter.snapshot.mockClear();
    await service.snapshot(workspace.id);
    expect(adapter.snapshot).toHaveBeenCalledWith(undefined);
    adapter.snapshot.mockClear();
    await service.execute(workspace.id, { command: 'type', text: 'Ol\u00e1', targetId: 'editor:1' }, { actorType, actorId: 'qa-agent', idempotencyKey: 'unicode-input:1' });
    expect(adapter.snapshot).toHaveBeenLastCalledWith(actorType === 'user' ? undefined : { windowId: 'editor:1' });
    expect(adapter.type).toHaveBeenCalledTimes(1);
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
      const second = new ComputerService([adapter]).execute(workspace.id, { command: 'type', text: 'second', targetId: 'editor:1' }, { actorType: 'user' });
      await new Promise(resolve => setTimeout(resolve, 40));
      expect(adapter.type).toHaveBeenCalledTimes(1);
      release();
      await first;
      await second;
    } finally { release(); await first; }
    expect(adapter.type.mock.calls.map(call => (call[0] as unknown))).toEqual(['first', 'second']);
  });

  it('gives queued input priority over continued observation and revalidates revoked access', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'Observation arbitration', workingDir: '/tmp' });
    const config = { enabled: true, allowedApplications: ['com.example.editor'], watch: { enabled: true, windowId: 'editor:1', applicationId: 'com.example.editor', routineId: workspace.id, taskId: workspace.id } };
    const node = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'computer', payload: { computerConfig: config } });
    const policy = await autonomyPolicyService.get(workspace.id);
    await autonomyPolicyService.update(workspace.id, { enabled: true, mode: 'bounded', policy: { ...policy.policy, capabilities: ['computer'], allowedApps: ['com.example.editor'] } });
    let release!: () => void, entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const read = vi.fn(async () => { entered(); await new Promise<void>(resolve => { release = resolve; }); return { available: true, truncated: false, elements: [] }; });
    const adapter = Object.assign(new FakeAdapter(), { read });
    const service = new ComputerService([adapter]);
    const observation = service.observeAccessibility(workspace.id, 'editor:1', 'com.example.editor', async () => {});
    await started;
    const input = new ComputerService([adapter]).execute(workspace.id, { command: 'type', targetId: 'editor:1', text: 'pending input' }, { actorType: 'user' });
    const rejected = expect(input).rejects.toThrow(/disabled/i);
    await workspaceRepository.updateNode(node.id, { payload: { computerConfig: { ...config, enabled: false } } });
    release();
    await observation;
    expect(await service.observeAccessibility(workspace.id, 'editor:1', 'com.example.editor', async () => {})).toMatchObject({ state: 'waiting_agent' });
    await rejected;
    expect(adapter.type).not.toHaveBeenCalled();
    await workspaceRepository.updateNode(node.id, { payload: { computerConfig: config } });
    await service.execute(workspace.id, { command: 'type', targetId: 'editor:1', text: 'fresh input' }, { actorType: 'user' });
    expect(adapter.type).toHaveBeenCalledTimes(1);
  });

  it.each(['123:cg:1', '123:cg:2', '456:cg:3'])('isolates observation from a directed operation by process (%s)', async (observedId) => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'Per-process observation', workingDir: '/tmp' });
    await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'computer', payload: { computerConfig: {
      enabled: true, allowedApplications: ['com.example.editor'],
      watch: { enabled: true, windowId: observedId, applicationId: 'com.example.editor', routineId: workspace.id, taskId: workspace.id },
    } } });
    const policy = await autonomyPolicyService.get(workspace.id);
    await autonomyPolicyService.update(workspace.id, { enabled: true, mode: 'bounded', policy: { ...policy.policy, capabilities: ['computer'], allowedApps: ['com.example.editor'] } });
    const tree: ComputerAccessibility = { available: true, truncated: false, elements: [{ id: '0', role: 'text', name: 'Content', value: '', protected: false, enabled: true, focused: false, actions: [] }] };
    let release!: () => void, entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const read = vi.fn(async () => tree).mockImplementationOnce(async () => {
      entered(); await new Promise<void>(resolve => { release = resolve; }); return tree;
    });
    const adapter = Object.assign(new FakeAdapter(), { read, backgroundInteraction: true });
    adapter.snapshot.mockResolvedValue({ ...snapshot, focusedWindowId: null, windows: ['123:cg:1', '123:cg:2', '456:cg:3'].map(id => ({ ...snapshot.windows[0], id, focused: false })) });
    const service = new ComputerService([adapter]);
    const operation = service.execute(workspace.id, { command: 'read', targetId: '123:cg:1' }, { actorType: 'user' });
    try {
      await started;
      const observation = await new ComputerService([adapter]).observeAccessibility(workspace.id, observedId, 'com.example.editor', async () => {});
      expect(observation).toMatchObject(observedId.startsWith('123:') ? { state: 'waiting_agent' } : { state: 'read', tree });
      expect(read).toHaveBeenCalledTimes(observedId.startsWith('123:') ? 1 : 2);
      expect(adapter.focus).not.toHaveBeenCalled();
      expect(adapter.type).not.toHaveBeenCalled();
    } finally { release(); await operation; }
    await expect(service.observeAccessibility(workspace.id, observedId, 'com.example.editor', async () => {})).resolves.toMatchObject({ state: 'read', tree });
  });

  it('releases observation ownership after a native read fails', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'Observation failure cleanup', workingDir: '/tmp' });
    await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'computer', payload: { computerConfig: {
      enabled: true, allowedApplications: ['com.example.editor'],
      watch: { enabled: true, windowId: '123:cg:1', applicationId: 'com.example.editor', routineId: workspace.id, taskId: workspace.id },
    } } });
    const policy = await autonomyPolicyService.get(workspace.id);
    await autonomyPolicyService.update(workspace.id, { enabled: true, mode: 'bounded', policy: { ...policy.policy, capabilities: ['computer'], allowedApps: ['com.example.editor'] } });
    const read = vi.fn().mockRejectedValueOnce(new Error('Native process ended')).mockResolvedValue({ available: true, truncated: false, elements: [] });
    const adapter = Object.assign(new FakeAdapter(), { read });
    adapter.snapshot.mockResolvedValue({ ...snapshot, windows: [{ ...snapshot.windows[0], id: '123:cg:1' }] });
    const service = new ComputerService([adapter]);
    await expect(service.observeAccessibility(workspace.id, '123:cg:1', 'com.example.editor', async () => {})).rejects.toThrow('Native process ended');
    await service.observeAccessibility(workspace.id, '123:cg:1', 'com.example.editor', async () => {});
    expect(read).toHaveBeenCalledTimes(2);
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
    expect(adapter.click).toHaveBeenCalledWith(expect.objectContaining({ x: 610, y: 420 }), { targetId: 'editor:1', appId: 'com.example.editor' });
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
      expect(adapter.focus).not.toHaveBeenCalled();
      expect(adapter.snapshot).toHaveBeenCalledWith({ windowId: 'editor:1' });
      expect(adapter.typeSensitive).toHaveBeenCalledWith('never-persist-this-value', { targetId: 'editor:1', appId: 'com.example.editor' });
      expect(adapter.type).not.toHaveBeenCalledWith('never-persist-this-value');
      const audit = await autonomyPolicyService.exportAudit(workspace.id);
      expect(JSON.stringify(audit)).not.toContain('never-persist-this-value');
    } finally {
      delete state.__orkestraiHostVaultResolve;
    }
  });
});
