import { describe, expect, it } from 'vitest';
import { PassThrough } from 'node:stream';
import { runMcpServer, MCP_TOOLS } from '../../packages/orkestrai-cli/src/mcp.js';

/** Roda o servidor MCP com streams em memoria + bridge fake (captura o body). */
function startMcp(bridgeResult = { ok: true }) {
  const input = new PassThrough();
  const chunks = [];
  const done = runMcpServer({
    input,
    write: (chunk) => chunks.push(chunk),
    bridge: async (method, path, body) => ({ ...bridgeResult, method, path, body }),
    findFreePort: async () => 45678,
    selfAgent: 'n1',
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
  it('handshake initialize + tools/list com as tools do canvas', async () => {
    const { send, waitFor, input } = startMcp();
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {} } });
    const init = await waitFor(1);
    expect(init.result.protocolVersion).toBe('2024-11-05');
    expect(init.result.serverInfo.name).toBe('orkestrai');

    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const list = await waitFor(2);
    const names = list.result.tools.map((tool) => tool.name);
    for (const expected of ['ask', 'usage', 'code_graph_status', 'code_graph_index', 'code_graph_search', 'code_graph_symbol', 'code_graph_neighbors', 'code_graph_changes', 'code_graph_contracts', 'code_graph_quality', 'code_graph_semantic_status', 'code_graph_semantic_build', 'code_graph_semantic_search', 'code_graph_evidence', 'code_graph_evidence_import', 'code_graph_context', 'code_graph_operations', 'code_graph_explain', 'code_graph_locate', 'code_graph_revisions', 'code_graph_compare', 'code_graph_investigation_list', 'code_graph_investigation_read', 'code_graph_investigation_save', 'code_graph_investigation_delete', 'code_graph_handoff', 'note_list', 'note_read', 'note_write', 'note_edit', 'note_create', 'memory_search', 'memory_add', 'memory_revise', 'memory_archive', 'api_client_list', 'api_client_reference', 'api_client_read', 'api_client_import', 'api_client_create', 'api_client_replace', 'api_client_sync_status', 'api_client_pull', 'api_client_push', 'api_client_export', 'api_client_run_runner', 'api_client_execute', 'image_workflow_list', 'image_workflow_read', 'image_workflow_create', 'image_workflow_update', 'image_workflow_connect', 'image_workflow_disconnect', 'image_workflow_add_reference', 'image_workflow_run', 'image_workflow_validate', 'image_workflow_complete', 'image_workflow_fail', 'image_workflow_cancel', 'image_workflow_delete', 'design_audit', 'design_apply_template', 'task_list', 'task_columns', 'task_move', 'task_done', 'portal_dom', 'floor_land', 'device_attach', 'device_screenshot', 'notify', 'port', 'recruit']) {
      expect(names).toContain(expected);
    }
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
