import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  findPromptInTranscript,
  findReplyToPrompt,
  latestTurnComplete,
  parseLatestTurnComplete,
  parseLatestTurnBoundary,
  latestTurnBoundary,
  parseClaudeTranscriptReply,
  parseCodexTranscriptReply,
  parseCodexTranscriptReplyForPrompt,
  parseDevinTranscriptReply,
  parseGenericTranscriptReply,
  parseKimiTranscriptReply,
  parseStructuredMessagesReply,
  parseTranscriptReplyForPrompt,
  parseTranscriptReplyStateForPrompt,
  transcriptContainsPrompt,
  transcriptMarks,
  type TranscriptMark,
} from '$lib/modules/agent-room/infrastructure/transcript/AgentTranscript.js';

describe('async transcript lookup', () => {
  it.each([false, true])('reads exact turns without synchronous filesystem scans (WSL: %s)', async (posixCwd) => {
    const home = await mkdtemp(join(tmpdir(), 'ork-transcript-async-'));
    const cwd = posixCwd ? '/home/test/project' : home;
    const sessionId = '11111111-1111-4111-8111-111111111111';
    const dir = join(home, '.codex', 'sessions', '2026', '09', '27');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `rollout-2026-09-27T12-00-00-${sessionId}.jsonl`), [
      { type: 'session_meta', payload: { id: sessionId, cwd } },
      { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'first prompt' }], internal_chat_message_metadata_passthrough: { turn_id: 'turn-1' } } },
      { type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-1', last_agent_message: 'First answer' } },
      { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'second prompt' }] } },
    ].map(event => JSON.stringify(event)).join('\n'));
    const reads = [vi.spyOn(fs, 'readdirSync'), vi.spyOn(fs, 'readFileSync'), vi.spyOn(fs, 'openSync')];
    try {
      const options = { homeDir: home, posixCwd };
      expect(await findPromptInTranscript('codex', cwd, sessionId, 'second prompt', Date.now() - 1_000, options)).toEqual({ sessionId });
      expect(await latestTurnComplete('codex', cwd, sessionId, options)).toBe(false);
      expect(await latestTurnBoundary('codex', cwd, sessionId, options)).toMatchObject({ ready: false });
      expect(await latestTurnComplete('codex', cwd, 'missing-session', options)).toBeNull();
      expect(await findReplyToPrompt('codex', cwd, sessionId, 'first prompt', Date.now() - 1_000, options)).toEqual({ sessionId, text: 'First answer', complete: true });
      expect(await findReplyToPrompt('codex', cwd, sessionId, 'second prompt', Date.now() - 1_000, options)).toBeNull();
      await appendFile(join(dir, `rollout-2026-09-27T12-00-00-${sessionId}.jsonl`), '\n' + JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'New answer after poll' }] } }));
      expect(await findReplyToPrompt('codex', cwd, sessionId, 'second prompt', Date.now() - 1_000, options)).toMatchObject({ sessionId, text: 'New answer after poll' });
      for (const spy of reads) expect(spy).not.toHaveBeenCalled();
    } finally {
      reads.forEach(spy => spy.mockRestore());
      await rm(home, { recursive: true, force: true });
    }
  });
});

describe('latest turn completion for supervision', () => {
  it('distinguishes a completed or aborted Codex composer from an actual reply', () => {
    const start = '2026-10-23T12:00:00Z', end = '2026-10-23T12:00:10Z';
    const prompt = { timestamp: start, type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Continue' }] } };
    const completed = { timestamp: end, type: 'event_msg', payload: { type: 'task_complete', last_agent_message: 'Done' } };
    const text = (events: unknown[]) => events.map(event => JSON.stringify(event)).join('\n');
    expect(parseLatestTurnBoundary('codex-rollout-jsonl', text([prompt, completed])))
      .toEqual({ ready: true, startedAt: Date.parse(start), finishedAt: Date.parse(end) });
    const aborted = { ...completed, payload: { type: 'turn_aborted' } };
    expect(parseLatestTurnComplete('codex-rollout-jsonl', text([prompt, aborted]))).toBe(false);
    expect(parseLatestTurnBoundary('codex-rollout-jsonl', text([prompt, aborted]))).toMatchObject({ ready: true, finishedAt: Date.parse(end) });
    expect(parseLatestTurnBoundary('codex-rollout-jsonl', text([prompt, completed, { ...prompt, timestamp: '2026-10-23T12:01:00Z' }])))
      .toEqual({ ready: false, startedAt: Date.parse('2026-10-23T12:01:00Z'), finishedAt: null });
  });

  it('requires explicit Claude completion, respecting pending input and newer work', () => {
    const prompt = { timestamp: '2026-10-23T12:00:00Z', type: 'user', message: { content: 'Continue' } };
    const duration = { timestamp: '2026-10-23T12:00:10Z', type: 'system', subtype: 'turn_duration' };
    const thinking = { type: 'assistant', message: { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: 'Not a final answer' }] } };
    const text = (events: unknown[]) => events.map(event => JSON.stringify(event)).join('\n');
    expect(parseLatestTurnBoundary('claude-project-jsonl', text([prompt, thinking])).ready).toBe(false);
    expect(parseLatestTurnBoundary('claude-project-jsonl', text([prompt, thinking, duration])))
      .toEqual({ ready: true, startedAt: Date.parse(prompt.timestamp), finishedAt: Date.parse(duration.timestamp) });
    expect(parseLatestTurnBoundary('claude-project-jsonl', text([prompt, duration, { type: 'assistant', message: { stop_reason: 'tool_use', content: [{ type: 'tool_use' }] } }])).ready).toBe(false);
    expect(parseLatestTurnBoundary('claude-project-jsonl', text([prompt, duration, { type: 'queue-operation', operation: 'enqueue' }])).ready).toBe(false);
    expect(parseLatestTurnBoundary('unregistered', '{}')).toEqual({ ready: null, startedAt: null, finishedAt: null });
  });

  it('uses Kimi epoch times without inventing timestamps for legacy transcripts', () => {
    const events = [{ type: 'turn.prompt', time: 1000, input: [{ type: 'text', text: 'Continue' }] }, { type: 'turn.ended', reason: 'completed', time: 2000 }];
    expect(parseLatestTurnBoundary('kimi-session-dir', events.map(event => JSON.stringify(event)).join('\n')))
      .toEqual({ ready: true, startedAt: 1000, finishedAt: 2000 });
    expect(parseLatestTurnBoundary('kimi-session-dir', events.map(({ time: _time, ...event }) => JSON.stringify(event)).join('\n')))
      .toEqual({ ready: true, startedAt: null, finishedAt: null });
  });
  it('does not mistake an earlier final answer for completion of a repeated prompt', () => {
    const prompt = { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Continue' }] } };
    const complete = { type: 'event_msg', payload: { type: 'task_complete', last_agent_message: 'Done' } };
    const transcript = [prompt, complete].map((event) => JSON.stringify(event)).join('\n');
    expect(parseLatestTurnComplete('codex-rollout-jsonl', transcript)).toBe(true);
    expect(parseLatestTurnComplete('codex-rollout-jsonl', transcript + '\n' + JSON.stringify(prompt))).toBe(false);
    expect(parseLatestTurnComplete('codex-rollout-jsonl', JSON.stringify(complete))).toBe(true);
    expect(parseLatestTurnComplete('codex-rollout-jsonl', JSON.stringify(complete) + '\n' + JSON.stringify({ type: 'event_msg', payload: { type: 'task_started' } }))).toBe(false);
  });

  it('requires a real end_turn rather than Claude commentary or tool output', () => {
    const prompt = { type: 'user', message: { content: 'Continue' } };
    const answer = { type: 'assistant', message: { content: [{ type: 'text', text: 'Checking' }] } };
    expect(parseLatestTurnComplete('claude-project-jsonl', [prompt, answer].map((event) => JSON.stringify(event)).join('\n'))).toBe(false);
    expect(parseLatestTurnComplete('claude-project-jsonl', [prompt, { ...answer, message: { ...answer.message, stop_reason: 'end_turn' } }].map((event) => JSON.stringify(event)).join('\n'))).toBe(true);
    expect(parseLatestTurnComplete('unregistered', '{}')).toBeNull();
    expect(parseLatestTurnComplete('codex-rollout-jsonl', '{}')).toBeNull();
  });

  it('releases a turn left open by a process that quit mid-turn', () => {
    const at = (iso: string) => `2026-10-10T${iso}Z`;
    const restartedAt = Date.parse(at('01:09:53'));
    const interrupted = [
      { timestamp: at('01:07:00'), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Continue' }] } },
      { timestamp: at('01:07:01'), type: 'event_msg', payload: { type: 'task_started' } },
      { timestamp: at('01:07:34'), type: 'response_item', payload: { type: 'reasoning' } },
      // Written by the resumed CLI: settings, not turn work.
      { timestamp: at('01:09:55'), type: 'event_msg', payload: { type: 'thread_settings_applied' } },
    ].map((event) => JSON.stringify(event)).join('\n');
    expect(parseLatestTurnComplete('codex-rollout-jsonl', interrupted)).toBe(false);
    expect(parseLatestTurnComplete('codex-rollout-jsonl', interrupted, restartedAt)).toBe(true);
    expect(parseLatestTurnBoundary('codex-rollout-jsonl', interrupted, restartedAt)).toMatchObject({ ready: true, finishedAt: null });
    // A turn running in the live process is still running.
    expect(parseLatestTurnComplete('codex-rollout-jsonl', interrupted, Date.parse(at('01:07:20')))).toBe(false);
    expect(parseLatestTurnBoundary('codex-rollout-jsonl', interrupted, Date.parse(at('01:07:20'))).ready).toBe(false);
    const claude = [
      { timestamp: at('01:07:00'), type: 'user', message: { content: 'Continue' } },
      { timestamp: at('01:07:05'), type: 'assistant', message: { content: [{ type: 'tool_use' }], stop_reason: 'tool_use' } },
    ].map((event) => JSON.stringify(event)).join('\n');
    expect(parseLatestTurnComplete('claude-project-jsonl', claude, restartedAt)).toBe(true);
    expect(parseLatestTurnComplete('claude-project-jsonl', claude, Date.parse(at('01:07:02')))).toBe(false);
    // Without timestamps there is no evidence the turn is stale.
    const untimed = interrupted.replace(/"timestamp":"[^"]+",/g, '');
    expect(parseLatestTurnComplete('codex-rollout-jsonl', untimed, restartedAt)).toBe(false);
  });
});

describe('parseClaudeTranscriptReply', () => {
  it('acknowledges a complete Claude bracketed-paste envelope and scopes its reply', () => {
    const pasted = '\n\n<pasted_content id="ac6e">\nReview the assigned task\n</pasted_content id="ac6e">\n';
    const events = [
      { type: 'user', message: { content: pasted } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Reviewed the assigned task.' }], stop_reason: 'end_turn' } },
    ];
    const transcript = events.map(event => JSON.stringify(event)).join('\n');
    expect(transcriptContainsPrompt('claude-project-jsonl', transcript, 'Review the assigned task')).toBe(true);
    expect(parseTranscriptReplyStateForPrompt('claude-project-jsonl', transcript, 'Review the assigned task'))
      .toEqual({ text: 'Reviewed the assigned task.', complete: true });
    expect(transcriptContainsPrompt('claude-project-jsonl', transcript, pasted)).toBe(true);
    const nextTurn = JSON.stringify({ type: 'user', message: { content: 'Another task' } });
    expect(transcriptContainsPrompt('claude-project-jsonl', transcript + '\n' + nextTurn, 'Review the assigned task')).toBe(false);
    expect(parseTranscriptReplyForPrompt('claude-project-jsonl', transcript + '\n' + nextTurn, 'Review the assigned task'))
      .toBe('Reviewed the assigned task.');
  });

  it.each([
    '<pasted_content id="one">Expected</pasted_content id="two">',
    'Extra <pasted_content id="one">Expected</pasted_content id="one">',
    '<pasted_content id="one">Expected</pasted_content id="one"> extra',
    '<pasted_content id="one">Expected</pasted_content id="one"><pasted_content id="two">Another</pasted_content id="two">',
    '<pasted_content id="one">Expected and something else</pasted_content id="one">',
  ])('does not accept a partial or mismatched paste: %s', content => {
    const transcript = JSON.stringify({ type: 'user', message: { content } });
    expect(transcriptContainsPrompt('claude-project-jsonl', transcript, 'Expected')).toBe(false);
    expect(parseTranscriptReplyForPrompt('claude-project-jsonl', transcript, 'Expected')).toBeNull();
  });

  it('ignores non-event JSON and does not acknowledge a cancelled queued prompt', () => {
    const transcript = [
      { type: 'queue-operation', operation: 'enqueue', content: 'Cancelled' },
      { type: 'queue-operation', operation: 'remove', reason: 'cancelled', content: 'Cancelled' },
      null, 0, 'unrelated', {},
    ].map((event) => JSON.stringify(event)).join('\n');
    expect(transcriptContainsPrompt('claude-project-jsonl', transcript, 'Cancelled')).toBe(false);
    expect(transcriptContainsPrompt('claude-project-jsonl', transcript, 'Missing')).toBe(false);
  });

  it('matches a mid-turn queued prompt without including the previous answer', () => {
    const events = [
      { type: 'user', message: { content: 'Old prompt' } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Old answer' }], stop_reason: 'end_turn' } },
      { type: 'queue-operation', operation: 'enqueue', content: 'Review the new change' },
      { type: 'queue-operation', operation: 'remove', reason: 'absorbed_mid_turn', content: 'Review the new change' },
      { type: 'attachment', isSidechain: false, attachment: { type: 'queued_command', commandMode: 'prompt', prompt: 'Review the new change' } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'New review' }], stop_reason: 'end_turn' } },
    ];
    const transcript = events.map((event) => JSON.stringify(event)).join('\n');
    expect(transcriptContainsPrompt('claude-project-jsonl', events.slice(0, 3).map((e) => JSON.stringify(e)).join('\n'), 'Review the new change')).toBe(true);
    expect(parseTranscriptReplyStateForPrompt('claude-project-jsonl', transcript, 'Review the new change')).toEqual({ text: 'New review', complete: true });
    expect(parseClaudeTranscriptReply(transcript)).toBe('New review');
    expect(parseTranscriptReplyForPrompt('claude-project-jsonl', transcript, 'Old prompt')).toBe('Old answer');
  });

  it('does not turn an enqueue, unrelated attachment or tool output into an agent answer', () => {
    const transcript = [
      { type: 'user', message: { content: 'Old prompt' } },
      { type: 'queue-operation', operation: 'enqueue', content: 'Queued prompt' },
      { type: 'attachment', attachment: { type: 'other', prompt: 'Queued prompt' } },
      { type: 'user', message: { content: [{ type: 'tool_result', content: 'Not an answer' }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Old response' }] } },
    ].map((event) => JSON.stringify(event)).join('\n');
    expect(parseTranscriptReplyForPrompt('claude-project-jsonl', transcript, 'Queued prompt')).toBeNull();
    expect(transcriptContainsPrompt('claude-project-jsonl', transcript, 'Missing prompt')).toBe(false);
  });
  it('junta TODOS os blocos de texto do assistant apos a ultima pergunta (inclusive com tool calls no meio)', () => {
    const jsonl = [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'como estao as tasks?' } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Vou verificar o quadro.' }, { type: 'tool_use', name: 'Bash', input: {} }] } }),
      JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'saida do comando' }] } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Tudo verde: 3 tarefas feitas e 1 em andamento.' }] } }),
    ].join('\n');
    expect(parseClaudeTranscriptReply(jsonl)).toBe('Vou verificar o quadro.\n\nTudo verde: 3 tarefas feitas e 1 em andamento.');
  });

  it('resposta com paragrafos/multiplas mensagens assistant vem completa', () => {
    const jsonl = [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'resume o projeto' } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Primeiro ponto.' }] } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Segundo ponto.' }] } }),
    ].join('\n');
    expect(parseClaudeTranscriptReply(jsonl)).toBe('Primeiro ponto.\n\nSegundo ponto.');
  });

  it('pergunta nova no fim vira fronteira (nao mistura respostas antigas)', () => {
    const jsonl = [
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Resposta velha.' }] } }),
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'nova pergunta' } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Resposta nova.' }] } }),
    ].join('\n');
    expect(parseClaudeTranscriptReply(jsonl)).toBe('Resposta nova.');
  });

  it('sem resposta retorna null', () => {
    expect(parseClaudeTranscriptReply(JSON.stringify({ type: 'user', message: { role: 'user', content: 'so pergunta' } }))).toBeNull();
  });

  it('ignora mensagens meta e espera o end_turn antes de fechar uma resposta com tools', () => {
    const partial = [
      { type: 'user', origin: { kind: 'human' }, message: { content: 'como esta o projeto?' } },
      { type: 'assistant', message: { stop_reason: 'tool_use', content: [{ type: 'text', text: 'Vou verificar.' }] } },
      { type: 'user', isMeta: true, message: { content: [{ type: 'text', text: 'Base directory for this skill: /tmp/skill' }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', content: 'resultado' }] } },
    ].map(JSON.stringify).join('\n');
    expect(parseTranscriptReplyStateForPrompt('claude-project-jsonl', partial, 'como esta o projeto?')).toEqual({
      text: 'Vou verificar.',
      complete: false,
    });

    const complete = `${partial}\n${JSON.stringify({
      type: 'assistant',
      message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Projeto concluido.' }] },
    })}`;
    expect(parseTranscriptReplyStateForPrompt('claude-project-jsonl', complete, 'como esta o projeto?')).toEqual({
      text: 'Vou verificar.\n\nProjeto concluido.',
      complete: true,
    });
  });
});

describe('parseCodexTranscriptReply', () => {
  it('junta output_text do assistant apos o ultimo input_text do usuario', () => {
    const jsonl = [
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'status?' }] } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Estou operacional.' }] } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Pronto para o proximo passo.' }] } }),
    ].join('\n');
    expect(parseCodexTranscriptReply(jsonl)).toBe('Estou operacional.\n\nPronto para o proximo passo.');
  });

  it('ignora eventos nao-message (reasoning, tool calls)', () => {
    const jsonl = [
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'vai' }] } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'reasoning', summary: [] } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'function_call', name: 'shell' } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Feito.' }] } }),
    ].join('\n');
    expect(parseCodexTranscriptReply(jsonl)).toBe('Feito.');
  });

  it('sem resposta retorna null', () => {
    expect(parseCodexTranscriptReply('{"type":"session_meta","payload":{}}')).toBeNull();
  });

  it('nunca associa a resposta de outra pergunta ao chat remoto', () => {
    const jsonl = [
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'corrija o lockfile' }] } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Vou restaurar o lock validado.' }] } }),
    ].join('\n');
    expect(parseCodexTranscriptReplyForPrompt(jsonl, 'Oi tudo bem?')).toBeNull();
    expect(parseCodexTranscriptReplyForPrompt(jsonl, '  corrija   o lockfile ')).toBe('Vou restaurar o lock validado.');
  });

  it('confirma o turno pelo task_complete e ainda encontra a resposta depois de uma pergunta nova', () => {
    const jsonl = [
      { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'primeira pergunta' }], internal_chat_message_metadata_passthrough: { turn_id: 'turn-1' } } },
      { type: 'response_item', payload: { type: 'message', role: 'assistant', phase: 'commentary', content: [{ type: 'output_text', text: 'Vou verificar.' }] } },
      { type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-1', last_agent_message: 'Primeira resposta final.' } },
      { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'segunda pergunta' }], internal_chat_message_metadata_passthrough: { turn_id: 'turn-2' } } },
      { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Segunda resposta.' }] } },
    ].map(JSON.stringify).join('\n');

    expect(parseTranscriptReplyStateForPrompt('codex-rollout-jsonl', jsonl, 'primeira pergunta')).toEqual({
      text: 'Primeira resposta final.',
      complete: true,
    });
    expect(parseTranscriptReplyStateForPrompt('codex-rollout-jsonl', jsonl, 'segunda pergunta')).toEqual({
      text: 'Segunda resposta.',
      complete: false,
    });
  });
});

describe('parseKimiTranscriptReply (formato real do wire.jsonl, 0.33)', () => {
  it('junta os textos do assistente depois do ultimo turn.prompt', () => {
    const jsonl = [
      JSON.stringify({ type: 'profile.bind', modelAlias: 'kimi-code/k3' }),
      JSON.stringify({ type: 'turn.prompt', input: [{ type: 'text', text: 'como voce esta?' }], origin: { kind: 'user' } }),
      JSON.stringify({ type: 'context.append_loop_event', event: { type: 'content.part', part: { type: 'text', text: 'Estou bem.' } } }),
      JSON.stringify({ type: 'context.append_loop_event', event: { type: 'content.part', part: { type: 'text', text: 'Pronto para trabalhar.' } } }),
      JSON.stringify({ type: 'turn.ended', reason: 'completed' }),
    ].join('\n');
    expect(parseKimiTranscriptReply(jsonl)).toBe('Estou bem.\n\nPronto para trabalhar.');
  });

  it('ignora o que veio antes do ultimo prompt e retorna null sem resposta', () => {
    const jsonl = [
      JSON.stringify({ type: 'context.append_loop_event', event: { type: 'content.part', part: { type: 'text', text: 'resposta antiga' } } }),
      JSON.stringify({ type: 'turn.prompt', input: [{ type: 'text', text: 'oi' }] }),
    ].join('\n');
    expect(parseKimiTranscriptReply(jsonl)).toBeNull();
    expect(parseKimiTranscriptReply('{"type":"profile.bind"}')).toBeNull();
  });
});

describe('transcritos estruturados dos providers adicionais', () => {
  it('confirma o prompt antes de existir qualquer resposta do provider', () => {
    const claude = JSON.stringify({ type: 'user', message: { content: 'mensagem entre agentes' } });
    const codex = JSON.stringify({
      type: 'response_item',
      payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'mensagem entre agentes' }] },
    });
    const kimi = JSON.stringify({ type: 'turn.prompt', input: [{ type: 'text', text: 'mensagem entre agentes' }] });

    expect(transcriptContainsPrompt('claude-project-jsonl', claude, ' mensagem   entre agentes ')).toBe(true);
    expect(transcriptContainsPrompt('codex-rollout-jsonl', codex, 'mensagem entre agentes')).toBe(true);
    expect(transcriptContainsPrompt('kimi-session-dir', kimi, 'mensagem entre agentes')).toBe(true);
    expect(transcriptContainsPrompt('claude-project-jsonl', claude, 'outra mensagem')).toBe(false);
    expect(parseTranscriptReplyForPrompt('claude-project-jsonl', claude, 'mensagem entre agentes')).toBeNull();

    const newerClaudeTurn = `${claude}\n${JSON.stringify({ type: 'user', message: { content: 'mensagem posterior' } })}`;
    expect(transcriptContainsPrompt('claude-project-jsonl', newerClaudeTurn, 'mensagem entre agentes')).toBe(false);
  });

  it('encontra o prompt do Claude no home da distribuição WSL', async () => {
    const home = await mkdtemp(join(tmpdir(), 'orkestrai-wsl-transcript-'));
    const sessionId = '01a11111-2222-7333-8444-555555555555';
    const directory = join(home, '.claude', 'projects', '-home-dev-project');
    try {
      await mkdir(directory, { recursive: true });
      await writeFile(
        join(directory, `${sessionId}.jsonl`),
        `${JSON.stringify({ type: 'user', message: { content: 'execute a tarefa' } })}\n`,
      );

      await expect(findPromptInTranscript(
        'claude',
        '/home/dev/project',
        sessionId,
        'execute a tarefa',
        Date.now() - 1_000,
        { homeDir: home, posixCwd: true },
      )).resolves.toEqual({ sessionId });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it('confirma a resposta completa do Claude no transcript da distribuição WSL', async () => {
    const home = await mkdtemp(join(tmpdir(), 'orkestrai-wsl-reply-'));
    const sessionId = '01a11111-2222-7333-8444-666666666666';
    const directory = join(home, '.claude', 'projects', '-home-dev-project');
    try {
      await mkdir(directory, { recursive: true });
      await writeFile(
        join(directory, `${sessionId}.jsonl`),
        [
          { type: 'user', message: { content: 'analise o contrato' } },
          { type: 'assistant', message: { stop_reason: 'tool_use', content: [{ type: 'text', text: 'Vou verificar.' }] } },
          { type: 'user', message: { content: [{ type: 'tool_result', content: 'resultado' }] } },
          { type: 'assistant', message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Contrato confirmado.' }] } },
        ].map(JSON.stringify).join('\n'),
      );

      await expect(findReplyToPrompt(
        'claude',
        '/home/dev/project',
        'stale-session-id',
        'analise o contrato',
        Date.now() - 1_000,
        { homeDir: home, posixCwd: true },
      )).resolves.toEqual({
        sessionId,
        text: 'Vou verificar.\n\nContrato confirmado.',
        complete: true,
      });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it('le Cursor e Antigravity em JSONL sem misturar a resposta anterior', () => {
    const jsonl = [
      JSON.stringify({ role: 'assistant', content: 'resposta antiga' }),
      JSON.stringify({ role: 'user', content: 'nova pergunta' }),
      JSON.stringify({ role: 'assistant', content: [{ type: 'text', text: 'Resposta atual.' }] }),
    ].join('\n');
    expect(parseGenericTranscriptReply(jsonl)).toBe('Resposta atual.');
  });

  it('le o array de mensagens persistido pelo Cline', () => {
    expect(
      parseStructuredMessagesReply([
        { role: 'user', content: 'faça a análise' },
        { role: 'assistant', content: [{ type: 'text', text: 'Análise concluída.' }] },
      ])
    ).toBe('Análise concluída.');
  });

  it('le o ATIF do Devin e usa reasoning_content apenas quando message esta vazio', () => {
    const transcript = JSON.stringify({
      steps: [
        { source: 'agent', message: 'resposta antiga' },
        { source: 'user', message: 'nova pergunta' },
        { source: 'agent', message: 'Primeira parte.' },
        { source: 'agent', message: '', reasoning_content: 'Segunda parte.' },
      ],
    });
    expect(parseDevinTranscriptReply(transcript)).toBe('Primeira parte.\n\nSegunda parte.');
  });

  it('exige a pergunta exata em todos os formatos declarados pelos adapters', () => {
    const cases = [
      {
        storage: 'claude-project-jsonl',
        transcript: [
          { type: 'user', message: { content: 'pergunta atual' } },
          { type: 'assistant', message: { content: [{ type: 'text', text: 'Claude respondeu.' }] } },
        ].map(JSON.stringify).join('\n'),
      },
      {
        storage: 'codex-rollout-jsonl',
        transcript: [
          { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'pergunta atual' }] } },
          { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Codex respondeu.' }] } },
        ].map(JSON.stringify).join('\n'),
      },
      {
        storage: 'kimi-session-dir',
        transcript: [
          { type: 'turn.prompt', input: [{ type: 'text', text: 'pergunta atual' }] },
          { type: 'context.append_loop_event', event: { type: 'content.part', part: { type: 'text', text: 'Kimi respondeu.' } } },
        ].map(JSON.stringify).join('\n'),
      },
      ...['opencode-session-json', 'cursor-transcript-jsonl', 'antigravity-workspace-cache'].map((storage) => ({
        storage,
        transcript: [
          { role: 'user', content: 'pergunta atual' },
          { role: 'assistant', content: 'Provider respondeu.' },
        ].map(JSON.stringify).join('\n'),
      })),
      {
        storage: 'cline-session-manifest',
        transcript: JSON.stringify([
          { role: 'user', content: 'pergunta atual' },
          { role: 'assistant', content: 'Cline respondeu.' },
        ]),
      },
      {
        storage: 'devin-session-db',
        transcript: JSON.stringify({ steps: [
          { source: 'user', message: 'pergunta atual' },
          { source: 'agent', message: 'Devin respondeu.' },
        ] }),
      },
    ];

    for (const testCase of cases) {
      expect(parseTranscriptReplyForPrompt(testCase.storage, testCase.transcript, 'pergunta anterior')).toBeNull();
      expect(parseTranscriptReplyForPrompt(testCase.storage, testCase.transcript, '  pergunta   atual ')).toMatch(/respondeu\.$/);
    }
  });

  it('correlaciona um turno anterior sem misturar a resposta do turno seguinte', () => {
    const cases = [
      {
        storage: 'claude-project-jsonl',
        transcript: [
          { type: 'user', message: { content: 'pergunta anterior' } },
          { type: 'assistant', message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Resposta anterior do Claude.' }] } },
          { type: 'user', message: { content: 'pergunta atual' } },
          { type: 'assistant', message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Resposta atual do Claude.' }] } },
        ].map(JSON.stringify).join('\n'),
      },
      {
        storage: 'kimi-session-dir',
        transcript: [
          { type: 'turn.prompt', input: [{ type: 'text', text: 'pergunta anterior' }] },
          { type: 'context.append_loop_event', event: { type: 'content.part', part: { type: 'text', text: 'Resposta anterior do Kimi.' } } },
          { type: 'turn.ended' },
          { type: 'turn.prompt', input: [{ type: 'text', text: 'pergunta atual' }] },
          { type: 'context.append_loop_event', event: { type: 'content.part', part: { type: 'text', text: 'Resposta atual do Kimi.' } } },
        ].map(JSON.stringify).join('\n'),
      },
      {
        storage: 'cursor-transcript-jsonl',
        transcript: [
          { role: 'user', content: 'pergunta anterior' },
          { role: 'assistant', content: 'Resposta anterior do Cursor.' },
          { role: 'user', content: 'pergunta atual' },
          { role: 'assistant', content: 'Resposta atual do Cursor.' },
        ].map(JSON.stringify).join('\n'),
      },
      {
        storage: 'cline-session-manifest',
        transcript: JSON.stringify([
          { role: 'user', content: 'pergunta anterior' },
          { role: 'assistant', content: 'Resposta anterior do Cline.' },
          { role: 'user', content: 'pergunta atual' },
          { role: 'assistant', content: 'Resposta atual do Cline.' },
        ]),
      },
      {
        storage: 'devin-session-db',
        transcript: JSON.stringify({ steps: [
          { source: 'user', message: 'pergunta anterior' },
          { source: 'agent', message: 'Resposta anterior do Devin.' },
          { source: 'user', message: 'pergunta atual' },
          { source: 'agent', message: 'Resposta atual do Devin.' },
        ] }),
      },
    ];

    for (const testCase of cases) {
      expect(parseTranscriptReplyForPrompt(testCase.storage, testCase.transcript, 'pergunta anterior')).toMatch(/Resposta anterior/);
      expect(parseTranscriptReplyForPrompt(testCase.storage, testCase.transcript, 'pergunta anterior')).not.toMatch(/Resposta atual/);
    }
  });
});

describe('a question asked again in the same conversation', () => {
  const user = (text: string, timestamp?: string) => JSON.stringify({ type: 'user', ...(timestamp ? { timestamp } : {}), message: { role: 'user', content: text } });
  const reply = (text: string, timestamp?: string) => JSON.stringify({ type: 'assistant', ...(timestamp ? { timestamp } : {}), message: { role: 'assistant', content: [{ type: 'text', text }], stop_reason: 'end_turn' } });
  const sentAt = Date.parse('2026-10-20T16:00:02.000Z');

  it('is matched to its own turn, never to the reply of an earlier occurrence', () => {
    const waiting = [
      user('Qual o status?', '2026-10-20T16:00:00.000Z'),
      reply('Resposta antiga: entregue.', '2026-10-20T16:00:01.000Z'),
      user('Qual o status?', '2026-10-20T16:00:02.000Z'),
    ].join('\n');
    expect(parseTranscriptReplyStateForPrompt('claude-project-jsonl', waiting, 'Qual o status?', { notBefore: sentAt })).toBeNull();
    const answered = [waiting, reply('Resposta nova: em revisão.', '2026-10-20T16:00:05.000Z')].join('\n');
    expect(parseTranscriptReplyStateForPrompt('claude-project-jsonl', answered, 'Qual o status?', { notBefore: sentAt })).toEqual({ text: 'Resposta nova: em revisão.', complete: true });
    // Not yet written: nothing matches rather than the earlier turn.
    const notYet = waiting.split('\n').slice(0, 2).join('\n');
    expect(parseTranscriptReplyStateForPrompt('claude-project-jsonl', notYet, 'Qual o status?', { notBefore: sentAt })).toBeNull();
    // Callers without a lower bound keep the earlier behavior.
    expect(parseTranscriptReplyStateForPrompt('claude-project-jsonl', answered, 'Qual o status?')).toEqual({ text: 'Resposta antiga: entregue.', complete: true });
  });

  it('matches a prompt the transcript records without a time only past the occurrences counted when it was sent', () => {
    const answer = (transcript: string, before?: number) => parseTranscriptReplyStateForPrompt('claude-project-jsonl', transcript, 'Qual o status?', { notBefore: sentAt, before });
    const once = [user('Qual o status?'), reply('Resposta antiga: entregue.')].join('\n');
    // It was already there when the line was sent: the earlier question's turn.
    expect(answer(once, 1)).toBeNull();
    // Being the only one, without a count, proves nothing.
    expect(answer(once)).toBeNull();
    // Counted none: the one there now was written after the send.
    expect(answer(once, 0)).toEqual({ text: 'Resposta antiga: entregue.', complete: true });
    const twice = [once, user('Qual o status?'), reply('Resposta nova: em revisão.')].join('\n');
    expect(answer(twice, 1)).toEqual({ text: 'Resposta nova: em revisão.', complete: true });
    expect(answer(twice)).toBeNull();
  });

  it('reads a Kimi prompt time in milliseconds', () => {
    const prompt = (text: string, time: number) => JSON.stringify({ type: 'turn.prompt', input: [{ type: 'text', text }], origin: { kind: 'user' }, time });
    const part = (text: string) => JSON.stringify({ type: 'context.append_loop_event', event: { type: 'content.part', part: { type: 'text', text } } });
    const transcript = [prompt('Qual o status?', sentAt - 2_000), part('Antiga.'), prompt('Qual o status?', sentAt + 50), part('Nova.')].join('\n');
    expect(parseTranscriptReplyStateForPrompt('kimi-session-dir', transcript, 'Qual o status?', { notBefore: sentAt })?.text).toBe('Nova.');
  });

  it('answers a CLI that appends untimed prompts only with what it wrote past the mark taken at the send', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ork-transcript-untimed-'));
    const line = (role: string, content: string) => JSON.stringify({ role, content });
    // Cursor files the conversation under the real cwd (/private/tmp on macOS).
    const files = ['tmp', 'private-tmp'].map((folder) => join(home, '.cursor', 'projects', folder, 'agent-transcripts', 'repeated', 'repeated.jsonl'));
    const append = async (...lines: string[]) => { for (const file of files) await appendFile(file, `${lines.join('\n')}\n`); };
    for (const file of files) await mkdir(join(file, '..'), { recursive: true });
    await append(line('user', 'Qual o status?'), line('assistant', 'Resposta antiga: entregue.'));
    try {
      const at = Date.now();
      const marks = await transcriptMarks('cursor', '/tmp', 'repeated', 'Qual o status?', { homeDir: home });
      expect(marks.repeated).toMatchObject({ bytes: expect.any(Number), hash: expect.any(String) });
      const lookup = (promptMarks?: Record<string, TranscriptMark>) => findReplyToPrompt('cursor', '/tmp', 'repeated', 'Qual o status?', at - 5_000, { homeDir: home, promptNotBefore: at, promptMarks });
      // The CLI has not written the repeated line yet: the earlier turn is not its answer.
      expect(await lookup(marks)).toBeNull();
      // Without a mark, the only occurrence proves nothing.
      expect(await lookup()).toBeNull();
      await append(line('user', 'Qual o status?'));
      expect(await lookup(marks)).toBeNull();
      await append(line('assistant', 'Resposta nova: em revisão.'));
      expect(await lookup(marks)).toMatchObject({ sessionId: 'repeated', text: 'Resposta nova: em revisão.' });
      // Timed CLIs need no mark.
      expect(await transcriptMarks('claude', '/tmp', 'repeated', 'Qual o status?', { homeDir: home })).toEqual({});
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it('keeps the mark exact past the part of a long transcript it reads, and when the file is written anew', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ork-transcript-untimed-long-'));
    const line = (role: string, content: string) => JSON.stringify({ role, content });
    const files = ['tmp', 'private-tmp'].map((folder) => join(home, '.cursor', 'projects', folder, 'agent-transcripts', 'long', 'long.jsonl'));
    const append = async (...lines: string[]) => { for (const file of files) await appendFile(file, `${lines.join('\n')}\n`); };
    for (const file of files) await mkdir(join(file, '..'), { recursive: true });
    const filler = Array.from({ length: 5 }, (_, index) => line('assistant', `${index}:${'x'.repeat(1024 * 1024)}`));
    await append(line('user', 'Qual o status?'), line('assistant', 'Resposta antiga: entregue.'));
    try {
      const at = Date.now();
      const marks = await transcriptMarks('cursor', '/tmp', 'long', 'Qual o status?', { homeDir: home });
      const lookup = () => findReplyToPrompt('cursor', '/tmp', 'long', 'Qual o status?', at - 5_000, { homeDir: home, promptNotBefore: at, promptMarks: marks });
      // More than the 4 MB read since the send: what is read is all new, and the old turn is not in it.
      await append(...filler);
      expect(await lookup()).toBeNull();
      await append(line('user', 'Qual o status?'), line('assistant', 'Resposta nova: em revisão.'));
      expect(await lookup()).toMatchObject({ text: 'Resposta nova: em revisão.' });
      // Written anew with the same start, what follows the mark is still new.
      for (const file of files) await writeFile(file, `${[line('user', 'Qual o status?'), line('assistant', 'Resposta antiga: entregue.'), line('user', 'Qual o status?'), line('assistant', 'Reescrita depois do envio.')].join('\n')}\n`);
      expect(await lookup()).toMatchObject({ text: 'Reescrita depois do envio.' });
      // Changed before the mark (compacted, say), it proves nothing, even holding the prompt again.
      for (const file of files) await writeFile(file, `${[line('assistant', 'Resumo da conversa.'), line('user', 'Qual o status?'), line('assistant', 'Resposta antiga: entregue.'), line('user', 'Qual o status?'), line('assistant', 'Reescrita.')].join('\n')}\n`);
      expect(await lookup()).toBeNull();
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it('answers a CLI that rewrites its untimed transcript whole only past the occurrences counted at the send', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ork-transcript-untimed-cline-'));
    const path = join(home, '.cline', 'data', 'sessions', 'task', 'task.messages.json');
    const message = (role: string, text: string) => ({ role, content: [{ type: 'text', text }] });
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, JSON.stringify({ messages: [message('user', 'Qual o status?'), message('assistant', 'Resposta antiga: entregue.')] }));
    try {
      const at = Date.now();
      const marks = await transcriptMarks('cline', '/tmp', 'task', 'Qual o status?', { homeDir: home });
      expect(marks).toEqual({ task: { occurrences: 1 } });
      const lookup = () => findReplyToPrompt('cline', '/tmp', 'task', 'Qual o status?', at - 5_000, { homeDir: home, promptNotBefore: at, promptMarks: marks });
      expect(await lookup()).toBeNull();
      await writeFile(path, JSON.stringify({ messages: [message('user', 'Qual o status?'), message('assistant', 'Resposta antiga: entregue.'), message('user', 'Qual o status?'), message('assistant', 'Resposta nova: em revisão.')] }));
      expect(await lookup()).toMatchObject({ sessionId: 'task', text: 'Resposta nova: em revisão.' });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it('reads when OpenCode created each prompt', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ork-transcript-opencode-'));
    const databaseDir = join(home, '.local', 'share', 'opencode');
    await mkdir(databaseDir, { recursive: true });
    const database = new DatabaseSync(join(databaseDir, 'opencode.db'));
    database.exec('CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL)');
    database.exec('CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL)');
    const insertMessage = database.prepare('INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)');
    const insertPart = database.prepare('INSERT INTO part (id, message_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)');
    const at = Date.now();
    const add = (id: string, role: string, text: string, created: number) => {
      insertMessage.run(id, 'ses_status', created, created, JSON.stringify({ role }));
      insertPart.run(`${id}_part`, id, created, created, JSON.stringify({ type: 'text', text }));
    };
    add('msg_1', 'user', 'Qual o status?', at - 60_000);
    add('msg_2', 'assistant', 'Resposta antiga: entregue.', at - 59_000);
    try {
      const lookup = () => findReplyToPrompt('opencode', '/tmp', 'ses_status', 'Qual o status?', at - 5_000, { homeDir: home, promptNotBefore: at });
      // Recent activity, but the only occurrence was created before the send.
      add('msg_3', 'assistant', 'Ainda trabalhando no pedido anterior.', at - 1_000);
      expect(await lookup()).toBeNull();
      add('msg_4', 'user', 'Qual o status?', at + 100);
      add('msg_5', 'assistant', 'Resposta nova: em revisão.', at + 2_000);
      expect(await lookup()).toMatchObject({ sessionId: 'ses_status', text: 'Resposta nova: em revisão.' });
      // A time is all the proof it needs.
      expect(await transcriptMarks('opencode', '/tmp', 'ses_status', 'Qual o status?', { homeDir: home })).toEqual({});
    } finally {
      database.close();
      await rm(home, { recursive: true, force: true });
    }
  });
});
