import { describe, expect, it } from 'vitest';
import { parseBoardCommand } from '$lib/modules/agent-room/domain/board-commands.js';

const options = {
  providers: [{ id: 'claude', names: ['claude', 'Claude Code'] }, { id: 'codex', names: ['codex', 'OpenAI Codex'] }],
  agents: ['Codex Lider', 'QA Upload', 'Codex'],
};

describe('board commands', () => {
  it('spawns agents with counts in words or digits', () => {
    expect(parseBoardCommand('crie 4 agentes claude', options)).toEqual({ kind: 'spawn', count: 4, provider: 'claude' });
    expect(parseBoardCommand('Spawn five Claude Code agents', options)).toEqual({ kind: 'spawn', count: 5, provider: 'claude' });
    expect(parseBoardCommand('crea tres agentes codex', options)).toEqual({ kind: 'spawn', count: 3, provider: 'codex' });
    expect(parseBoardCommand('crie 40 agentes', options)).toEqual({ kind: 'spawn', count: 12, provider: null });
    expect(parseBoardCommand('novo agente codex', options)).toEqual({ kind: 'spawn', count: 1, provider: 'codex' });
  });

  it('hands a task over only when both agents are named', () => {
    expect(parseBoardCommand('passe a tarefa do Codex Lider para o QA Upload', options)).toEqual({ kind: 'handoff', from: 'Codex Lider', to: 'QA Upload' });
    expect(parseBoardCommand('pass the task from QA Upload to Codex Lider', options)).toEqual({ kind: 'handoff', from: 'QA Upload', to: 'Codex Lider' });
    expect(parseBoardCommand('passe isso para o Codex', options)).toBeNull();
  });

  it('keeps ordinary messages as messages', () => {
    expect(parseBoardCommand('Pause o deploy e me explique o plano', options)).toBeNull();
    expect(parseBoardCommand('Continue o trabalho no formulário', options)).toBeNull();
    expect(parseBoardCommand('veja o mapa da equipe e me diga', options)).toBeNull();
  });

  it('pauses, resumes and opens views', () => {
    expect(parseBoardCommand('pausar todos', options)).toEqual({ kind: 'pause', paused: true });
    expect(parseBoardCommand('Resume all', options)).toEqual({ kind: 'pause', paused: false });
    expect(parseBoardCommand('abra o mapa da equipe', options)).toEqual({ kind: 'open', target: 'team-map' });
    expect(parseBoardCommand('orquestrador', options)).toEqual({ kind: 'open', target: 'orchestrator' });
    expect(parseBoardCommand('abra o painel do líder', options)).toEqual({ kind: 'open', target: 'orchestrator' });
    expect(parseBoardCommand('open the leader panel', options)).toEqual({ kind: 'open', target: 'orchestrator' });
    expect(parseBoardCommand('monte uma equipe', options)).toEqual({ kind: 'open', target: 'team-composer' });
    expect(parseBoardCommand('nota: revisar o contrato do QR', options)).toEqual({ kind: 'note', text: 'revisar o contrato do QR' });
  });
});
