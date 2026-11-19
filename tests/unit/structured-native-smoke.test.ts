import { mkdtemp, rm, writeFile, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CodexStructuredDriver } from '$lib/modules/agent-room/application/adapters/codex-structured.js';
import { ClaudeStructuredDriver } from '$lib/modules/agent-room/application/adapters/claude-structured.js';
import type { StructuredAgentOptions } from '$lib/modules/agent-room/application/adapters/structured-types.js';
import { findTranscriptFile } from '$lib/modules/agent-room/infrastructure/transcript/TranscriptFiles.js';

// Explicit local smoke only: no app/bridge provisioning, no config writes. The
// unchanged installed provider reads its own account; all task files are temporary.
describe.skipIf(!process.env.NATIVE_PROVIDER_SMOKE_HOME)('installed native providers', () => {
  for (const [name, Driver] of [['Codex App Server', CodexStructuredDriver], ['Claude Agent SDK', ClaudeStructuredDriver]] as const) {
    it(`completes an exact native turn through ${name}`, async () => {
      const root = await mkdtemp(join(tmpdir(), 'orkestrai-native-smoke-'));
      const mcp = join(root, 'mcp.mjs');
      await writeFile(mcp, `import readline from 'node:readline';
        for await (const line of readline.createInterface({input:process.stdin})) {
          const m=JSON.parse(line); if(m.id===undefined)continue;
          const result=m.method==='initialize'?{protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'smoke',version:'1'}}:m.method==='tools/list'?{tools:[]}:{};
          process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');
        }`);
      const sessions = new Map<string, string>();
      const providerHome = process.env.NATIVE_PROVIDER_SMOKE_HOME!;
      const env = Object.fromEntries(Object.entries({ ...process.env, HOME: providerHome,
        CODEX_HOME: join(providerHome, '.codex') }).filter((item): item is [string, string] => typeof item[1] === 'string'));
      delete env.NATIVE_PROVIDER_SMOKE_HOME;
      const sentinel = `ORKESTRAI_SMOKE_ONLY_${crypto.randomUUID()}`;
      env.ORKESTRAI_AGENT_TOKEN = sentinel;
      const options: StructuredAgentOptions = { cwd: root, hostCwd: root, workspaceRoot: root, runtime: { kind: 'native' }, env,
        instructions: 'This is a tiny transport verification. Do not use tools. Answer only the requested word.',
        launchArgs: ['-c', `mcp_servers.orkestrai.command=${JSON.stringify(process.execPath)}`, '-c', `mcp_servers.orkestrai.args=${JSON.stringify([mcp])}`, '-c', 'mcp_servers.orkestrai.env_vars=["ORKESTRAI_AGENT_TOKEN"]'],
        bridgeMcp: { command: process.execPath, args: [mcp], env: { ORKESTRAI_AGENT_TOKEN: sentinel } },
        session: key => sessions.get(key) ?? null, saveSession: async (key, id) => { sessions.set(key, id); } };
      const driver = new Driver(options);
      let accepted = 0;
      const timeout = new AbortController();
      const timer = setTimeout(() => timeout.abort(), 90_000);
      try {
        const answer = await driver.run({ prompt: 'Return exactly ORKESTRAI_NATIVE_OK and nothing else.', conversationKey: 'smoke', messageId: crypto.randomUUID(),
          signal: timeout.signal, accepted: () => accepted++, output: () => {} });
        expect(answer.trim()).toBe('ORKESTRAI_NATIVE_OK');
        expect(accepted).toBe(1);
        expect(sessions.size).toBe(1);
        await driver.close();
        const sessionId = sessions.get('smoke')!;
        const file = Driver === ClaudeStructuredDriver
          ? join(providerHome, '.claude', 'projects', root.replace(/[^a-zA-Z0-9]/g, '-'), `${sessionId}.jsonl`)
          : await findTranscriptFile(join(providerHome, '.codex', 'sessions'), sessionId, 3);
        expect(Boolean(file)).toBe(true);
        expect((await stat(file!)).size).toBeLessThan(2_000_000);
        const transcript = await readFile(file!, 'utf8');
        expect(transcript.includes(sentinel)).toBe(false);
      } finally { clearTimeout(timer); await driver.close(); await rm(root, { recursive: true, force: true }); }
    }, 110_000);
  }
});
