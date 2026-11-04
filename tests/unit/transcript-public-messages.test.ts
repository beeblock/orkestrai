import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePublicTranscriptMessages, publicTranscriptUpdates } from '$lib/modules/agent-room/infrastructure/transcript/AgentTranscript.js';

const at = '2026-11-04T13:58:43.008Z';
const codex = (text: string, phase = 'commentary', timestamp = at) => ({ type: 'response_item', timestamp,
  payload: { type: 'message', role: 'assistant', phase, content: [{ type: 'output_text', text }] } });
const jsonl = (events: unknown[]) => events.map(event => JSON.stringify(event)).join('\n');

describe('public transcript message boundary', () => {
  it('recognizes the current Codex phase format before a long-running turn completes', () => {
    const events = [codex('Current progress'), codex('Final result', 'final_answer')];
    expect(parsePublicTranscriptMessages('codex-rollout-jsonl', jsonl(events), Date.parse(at))).toMatchObject([
      { text: 'Current progress', at }, { text: 'Final result', at },
    ]);
  });

  it('excludes analysis, reasoning, tool results, old updates and malformed/incomplete records', () => {
    const events = [codex('OLD', 'commentary', '2026-11-04T13:50:00Z'), codex('PRIVATE', 'analysis'),
      { type: 'response_item', timestamp: at, payload: { type: 'custom_tool_call_output', output: 'SECRET' } },
      { type: 'event_msg', timestamp: at, payload: { type: 'item_completed', text: 'SECRET' } }, codex('Visible')];
    const parsed = parsePublicTranscriptMessages('codex-rollout-jsonl', `${jsonl(events)}\n{"type":`, Date.parse(at));
    expect(parsed.map(message => message.text)).toEqual(['Visible']);
  });

  it.each(['claude-project-jsonl', 'orkestrai-jsonl'])('exports only public text blocks from %s', storage => {
    const event = { type: 'assistant', timestamp: at, message: { role: 'assistant', content: [
      { type: 'thinking', thinking: 'PRIVATE' }, { type: 'tool_use', input: { token: 'SECRET' } }, { type: 'text', text: 'Visible' },
    ] } };
    expect(parsePublicTranscriptMessages(storage, jsonl([event, { ...event, isSidechain: true }]), 0).map(message => message.text)).toEqual(['Visible']);
  });

  it.each([false, true])('reads only the exact selected account conversation asynchronously (WSL: %s)', async posixCwd => {
    const home = await mkdtemp(join(tmpdir(), 'orkestrai-public-'));
    const session = '11111111-1111-4111-8111-111111111111';
    const root = join(home, 'work-profile', 'sessions', '2026', '11', '04');
    try {
      await mkdir(root, { recursive: true });
      await writeFile(join(root, `rollout-test-${session}.jsonl`), jsonl([codex('Selected profile')]) + '\n');
      const other = join(home, '.codex', 'sessions', '2026', '11', '04');
      await mkdir(other, { recursive: true });
      await writeFile(join(other, `rollout-test-${session}.jsonl`), jsonl([codex('WRONG ACCOUNT')]) + '\n');
      const result = await publicTranscriptUpdates('codex', posixCwd ? '/home/test/project' : home, session, Date.parse(at),
        { homeDir: home, codexHome: join(home, 'work-profile'), posixCwd });
      expect(result?.messages.map(message => message.text)).toEqual(['Selected profile']);
      expect(result?.complete).toBe(false);
    } finally { await rm(home, { recursive: true, force: true }); }
  });
});
