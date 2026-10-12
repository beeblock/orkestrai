import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { uuidv7 } from '@beeblock/svelar/support';
import { bridgeCanvasService, BridgeCanvasService, canvasNodeSummary, shellSummary, portalConfigurationSummary } from '$lib/modules/agent-room/application/services/BridgeCanvasService.js';
import { BridgeCanvasCommandDto } from '$lib/modules/agent-room/application/dto/BridgeCanvasCommandDto.js';
import { bridgeCanvasCommandSchema } from '$lib/modules/agent-room/contracts/schemas/bridge-canvas.schema.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { agentSessionService, AgentSessionService } from '$lib/modules/agent-room/application/services/AgentSessionService.js';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.js';
import { AgentBoardTask } from '$lib/modules/agent-room/domain/models/AgentBoardTask.js';
import { autonomyPolicyService } from '$lib/modules/agent-room/application/services/AutonomyPolicyService.js';
import { BridgeController } from '$lib/modules/agent-room/interface/http/controllers/BridgeController.js';
import { bridgeService } from '$lib/modules/agent-room/application/services/BridgeService.js';

describe('native Canvas agent delivery', () => {
  useSvelarTest({ refreshDatabase: true });
  afterEach(() => { ptySessionManager.killAll(); vi.restoreAllMocks(); });

  async function setup() {
    const workspace = await workspaceRepository.createWorkspace({ name: 'Any workspace', workingDir: '/tmp' });
    const agent = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Specialist', payload: { provider: 'codex', env: { PRIVATE_TEST_SECRET: 'never-expose-this' } } });
    const taskId = uuidv7();
    await AgentBoardTask.create({ id: taskId, workspace_id: workspace.id, title: 'Canvas delivery', status: 'doing', assignee_node_id: agent.id,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(), created_by: 'user' });
    const execute = async (input: unknown) => bridgeCanvasService.execute(workspace.id, agent.id,
      new BridgeCanvasCommandDto(bridgeCanvasCommandSchema.parse({ from: agent.id, taskId, input })));
    return { workspace, agent, taskId, execute };
  }

  it('moves a device below its Portal with Computer disabled and no OS permission dependency', async () => {
    const { workspace, execute } = await setup();
    await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'computer', payload: { computerConfig: { enabled: false } } });
    const portal = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'portal', x: 100, y: 200, height: 600 });
    const device = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'device', x: 900, y: 200 });
    const input = { command: 'layout', updates: [{ nodeId: device.id, revision: canvasNodeSummary(device).revision,
      changes: { x: portal.x, y: portal.y + portal.height + 40 } }] };
    await execute(input);
    // Exact retry is safe, without overwriting another user's later layout.
    await execute(input);
    expect(await workspaceRepository.getNode(device.id)).toMatchObject({ x: 100, y: 840 });
    expect(JSON.stringify(await bridgeCanvasService.list(workspace.id, { includeArchived: false, limit: 100 }))).not.toContain('never-expose-this');
  });

  it('configures exact Portal hosts without changing grants or browser state in any workspace', async () => {
    const { workspace, execute } = await setup();
    const portal = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'portal', payload: {
      portalAllowedHosts: ['127.0.0.1'], portalAllowBackground: false, url: 'http://127.0.0.1:3000',
      portalTabs: [{ id: 'existing', url: 'http://127.0.0.1:3000' }], privateToken: 'never-expose-this',
    } as never });
    const inventory = await bridgeCanvasService.list(workspace.id, { includeArchived: false, limit: 100 });
    const summary = inventory.nodes.find(node => node.nodeId === portal.id)!.portal!;
    const result = await execute({ command: 'configure_portal_hosts', nodeId: portal.id, revision: summary.revision,
      allowedHosts: ['LOCALHOST', '127.0.0.1', '[::1]', 'localhost'] });
    expect(result).toMatchObject({ portal: { allowedHosts: ['localhost', '127.0.0.1', '[::1]'] } });
    expect((await workspaceRepository.getNode(portal.id))!.payload).toMatchObject({
      portalAllowBackground: false, portalTabs: [{ id: 'existing', url: 'http://127.0.0.1:3000' }], privateToken: 'never-expose-this',
    });
    expect(JSON.stringify(result)).not.toContain('never-expose-this');
    await expect(execute({ command: 'configure_portal_hosts', nodeId: portal.id, revision: summary.revision,
      allowedHosts: ['example.com'] })).rejects.toThrow('configuration changed');
  });

  it.each([{ portalPaused: true }, { portalControl: 'read' }, { portalControl: 'disabled' },
    { portalAgentAccess: 'selected', portalAgentIds: [] }])('preserves explicit Portal restrictions: %j', async restriction => {
    const { workspace, execute } = await setup();
    const portal = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'portal',
      payload: { portalAllowedHosts: ['127.0.0.1'], ...restriction } as never });
    await expect(execute({ command: 'configure_portal_hosts', nodeId: portal.id,
      revision: portalConfigurationSummary(portal)!.revision, allowedHosts: ['localhost'] })).rejects.toThrow('explicit owner settings');
    expect((await workspaceRepository.getNode(portal.id))!.payload).toMatchObject({ portalAllowedHosts: ['127.0.0.1'], ...restriction });
  });

  it('checks an owner pause arriving between inventory and the serialized Portal write', async () => {
    const { workspace, execute } = await setup();
    const portal = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'portal', payload: { portalAllowedHosts: ['127.0.0.1'] } as never });
    const update = workspaceRepository.updateNode.bind(workspaceRepository);
    vi.spyOn(workspaceRepository, 'updateNode').mockImplementationOnce(async (id, changes, options) => {
      await update(id, { payload: { portalPaused: true } as never }, { mergePortalPayload: true });
      return update(id, changes, options);
    });
    await expect(execute({ command: 'configure_portal_hosts', nodeId: portal.id,
      revision: portalConfigurationSummary(portal)!.revision, allowedHosts: ['localhost'] })).rejects.toThrow('explicit owner settings');
    expect((await workspaceRepository.getNode(portal.id))!.payload).toMatchObject({ portalPaused: true, portalAllowedHosts: ['127.0.0.1'] });
  });

  it.each(['https://localhost', 'localhost:3000', '*.example.com', 'user@host', '../host'])('rejects invalid Portal hosts: %s', async host => {
    const { workspace, execute } = await setup();
    const portal = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'portal' });
    await expect(execute({ command: 'configure_portal_hosts', nodeId: portal.id,
      revision: portalConfigurationSummary(portal)!.revision, allowedHosts: [host] })).rejects.toThrow();
  });

  it('validates all layout targets before writing and refuses stale revisions or policy payloads', async () => {
    const { workspace, agent, execute } = await setup();
    const foreign = await workspaceRepository.createWorkspace({ name: 'Other', workingDir: '/tmp' });
    const other = await workspaceRepository.createNode({ workspaceId: foreign.id, type: 'computer' });
    await expect(execute({ command: 'layout', updates: [agent, other].map(node => ({ nodeId: node.id, revision: canvasNodeSummary(node).revision, changes: { x: 123 } })) })).rejects.toThrow('not in this workspace');
    expect((await workspaceRepository.getNode(agent.id))?.x).toBe(0);
    await expect(execute({ command: 'layout', updates: [{ nodeId: agent.id, revision: 'a'.repeat(64), changes: { x: 1 } }] })).rejects.toThrow('layout changed');
    await expect(execute({ command: 'layout', updates: [{ nodeId: agent.id, revision: canvasNodeSummary(agent).revision, changes: { payload: { computerConfig: { enabled: true } } } }] })).rejects.toThrow();
  });

  it('archives and restores notes without losing task links, content or edges', async () => {
    const { workspace, agent, taskId, execute } = await setup();
    const note = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'note', payload: { content: 'Approved references' } });
    await AgentBoardTask.query().where('id', taskId).update({ note_node_id: note.id });
    const edge = await workspaceRepository.createEdge({ workspaceId: workspace.id, sourceNodeId: agent.id, targetNodeId: note.id });
    await execute({ command: 'archive_note', nodeId: note.id });
    expect((await workspaceRepository.listNodes(workspace.id)).some(node => node.id === note.id)).toBe(false);
    expect(await workspaceRepository.getNode(note.id)).toMatchObject({ payload: { content: 'Approved references' } });
    expect((await AgentBoardTask.find(taskId))?.getAttribute('note_node_id')).toBe(note.id);
    expect(await workspaceRepository.listEdges(workspace.id)).toContainEqual(edge);
    await execute({ command: 'restore_note', nodeId: note.id });
    expect((await workspaceRepository.listNodes(workspace.id)).some(node => node.id === note.id)).toBe(true);
  });

  it('creates a Shell once with reusable automatic startup and rejects escaping cwd', async () => {
    const { workspace, execute } = await setup();
    const nodeId = uuidv7();
    const input = { command: 'create_shell', nodeId, title: 'Client dev', startupCommand: 'npm run dev', start: false };
    await execute(input);
    await execute(input);
    expect((await workspaceRepository.listNodes(workspace.id)).filter(node => node.id === nodeId)).toHaveLength(1);
    expect((await workspaceRepository.getNode(nodeId))?.payload).toMatchObject({ shellStartupManaged: true, currentWorkingDir: expect.stringMatching(/tmp$/),
      savedCommands: [{ id: expect.any(String), name: 'Client dev', command: 'npm run dev', runOnResume: true }] });
    await expect(execute({ ...input, startupCommand: 'different command' })).rejects.toThrow('another node or configuration');
    await expect(execute({ ...input, nodeId: uuidv7(), cwd: '../' })).rejects.toThrow('escapes');
  });

  it('submits managed startup once per PTY across service copies and concurrent callers', async () => {
    const { workspace, execute } = await setup();
    const nodeId = uuidv7();
    await execute({ command: 'create_shell', nodeId, title: 'Startup', startupCommand: 'echo startup-test', start: false });
    const pty = ptySessionManager.create({ command: '/bin/cat', cwd: '/tmp', workspaceId: workspace.id, nodeId });
    const write = vi.spyOn(ptySessionManager, 'write');
    const services = [agentSessionService, new AgentSessionService(), new AgentSessionService()];
    expect(await Promise.all(services.map(service => service.startManagedShell(workspace.id, nodeId, pty.id)))).toEqual([true, true, true]);
    expect(write).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledWith(pty.id, 'echo startup-test\r');
    await new AgentSessionService().startManagedShell(workspace.id, nodeId, pty.id);
    expect(write).toHaveBeenCalledOnce();
  });

  it('edits a legacy bridge Shell without owner intervention, replay or loss of other settings', async () => {
    const { workspace, execute } = await setup();
    const node = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Old command',
      payload: { command: '/bin/sh', currentWorkingDir: '/tmp', shellStartupManaged: true, env: { PRIVATE_TEST_SECRET: 'keep-private' },
        savedCommands: [{ id: 'existing-command', name: 'Old', command: 'echo old', runOnResume: true }] } });
    const pty = ptySessionManager.create({ command: '/bin/sh', cwd: '/tmp', workspaceId: workspace.id, nodeId: node.id });
    await agentSessionService.startManagedShell(workspace.id, node.id, pty.id);
    const write = vi.spyOn(ptySessionManager, 'write');
    const input = { command: 'update_shell', nodeId: node.id, revision: shellSummary(node)!.revision,
      changes: { startupCommand: 'echo corrected' } };
    expect(await execute(input)).toMatchObject({ updated: true, restartRequired: true });
    expect(await execute(input)).toMatchObject({ updated: false, restartRequired: true });
    expect(ptySessionManager.get(pty.id)?.exited).toBe(false);
    expect(write).not.toHaveBeenCalled();
    const saved = (await workspaceRepository.getNode(node.id))!;
    expect(saved.payload).toMatchObject({ env: { PRIVATE_TEST_SECRET: 'keep-private' },
      savedCommands: [{ id: 'existing-command', command: 'echo corrected', runOnResume: true }] });
    const inventory = await bridgeCanvasService.list(workspace.id, { includeArchived: false, limit: 100 });
    expect(inventory.nodes.find(item => item.nodeId === node.id)?.shell).toMatchObject({ revision: shellSummary(saved)!.revision, sessionId: pty.id });
    expect(JSON.stringify(inventory)).not.toMatch(/keep-private|echo corrected/);
  });

  it('rejects stale, cross-workspace, provider, archived and escaping Shell edits', async () => {
    const { workspace, agent, execute } = await setup();
    const nodeId = uuidv7();
    await execute({ command: 'create_shell', nodeId, title: 'Shell', start: false });
    const revision = shellSummary((await workspaceRepository.getNode(nodeId))!)!.revision;
    await execute({ command: 'update_shell', nodeId, revision, changes: { startupCommand: 'echo latest' } });
    await expect(execute({ command: 'update_shell', nodeId, revision, changes: { startupCommand: 'echo stale' } })).rejects.toThrow('configuration changed');
    await expect(execute({ command: 'update_shell', nodeId, revision, changes: { cwd: '../' } })).rejects.toThrow('escapes');
    await expect(execute({ command: 'update_shell', nodeId: agent.id, revision, changes: { title: 'Not a Shell' } })).rejects.toThrow('managed Shells');
    const other = await workspaceRepository.createWorkspace({ name: 'Foreign', workingDir: '/tmp' });
    const foreign = await workspaceRepository.createNode({ workspaceId: other.id, type: 'terminal', payload: { shellStartupManaged: true } });
    await expect(execute({ command: 'update_shell', nodeId: foreign.id, revision, changes: { title: 'Foreign' } })).rejects.toThrow('not in this workspace');
    await workspaceRepository.setNodeArchived(workspace.id, nodeId, true);
    await expect(execute({ command: 'update_shell', nodeId, revision, changes: { title: 'Archived' } })).rejects.toThrow('active managed');
  });

  it('serializes concurrent configuration changes and preserves manual saved commands', async () => {
    const { workspace, agent, taskId, execute } = await setup();
    const nodeId = uuidv7();
    await execute({ command: 'create_shell', nodeId, title: 'Shell', startupCommand: 'echo first', start: false });
    let node = (await workspaceRepository.getNode(nodeId))!;
    const payload = node.payload as any;
    node = (await workspaceRepository.updateNode(nodeId, { payload: { ...payload,
      savedCommands: [...payload.savedCommands, { id: 'manual', name: 'Check', command: 'echo manual', runOnResume: false }] } }))!;
    const revision = shellSummary(node)!.revision;
    const outcomes = await Promise.allSettled(['echo A', 'echo B'].map(startupCommand => new BridgeCanvasService().execute(workspace.id, agent.id,
      new BridgeCanvasCommandDto(bridgeCanvasCommandSchema.parse({ from: agent.id, taskId, input: { command: 'update_shell', nodeId, revision, changes: { startupCommand } } })))));
    expect(outcomes.map(item => item.status)).toEqual(['fulfilled', 'rejected']);
    expect((await workspaceRepository.getNode(nodeId))!.payload).toMatchObject({ savedCommands: [
      { id: payload.savedCommands[0].id, command: 'echo A' }, { id: 'manual', command: 'echo manual', runOnResume: false },
    ] });
  });

  it('restarts the owned Shell with the corrected command once and refuses a stale-session retry', async () => {
    const { workspace, execute } = await setup();
    const nodeId = uuidv7();
    await execute({ command: 'create_shell', nodeId, title: 'Restart', startupCommand: 'echo old', start: false });
    const node = (await workspaceRepository.getNode(nodeId))!;
    const old = ptySessionManager.create({ command: '/bin/sh', cwd: '/tmp', workspaceId: workspace.id, nodeId });
    const sibling = ptySessionManager.create({ command: '/bin/sh', cwd: '/tmp', workspaceId: workspace.id, nodeId: uuidv7() });
    const updated = await execute({ command: 'update_shell', nodeId, revision: shellSummary(node)!.revision,
      changes: { startupCommand: 'echo corrected' } }) as any;
    const write = vi.spyOn(ptySessionManager, 'write');
    const input = { command: 'restart_shell', nodeId, revision: updated.shell.revision, expectedSessionId: old.id };
    const result = await execute(input) as any;
    expect(result).toMatchObject({ startupSubmitted: true, shell: { sessionId: result.sessionId } });
    expect(result.sessionId).not.toBe(old.id);
    expect(ptySessionManager.get(old.id)).toBeNull();
    expect(ptySessionManager.get(sibling.id)?.exited).toBe(false);
    expect(write).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledWith(result.sessionId, 'echo corrected\r');
    await expect(execute(input)).rejects.toThrow('session changed');
    expect(write).toHaveBeenCalledOnce();
    expect(ptySessionManager.get(result.sessionId)?.exited).toBe(false);
  });

  it('does not stop a Shell when configuration changed or the workspace is halted', async () => {
    const { workspace, execute } = await setup();
    const nodeId = uuidv7();
    await execute({ command: 'create_shell', nodeId, title: 'Keep running', start: false });
    const pty = ptySessionManager.create({ command: '/bin/sh', cwd: '/tmp', workspaceId: workspace.id, nodeId });
    await expect(execute({ command: 'restart_shell', nodeId, revision: 'a'.repeat(64), expectedSessionId: pty.id })).rejects.toThrow('configuration changed');
    const revision = shellSummary((await workspaceRepository.getNode(nodeId))!)!.revision;
    await autonomyPolicyService.emergencyStop(workspace.id);
    await expect(execute({ command: 'restart_shell', nodeId, revision, expectedSessionId: pty.id })).rejects.toThrow('halted');
    expect(ptySessionManager.get(pty.id)?.exited).toBe(false);
  });

  it('does not replay an uncertain startup or ignore an explicit workspace halt', async () => {
    const { workspace, execute } = await setup();
    const nodeId = uuidv7();
    await execute({ command: 'create_shell', nodeId, title: 'Startup', startupCommand: 'echo startup', start: false });
    const pty = ptySessionManager.create({ command: '/bin/cat', cwd: '/tmp', workspaceId: workspace.id, nodeId });
    const write = vi.spyOn(ptySessionManager, 'write').mockImplementation(() => { throw new Error('Uncertain write'); });
    await expect(agentSessionService.startManagedShell(workspace.id, nodeId, pty.id)).rejects.toThrow();
    await expect(new AgentSessionService().startManagedShell(workspace.id, nodeId, pty.id)).rejects.toThrow('uncertain');
    expect(write).toHaveBeenCalledOnce();
    await autonomyPolicyService.emergencyStop(workspace.id);
    await expect(execute({ command: 'archive_note', nodeId })).rejects.toThrow('halted');
  });

  it('requires the real assigned terminal identity, not a spoofed from field', async () => {
    const { workspace, agent, taskId } = await setup();
    const token = await bridgeService.getOrCreateToken(workspace.id);
    const controller = new BridgeController();
    const url = new URL('http://localhost/api/agent-room/bridge/canvas');
    const response = await controller.canvasCommand({ url, params: {}, request: new Request(url, { method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: agent.id, taskId, input: { command: 'create_shell', nodeId: uuidv7(), title: 'Spoofed', start: false } }) }) } as any) as Response;
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('active terminal identity');
  });

  it.each([false, true])('allows native Canvas delivery for specialists and leaders (leader: %s)', async maestro => {
    const { workspace, agent, taskId } = await setup();
    await workspaceRepository.updateNode(agent.id, { payload: { ...agent.payload, maestro } });
    ptySessionManager.create({ command: '/bin/cat', cwd: '/tmp', provider: 'codex', workspaceId: workspace.id, nodeId: agent.id, bridgeAgentToken: 'test-live-token' });
    const token = await bridgeService.getOrCreateToken(workspace.id);
    const url = new URL('http://localhost/api/agent-room/bridge/canvas');
    const controller = new BridgeController();
    const nodeId = uuidv7();
    const response = await controller.canvasCommand({ url, params: {}, request: new Request(url, { method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'x-orkestrai-agent-token': 'test-live-token', 'content-type': 'application/json' },
      body: JSON.stringify({ from: agent.id, taskId, input: { command: 'create_shell', nodeId, title: 'Dev server', start: false } }) }) } as any) as Response;
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ nodeId, startupSubmitted: false });
    expect((await workspaceRepository.getNode(nodeId))?.workspaceId).toBe(workspace.id);
    const revision = shellSummary((await workspaceRepository.getNode(nodeId))!)!.revision;
    const edit = await controller.canvasCommand({ url, params: {}, request: new Request(url, { method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'x-orkestrai-agent-token': 'test-live-token', 'content-type': 'application/json' },
      body: JSON.stringify({ from: agent.id, taskId, input: { command: 'update_shell', nodeId, revision, changes: { startupCommand: 'echo corrected' } } }) }) } as any) as Response;
    expect(edit.status).toBe(200);
    expect((await edit.json()).data).toMatchObject({ updated: true, restartRequired: false });
    const portal = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'portal',
      payload: { portalAllowedHosts: ['127.0.0.1'] } as never });
    const configured = await controller.canvasCommand({ url, params: {}, request: new Request(url, { method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'x-orkestrai-agent-token': 'test-live-token', 'content-type': 'application/json' },
      body: JSON.stringify({ from: agent.id, taskId, input: { command: 'configure_portal_hosts', nodeId: portal.id,
        revision: portalConfigurationSummary(portal)!.revision, allowedHosts: ['localhost', '127.0.0.1', '[::1]'] } }) }) } as any) as Response;
    expect(configured.status).toBe(200);
    expect((await configured.json()).data).toMatchObject({ portal: { allowedHosts: ['localhost', '127.0.0.1', '[::1]'] } });
  });
});
