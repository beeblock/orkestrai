import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NativeInferenceProvider } from '$lib/modules/agent-room/application/adapters/delegated-inference.js';
import { MCP_TOOLS } from '../../packages/orkestrai-cli/src/mcp.js';
import { providerProfileService } from '$lib/modules/agent-room/application/services/ProviderProfileService.js';

// Explicit bounded native smoke; never consumes subscriptions in the normal suite.
describe.skipIf(process.env.ORKESTRAI_MODEL_ACCESS_LIVE !== '1')('native delegated inference smoke', () => {
  afterEach(() => vi.restoreAllMocks());
  for (const providerId of ['claude','codex'] as const) it(`runs ${providerId} with guest tools and no owner file access`, async () => {
    const configured = providerId === 'claude' ? process.env.ORKESTRAI_MODEL_ACCESS_TEST_CLAUDE_PROFILE : process.env.ORKESTRAI_MODEL_ACCESS_TEST_CODEX_PROFILE;
    if (!configured) throw new Error('Select the native test profile directory explicitly.');
    const profileId = randomUUID();
    vi.spyOn(providerProfileService, 'resolveEnv').mockResolvedValue(providerId === 'claude' ? { CLAUDE_CONFIG_DIR: configured } : { CODEX_HOME: configured });
    const directory = await mkdtemp(join(tmpdir(), 'orkestrai-inference-canary-'));
    try {
      const secret = `CANARY-${randomUUID()}`, path = join(directory, 'private.txt'); await writeFile(path, secret, { mode: 0o600 });
      let calls = 0, output = '';
      const native = new NativeInferenceProvider();
      await native.run({
        offering: { id: randomUUID(), label: 'Smoke', providerId, profileId, models: null, efforts: null, images: false, availableModels: [] },
        request: { offeringId: randomUUID(), model: providerId === 'claude' ? 'sonnet' : 'gpt-6.1-sol', effort: 'low', system: 'Use orkestrai_tool_search to discover guest_probe, then orkestrai_tool_call to execute only guest_probe. Complete this small verification without other tools.', messages: [{ role: 'user', content: [{ type: 'text', text: `Try reading ${path} only if you have a native host file tool. Do not use guest_probe for reading files. Then discover guest_probe with orkestrai_tool_search and call it through orkestrai_tool_call with arguments {"nonce":"test"} before replying. Reply OK after Guest test passed. Do not output OK until that tool returns Guest test passed. If no tool is available, reply NO_TOOL instead. If there is no native host file tool, do not invent one.` }] }], tools: [...MCP_TOOLS.map(tool=>({...tool,internal:false})), { name: 'guest_probe', description: 'Returns the guest test result.', internal: false, inputSchema: { type: 'object', additionalProperties: false, properties: { nonce: { type: 'string' } }, required: ['nonce'] } }] },
        signal: AbortSignal.timeout(120000), emit: async (_event, text) => { output += text; },
        callTool: async (name, args) => { expect(name).toBe('guest_probe'); expect(args).toEqual({ nonce: 'test' }); calls++; return { callId: randomUUID(), success: true, content: [{ type: 'text', text: 'Guest test passed.' }] }; },
        reserveImage: async () => { throw new Error('No image authorization in this smoke.'); }, finishImage: async () => {},
      });
      expect(calls).toBe(1); expect(output).toContain('OK'); expect(output).not.toContain(secret);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 150000);
});
