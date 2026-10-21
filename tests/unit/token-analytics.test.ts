import { describe, expect, it } from 'vitest';
import { readClaudeTranscript, readCodexRollout } from '$lib/modules/agent-room/application/services/TokenAnalyticsService.js';

async function* lines(rows: unknown[]): AsyncIterable<string> {
  for (const row of rows) yield JSON.stringify(row);
}

describe('token analytics', () => {
  it('counts each Claude message once even when streamed blocks repeat it', async () => {
    const usage = { input_tokens: 2, cache_creation_input_tokens: 100, cache_read_input_tokens: 50, output_tokens: 10 };
    const result = await readClaudeTranscript(lines([
      { type: 'user', timestamp: '2026-10-18T10:00:00Z', sessionId: 's1' },
      { type: 'assistant', timestamp: '2026-10-18T10:00:01Z', sessionId: 's1', message: { id: 'm1', usage } },
      { type: 'assistant', timestamp: '2026-10-18T10:00:02Z', sessionId: 's1', message: { id: 'm1', usage } },
      { type: 'assistant', timestamp: '2026-10-18T10:05:00Z', sessionId: 's1', message: { id: 'm2', usage: { ...usage, output_tokens: 5 } } },
    ]));
    expect(result.sessionId).toBe('s1');
    const day = Object.values(result.byDay)[0];
    expect(day).toEqual({ input: 204, output: 15, cached: 100 });
  });

  it('adds only what grew between Codex token counts', async () => {
    const count = (input: number, cached: number, output: number) => ({ timestamp: '2026-10-18T12:00:00Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output } } } });
    const result = await readCodexRollout(lines([
      { type: 'session_meta', payload: { session_id: 'codex-1' } },
      count(1000, 400, 50),
      count(1000, 400, 50),
      count(1600, 900, 80),
    ]));
    expect(result.sessionId).toBe('codex-1');
    expect(Object.values(result.byDay)[0]).toEqual({ input: 700, output: 80, cached: 900 });
  });
});
