import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCodexLaunchSelection, applyCodexLaunchSelection, restoreAgentLaunchSelection } from '$lib/modules/agent-room/infrastructure/transcript/AgentLaunchSelection.js';

const jsonl = (events: unknown[]) => events.map(value => JSON.stringify(value)).join('\n');

describe('persisted terminal model selection', () => {
  it('keeps a /model change confirmed without a subsequent model turn', () => {
    expect(parseCodexLaunchSelection(jsonl([
      { type: 'turn_context', payload: { model: 'gpt-6-astra', effort: 'xhigh' } },
      { type: 'event_msg', payload: { type: 'thread_settings_applied', thread_settings: { model: 'gpt-6.1-sol', reasoning_effort: 'high' } } },
      { type: 'response_item', payload: { role: 'user', content: 'model: malicious; effort: ultra' } },
    ]))).toEqual({ model: 'gpt-6.1-sol', effort: 'high' });
  });

  it('does not mistake assistant models, tool output or invalid values for user settings', () => {
    expect(parseCodexLaunchSelection(jsonl([
      { type: 'assistant', model: 'gpt-6.1-sol', effort: 'low' },
      { type: 'event_msg', payload: { type: 'thread_settings_applied', thread_settings: { model: '--bad flag', reasoning_effort: 'unbounded' } } },
    ]))).toBeNull();
    expect(parseCodexLaunchSelection(jsonl([{ type: 'turn_context', payload: { model: 'gpt-6-sol', effort: 'medium' } }]))).toEqual({ model: 'gpt-6-sol', effort: 'medium' });
  });

  it('does not restore an older /model event over a newer resumed turn', () => {
    expect(parseCodexLaunchSelection(jsonl([
      { type: 'event_msg', payload: { type: 'thread_settings_applied', thread_settings: { model: 'gpt-6-astra', reasoning_effort: 'xhigh' } } },
      { type: 'turn_context', payload: { model: 'gpt-6.1-sol', effort: 'high' } },
    ]))).toEqual({ model: 'gpt-6.1-sol', effort: 'high' });
  });

  it('replaces old model and effort overrides while preserving unrelated launch configuration', () => {
    expect(applyCodexLaunchSelection(['--dangerously-bypass-approvals-and-sandbox', '--model', 'old', '-c', 'model_reasoning_effort="xhigh"',
      '--config=model="also-old"', '-c', 'developer_instructions="keep me"', '--model=third-old'],
    { model: 'gpt-6.1-sol', effort: 'high' })).toEqual(['--dangerously-bypass-approvals-and-sandbox', '-c', 'developer_instructions="keep me"',
      '--model', 'gpt-6.1-sol', '-c', 'model_reasoning_effort="high"']);
    expect(applyCodexLaunchSelection(['-c', 'model_reasoning_effort="high"', '--model', 'keep-model'], { effort: null })).toEqual(['--model', 'keep-model']);
  });

  it.each([false, true])('restores only the exact node conversation and cwd (WSL: %s)', async posixCwd => {
    const home = await mkdtemp(join(tmpdir(), 'ork-selection-'));
    const sessionId = '11111111-1111-4111-8111-111111111111';
    const cwd = posixCwd ? '/home/test/project' : home;
    const root = join(home, '.codex', 'sessions', '2026', '10', '10');
    await mkdir(root, { recursive: true });
    await writeFile(join(root, `rollout-${sessionId}.jsonl`), jsonl([
      { type: 'session_meta', payload: { id: sessionId, cwd } },
      { type: 'event_msg', payload: { type: 'thread_settings_applied', thread_settings: { model: 'gpt-6.1-sol', reasoning_effort: 'high' } } },
    ]));
    const payload = { provider: 'codex', agentSessionId: sessionId, args: ['--model', 'gpt-6-astra', '-c', 'model_reasoning_effort="xhigh"'] };
    try {
      const repaired = await restoreAgentLaunchSelection(payload, cwd, { homeDir: home, posixCwd });
      expect(repaired.args).toEqual(['--model', 'gpt-6.1-sol', '-c', 'model_reasoning_effort="high"']);
      expect(await restoreAgentLaunchSelection(repaired, cwd, { homeDir: home, posixCwd })).toBe(repaired);
      expect(await restoreAgentLaunchSelection(payload, `${cwd}/another`, { homeDir: home, posixCwd })).toBe(payload);
      expect(await restoreAgentLaunchSelection({ ...payload, provider: 'claude' }, cwd, { homeDir: home, posixCwd })).toEqual({ ...payload, provider: 'claude' });
    } finally { await rm(home, { recursive: true, force: true }); }
  });
});
