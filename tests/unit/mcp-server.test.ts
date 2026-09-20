import { describe, expect, it } from 'vitest';
import { PassThrough } from 'node:stream';
import { runMcpServer, MCP_TOOLS } from '../../packages/orkestrai-cli/src/mcp.js';

/** Roda o servidor MCP com streams em memoria + bridge fake (captura o body). */
function startMcp(bridgeResult = { ok: true }, selfAgent = 'n1') {
  const input = new PassThrough();
  const chunks = [];
  const done = runMcpServer({
    input,
    write: (chunk) => chunks.push(chunk),
    bridge: async (method, path, body) => ({ ...bridgeResult, method, path, body }),
    findFreePort: async () => 45678,
    selfAgent,
  });
  /** NDJSON (spec stdio do MCP): 1 JSON por linha. */
  const send = (message) => {
    input.write(`${JSON.stringify(message)}\n`);
  };
  /** Legado LSP: Content-Length — a entrada ainda e tolerada. */
  const sendLsp = (message) => {
    const body = JSON.stringify(message);
    input.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  };
  /** Espera a resposta com o id dado aparecer no stdout (NDJSON). */
  const waitFor = async (id) => {
    for (let i = 0; i < 100; i += 1) {
      const lines = chunks.join('').split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.id === id) return parsed;
        } catch {
          // linha ainda incompleta
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`resposta ${id} nao chegou`);
  };
  return { send, sendLsp, waitFor, done, input };
}

describe('servidor MCP (orkestrai mcp)', () => {
  it('exposes per-model contracts and read-only pricing without presenting suggestions as hard constraints', () => {
    const tool = MCP_TOOLS.find(tool => tool.name === 'video_workflow_models')!;
    expect(tool.description).toContain('descriptions, examples, defaults');
    expect(tool.description).toContain('not exclusive enums');
    expect(tool.description).toContain('not render speed');
    expect(tool.inputSchema.properties.input.properties.pricingIds.maxItems).toBe(50);
    expect(tool.inputSchema.properties.input.properties.profileId.format).toBe('uuid');
  });
  it('keeps storyboard images on Codex and makes native video audio an explicit model capability', () => {
    const description = MCP_TOOLS.find(tool => tool.name === 'video_workflow_create')!.description;
    expect(description).toContain('image_gen.imagegen');
    expect(description).toContain('never external-provider image generation');
    expect(description).toContain('validated Image outputs');
    expect(description).toContain('native audio');
    expect(description).toContain('requested language');
    expect(description).toContain('silently substitute a mute model');
  });
  it('exposes provider identity in discovery and saved video configs without adding credentials', () => {
    const models = MCP_TOOLS.find(tool => tool.name === 'video_workflow_models')!;
    const create = MCP_TOOLS.find(tool => tool.name === 'video_workflow_create')!;
    expect(models.inputSchema.properties.input.properties.provider.enum).toEqual(['fal', 'byteplus', 'higgsfield']);
    expect(create.inputSchema.properties.input.properties.config.properties.provider.enum).toEqual(['fal', 'byteplus', 'higgsfield']);
    expect(create.inputSchema.properties.input.properties.config.properties).not.toHaveProperty('credential');
    expect(create.description).toContain('matching profile');
  });
  it.each(['characters','models','list','read','create','update','preview','run','cancel','retry_download','remove'])('routes native video %s through the same task-bound contract without credentials', async command => {
    const server = startMcp();
    const args = { taskId:'00000000-0000-4000-8000-000000000001', nodeId:'00000000-0000-4000-8000-000000000002', input:{title:'Test video',config:{prompt:'A scene'} } };
    server.send({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:`video_workflow_${command}`,arguments:args}});
    const response = await server.waitFor(1);
    expect(JSON.parse(response.result.content[0].text)).toMatchObject({method:'POST',path:'/api/agent-room/bridge/creative-media',body:{...args,command}});
    const tool = MCP_TOOLS.find(tool => tool.name === `video_workflow_${command}`)!;
    expect(tool.inputSchema.required).toContain('taskId');
    expect(tool.inputSchema.properties).not.toHaveProperty('credential');
    expect(tool.inputSchema.additionalProperties).toBe(false);
    if (command === 'update') expect(tool.inputSchema.properties.input.required).toEqual(['title', 'config']);
    if (command === 'characters') {
      expect(tool.inputSchema.required).not.toContain('nodeId');
      expect(tool.inputSchema.properties.input.properties.command.enum).not.toContain('lock');
      expect(tool.inputSchema.properties.input.properties.command.enum).toContain('binding');
      expect(tool.inputSchema.properties.input.properties.config.properties.characterBindings.items.properties.alias).toBeDefined();
    }
    server.input.end(); await server.done;
  });
  it('routes automatic contact navigation without allowing a supplied recipient or arbitrary query', async () => {
    const server = startMcp();
    const args = { taskId: '00000000-0000-4000-8000-000000000001', idempotencyKey: 'open-contact-test', grantId: '00000000-0000-4000-8000-000000000002', targetId: '42:cg:80' };
    server.send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'computer_open_conversation', arguments: args } });
    const response = await server.waitFor(1);
    expect(JSON.parse(response.result.content[0].text).body).toEqual({ from: 'n1', taskId: args.taskId, idempotencyKey: args.idempotencyKey, input: { command: 'open_conversation', grantId: args.grantId, targetId: args.targetId } });
    const schema = MCP_TOOLS.find(t => t.name === 'computer_open_conversation')!.inputSchema;
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties).not.toHaveProperty('text');
    server.input.end();
  });
  it('routes an explicit no-reply acknowledgment with its exact batch and reason', async () => {
    const server = startMcp();
    const args = { taskId: '00000000-0000-4000-8000-000000000001', idempotencyKey: 'no-reply-test', grantId: '00000000-0000-4000-8000-000000000002', batchId: '00000000-0000-4000-8000-000000000003', inReplyToDigest: 'a'.repeat(64), reason: 'already_answered' };
    server.send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'computer_inbox_acknowledge', arguments: args } });
    const response = await server.waitFor(1);
    const result = JSON.parse(response.result.content[0].text);
    expect(result.body).toEqual({ from: 'n1', taskId: args.taskId, idempotencyKey: args.idempotencyKey, input: { command: 'inbox_acknowledge', grantId: args.grantId, batchId: args.batchId, inReplyToDigest: args.inReplyToDigest, reason: args.reason } });
    expect(MCP_TOOLS.find(tool => tool.name === 'computer_inbox_acknowledge')?.inputSchema.required).toContain('batchId');
    server.input.end();
  });
  it.each(['computer_capabilities','computer_send','computer_media_send','computer_media_receive','computer_memory_search','artifact_speech','artifact_report','artifact_inspect','artifact_transcribe','automation_save','automation_cancel'])('preserves assigned identity and payload for %s', async name => {
    const server = startMcp();
    const args = { taskId:'00000000-0000-4000-8000-000000000001', idempotencyKey:'stable-test-key', grantId:'00000000-0000-4000-8000-000000000002', targetId:'42', text:'Hello', path:'generated/hello.wav', source:{kind:'task',id:'00000000-0000-4000-8000-000000000003'}, definition:{name:'Monday report',trigger:'calendar',prompt:'Report',calendar:{frequency:'weekly',weekdays:[1],time:'14:00',timeZone:'America/Sao_Paulo'}}, revision:2, id:'00000000-0000-4000-8000-000000000004' };
    server.send({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}});
    const response = await server.waitFor(1);
    const result = JSON.parse(response.result.content[0].text);
    expect(result.body.from).toBe('n1'); expect(result.body.taskId).toBe(args.taskId); expect(result.body.idempotencyKey).toBe(args.idempotencyKey);
    expect(result.path).toBe('/api/agent-room/bridge/'+(name.startsWith('automation_')?'automations':'computers'));
    expect(result.body.input.command).toBe(name.startsWith('artifact_')?name:name.replace(/^(computer|automation)_/,''));
    expect(MCP_TOOLS.some(tool=>tool.name===name)).toBe(true);
    server.input.end();
  });
  it('handshake initialize + tools/list com as tools do canvas', async () => {
    const { send, waitFor, input } = startMcp();
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {} } });
    const init = await waitFor(1);
    expect(init.result.protocolVersion).toBe('2024-11-05');
    expect(init.result.serverInfo.name).toBe('orkestrai');

    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const list = await waitFor(2);
    const names = list.result.tools.map((tool) => tool.name);
    for (const expected of ['ask', 'usage', 'code_graph_status', 'code_graph_index', 'code_graph_search', 'code_graph_symbol', 'code_graph_neighbors', 'code_graph_changes', 'code_graph_contracts', 'code_graph_quality', 'code_graph_semantic_status', 'code_graph_semantic_build', 'code_graph_semantic_search', 'code_graph_evidence', 'code_graph_evidence_import', 'code_graph_context', 'code_graph_operations', 'code_graph_explain', 'code_graph_locate', 'code_graph_revisions', 'code_graph_compare', 'code_graph_investigation_list', 'code_graph_investigation_read', 'code_graph_investigation_save', 'code_graph_investigation_delete', 'code_graph_handoff', 'note_list', 'note_read', 'note_write', 'note_edit', 'note_create', 'memory_search', 'memory_add', 'memory_revise', 'memory_archive', 'api_client_list', 'api_client_reference', 'api_client_read', 'api_client_import', 'api_client_create', 'api_client_replace', 'api_client_sync_status', 'api_client_pull', 'api_client_push', 'api_client_export', 'api_client_run_runner', 'api_client_execute', 'image_workflow_list', 'image_workflow_read', 'image_workflow_create', 'image_workflow_update', 'image_workflow_connect', 'image_workflow_disconnect', 'image_workflow_add_reference', 'image_workflow_run', 'image_workflow_validate', 'image_workflow_complete', 'image_workflow_fail', 'image_workflow_cancel', 'image_workflow_delete', 'design_audit', 'design_apply_template', 'task_list', 'task_columns', 'task_move', 'task_done', 'portal_dom', 'floor_land', 'device_attach', 'device_screenshot', 'computer_inspect', 'computer_click', 'computer_type_secret', 'computer_screenshot', 'notify', 'port', 'recruit']) {
      expect(names).toContain(expected);
    }
    expect(names).toEqual(expect.arrayContaining(['integration_list', 'integration_events', 'integration_execute']));
    expect(names).toEqual(expect.arrayContaining(['tool_list', 'tool_propose', 'tool_update', 'tool_execute']));
    input.end();
  });

  it('tools/call roteia para a bridge e devolve texto', async () => {
    const { send, waitFor, input } = startMcp({ tasks: [] });
    send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'task_list', arguments: {} } });
    const response = await waitFor(1);
    const text = response.result.content[0].text;
    const data = JSON.parse(text);
    expect(data.path).toBe('/api/agent-room/bridge/tasks');
    expect(data.method).toBe('GET');
    input.end();
  });

  it('port usa a porta livre local (sem bridge)', async () => {
    const { send, waitFor, input } = startMcp();
    send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'port', arguments: {} } });
    const response = await waitFor(1);
    expect(JSON.parse(response.result.content[0].text).port).toBe(45678);
    input.end();
  });

  it('reports status through an assigned task when a restored session has no agent environment', async () => {
    const { send, waitFor, input } = startMcp({ ok: true }, null);
    const taskId = '00000000-0000-7000-8000-000000000001';
    send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
      name: 'status',
      arguments: { state: 'working', action: 'Reviewing architecture', taskId },
    } });
    const response = await waitFor(1);
    const result = JSON.parse(response.result.content[0].text);
    expect(result).toMatchObject({
      method: 'POST',
      path: '/api/agent-room/bridge/activity',
      body: { state: 'working', action: 'Reviewing architecture', taskId },
    });
    expect(result.body).not.toHaveProperty('from');
    input.end();
  });

  it('rejects status without an environment identity or assigned task', async () => {
    const { send, waitFor, input } = startMcp({ ok: true }, null);
    send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
      name: 'status',
      arguments: { state: 'working' },
    } });
    const response = await waitFor(1);
    expect(response.result.isError).toBe(true);
    expect(response.result.content[0].text).toMatch(/ORKESTRAI_NODE_ID.*tarefa/i);
    input.end();
  });

  it('moves tasks through custom board columns', async () => {
    const { send, waitFor, input } = startMcp();
    send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'task_columns', arguments: {} } });
    const columns = JSON.parse((await waitFor(1)).result.content[0].text);
    expect(columns.path).toBe('/api/agent-room/bridge/task-columns');
    expect(columns.method).toBe('GET');

    send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'task_move', arguments: { taskId: 't1', column: 'Review' } } });
    const moved = JSON.parse((await waitFor(2)).result.content[0].text);
    expect(moved.path).toBe('/api/agent-room/bridge/tasks/t1');
    expect(moved.method).toBe('PATCH');
    expect(moved.body).toEqual({ status: 'Review' });
    input.end();
  });

  it('routes mobile device tools through the workspace bridge', async () => {
    const { send, waitFor, input } = startMcp();
    send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
      name: 'device_pinch',
      arguments: { centerX: 0.5, centerY: 0.45, startDistance: 0.18, endDistance: 0.42, durationMs: 360 },
    } });
    const pinch = JSON.parse((await waitFor(1)).result.content[0].text);
    expect(pinch.method).toBe('POST');
    expect(pinch.path).toBe('/api/agent-room/bridge/devices');
    expect(pinch.body).toEqual({
      command: 'pinch',
      centerX: 0.5,
      centerY: 0.45,
      startDistance: 0.18,
      endDistance: 0.42,
      durationMs: 360,
    });
    input.end();
  });

  it('confines computer tools to windows and forwards only SecretRefs', async () => {
    const { send, waitFor, input } = startMcp();
    const taskId = '00000000-0000-7000-8000-000000000001';
    send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
      name: 'computer_click',
      arguments: { x: 0.5, y: 0.25, targetId: 'window-1', taskId, idempotencyKey: 'task:click:1' },
    } });
    const click = JSON.parse((await waitFor(1)).result.content[0].text);
    expect(click.path).toBe('/api/agent-room/bridge/computers');
    expect(click.body.input).toEqual({ command: 'click', x: 0.5, y: 0.25, space: 'window', targetId: 'window-1', button: 'left', count: 1 });

    send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: {
      name: 'computer_type_secret',
      arguments: { secretRef: 'secretref:0123456789abcdef', targetId: 'window-1', taskId, idempotencyKey: 'task:secret:1' },
    } });
    const secret = JSON.parse((await waitFor(2)).result.content[0].text);
    expect(secret.body.input).toEqual({ command: 'type_secret', secretRef: 'secretref:0123456789abcdef', targetId: 'window-1' });
    expect(JSON.stringify(secret)).not.toContain('password');
    send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: {
      name: 'computer_type',
      arguments: { text: 'Ol\u00e1 aqui \u00e9 o orkestrai \ud83d\ude80', targetId: 'window-1', taskId, idempotencyKey: 'task:text:1' },
    } });
    const text = JSON.parse((await waitFor(3)).result.content[0].text);
    expect(text.body.input).toEqual({ command: 'type', text: 'Ol\u00e1 aqui \u00e9 o orkestrai \ud83d\ude80', targetId: 'window-1' });
    expect(text.body).toMatchObject({ taskId, idempotencyKey: 'task:text:1' });
    input.end();
  });

  it('allows an authenticated agent to prepare and launch through the same computer boundary', async () => {
    const { send, waitFor, input } = startMcp();
    const taskId = '00000000-0000-7000-8000-000000000001';
    for (const [id, name, arguments_, command] of [
      [1, 'computer_prepare', {}, { command: 'prepare' }],
      [2, 'computer_launch', { applicationId: 'com.apple.calculator' }, { command: 'launch', applicationId: 'com.apple.calculator' }],
      [3, 'computer_batch', { steps: [{ input: { command: 'type', text: 'complete text', targetId: 'window-1' } }] }, { command: 'batch', steps: [{ input: { command: 'type', text: 'complete text', targetId: 'window-1' } }] }],
      [4, 'computer_watch', { watch: { enabled: false, taskId } }, { command: 'watch', watch: { enabled: false, taskId } }],
      [5, 'computer_screenshot', { targetId: 'window-1', retention: 'temporary' }, { command: 'screenshot', target: 'window', targetId: 'window-1', retention: 'temporary' }],
      [6, 'computer_reply', { targetId: 'window-1', grantId: taskId, inReplyToDigest: 'a'.repeat(64), text: 'Hello' }, { command: 'reply', targetId: 'window-1', grantId: taskId, inReplyToDigest: 'a'.repeat(64), text: 'Hello' }],
      [7, 'computer_reply', { targetId: 'window-1', grantId: taskId, batchId: '00000000-0000-7000-8000-000000000002', inReplyToDigest: 'b'.repeat(64), text: 'Queued response' }, { command: 'reply', targetId: 'window-1', grantId: taskId, batchId: '00000000-0000-7000-8000-000000000002', inReplyToDigest: 'b'.repeat(64), text: 'Queued response' }],
    ] as const) {
      send({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: { ...arguments_, taskId, idempotencyKey: `desktop:${id}` } } });
      const response = JSON.parse((await waitFor(id)).result.content[0].text);
      expect(response.path).toBe('/api/agent-room/bridge/computers');
      expect(response.body).toMatchObject({ taskId, input: command });
    }
    input.end();
  });

  it('routes versioned tool proposals and executions without accepting raw credentials', async () => {
    const { send, waitFor, input } = startMcp();
    const taskId = '00000000-0000-7000-8000-000000000001';
    const manifest = {
      schemaVersion: 1,
      executor: { kind: 'transform', operations: [{ kind: 'set', path: 'ok', value: true }] },
      inputSchema: { type: 'object', properties: {}, additionalProperties: true },
      outputSchema: { type: 'object', properties: {}, additionalProperties: true },
      capabilities: ['tool'], secretRefs: [], timeoutMs: 5_000, maxOutputBytes: 65_536, fixtures: [],
    };
    send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'tool_propose', arguments: {
      name: 'Report formatter', slug: 'report-formatter', manifest, taskId,
    } } });
    const proposal = JSON.parse((await waitFor(1)).result.content[0].text);
    expect(proposal).toMatchObject({ path: '/api/agent-room/bridge/tools', method: 'POST', body: { operation: 'propose', from: 'n1', taskId } });
    expect(JSON.stringify(proposal)).not.toMatch(/password|bearer/i);

    send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'tool_execute', arguments: {
      toolId: '00000000-0000-7000-8000-000000000002', input: { reportId: 'weekly' }, taskId, idempotencyKey: 'task:report:weekly',
    } } });
    const execution = JSON.parse((await waitFor(2)).result.content[0].text);
    expect(execution.body).toMatchObject({ operation: 'execute', from: 'n1', taskId, toolId: '00000000-0000-7000-8000-000000000002' });
    expect(execution.body.input).toMatchObject({ input: { reportId: 'weekly' }, idempotencyKey: 'task:report:weekly' });
    input.end();
  });

  it('metodo desconhecido devolve erro JSON-RPC; notificacao nao tem resposta', async () => {
    const { send, waitFor, input } = startMcp();
    send({ jsonrpc: '2.0', method: 'notifications/initialized' }); // sem id: ignorada
    send({ jsonrpc: '2.0', id: 9, method: 'resources/list' });
    const response = await waitFor(9);
    expect(response.error.code).toBe(-32601);
    input.end();
  });

  it('tolerates framing LSP legado (Content-Length) na entrada', async () => {
    const { sendLsp, waitFor, input } = startMcp();
    sendLsp({ jsonrpc: '2.0', id: 5, method: 'ping' });
    const response = await waitFor(5);
    expect(response.result).toEqual({});
    input.end();
  });

  it('corpos das tools batem com os schemas da bridge (ask/notes/dismiss)', async () => {
    const { send, waitFor, input } = startMcp();
    // ask: o schema exige "message" (nao "text") — o bug do "data was invalid"
    send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ask', arguments: { agent: 'Codex', message: 'oi' } } });
    const ask = JSON.parse((await waitFor(1)).result.content[0].text);
    expect(ask.path).toBe('/api/agent-room/bridge/ask');
    expect(ask.body).toMatchObject({ to: 'Codex', message: 'oi', from: 'n1' });
    expect(ask.body.text).toBeUndefined();

    send({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'task_done', arguments: { taskId: 't1' } } });
    const taskDone = JSON.parse((await waitFor(6)).result.content[0].text);
    expect(taskDone.body).toEqual({ status: 'done', from: 'n1' });

    // note_write/edit: REST por nodeId (PUT/PATCH /notes/:id)
    send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'note_write', arguments: { nodeId: 'n9', content: 'x' } } });
    const write = JSON.parse((await waitFor(2)).result.content[0].text);
    expect(write.method).toBe('PUT');
    expect(write.path).toBe('/api/agent-room/bridge/notes/n9');
    expect(write.body).toEqual({ content: 'x' });

    send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'note_edit', arguments: { nodeId: 'n9', oldText: 'a', newText: 'b' } } });
    const edit = JSON.parse((await waitFor(3)).result.content[0].text);
    expect(edit.method).toBe('PATCH');
    expect(edit.path).toBe('/api/agent-room/bridge/notes/n9');
    expect(edit.body).toEqual({ old: 'a', new: 'b' });

    send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'note_create', arguments: { title: 'T', content: 'c' } } });
    const create = JSON.parse((await waitFor(4)).result.content[0].text);
    expect(create.method).toBe('POST');
    expect(create.path).toBe('/api/agent-room/bridge/notes');
    expect(create.body).toMatchObject({ title: 'T', content: 'c', from: 'n1' });
    expect(create.body.connect).toBeUndefined();

    // dismiss: o schema espera "target" (nao "agent")
    send({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'dismiss', arguments: { agent: 'Kimi' } } });
    const dismiss = JSON.parse((await waitFor(5)).result.content[0].text);
    expect(dismiss.body).toMatchObject({ target: 'Kimi' });
    expect(dismiss.body.agent).toBeUndefined();
    input.end();
  });

  it('lista de tools tem schemas validos', () => {
    for (const tool of MCP_TOOLS) {
      expect(tool.name).toMatch(/^[a-z_]+$/);
      expect(tool.description.length).toBeGreaterThan(5);
      expect(tool.inputSchema.type).toBe('object');
    }
  });
});
