import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  findPromptInTranscript,
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
} from '$lib/modules/agent-room/infrastructure/transcript/AgentTranscript.js';

describe('parseClaudeTranscriptReply', () => {
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
