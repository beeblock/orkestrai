import { describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node-pty';
import { codexAdapter } from '$lib/modules/agent-room/application/adapters/CodexAdapter.js';
import { bridgeService } from '$lib/modules/agent-room/application/services/BridgeService.js';
import { agentInboxService } from '$lib/modules/agent-room/application/services/AgentInboxService.js';
import { taskBoardService } from '$lib/modules/agent-room/application/services/TaskBoardService.js';
import { ReadBridgeMessageAction } from '$lib/modules/agent-room/application/actions/ReadBridgeMessageAction.js';
import { ReadBridgeMessageDTO } from '$lib/modules/agent-room/application/dto/ReadBridgeMessageDTO.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { controlCenterRepository } from '$lib/modules/agent-room/infrastructure/repositories/ControlCenterRepository.js';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.js';

describe.skipIf(process.env.ORKESTRAI_REAL_CODEX_TEST !== '1')('real Codex with the persisted inbox', () => {
  useSvelarTest({ refreshDatabase: true });

  it('wakes an idle leader for external messages and Kanban assignments without a viewer or inbox polling by the agent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ork-codex-inbox-'));
    const home = join(root, 'home'), cwd = join(root, 'project'), codexHome = join(home, '.codex');
    await mkdir(codexHome, { recursive: true }); await mkdir(cwd);
    let requests = 0, dropped = 0, dropEnter = true, output = '';
    const inputs: string[] = [];
    const server = createServer(async (request, response) => {
      if (request.method !== 'POST' || request.url !== '/v1/responses') { response.writeHead(404).end(); return; }
      let raw = '';
      for await (const chunk of request) { raw += chunk; if (raw.length > 4 * 1024 * 1024) { response.writeHead(413).end(); return; } }
      const body = JSON.parse(raw);
      const lastText = (body.input?.at(-1)?.content ?? []).map((item: any) => item.text ?? '').join('');
      const primary = lastText.startsWith('[orkestrai:message:');
      const externalSerial = primary ? /External fixture ([12])/.exec(lastText)?.[1] : undefined;
      const card = primary && lastText.includes('Coordinate the native queue fixture');
      if (externalSerial || card) inputs.push(lastText);
      requests++;
      console.info(JSON.stringify({ modelRequest: requests, lastRole: body.input?.at(-1)?.role, prefix: lastText.slice(0, 90), primary: Boolean(externalSerial || card) }));
      const item = { id: `msg_${requests}`, type: 'message', role: 'assistant', phase: 'final_answer',
        content: [{ type: 'output_text', text: `QUEUE_FIXTURE_OK_${externalSerial ?? (card ? 'TASK' : 'AUXILIARY')}` }] };
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const event of [{ type: 'response.created', response: { id: `resp_${requests}` } },
        { type: 'response.output_item.done', output_index: 0, item },
        { type: 'response.completed', response: { id: `resp_${requests}`, status: 'completed', output: [item],
          usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 } } }]) {
        response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      }
      response.end();
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    let sessionId: string | null = null;
    const runtime = ptySessionManager as unknown as { spawnPty: typeof spawn };
    const spawnSpy = vi.spyOn(runtime, 'spawnPty').mockImplementation((command, args, options) => {
      const env: Record<string, string> = {};
      for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'LANG', 'TERM']) {
        if (options?.env?.[key]) env[key] = options.env[key]!;
      }
      Object.assign(env, { HOME: home, USERPROFILE: home, CODEX_HOME: codexHome,
        APPDATA: join(home, 'AppData/Roaming'), LOCALAPPDATA: join(home, 'AppData/Local'), XDG_CONFIG_HOME: join(home, '.config'),
        NO_PROXY: '127.0.0.1,localhost', HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1', ALL_PROXY: 'http://127.0.0.1:1' });
      const child = spawn(command, args, { ...options, env });
      child.onData(chunk => {
        output = (output + chunk).slice(-32768);
        queueMicrotask(() => {
          if (!sessionId) return;
          if (chunk.includes('\x1b[6n')) ptySessionManager.writeHumanInput(sessionId, '\x1b[1;1R');
          if (/\x1b\[(?:0)?c/.test(chunk)) ptySessionManager.writeHumanInput(sessionId, '\x1b[?1;2c');
        });
      });
      const write = child.write.bind(child);
      child.write = text => {
        if (dropEnter && text === '\r') { dropEnter = false; dropped++; }
        else write(text);
      };
      return child;
    });
    agentInboxService.reset();
    try {
      const workspace = await workspaceRepository.createWorkspace({ name: 'Native inbox fixture', workingDir: cwd, codeIntelligenceMode: 'disabled' });
      // Large unrelated Canvas rows must not enter recipient/readiness queries.
      for (let index = 0; index < 300; index++) await workspaceRepository.createNode({ workspaceId: workspace.id,
        type: 'image', title: `Asset ${index}`, payload: { src: 'fixture.png', caption: 'Generated asset metadata. '.repeat(2700) } as never });
      const node = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Idle leader',
        payload: { provider: 'codex', maestro: true } });
      const args = [...codexAdapter.interactiveCommand!({ model: 'gpt-6.1-sol' }).args,
        '-c', 'model_provider="fixture"', '-c', 'model_providers.fixture.name="Local fixture"',
        '-c', `model_providers.fixture.base_url="http://127.0.0.1:${port}/v1"`, '-c', 'model_providers.fixture.wire_api="responses"',
        '-c', 'model_providers.fixture.requires_openai_auth=false', '-c', 'model_providers.fixture.supports_websockets=false',
        '-c', 'check_for_update_on_startup=false', '-c', `projects.${JSON.stringify(cwd)}.trust_level="trusted"`];
      const session = ptySessionManager.create({ command: process.env.ORKESTRAI_TEST_CODEX_BINARY ?? 'codex', args, cwd,
        provider: 'codex', workspaceId: workspace.id, nodeId: node.id, transcriptHome: home,
        env: { HOME: home, USERPROFILE: home, CODEX_HOME: codexHome } });
      sessionId = session.id;
      await workspaceRepository.updateNode(node.id, { payload: { provider: 'codex', maestro: true, sessionId } });
      await expect.poll(() => ptySessionManager.canAcceptAutomaticMessage(session.id), { timeout: 30000 }).toBe(true);

      // No UI subscriber or agent MCP/inbox call exists. The server must wake
      // the real CLI, recover its deliberately lost Enter, and route its answer.
      for (let serial = 1; serial <= 2; serial++) {
        const external = { clientId: randomBytes(16).toString('hex'), requestId: randomBytes(16).toString('hex'), receipt: randomBytes(32).toString('hex') };
        const since = Date.now();
        const asked = await bridgeService.ask(workspace.id, { to: node.id, message: `External fixture ${serial}`, external, timeoutMs: 100, busyGraceMs: 100 });
        const read = () => new ReadBridgeMessageAction().execute(new ReadBridgeMessageDTO(workspace.id, null, { external, waitMs: 0 }));
        await expect.poll(async () => (await read()).replyConfirmed, { timeout: 25000 }).toBe(true);
        expect(await read()).toMatchObject({ deliveryState: 'replied', reply: `QUEUE_FIXTURE_OK_${serial}` });
        expect((await controlCenterRepository.findEnvelope(asked.messageId))?.fromNodeId).toBeNull();
        console.info(JSON.stringify({ scenario: 'external-to-idle-leader', serial, elapsedMs: Date.now() - since, dropped, unrelatedImages: 300 }));
      }

      const card = await taskBoardService.create(workspace.id, { title: 'Coordinate the native queue fixture', assigneeNodeId: node.id });
      await expect.poll(async () => (await taskBoardService.read(workspace.id, card.id)).execution?.acceptedAt, { timeout: 25000 }).toBeTruthy();
      expect(inputs).toHaveLength(3);
      expect(inputs[0]).toContain('External fixture 1'); expect(inputs[1]).toContain('External fixture 2');
      expect(inputs[2]).toContain('Coordinate the native queue fixture');
      expect(dropped).toBe(1);
      console.info(JSON.stringify({ scenario: 'kanban-to-real-cli', requests, dropped, accepted: true }));
    } catch (error) {
      process.stderr.write(`Native inbox fixture failed: ${String(error)}\n${output.slice(-10000)}\n`);
      throw error;
    } finally {
      agentInboxService.reset();
      if (sessionId) ptySessionManager.kill(sessionId);
      spawnSpy.mockRestore();
      server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
      await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    }
  }, 100000);
});
