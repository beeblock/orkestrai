import { describe, expect, it, vi } from 'vitest';
import { appendFile, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as files from '$lib/modules/agent-room/infrastructure/transcript/TranscriptFiles.js';
import { findPromptInTranscript, findReplyToPrompt, latestTurnBoundary } from '$lib/modules/agent-room/infrastructure/transcript/AgentTranscript.js';

async function fixture(posixCwd: boolean, size = 30, replySize = 0, provider: 'claude' | 'codex' = 'claude') {
  const home = await mkdtemp(join(tmpdir(), 'orkestrai-team-throughput-'));
  const cwd = posixCwd ? '/home/test/team-project' : await realpath(home);
  const dir = provider === 'claude' ? join(home, '.claude', 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-')) : join(home, '.codex', 'sessions', '2026', '11', '02');
  await mkdir(dir, { recursive: true });
  const at = Date.now();
  const agents = Array.from({ length: size }, (_, index) => ({ id: `team-${index}`, prompt: `Task for specialist ${index}` }));
  const path = (agent: typeof agents[number]) => join(dir, provider === 'claude' ? `${agent.id}.jsonl` : `rollout-2026-11-02T00-00-00-${agent.id}.jsonl`);
  for (const agent of agents) {
    const reply = `Result ${agent.id}`.padEnd(replySize, 'x');
    const records = provider === 'claude' ? [
      { type: 'user', timestamp: new Date(at).toISOString(), message: { content: agent.prompt } },
      { type: 'assistant', timestamp: new Date(at + 1).toISOString(), message: { stop_reason: 'end_turn', content: [{ type: 'text', text: reply }] } },
    ] : [
      { type: 'session_meta', payload: { id: agent.id, cwd } },
      { type: 'response_item', timestamp: new Date(at).toISOString(), payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: agent.prompt }] } },
      { type: 'response_item', timestamp: new Date(at + 1).toISOString(), payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: reply }] } },
      { type: 'event_msg', timestamp: new Date(at + 2).toISOString(), payload: { type: 'task_complete', last_agent_message: reply } },
    ];
    await writeFile(path(agent), records.map(record => JSON.stringify(record)).join('\n') + '\n');
  }
  return { home, cwd, dir, path, at, agents, options: { homeDir: home, posixCwd } };
}

describe('transcript throughput for a 30-agent team', () => {
  const runtimes = [['claude', false], ['claude', true], ['codex', false], ['codex', true]] as const;
  it.each(runtimes)('does not re-read unchanged prompts and replies on every sweep (%s, WSL: %s)', async (provider, posixCwd) => {
    const f = await fixture(posixCwd, 30, 0, provider);
    const reads = vi.spyOn(files, 'transcriptTail');
    const sweep = async () => {
      for (const agent of f.agents) {
        expect(await findPromptInTranscript(provider, f.cwd, agent.id, agent.prompt, f.at - 1000, f.options)).toMatchObject({ sessionId: agent.id });
        expect(await findReplyToPrompt(provider, f.cwd, agent.id, agent.prompt, f.at - 1000, f.options)).toMatchObject({ text: `Result ${agent.id}` });
      }
    };
    try {
      await sweep();
      reads.mockClear();
      await sweep();
      expect(reads).not.toHaveBeenCalled();
    } finally { reads.mockRestore(); await rm(f.home, { recursive: true, force: true }); }
  });

  it.each(runtimes)('does not re-read unchanged turn boundaries for 30 idle agents (%s, WSL: %s)', async (provider, posixCwd) => {
    const f = await fixture(posixCwd, 30, 0, provider);
    const reads = vi.spyOn(files, 'transcriptTail');
    const sweep = async () => {
      for (const agent of f.agents) expect(await latestTurnBoundary(provider, f.cwd, agent.id, f.options)).toMatchObject({ ready: true });
    };
    try {
      await sweep(); reads.mockClear();
      await sweep();
      expect(reads).not.toHaveBeenCalled();
      const agent = f.agents[0];
      const next = provider === 'claude'
        ? { type: 'user', timestamp: new Date(f.at + 100).toISOString(), message: { content: 'Next task' } }
        : { type: 'event_msg', timestamp: new Date(f.at + 100).toISOString(), payload: { type: 'task_started' } };
      await appendFile(f.path(agent), JSON.stringify(next) + '\n');
      expect(await latestTurnBoundary(provider, f.cwd, agent.id, f.options)).toMatchObject({ ready: false });
      expect(reads).toHaveBeenCalledTimes(1);
    } finally { reads.mockRestore(); await rm(f.home, { recursive: true, force: true }); }
  });

  it('retries an unchanged file after a transient read failure instead of caching a missing receipt', async () => {
    const f = await fixture(false, 1);
    const reads = vi.spyOn(files, 'transcriptTail').mockResolvedValueOnce(null);
    const agent = f.agents[0];
    const lookup = () => findPromptInTranscript('claude', f.cwd, agent.id, agent.prompt, f.at - 1000, f.options);
    try {
      expect(await lookup()).toBeNull();
      expect(await lookup()).toMatchObject({ sessionId: agent.id });
    } finally { reads.mockRestore(); await rm(f.home, { recursive: true, force: true }); }
  });

  it('evicts older large replies while retaining recently used results within the byte budget', async () => {
    const f = await fixture(false, 10, 1024 * 1024);
    const reads = vi.spyOn(files, 'transcriptTail');
    const lookup = (agent: typeof f.agents[number]) => findReplyToPrompt('claude', f.cwd, agent.id, agent.prompt, f.at - 1000, f.options);
    try {
      for (const agent of f.agents) expect(await lookup(agent)).toMatchObject({ complete: true });
      reads.mockClear();
      expect(await lookup(f.agents.at(-1)!)).not.toBeNull();
      expect(reads).not.toHaveBeenCalled();
      expect(await lookup(f.agents[0])).not.toBeNull();
      expect(reads).toHaveBeenCalledTimes(1);
    } finally { reads.mockRestore(); await rm(f.home, { recursive: true, force: true }); }
  });

  it('shares one read between concurrent lookups and notices the next file revision', async () => {
    const f = await fixture(false, 1);
    const reads = vi.spyOn(files, 'transcriptTail');
    const agent = f.agents[0];
    const lookup = () => findReplyToPrompt('claude', f.cwd, agent.id, agent.prompt, f.at - 1000, f.options);
    try {
      const result = await Promise.all(Array.from({ length: 30 }, lookup));
      expect(result.every(value => value?.text === `Result ${agent.id}`)).toBe(true);
      expect(reads).toHaveBeenCalledTimes(1);
      await appendFile(join(f.dir, `${agent.id}.jsonl`), JSON.stringify({ type: 'assistant', timestamp: new Date(f.at + 2).toISOString(), message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Latest result' }] } }) + '\n');
      expect((await lookup())?.text).toContain('Latest result');
      expect(reads).toHaveBeenCalledTimes(2);
    } finally { reads.mockRestore(); await rm(f.home, { recursive: true, force: true }); }
  });
});
