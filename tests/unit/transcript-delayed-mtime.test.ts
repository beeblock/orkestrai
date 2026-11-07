import { expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, utimes, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { findPromptInTranscript } from '$lib/modules/agent-room/infrastructure/transcript/AgentTranscript.ts';

it('confirms the exact Codex prompt when Windows exposes new bytes with a delayed file timestamp', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orkestrai-delayed-write-time-'));
  try {
    const id = randomUUID(), since = Date.now();
    const folder = join(root, 'sessions', '2026', '11', '07'); await mkdir(folder, { recursive: true });
    const file = join(folder, `rollout-2026-11-07-${id}.jsonl`);
    const text = `[orkestrai:message:${randomUUID()}] Exact new delivery`;
    await writeFile(file, [
      { type: 'session_meta', payload: { id, cwd: root } },
      { type: 'response_item', timestamp: new Date(since).toISOString(), payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } },
    ].map(row => JSON.stringify(row)).join('\n'));
    await utimes(file, new Date(since - 3600000), new Date(since - 3600000));
    expect(await findPromptInTranscript('codex', root, id, text, since, { codexHome: root })).toEqual({ sessionId: id });
    expect(await findPromptInTranscript('codex', root, id, 'Different delivery', since, { codexHome: root })).toBeNull();
  } finally { await rm(root, { recursive: true, force: true }); }
});
