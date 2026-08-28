import { describe, expect, it } from 'vitest';
import { safeAgentRespawn } from '$lib/modules/agent-room/domain/terminal-session-launch.js';

describe('safeAgentRespawn', () => {
  it('starts a new Codex conversation instead of resuming the last workspace conversation', () => {
    expect(safeAgentRespawn(
      ['--model', 'gpt-5.6-sol'],
      null,
      (id) => ['resume', id],
      null,
    )).toEqual({ args: ['--model', 'gpt-5.6-sol'] });
  });

  it('resumes only the exact conversation attributed to the canvas node', () => {
    expect(safeAgentRespawn(
      ['--model', 'gpt-5.6-sol'],
      'conversation-director',
      (id) => ['resume', id],
      null,
    )).toEqual({
      args: ['--model', 'gpt-5.6-sol'],
      conversationArgs: ['resume', 'conversation-director'],
    });
  });

  it('uses a provider fresh-session reservation when exact resume is unavailable', () => {
    expect(safeAgentRespawn(
      ['--effort', 'medium'],
      null,
      (id) => ['--resume', id],
      ['--session-id', '__ORKESTRAI_SESSION_ID__'],
    )).toEqual({
      args: ['--effort', 'medium'],
      freshSessionArgs: ['--session-id', '__ORKESTRAI_SESSION_ID__'],
    });
  });
});
