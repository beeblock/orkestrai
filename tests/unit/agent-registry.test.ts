import { describe, expect, it } from 'vitest';
import {
  agentAdapters,
  getAgentAdapter,
  hasAgentAdapter,
  listAgentAdapters,
  materializeInteractiveAgentCommand,
  registerAgentAdapter,
} from '$lib/modules/agent-room/application/adapters/registry.js';
import type { AgentAdapter } from '$lib/modules/agent-room/application/adapters/types.js';

function stubAdapter(id: string): AgentAdapter {
  return {
    id,
    displayName: `Stub ${id}`,
    supportsResume: false,
    setup: { docsUrl: 'https://example.com/setup' },
    async detect() {
      return { installed: true };
    },
    buildCommand() {
      return { command: id, args: [] };
    },
    interactiveCommand() {
      return { command: id, args: [] };
    },
    resumeArgs(agentSessionId?: string) {
      return agentSessionId ? ['resume', agentSessionId] : null;
    },
    parseOutput(stdout: string) {
      return { content: stdout };
    },
    runMetadata() {
      return {};
    },
    async listModels() {
      return [];
    },
  };
}

describe('agent adapter registry', () => {
  it('registra todos os providers embutidos por padrao', () => {
    const expected = ['claude', 'codex', 'kimi', 'opencode', 'cursor', 'antigravity', 'cline', 'devin'];
    for (const id of expected) expect(hasAgentAdapter(id)).toBe(true);
    expect(getAgentAdapter('cursor').displayName).toBe('Cursor');
    expect(getAgentAdapter('antigravity').displayName).toBe('Antigravity');
    expect(getAgentAdapter('cline').displayName).toBe('Cline');
    expect(getAgentAdapter('devin').displayName).toBe('Devin');
    expect(hasAgentAdapter('pi')).toBe(true);
    expect(hasAgentAdapter('omp')).toBe(true);
    expect(getAgentAdapter('pi').displayName).toBe('Pi');
    expect(getAgentAdapter('omp').displayName).toBe('Oh My Pi');
    for (const id of expected) {
      const setup = getAgentAdapter(id).setup;
      expect(setup.docsUrl).toMatch(/^https:\/\//);
      expect(setup.installCommands?.darwin).toBeTruthy();
      expect(setup.installCommands?.windows).toBeTruthy();
      expect(setup.installCommands?.linux).toBeTruthy();
    }
  });

  it('registra e recupera um novo adapter', () => {
    const adapter = stubAdapter('stub-test');
    registerAgentAdapter(adapter);

    expect(agentAdapters.get('stub-test')).toBe(adapter);
    expect(getAgentAdapter('stub-test')).toBe(adapter);
    expect(hasAgentAdapter('stub-test')).toBe(true);
  });

  it('lista todos os adapters registrados', () => {
    const ids = listAgentAdapters().map((adapter) => adapter.id);
    expect(ids).toContain('claude');
    expect(ids).toContain('codex');
    expect(ids).toContain('stub-test');
  });

  it('materializa comandos interativos ausentes sem sobrescrever args personalizados', () => {
    const claude = materializeInteractiveAgentCommand({ provider: 'claude', command: 'claude', args: [] });
    expect(claude.changed).toBe(true);
    expect(claude.payload.args).toContain('--dangerously-skip-permissions');

    const custom = { provider: 'codex', command: 'codex', args: ['--model', 'gpt-custom'] };
    const preserved = materializeInteractiveAgentCommand(custom);
    expect(preserved.changed).toBe(false);
    expect(preserved.payload).toBe(custom);
  });

  it('materializa roles no mecanismo nativo do provider sem coloca-las no composer', () => {
    const role = {
      name: 'Revisor',
      prompt: 'Revise riscos e testes antes de aprovar.',
      instructionFile: '/tmp/.orkestrai/roles/revisor/AGENTS.md',
    };

    const claude = materializeInteractiveAgentCommand({ provider: 'claude', args: [] }, role).payload;
    expect(claude.initialRoleArgs).toEqual(['--append-system-prompt', role.prompt]);
    expect(claude.roleConfiguredAtLaunch).toBe('Revisor');

    const codex = materializeInteractiveAgentCommand({ provider: 'codex', args: [] }, role).payload;
    expect(codex.initialRoleArgs).toEqual([
      '-c',
      `developer_instructions=${JSON.stringify(role.prompt)}`,
    ]);

    const kimi = materializeInteractiveAgentCommand({ provider: 'kimi', args: [] }, role).payload;
    expect(kimi.initialRoleArgs).toEqual(['--agent-file', role.instructionFile]);


    const pi = materializeInteractiveAgentCommand({ provider: 'pi', args: [] }, role).payload;
    expect(pi.initialRoleArgs).toEqual(['--append-system-prompt', role.prompt]);
    expect(pi.roleConfiguredAtLaunch).toBe('Revisor');

    const omp = materializeInteractiveAgentCommand({ provider: 'omp', args: [] }, role).payload;
    expect(omp.initialRoleArgs).toEqual(['--append-system-prompt', role.prompt]);
    expect(omp.roleConfiguredAtLaunch).toBe('Revisor');
    const fallback = materializeInteractiveAgentCommand({ provider: 'opencode', args: [] }, role).payload;
    expect(fallback.initialRoleArgs).toBeUndefined();
    expect(fallback.roleConfiguredAtLaunch).toBeUndefined();
  });

  it('lanca erro claro para adapter desconhecido', () => {
    expect(hasAgentAdapter('nao-existe')).toBe(false);
    expect(() => getAgentAdapter('nao-existe')).toThrowError(/Adaptador de agente desconhecido: "nao-existe"/);
  });
});
