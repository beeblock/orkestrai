import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addImageWorkflowReferenceSchema,
  completeImageWorkflowSchema,
  imageWorkflowConfigSchema,
} from '$lib/modules/agent-room/contracts/schemas/imageWorkflowSchemas.js';
import { ImageWorkflowError, ImageWorkflowService } from '$lib/modules/agent-room/application/services/ImageWorkflowService.js';
import {
  ConnectImageWorkflowNodeDto,
  CreateImageWorkflowDto,
  RunImageWorkflowDto,
  UpdateImageWorkflowDto,
} from '$lib/modules/agent-room/application/dto/ImageWorkflowDtos.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { filesystemService } from '$lib/modules/agent-room/application/services/FilesystemService.js';
import { bridgeService } from '$lib/modules/agent-room/application/services/BridgeService.js';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function config(overrides: Record<string, unknown> = {}) {
  return imageWorkflowConfigSchema.parse({
    prompt: 'Create an atomic ant character.',
    count: 1,
    transparentBackground: true,
    outputDirectory: 'generated/images',
    filePrefix: 'atomic-ant',
    ...overrides,
  });
}

function setupWorkflow(options: { provider?: string; sessionAlive?: boolean; references?: boolean } = {}) {
  const workspace = {
    id: 'workspace-1', name: 'Image lab', workingDir: '/workspace', runtimeKind: 'native',
    wslDistribution: null, wslWorkingDir: null, icon: null, instructions: null,
    syncAgentInstructionFiles: true, repositoryRoots: [], hooks: {}, suspendedAt: null,
    groupId: null, position: 0, createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
  } as any;
  let workflow = {
    id: 'workflow-1', workspaceId: workspace.id, type: 'imageWorkflow', title: 'Character poses',
    x: 10, y: 20, width: 440, height: 560, zIndex: 2, floorId: null,
    payload: { ...config(), history: [], status: 'idle' },
  } as any;
  const note = {
    ...workflow, id: 'note-1', type: 'note', title: 'Visual brief',
    payload: { content: '# Palette\nRed, white, and black.' },
  } as any;
  const reference = {
    ...workflow, id: 'reference-1', type: 'image', title: 'Atomic ant',
    payload: { path: 'references/atomic-ant.png' },
  } as any;
  const executor = {
    ...workflow, id: 'agent-1', type: 'terminal', title: 'Creative Director',
    payload: { provider: options.provider ?? 'codex', sessionId: 'session-1' },
  } as any;
  const nodes = [workflow, note, ...(options.references === false ? [] : [reference]), executor];
  const edges = [
    { id: 'edge-note', sourceNodeId: note.id, targetNodeId: workflow.id },
    ...(options.references === false ? [] : [{ id: 'edge-reference', sourceNodeId: reference.id, targetNodeId: workflow.id }]),
    { id: 'edge-executor', sourceNodeId: executor.id, targetNodeId: workflow.id },
  ] as any;
  const agent = {
    nodeId: executor.id, title: executor.title, provider: options.provider ?? 'codex', command: 'codex',
    sessionId: 'session-1', sessionAlive: options.sessionAlive ?? true, maestro: false,
  };

  vi.spyOn(workspaceRepository, 'getWorkspace').mockResolvedValue(workspace);
  vi.spyOn(workspaceRepository, 'getNode').mockImplementation(async (id) => id === workflow.id ? workflow : nodes.find((node) => node.id === id) ?? null);
  vi.spyOn(workspaceRepository, 'listNodes').mockImplementation(async () => nodes.map((node) => node.id === workflow.id ? workflow : node));
  vi.spyOn(workspaceRepository, 'listEdges').mockResolvedValue(edges);
  vi.spyOn(workspaceRepository, 'updateNode').mockImplementation(async (_id, changes) => {
    workflow = { ...workflow, ...changes };
    return workflow;
  });
  vi.spyOn(bridgeService, 'listAgents').mockResolvedValue([agent]);
  vi.spyOn(filesystemService, 'readBinary').mockImplementation(async (_workspaceId, path) => ({
    data: PNG, contentType: 'image/png', name: path.split('/').at(-1) ?? 'image.png',
  }));
  vi.spyOn(filesystemService, 'inspect').mockResolvedValue({
    path: '/workspace/references/atomic-ant.png', name: 'atomic-ant.png', extension: 'png', size: PNG.length,
    modifiedAt: new Date(0).toISOString(), contentType: 'image/png', kind: 'image',
  });

  return { workspace, nodes, edges, executor, getWorkflow: () => workflow };
}

afterEach(() => vi.restoreAllMocks());

describe('image workflow schema', () => {
  it('keeps outputs inside the workspace and exposes no direct API controls', () => {
    expect(() => config({ outputDirectory: '../outside' })).toThrow();
    expect(() => config({ outputDirectory: '/tmp/outside' })).toThrow();
    const parsed = config({ model: 'gpt-image-2', quality: 'high', apiKey: 'secret' });
    expect(parsed.outputDirectory).toBe('generated/images');
    expect(parsed).not.toHaveProperty('model');
    expect(parsed).not.toHaveProperty('quality');
    expect(parsed).not.toHaveProperty('apiKey');
  });

  it('accepts ten outputs and rejects an eleventh output or an escaping reference', () => {
    expect(config({ count: 10 }).count).toBe(10);
    expect(() => config({ count: 11 })).toThrow();
    expect(completeImageWorkflowSchema.parse({
      runId: '00000000-0000-7000-8000-000000000001',
      outputPaths: Array.from({ length: 10 }, (_, index) => `generated/images/result-${index + 1}.png`),
      from: 'Creative Director',
    }).outputPaths).toHaveLength(10);
    expect(() => addImageWorkflowReferenceSchema.parse({ path: '../private.png', from: 'Creative Director' })).toThrow();
  });
});

describe('ImageWorkflowService', () => {
  it('prepares the exact built-in Codex image tool contract with notes and local references', async () => {
    setupWorkflow();
    const result = await new ImageWorkflowService().begin(new RunImageWorkflowDto(
      'workspace-1', 'workflow-1', config({ count: 2 }), 'agent-1',
    ));

    expect(result).toMatchObject({
      workflowNodeId: 'workflow-1', status: 'running',
      executor: { nodeId: 'agent-1', provider: 'codex' },
      tool: {
        displayName: 'image_gen.imagegen',
        normalizedName: 'tools.image_gen__imagegen',
        calls: 2,
        referenced_image_paths: ['/workspace/references/atomic-ant.png'],
        prompt: expect.stringContaining('Red, white, and black.'),
      },
      completion: { tool: 'image_workflow_complete' },
      failure: { tool: 'image_workflow_fail' },
    });
    expect(result.tool.prompt).toContain('real alpha channel');
    expect(result.outputPaths).toHaveLength(2);
    expect(result.outputPaths.every((path: string) => path.startsWith('generated/images/atomic-ant-'))).toBe(true);
  });

  it('prepares ten generated outputs as one automated workflow execution', async () => {
    setupWorkflow({ references: false });
    const result = await new ImageWorkflowService().begin(new RunImageWorkflowDto(
      'workspace-1', 'workflow-1', config({ count: 10 }), 'agent-1',
    ));

    expect(result.tool.calls).toBe(10);
    expect(result.outputPaths).toHaveLength(10);
    expect(new Set(result.outputPaths).size).toBe(10);
  });

  it('lets a connected Codex revise a draft and reorder context without starting generation', async () => {
    const state = setupWorkflow();
    const service = new ImageWorkflowService();
    const createEdge = vi.spyOn(workspaceRepository, 'createEdge').mockResolvedValue({ id: 'edge-extra-note' } as any);
    const extraNote = {
      ...state.nodes[1], id: '00000000-0000-7000-8000-000000000030', title: 'Campaign copy',
      payload: { content: 'Carousel copy for ten slides.' },
    } as any;
    state.nodes.push(extraNote);

    const updated = await service.update(new UpdateImageWorkflowDto(
      'workspace-1', 'workflow-1',
      { from: 'agent-1', prompt: 'Create a complete carousel.', count: 10 },
      'agent-1',
    ));
    await service.connect(new ConnectImageWorkflowNodeDto(
      'workspace-1', 'workflow-1',
      { from: 'agent-1', targetNodeId: extraNote.id, order: 0 },
      'agent-1',
    ));

    expect(updated).toMatchObject({ status: 'idle', config: { prompt: 'Create a complete carousel.', count: 10 } });
    expect(state.getWorkflow().payload).toMatchObject({ status: 'idle' });
    expect(state.getWorkflow().payload).not.toHaveProperty('activeRun');
    expect(state.getWorkflow().payload.contextOrder).toEqual([extraNote.id, 'note-1']);
    expect(createEdge).toHaveBeenCalledWith(expect.objectContaining({ targetNodeId: extraNote.id }));
  });

  it('creates a visible draft next to the Codex and connects it before returning control', async () => {
    const state = setupWorkflow();
    const createdWorkflow = {
      ...state.getWorkflow(), id: 'workflow-created', title: 'Instagram carousel',
      payload: { ...config({ count: 10 }), prompt: '', status: 'idle', history: [] },
    } as any;
    state.nodes.push(createdWorkflow);
    vi.spyOn(workspaceRepository, 'createNode').mockResolvedValue(createdWorkflow);
    const createEdge = vi.spyOn(workspaceRepository, 'createEdge').mockResolvedValue({ id: 'edge-created' } as any);
    vi.spyOn(workspaceRepository, 'listEdges').mockResolvedValue([
      ...state.edges,
      { id: 'edge-created', sourceNodeId: 'agent-1', targetNodeId: 'workflow-created' },
    ] as any);

    const created = await new ImageWorkflowService().create(new CreateImageWorkflowDto(
      'workspace-1',
      {
        from: 'agent-1', title: 'Instagram carousel', prompt: '', count: 10,
        transparentBackground: false, outputDirectory: 'generated/images', filePrefix: 'carousel',
      },
      'agent-1',
    ));

    expect(createEdge).toHaveBeenCalledWith(expect.objectContaining({ sourceNodeId: 'agent-1', targetNodeId: 'workflow-created' }));
    expect(created).toMatchObject({ nodeId: 'workflow-created', config: { count: 10 } });
  });

  it('rejects workflow control from a Codex that is not connected', async () => {
    const state = setupWorkflow();
    const outsider = {
      ...state.executor, id: 'agent-2', title: 'Other Codex', payload: { provider: 'codex', sessionId: 'session-2' },
    } as any;
    state.nodes.push(outsider);
    vi.spyOn(bridgeService, 'listAgents').mockResolvedValue([
      { nodeId: 'agent-1', title: 'Creative Director', provider: 'codex', command: 'codex', sessionId: 'session-1', sessionAlive: true, maestro: false },
      { nodeId: 'agent-2', title: 'Other Codex', provider: 'codex', command: 'codex', sessionId: 'session-2', sessionAlive: true, maestro: false },
    ] as any);

    const error = await new ImageWorkflowService().update(new UpdateImageWorkflowDto(
      'workspace-1', 'workflow-1', { from: 'agent-2', prompt: 'Take over.' }, 'agent-2',
    )).catch((caught) => caught);

    expect(error).toMatchObject({ code: 'image_workflow_executor_unauthorized', status: 403 });
  });

  it('dispatches execution to the connected Codex without an API key or direct image endpoint', async () => {
    setupWorkflow({ references: false });
    const send = vi.spyOn(bridgeService, 'sendOneWay').mockResolvedValue({
      to: 'Creative Director', sent: true, messageId: 'message-1', deliveryState: 'delivered',
    });

    const result = await new ImageWorkflowService().dispatch(new RunImageWorkflowDto(
      'workspace-1', 'workflow-1', config({ transparentBackground: false }), null,
    ));

    expect(result.dispatched).toBe(true);
    expect(send).toHaveBeenCalledWith('workspace-1', expect.objectContaining({
      to: 'agent-1', kind: 'image-workflow',
      message: expect.stringContaining('built-in image_gen.imagegen tool only'),
    }));
    const message = send.mock.calls[0][1].message;
    expect(message).toContain('Do not ask for an API key');
    expect(message).toContain('do not call the OpenAI Images API directly');
    expect(message).toContain('image_workflow_complete');
  });

  it('rejects non-Codex and offline executors', async () => {
    setupWorkflow({ provider: 'claude' });
    const missing = await new ImageWorkflowService().begin(new RunImageWorkflowDto(
      'workspace-1', 'workflow-1', config(), null,
    )).catch((error) => error);
    expect(missing).toMatchObject({ code: 'image_workflow_executor_missing', status: 409 });

    vi.restoreAllMocks();
    setupWorkflow({ sessionAlive: false });
    const offline = await new ImageWorkflowService().begin(new RunImageWorkflowDto(
      'workspace-1', 'workflow-1', config(), 'agent-1',
    )).catch((error) => error);
    expect(offline).toMatchObject({ code: 'image_workflow_executor_offline', status: 409 });
  });

  it('materializes only the exact workspace outputs completed by the assigned Codex', async () => {
    const state = setupWorkflow();
    const service = new ImageWorkflowService();
    const execution = await service.begin(new RunImageWorkflowDto('workspace-1', 'workflow-1', config(), 'agent-1'));
    const createNode = vi.spyOn(workspaceRepository, 'createNode').mockImplementation(async (input: any) => ({
      ...input, id: 'output-1', createdAt: new Date(), updatedAt: new Date(),
    }));
    vi.spyOn(workspaceRepository, 'createEdge').mockResolvedValue({ id: 'edge-output' } as any);

    const unauthorized = await service.complete({
      workspaceId: 'workspace-1', nodeId: 'workflow-1', runId: execution.runId,
      outputPaths: execution.outputPaths, actorNodeId: 'different-agent',
    }).catch((error) => error);
    expect(unauthorized).toMatchObject({ code: 'image_workflow_executor_unauthorized', status: 403 });

    const mismatched = await service.complete({
      workspaceId: 'workspace-1', nodeId: 'workflow-1', runId: execution.runId,
      outputPaths: ['../stolen.png'], actorNodeId: 'agent-1',
    }).catch((error) => error);
    expect(mismatched).toMatchObject({ code: 'image_workflow_output_path_mismatch' });

    const result = await service.complete({
      workspaceId: 'workspace-1', nodeId: 'workflow-1', runId: execution.runId,
      outputPaths: execution.outputPaths, actorNodeId: 'agent-1',
    });

    expect(createNode).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'workspace-1', type: 'image',
      payload: expect.objectContaining({
        path: execution.outputPaths[0],
        generatedBy: expect.objectContaining({ workflowNodeId: 'workflow-1', runId: execution.runId }),
      }),
    }));
    expect(result.run).toMatchObject({
      status: 'succeeded', tool: 'image_gen.imagegen', executorNodeId: 'agent-1',
      contextNodeIds: ['note-1'], referenceNodeIds: ['reference-1'], outputNodeIds: ['output-1'],
    });
    expect(state.getWorkflow().payload).toMatchObject({ status: 'succeeded', activeRun: null, lastError: null });
  });

  it('keeps WSL reference and output paths in the agent runtime', async () => {
    const state = setupWorkflow();
    state.workspace.runtimeKind = 'wsl';
    state.workspace.wslDistribution = 'Ubuntu-24.04';
    state.workspace.wslWorkingDir = '/home/dev/project';

    const result = await new ImageWorkflowService().begin(new RunImageWorkflowDto(
      'workspace-1', 'workflow-1', config(), 'agent-1',
    ));

    expect(result.tool.referenced_image_paths).toEqual(['/home/dev/project/references/atomic-ant.png']);
    expect(result.outputAbsolutePaths[0]).toMatch(/^\/home\/dev\/project\/generated\/images\//);
  });

  it('invalidates a cancelled run without presenting cancellation as a failure', async () => {
    const state = setupWorkflow({ references: false });
    const service = new ImageWorkflowService();
    const execution = await service.begin(new RunImageWorkflowDto(
      'workspace-1', 'workflow-1', config(), 'agent-1',
    ));

    const result = await service.cancel('workspace-1', 'workflow-1');

    expect(result).toEqual({ cancelled: true, runId: execution.runId });
    expect(state.getWorkflow().payload).toMatchObject({
      status: 'cancelled', activeRunId: null, activeRun: null, lastError: null,
    });
    expect(state.getWorkflow().payload.history.at(-1)).toMatchObject({
      id: execution.runId, status: 'cancelled', errorCode: 'image_gen_cancelled',
    });
  });

  it('surfaces bounded workflow errors', () => {
    expect(new ImageWorkflowError('image_workflow_executor_missing', 409)).toMatchObject({
      message: 'image_workflow_executor_missing', code: 'image_workflow_executor_missing', status: 409,
    });
  });
});
