import { afterEach, describe, expect, it } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { uuidv7 } from '@beeblock/svelar/support';
import { TransferCanvasNodesDto } from '$lib/modules/agent-room/application/dto/TransferCanvasNodesDto.js';
import { canvasNodeTransferService } from '$lib/modules/agent-room/application/services/CanvasNodeTransferService.js';
import { CanvasNodeTransferController } from '$lib/modules/agent-room/interface/http/controllers/CanvasNodeTransferController.js';
import { TransferCanvasNodesRequest } from '$lib/modules/agent-room/interface/http/requests/TransferCanvasNodesRequest.js';
import { designDocumentService } from '$lib/modules/agent-room/application/services/DesignDocumentService.js';
import { AgentBoardTask } from '$lib/modules/agent-room/domain/models/AgentBoardTask.js';
import { AgentRoutine } from '$lib/modules/agent-room/domain/models/AgentRoutine.js';
import type { ApiClientNodePayload, CanvasNodeTransferResult, ImageNodePayload, NoteNodePayload, TerminalNodePayload } from '$lib/modules/agent-room/domain/types.js';
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

  function transferEvent(sourceWorkspaceId: string, body: unknown) {
    const url = new URL(`http://localhost/api/agent-room/workspaces/${sourceWorkspaceId}/nodes/transfer`);
    return {
      params: { id: sourceWorkspaceId }, url,
      request: new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    } as never;
  }

  it('validates the actual HTTP request without treating the workspace route id as an extra transfer field', async () => {
    const body = { destinationWorkspaceId: uuidv7(), nodeIds: Array.from({ length: 59 }, () => uuidv7()), mode: 'copy' };
    await expect(TransferCanvasNodesRequest.validate(transferEvent(uuidv7(), body))).resolves.toEqual(body);
    await expect(TransferCanvasNodesRequest.validate(transferEvent(uuidv7(), { ...body, unexpected: true }))).rejects.toThrow('invalid');
    const maximum = { ...body, nodeIds: Array.from({ length: 100 }, () => uuidv7()) };
    await expect(TransferCanvasNodesRequest.validate(transferEvent(uuidv7(), maximum))).resolves.toEqual(maximum);
    await expect(TransferCanvasNodesRequest.validate(transferEvent(uuidv7(), { ...body, nodeIds: [body.nodeIds[0], body.nodeIds[0]] })))
      .resolves.toMatchObject({ nodeIds: [body.nodeIds[0]] });
  });

  it('rejects invalid HTTP selections before writes and never lets a body id override the source workspace', async () => {
    const { source, destination } = await workspacePair();
    const node = await workspaceRepository.createNode({ workspaceId: source.id, type: 'note', payload: { content: 'Keep me' } });
    const foreign = await workspaceRepository.createNode({ workspaceId: destination.id, type: 'note', payload: { content: 'Other workspace' } });
    const controller = new CanvasNodeTransferController();
    const body = { destinationWorkspaceId: destination.id, nodeIds: [node.id], mode: 'move' };
    for (const invalid of [
      { ...body, unexpected: true }, { ...body, nodeIds: [] }, { ...body, nodeIds: ['invalid'] },
      { ...body, nodeIds: Array.from({ length: 101 }, () => uuidv7()) }, { ...body, mode: 'delete' },
    ]) {
      const response = await controller.store(transferEvent(source.id, invalid));
      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: 'canvas_transfer_invalid_request' });
    }
    const spoofed = await controller.store(transferEvent(source.id, { ...body, id: destination.id, nodeIds: [foreign.id] }));
    expect(spoofed.status).toBe(400);
    expect(await spoofed.json()).toEqual({ error: 'canvas_transfer_node_not_found' });
    expect(await workspaceRepository.listNodes(source.id)).toEqual([node]);
    expect(await workspaceRepository.listNodes(destination.id)).toEqual([foreign]);
  });

  it.each(['copy', 'move'] as const)('%s transfers 59 nodes and their internal edges through HTTP validation and the real transaction', async (mode) => {
    const { source, destination } = await workspacePair();
    const nodes = [];
    for (let index = 0; index < 59; index++) {
      nodes.push(await workspaceRepository.createNode({
        workspaceId: source.id, type: index % 2 ? 'shape' : 'note', title: `Item ${index}`,
        x: index * 140, y: index % 3 * 120, payload: { content: `Content ${index}` },
      }));
      if (index) await workspaceRepository.createEdge({ workspaceId: source.id, sourceNodeId: nodes[index - 1].id, targetNodeId: nodes[index].id });
    }
    const outside = await workspaceRepository.createNode({ workspaceId: source.id, type: 'note', title: 'Not selected' });
    await workspaceRepository.createEdge({ workspaceId: source.id, sourceNodeId: nodes[0].id, targetNodeId: outside.id });
    const response = await new CanvasNodeTransferController().store(transferEvent(source.id, {
      destinationWorkspaceId: destination.id, nodeIds: nodes.map(node => node.id), mode,
    }));

    expect(response.status).toBe(201);
    const { data } = await response.json();
    expect(data.nodes).toHaveLength(59);
    expect(data.edges).toHaveLength(58);
    expect(await workspaceRepository.listNodes(destination.id)).toHaveLength(59);
    const destinationIds = new Set(data.nodes.map((node: { id: string }) => node.id));
    for (const edge of data.edges) {
      expect(destinationIds.has(edge.sourceNodeId)).toBe(true);
      expect(destinationIds.has(edge.targetNodeId)).toBe(true);
    }
    expect(await workspaceRepository.listNodes(source.id)).toHaveLength(mode === 'copy' ? 60 : 1);
    expect(await workspaceRepository.getNode(outside.id)).not.toBeNull();
    expect(await workspaceRepository.listEdges(source.id)).toHaveLength(mode === 'copy' ? 59 : 0);
    for (let index = 0; index < nodes.length; index++) {
      expect(data.nodes[index].id).not.toBe(nodes[index].id);
      expect(data.nodes[index].payload).toEqual(nodes[index].type === 'note' ? { ...nodes[index].payload, attachments: [] } : nodes[index].payload);
      expect(data.nodes[index].x - data.nodes[0].x).toBe(nodes[index].x - nodes[0].x);
      expect(data.nodes[index].y - data.nodes[0].y).toBe(nodes[index].y - nodes[0].y);
    }
  });

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

    const response = await new CanvasNodeTransferController().store(transferEvent(source.id, {
      destinationWorkspaceId: destination.id, nodeIds: [terminal.id, note.id, design.id], mode: 'copy',
    }));
    expect(response.status).toBe(201);
    const { data: result } = await response.json() as { data: CanvasNodeTransferResult };

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

  it('copies an exact-delivery image together with its preserved native master', async () => {
    const { source, destination, sourceRoot, destinationRoot } = await workspacePair();
    const outputPath = 'generated/images/slide.png';
    const masterPath = 'generated/images/.masters/slide-native.png';
    await mkdir(join(sourceRoot, 'generated', 'images', '.masters'), { recursive: true });
    await writeFile(join(sourceRoot, outputPath), 'exact delivery');
    await writeFile(join(sourceRoot, masterPath), 'native master');
    const workflow = await workspaceRepository.createNode({
      workspaceId: source.id,
      type: 'imageWorkflow',
      title: 'TikTok workflow',
      payload: { schemaVersion: 1, status: 'idle', history: [] },
    });
    const image = await workspaceRepository.createNode({
      workspaceId: source.id,
      type: 'image',
      title: 'TikTok slide',
      payload: {
        path: outputPath,
        generatedBy: {
          workflowNodeId: workflow.id,
          runId: uuidv7(),
          outputIndex: 0,
          inputHash: 'hash',
          sourceMasterPath: masterPath,
          targetWidth: 1080,
          targetHeight: 1920,
        },
      },
    });

    const result = await canvasNodeTransferService.transfer(new TransferCanvasNodesDto(source.id, destination.id, [workflow.id, image.id], 'copy'));
    const copiedNode = result.nodes.find((node) => node.type === 'image')!;
    const copied = copiedNode.payload as ImageNodePayload;

    expect(copied.path).toContain(`.orkestrai/transfers/${copiedNode.id}/`);
    expect(copied.generatedBy?.sourceMasterPath).toContain(`.orkestrai/transfers/${copiedNode.id}/masters/`);
    expect(await readFile(join(destinationRoot, copied.path!), 'utf8')).toBe('exact delivery');
    expect(await readFile(join(destinationRoot, copied.generatedBy!.sourceMasterPath!), 'utf8')).toBe('native master');
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
