import { afterEach, describe, expect, it } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { uuidv7 } from '@beeblock/svelar/support';
import { TransferCanvasNodesDto } from '$lib/modules/agent-room/application/dto/TransferCanvasNodesDto.js';
import { canvasNodeTransferService } from '$lib/modules/agent-room/application/services/CanvasNodeTransferService.js';
import { designDocumentService } from '$lib/modules/agent-room/application/services/DesignDocumentService.js';
import { AgentBoardTask } from '$lib/modules/agent-room/domain/models/AgentBoardTask.js';
import { AgentRoutine } from '$lib/modules/agent-room/domain/models/AgentRoutine.js';
import type { ApiClientNodePayload, NoteNodePayload, TerminalNodePayload } from '$lib/modules/agent-room/domain/types.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';

describe('CanvasNodeTransfer', () => {
  useSvelarTest({ refreshDatabase: true });
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  async function workspacePair() {
    const sourceRoot = await mkdtemp(join(tmpdir(), 'orkestrai-transfer-source-'));
    const destinationRoot = await mkdtemp(join(tmpdir(), 'orkestrai-transfer-destination-'));
    roots.push(sourceRoot, destinationRoot);
    const source = await workspaceRepository.createWorkspace({ name: 'Source', workingDir: sourceRoot });
    const destination = await workspaceRepository.createWorkspace({ name: 'Destination', workingDir: destinationRoot });
    return { source, destination, sourceRoot, destinationRoot };
  }

  it('copies nodes, internal edges, note attachments, and native designs without live runtime state', async () => {
    const { source, destination, sourceRoot, destinationRoot } = await workspacePair();
    const attachmentId = uuidv7();
    const attachmentPath = `.orkestrai/attachments/${attachmentId}-brief.txt`;
    await mkdir(join(sourceRoot, '.orkestrai', 'attachments'), { recursive: true });
    await writeFile(join(sourceRoot, attachmentPath), 'transfer me');
    const terminal = await workspaceRepository.createNode({
      workspaceId: source.id,
      type: 'terminal',
      title: 'Creative lead',
      x: 120,
      y: 80,
      payload: { provider: 'codex', sessionId: 'pty-live', agentSessionId: uuidv7(), currentWorkingDir: sourceRoot, env: { ACCESS_TOKEN: 'secret' }, maestro: true },
    });
    const note = await workspaceRepository.createNode({
      workspaceId: source.id,
      type: 'note',
      title: 'Brief',
      x: 720,
      y: 80,
      payload: { content: '# Brief', attachments: [{ id: attachmentId, kind: 'file', name: 'brief.txt', path: attachmentPath, url: null, mimeType: 'text/plain', size: 11 }] },
    });
    const design = await workspaceRepository.createNode({ workspaceId: source.id, type: 'design', title: 'Campaign', x: 120, y: 520, payload: { schemaVersion: 1 } });
    const outside = await workspaceRepository.createNode({ workspaceId: source.id, type: 'shape', title: 'Outside' });
    await designDocumentService.get(source.id, design.id);
    await workspaceRepository.createEdge({ workspaceId: source.id, sourceNodeId: terminal.id, targetNodeId: note.id });
    await workspaceRepository.createEdge({ workspaceId: source.id, sourceNodeId: terminal.id, targetNodeId: outside.id });

    const result = await canvasNodeTransferService.transfer(new TransferCanvasNodesDto(source.id, destination.id, [terminal.id, note.id, design.id], 'copy'));

    expect(result.nodes).toHaveLength(3);
    expect(result.edges).toHaveLength(1);
    expect(await workspaceRepository.listNodes(source.id)).toHaveLength(4);
    const copiedTerminalPayload = result.nodes.find((node) => node.type === 'terminal')!.payload as TerminalNodePayload;
    expect(copiedTerminalPayload).toMatchObject({ provider: 'codex', maestro: true, resumeRecovery: false });
    expect(copiedTerminalPayload.sessionId).toBeUndefined();
    expect(copiedTerminalPayload.agentSessionId).toBeUndefined();
    expect(copiedTerminalPayload.currentWorkingDir).toBeUndefined();
    expect(copiedTerminalPayload.env).toBeUndefined();
    const copiedNote = result.nodes.find((node) => node.type === 'note')!;
    const copiedAttachment = (copiedNote.payload as NoteNodePayload).attachments![0];
    expect(copiedAttachment.id).not.toBe(attachmentId);
    expect(await readFile(join(destinationRoot, copiedAttachment.path!), 'utf8')).toBe('transfer me');
    const copiedDesign = result.nodes.find((node) => node.type === 'design')!;
    const copiedDocument = await designDocumentService.get(destination.id, copiedDesign.id);
    expect(copiedDocument).toMatchObject({ nodeId: copiedDesign.id, workspaceId: destination.id, name: 'Campaign', revision: 0 });
  });

  it('moves nodes atomically, detaches source tasks, and avoids duplicate leaders and titles', async () => {
    const { source, destination } = await workspacePair();
    const terminal = await workspaceRepository.createNode({ workspaceId: source.id, type: 'terminal', title: 'Lead', payload: { provider: 'codex', maestro: true } });
    const note = await workspaceRepository.createNode({ workspaceId: source.id, type: 'note', title: 'Decision', payload: { content: 'Approved' } });
    await workspaceRepository.createNode({ workspaceId: destination.id, type: 'terminal', title: 'Lead', payload: { provider: 'claude', maestro: true } });
    const taskId = uuidv7();
    const now = new Date().toISOString();
    await AgentBoardTask.create({ id: taskId, workspace_id: source.id, title: 'Tracked', description: '', status: 'todo', assignee_node_id: terminal.id, note_node_id: note.id, created_by: 'user', created_at: now, updated_at: now });

    const result = await canvasNodeTransferService.transfer(new TransferCanvasNodesDto(source.id, destination.id, [terminal.id, note.id], 'move'));

    expect(await workspaceRepository.listNodes(source.id)).toHaveLength(0);
    expect(result.nodes.find((node) => node.type === 'terminal')).toMatchObject({ title: 'Lead 2', payload: expect.objectContaining({ maestro: false }) });
    const task = await AgentBoardTask.find(taskId);
    expect(task?.getAttribute('assignee_node_id')).toBeNull();
    expect(task?.getAttribute('note_node_id')).toBeNull();
  });

  it('leaves both workspaces untouched when an asset cannot be copied', async () => {
    const { source, destination } = await workspacePair();
    const image = await workspaceRepository.createNode({ workspaceId: source.id, type: 'image', payload: { path: 'missing.png' } });

    await expect(canvasNodeTransferService.transfer(new TransferCanvasNodesDto(source.id, destination.id, [image.id], 'move')))
      .rejects.toThrow('canvas_transfer_asset_missing');
    expect(await workspaceRepository.listNodes(source.id)).toHaveLength(1);
    expect(await workspaceRepository.listNodes(destination.id)).toHaveLength(0);
  });

  it('rejects assets that escape the workspace through a symlink', async () => {
    const { source, destination, sourceRoot } = await workspacePair();
    const externalRoot = await mkdtemp(join(tmpdir(), 'orkestrai-transfer-external-'));
    roots.push(externalRoot);
    await writeFile(join(externalRoot, 'secret.txt'), 'outside workspace');
    await symlink(join(externalRoot, 'secret.txt'), join(sourceRoot, 'linked.txt'));
    const note = await workspaceRepository.createNode({
      workspaceId: source.id,
      type: 'note',
      payload: { content: '', attachments: [{ id: uuidv7(), kind: 'file', name: 'linked.txt', path: 'linked.txt', url: null, mimeType: 'text/plain', size: 17 }] },
    });

    await expect(canvasNodeTransferService.transfer(new TransferCanvasNodesDto(source.id, destination.id, [note.id], 'copy')))
      .rejects.toThrow('canvas_transfer_asset_invalid');
    expect(await workspaceRepository.listNodes(destination.id)).toHaveLength(0);
  });

  it('blocks moving a terminal that still owns a routine', async () => {
    const { source, destination } = await workspacePair();
    const terminal = await workspaceRepository.createNode({ workspaceId: source.id, type: 'terminal', title: 'Worker', payload: {} });
    await AgentRoutine.create({ id: uuidv7(), workspace_id: source.id, target_node_id: terminal.id, prompt: 'Work', interval_minutes: 5, enabled: true, last_run_at: null, run_count: 0, created_at: new Date().toISOString() });

    await expect(canvasNodeTransferService.transfer(new TransferCanvasNodesDto(source.id, destination.id, [terminal.id], 'move')))
      .rejects.toThrow('canvas_transfer_active_routine');
  });

  it('copies API definitions without source metadata or known credential fields', async () => {
    const { source, destination } = await workspacePair();
    const apiClient = await workspaceRepository.createNode({
      workspaceId: source.id,
      type: 'apiClient',
      title: 'Payments',
      payload: {
        sourceKind: 'postman',
        sourcePath: 'collections/payments.json',
        sourceCollection: { variable: [{ key: 'api_token', value: 'raw-secret' }] },
        variables: { api_key: 'secret', region: 'us-east' },
        environments: { local: { password: 'secret', host: 'localhost' } },
        globalVariables: { access_token: 'secret' },
        vaultKeys: ['jwt'],
        requests: [{
          id: 'request-1',
          name: 'Charge',
          method: 'POST',
          url: 'https://example.test/charge',
          headers: [{ id: 'header-1', name: 'Authorization', value: 'Bearer secret', enabled: true }],
          params: [],
          formFields: [],
          auth: { type: 'bearer', token: 'secret', username: '', password: '', value: '', oauth2: { clientSecret: 'secret', password: '', accessToken: 'secret', refreshToken: 'secret', expiresAt: 'tomorrow' } },
          sourcePath: 'charge.bru',
          sourceData: { kind: 'postman', data: { token: 'raw-secret' } },
        }],
        folders: [{ id: 'folder-1', name: 'Payments', parentId: null, sequence: 0, sourceData: { kind: 'postman', data: { auth: 'raw-secret' } } }],
        network: { cookies: [{ key: 'sid', value: 'secret' }], proxyUrl: 'https://user:secret@proxy.test', caPath: '/tmp/ca.pem', clientCertificatePath: '/tmp/cert.pem', clientKeyPath: '/tmp/key.pem', clientPfxPath: '/tmp/cert.pfx', clientKeyPassphrase: 'secret' },
      },
    });

    const result = await canvasNodeTransferService.transfer(new TransferCanvasNodesDto(source.id, destination.id, [apiClient.id], 'copy'));
    const payload = result.nodes[0].payload as ApiClientNodePayload;
    expect(payload).toMatchObject({ sourceKind: null, sourcePath: null, sourceCollection: null, vaultKeys: [], history: [] });
    expect(payload.variables).toEqual({ api_key: '', region: 'us-east' });
    expect(payload.environments).toEqual({ local: { password: '', host: 'localhost' } });
    expect(payload.requests?.[0].auth.token).toBe('');
    expect(payload.requests?.[0].headers?.[0].value).toBe('');
    expect(payload.requests?.[0].sourceData).toBeUndefined();
    expect(payload.folders?.[0].sourceData).toBeUndefined();
    expect(payload.network).toMatchObject({ cookies: [], proxyUrl: '', caPath: '', clientCertificatePath: '' });
  });

  it('does not duplicate single-instance tools in a destination workspace', async () => {
    const { source, destination } = await workspacePair();
    const usage = await workspaceRepository.createNode({ workspaceId: source.id, type: 'usage', payload: {} });
    await workspaceRepository.createNode({ workspaceId: destination.id, type: 'usage', payload: {} });

    await expect(canvasNodeTransferService.transfer(new TransferCanvasNodesDto(source.id, destination.id, [usage.id], 'copy')))
      .rejects.toThrow('canvas_transfer_singleton_exists');
  });
});
