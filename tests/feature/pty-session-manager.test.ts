import { describe, expect, it, vi } from 'vitest';
import { spawn } from 'node-pty';
import { PtySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.js';

/**
 * Integracao real com node-pty usando /bin/cat (echo de terminal).
 * Nao depende de nenhuma CLI de agente.
 */
describe('PtySessionManager', () => {
  it.each(['native', 'wsl'] as const)('does not submit initial tasks to the Claude trust dialog in %s', async (runtime) => {
    vi.useFakeTimers();
    const writes: string[] = [];
    let emitData!: (data: string) => void;
    const fakePty = {
      write: (data: string) => { writes.push(data); }, resize() {}, kill() {}, pid: 1,
      onData: (listener: (data: string) => void) => { emitData = listener; return { dispose() {} }; },
      onExit: () => ({ dispose() {} }),
    };
    const manager = new PtySessionManager((() => fakePty) as unknown as typeof spawn);
    const session = manager.create({
      command: 'claude', cwd: process.cwd(), provider: 'claude',
      ...(runtime === 'wsl' ? { runtime: { kind: 'wsl' as const, distribution: 'Ubuntu', linuxWorkingDir: '/workspace' } } : {}),
    });
    try {
      const pending = manager.queueWithSubmit(session.id, '[initial Kanban] Review the open tasks.');
      await vi.advanceTimersByTimeAsync(5_000);
      expect(writes).toEqual([]);
      emitData('Quick safety check: Is this a project you trust?\r\n\u276f No, exit\r\nYes, I trust this folder');
      const ready = manager.waitUntilIdle(session.id, 20_000);
      await vi.advanceTimersByTimeAsync(21_000);
      expect(await ready).toBe(false);
      expect(manager.hasReachedInitialIdle(session.id)).toBe(false);
      expect(manager.submitIfComposerFree(session.id)).toBe(false);
      expect(writes).toEqual([]);
      manager.writeHumanInput(session.id, '\x1b[B');
      manager.writeHumanInput(session.id, '\r');
      await vi.advanceTimersByTimeAsync(5_000);
      expect(writes).toEqual(['\x1b[B', '\r']);
      emitData('\x1b[2J\u276f \r\n? for shortcuts');
      await vi.advanceTimersByTimeAsync(4_000);
      await pending.submitted;
      expect(manager.hasReachedInitialIdle(session.id)).toBe(true);
      expect(writes).toEqual(['\x1b[B', '\r', '[initial Kanban] Review the open tasks.', '\r']);
    } finally { manager.kill(session.id); vi.useRealTimers(); }
  });

  it('rejects queued tasks if the user declines Claude workspace trust', async () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    let emitData!: (data: string) => void;
    let emitExit!: (event: { exitCode: number }) => void;
    const fakePty = {
      write: (data: string) => { writes.push(data); }, resize() {}, kill() {}, pid: 1,
      onData: (listener: (data: string) => void) => { emitData = listener; return { dispose() {} }; },
      onExit: (listener: typeof emitExit) => { emitExit = listener; return { dispose() {} }; },
    };
    const manager = new PtySessionManager((() => fakePty) as unknown as typeof spawn);
    const session = manager.create({ command: 'claude', cwd: process.cwd(), provider: 'claude' });
    try {
      emitData('Quick safety check:\r\nNo, exit\r\nYes, I trust this folder');
      const pending = manager.queueWithSubmit(session.id, 'must never be entered');
      const rejected = expect(pending.submitted).rejects.toThrow('código 1');
      manager.writeHumanInput(session.id, '\r');
      emitExit({ exitCode: 1 });
      await vi.advanceTimersByTimeAsync(25_000);
      await rejected;
      expect(writes).toEqual(['\r']);
    } finally { manager.kill(session.id); vi.useRealTimers(); }
  });

  it.each(['native', 'wsl'] as const)('releases an accepted %s prompt during continuous provider output', async (runtime) => {
    vi.useFakeTimers();
    const writes: string[] = [];
    let emitData!: (data: string) => void;
    const fakePty = {
      write: (data: string) => { writes.push(data); }, resize() {}, kill() {}, pid: 1,
      onData: (listener: (data: string) => void) => { emitData = listener; return { dispose() {} }; },
      onExit: () => ({ dispose() {} }),
    };
    const manager = new PtySessionManager((() => fakePty) as unknown as typeof spawn);
    const session = manager.create({
      command: 'codex', cwd: process.cwd(), provider: 'codex',
      ...(runtime === 'wsl' ? { runtime: { kind: 'wsl' as const, distribution: 'Ubuntu', linuxWorkingDir: '/workspace' } } : {}),
    });
    try {
      const first = manager.writeWithConfirmedSubmit(session.id, 'first prompt', { isAccepted: async () => true });
      await vi.advanceTimersByTimeAsync(600);
      await first;
      const second = manager.writeWithSubmit(session.id, 'second prompt');
      const spinner = setInterval(() => emitData('working...'), 100);
      await vi.advanceTimersByTimeAsync(7_000);
      expect(writes).toEqual(['first prompt', '\r']);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(writes).toContain('second prompt');
      clearInterval(spinner);
      await vi.advanceTimersByTimeAsync(1_000);
      await second;
      expect(writes).toEqual(['first prompt', '\r', 'second prompt', '\r']);
    } finally { manager.kill(session.id); vi.useRealTimers(); }
  });

  it('keeps an unconfirmed prompt behind the output barrier', async () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    let emitData!: (data: string) => void;
    const fakePty = {
      write: (data: string) => { writes.push(data); }, resize() {}, kill() {}, pid: 1,
      onData: (listener: (data: string) => void) => { emitData = listener; return { dispose() {} }; },
      onExit: () => ({ dispose() {} }),
    };
    const manager = new PtySessionManager((() => fakePty) as unknown as typeof spawn);
    const session = manager.create({ command: 'codex', cwd: process.cwd(), provider: 'codex' });
    try {
      const first = manager.writeWithConfirmedSubmit(session.id, 'first', { isAccepted: async () => false });
      await vi.advanceTimersByTimeAsync(600);
      await first;
      const second = manager.queueWithSubmit(session.id, 'second');
      const rejected = second.submitted.catch(() => undefined);
      const spinner = setInterval(() => emitData('working...'), 100);
      await vi.advanceTimersByTimeAsync(16_000);
      expect(writes).toEqual(['first', '\r']);
      clearInterval(spinner);
      second.cancel();
      await rejected;
    } finally { manager.kill(session.id); vi.useRealTimers(); }
  });

  it.each(['draft', 'submitted', 'next-delivery'] as const)('does not let an old acknowledgement bypass a %s', async (state) => {
    vi.useFakeTimers();
    const writes: string[] = [];
    let emitData!: (data: string) => void;
    const fakePty = {
      write: (data: string) => { writes.push(data); }, resize() {}, kill() {}, pid: 1,
      onData: (listener: (data: string) => void) => { emitData = listener; return { dispose() {} }; },
      onExit: () => ({ dispose() {} }),
    };
    const manager = new PtySessionManager((() => fakePty) as unknown as typeof spawn);
    const session = manager.create({ command: 'codex', cwd: process.cwd(), provider: 'codex' });
    try {
      const first = manager.queueWithSubmit(session.id, 'first');
      await vi.advanceTimersByTimeAsync(600);
      await first.submitted;
      if (state === 'next-delivery') {
        first.acknowledge();
        await vi.advanceTimersByTimeAsync(9_000);
        const next = manager.queueWithSubmit(session.id, 'next');
        await vi.advanceTimersByTimeAsync(600);
        await next.submitted;
      } else manager.writeHumanInput(session.id, state === 'draft' ? 'human draft' : 'human prompt\r');
      const pending = manager.queueWithSubmit(session.id, 'must stay queued');
      const rejected = pending.submitted.catch(() => undefined);
      const spinner = setInterval(() => emitData('working...'), 100);
      first.acknowledge();
      await vi.advanceTimersByTimeAsync(12_000);
      expect(writes).not.toContain('must stay queued');
      clearInterval(spinner);
      pending.cancel();
      await rejected;
    } finally { manager.kill(session.id); vi.useRealTimers(); }
  });

  it('retains initial provider readiness when new input makes it busy again', async () => {
    vi.useFakeTimers();
    let onData!: (data: string) => void;
    const fakePty = {
      write() {}, resize() {}, kill() {}, pid: 1,
      onData: (listener: (data: string) => void) => { onData = listener; return { dispose() {} }; },
      onExit: () => ({ dispose() {} }),
    };
    const manager = new PtySessionManager((() => fakePty) as unknown as typeof spawn);
    const session = manager.create({ command: 'codex', cwd: process.cwd(), provider: 'codex' });
    try {
      expect(manager.hasReachedInitialIdle(session.id)).toBe(false);
      onData('ready');
      await vi.advanceTimersByTimeAsync(4_000);
      expect(manager.hasReachedInitialIdle(session.id)).toBe(true);
      manager.write(session.id, 'next question\r');
      onData('working again');
      expect(manager.get(session.id)?.waiting).toBe(false);
      expect(manager.hasReachedInitialIdle(session.id)).toBe(true);
      manager.kill(session.id);
      expect(manager.hasReachedInitialIdle(session.id)).toBe(false);
    } finally { manager.kill(session.id); vi.useRealTimers(); }
  });

  it('exposes xterm capabilities to native and WSL terminal children', () => {
    let spawnedOptions: { env?: Record<string, string> } | undefined;
    const fakePty = {
      write: () => {},
      resize: () => {},
      kill: () => {},
      onData: () => ({ dispose: () => {} }),
      onExit: () => ({ dispose: () => {} }),
      pid: 1,
    };
    const manager = new PtySessionManager(((_command, _args, options) => {
      spawnedOptions = options as { env?: Record<string, string> };
      return fakePty;
    }) as unknown as typeof spawn);

    const session = manager.create({ command: 'codex', cwd: process.cwd() });

    expect(spawnedOptions?.env?.TERM).toBe('xterm-256color');
    expect(spawnedOptions?.env?.COLORTERM).toBe('truecolor');
    manager.kill(session.id);
  });

  it('preserves explicit terminal capability overrides', () => {
    let spawnedOptions: { env?: Record<string, string> } | undefined;
    const fakePty = {
      write: () => {},
      resize: () => {},
      kill: () => {},
      onData: () => ({ dispose: () => {} }),
      onExit: () => ({ dispose: () => {} }),
      pid: 1,
    };
    const manager = new PtySessionManager(((_command, _args, options) => {
      spawnedOptions = options as { env?: Record<string, string> };
      return fakePty;
    }) as unknown as typeof spawn);

    const session = manager.create({
      command: 'codex',
      cwd: process.cwd(),
      env: { TERM: 'xterm-direct', COLORTERM: '24bit' },
    });

    expect(spawnedOptions?.env?.TERM).toBe('xterm-direct');
    expect(spawnedOptions?.env?.COLORTERM).toBe('24bit');
    manager.kill(session.id);
  });

  it('authenticates a bridge caller only against its private live PTY credential', () => {
    const manager = new PtySessionManager(spawn);
    const session = manager.create({
      command: '/bin/cat',
      cwd: process.cwd(),
      workspaceId: 'workspace-1',
      nodeId: 'node-1',
      provider: 'codex',
      bridgeAgentToken: 'private-terminal-token',
      env: { ORKESTRAI_AGENT_TOKEN: 'private-terminal-token' },
    });

    expect(manager.resolveBridgeAgent('workspace-1', 'private-terminal-token')).toBe('node-1');
    expect(manager.resolveBridgeAgent('workspace-2', 'private-terminal-token')).toBeNull();
    expect(manager.resolveBridgeAgent('workspace-1', 'wrong-terminal-token')).toBeNull();
    expect(JSON.stringify(manager.get(session.id))).not.toContain('private-terminal-token');

    manager.kill(session.id);
    expect(manager.resolveBridgeAgent('workspace-1', 'private-terminal-token')).toBeNull();
  });

  it('encerra a arvore do processo gerenciado e localiza uma conversa mesmo sem vinculo do no', () => {
    const treeKill = vi.fn();
    const directKill = vi.fn();
    const fakePty = {
      write: () => {},
      resize: () => {},
      kill: directKill,
      onData: () => ({ dispose: () => {} }),
      onExit: () => ({ dispose: () => {} }),
      pid: 42,
    };
    const manager = new PtySessionManager((() => fakePty) as unknown as typeof spawn, treeKill);
    const conversationId = '01a04ef1-a6ca-72b1-bc4d-a80a00f5f897';
    const session = manager.create({
      command: 'codex',
      args: ['resume', conversationId],
      cwd: process.cwd(),
      workspaceId: 'workspace-1',
      nodeId: 'node-1',
      provider: 'codex',
    });

    expect(manager.claimNode(session.id, 'workspace-2', 'node-2')).toBe(false);
    expect(manager.claimNode(session.id, 'workspace-1', 'node-2')).toBe(false);
    expect(manager.claimNode(session.id, 'workspace-1', 'node-1')).toBe(true);
    expect(manager.get(session.id)).toMatchObject({ workspaceId: 'workspace-1', nodeId: 'node-1' });
    expect(manager.listLiveForAgentSession('codex', conversationId)).toHaveLength(1);
    expect(manager.killAgentSession('codex', conversationId, { workspaceId: 'workspace-1', nodeId: 'node-2' })).toBe(0);
    expect(manager.killAgentSession('codex', conversationId, { workspaceId: 'workspace-2', nodeId: 'node-1' })).toBe(0);
    expect(manager.get(session.id)?.exited).toBe(false);
    expect(manager.killAgentSession('codex', conversationId, { workspaceId: 'workspace-1', nodeId: 'node-1' })).toBe(1);
    expect(treeKill).toHaveBeenCalledWith(fakePty, true);
    expect(directKill).not.toHaveBeenCalled();
  });

  it('localiza o PTY original de um no e encerra somente as duplicatas', () => {
    const manager = new PtySessionManager(spawn);
    const first = manager.create({
      command: '/bin/cat',
      cwd: process.cwd(),
      workspaceId: 'workspace-1',
      nodeId: 'node-1',
      provider: 'codex',
    });
    const duplicate = manager.create({
      command: '/bin/cat',
      cwd: process.cwd(),
      workspaceId: 'workspace-1',
      nodeId: 'node-1',
      provider: 'codex',
    });

    expect(manager.listLiveForNode('workspace-1', 'node-1').map((session) => session.id))
      .toEqual([first.id, duplicate.id]);
    expect(manager.killNode('workspace-1', 'node-1', first.id)).toBe(1);
    expect(manager.get(first.id)?.exited).toBe(false);
    expect(manager.get(duplicate.id)).toBeNull();

    manager.kill(first.id);
  });

  it('cria sessao, faz roundtrip de escrita/leitura e replay de scrollback', async () => {
    const manager = new PtySessionManager(spawn);
    const session = manager.create({ command: '/bin/cat', cwd: process.cwd(), cols: 80, rows: 24 });

    expect(session.id).toHaveLength(36);
    expect(manager.get(session.id)?.exited).toBe(false);

    let received = '';
    const { detach } = manager.attach(session.id, (data) => {
      received += data;
    });

    manager.write(session.id, 'ola pty\n');
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(received).toContain('ola pty');

    // Segundo attach recebe o scrollback acumulado (reattach apos reload).
    const replay = manager.attach(session.id, () => {});
    expect(replay.scrollback).toContain('ola pty');
    replay.detach();
    detach();

    manager.kill(session.id);
    expect(manager.get(session.id)).toBeNull();
  });

  it('reporta exit code e notifica listeners de saida', async () => {
    const manager = new PtySessionManager(spawn);
    const session = manager.create({ command: '/bin/sh', args: ['-c', 'exit 3'], cwd: process.cwd() });

    const exitCode = await new Promise<number>((resolve) => {
      manager.attach(session.id, () => {}, resolve);
    });

    expect(exitCode).toBe(3);
    expect(manager.get(session.id)?.exited).toBe(true);
    expect(manager.get(session.id)?.exitCode).toBe(3);
    manager.kill(session.id);
  });

  it('resize nao falha em sessao finalizada e write em sessao morta erro claro', async () => {
    const manager = new PtySessionManager(spawn);
    const session = manager.create({ command: '/bin/sh', args: ['-c', 'exit 0'], cwd: process.cwd() });
    await new Promise<number>((resolve) => manager.attach(session.id, () => {}, resolve));

    expect(() => manager.resize(session.id, 100, 40)).not.toThrow();
    expect(() => manager.write(session.id, 'x')).toThrowError(/já finalizada/);
    manager.kill(session.id);
  });

  it('marca sessao como ociosa apos silencio e limpa ao escrever', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const manager = new PtySessionManager(spawn);
    const session = manager.create({ command: '/bin/cat', cwd: process.cwd() });

    const attentionStates: boolean[] = [];
    const { detach } = manager.attach(session.id, () => {}, undefined, (waiting) => attentionStates.push(waiting));

    manager.write(session.id, 'oi\n');
    await new Promise((resolve) => setTimeout(resolve, 3_200));
    expect(manager.get(session.id)?.waiting).toBe(true);

    manager.write(session.id, 'acordou\n');
    expect(manager.get(session.id)?.waiting).toBe(false);

    detach();
    manager.kill(session.id);
    expect(attentionStates).toContain(true);
    expect(attentionStates.at(-1)).toBe(false);
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('[orkestrai:attention]'));
    logSpy.mockRestore();
  });

  it('writeWithSubmit envia texto e Enter em writes separados (~200ms)', async () => {
    const writes: string[] = [];
    const fakePty = {
      write: (data: string) => {
        writes.push(data);
      },
      resize: () => {},
      kill: () => {},
      onData: () => ({ dispose: () => {} }),
      onExit: () => ({ dispose: () => {} }),
      pid: 1,
    };
    const manager = new PtySessionManager((() => fakePty) as unknown as typeof spawn);

    const session = manager.create({ command: 'codex', cwd: process.cwd() });
    await manager.writeWithSubmit(session.id, 'faz a tarefa X');

    expect(writes).toEqual(['faz a tarefa X', '\r']);
  });

  it('aguarda o rascunho humano antes de entregar uma mensagem automatica', async () => {
    const writes: string[] = [];
    const fakePty = {
      write: (data: string) => writes.push(data),
      resize: () => {},
      kill: () => {},
      onData: () => ({ dispose: () => {} }),
      onExit: () => ({ dispose: () => {} }),
      pid: 1,
    };
    const manager = new PtySessionManager((() => fakePty) as unknown as typeof spawn);
    const session = manager.create({ command: 'claude', cwd: process.cwd() });

    manager.writeHumanInput(session.id, 'minha mensagem');
    const delivery = manager.writeWithSubmit(session.id, 'mensagem do agente', 20);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(writes).toEqual(['minha mensagem']);

    manager.writeHumanInput(session.id, '\r');
    await delivery;
    expect(writes).toEqual(['minha mensagem', '\r', 'mensagem do agente', '\r']);
  });

  it('nao concatena uma entrega automatica logo apos o submit humano de um agente', async () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    const fakePty = {
      write: (data: string) => writes.push(data),
      resize: () => {},
      kill: () => {},
      onData: () => ({ dispose: () => {} }),
      onExit: () => ({ dispose: () => {} }),
      pid: 1,
    };
    const manager = new PtySessionManager((() => fakePty) as unknown as typeof spawn);
    const session = manager.create({ command: 'codex', provider: 'codex', cwd: process.cwd() });

    manager.writeHumanInput(session.id, 'prompt humano\r');
    const delivery = manager.writeWithSubmit(session.id, 'handoff automatico', 20);
    await vi.advanceTimersByTimeAsync(2_499);
    expect(writes).toEqual(['prompt humano\r']);

    await vi.advanceTimersByTimeAsync(50);
    await delivery;
    expect(writes).toEqual(['prompt humano\r', 'handoff automatico', '\r']);

    manager.kill(session.id);
    vi.useRealTimers();
  });

  it('preserva teclas humanas recebidas durante o intervalo do submit automatico', async () => {
    const writes: string[] = [];
    const fakePty = {
      write: (data: string) => writes.push(data),
      resize: () => {},
      kill: () => {},
      onData: () => ({ dispose: () => {} }),
      onExit: () => ({ dispose: () => {} }),
      pid: 1,
    };
    const manager = new PtySessionManager((() => fakePty) as unknown as typeof spawn);
    const session = manager.create({ command: 'codex', cwd: process.cwd() });

    const delivery = manager.writeWithSubmit(session.id, 'mensagem automatica', 40);
    manager.writeHumanInput(session.id, 'rascunho humano');
    expect(writes).toEqual(['mensagem automatica']);
    await delivery;
    expect(writes).toEqual(['mensagem automatica', '\r', 'rascunho humano']);
  });

  it('cancela uma entrega confirmada que ainda aguarda o rascunho humano', async () => {
    const writes: string[] = [];
    const fakePty = {
      write: (data: string) => writes.push(data),
      resize: () => {},
      kill: () => {},
      onData: () => ({ dispose: () => {} }),
      onExit: () => ({ dispose: () => {} }),
      pid: 1,
    };
    const manager = new PtySessionManager((() => fakePty) as unknown as typeof spawn);
    const session = manager.create({ command: 'claude', provider: 'claude', cwd: process.cwd() });
    const abortController = new AbortController();

    manager.writeHumanInput(session.id, 'rascunho humano');
    const delivery = manager.writeWithConfirmedSubmit(session.id, 'mensagem cancelada', {
      signal: abortController.signal,
    });
    abortController.abort();

    await expect(delivery).rejects.toThrow('cancelada');
    manager.writeHumanInput(session.id, '\r');
    expect(writes).toEqual(['rascunho humano', '\r']);
  });

  it('cancels a queued delivery when its task becomes obsolete', async () => {
    const writes: string[] = [];
    const fakePty = {
      write: (data: string) => writes.push(data),
      resize: () => {},
      kill: () => {},
      onData: () => ({ dispose: () => {} }),
      onExit: () => ({ dispose: () => {} }),
      pid: 1,
    };
    const manager = new PtySessionManager((() => fakePty) as unknown as typeof spawn);
    const session = manager.create({ command: 'claude', provider: 'claude', cwd: process.cwd() });
    let relevant = true;

    manager.writeHumanInput(session.id, 'human draft');
    const delivery = manager.writeWithConfirmedSubmit(session.id, 'obsolete handoff', {
      isStillRelevant: async () => relevant,
    });
    relevant = false;

    await expect(delivery).rejects.toMatchObject({ code: 'PTY_DELIVERY_OBSOLETE' });
    manager.writeHumanInput(session.id, '\r');
    expect(writes).toEqual(['human draft', '\r']);
    manager.kill(session.id);
  });

  it('repete Enter quando um TUI WSL não confirma o primeiro submit', async () => {
    const writes: string[] = [];
    let emitData: ((data: string) => void) | null = null;
    let enterCount = 0;
    let accepted = false;
    const fakePty = {
      write: (data: string) => {
        writes.push(data);
        if (data === '\r') {
          enterCount += 1;
          if (enterCount === 1) emitData?.('redraw do composer');
          if (enterCount === 2) accepted = true;
        }
      },
      resize: () => {},
      kill: () => {},
      onData: (callback: (data: string) => void) => {
        emitData = callback;
        return { dispose: () => {} };
      },
      onExit: () => ({ dispose: () => {} }),
      pid: 1,
    };
    const manager = new PtySessionManager((() => fakePty) as unknown as typeof spawn);
    const session = manager.create({
      command: 'codex',
      provider: 'codex',
      cwd: process.cwd(),
      runtime: { kind: 'wsl', distribution: 'Ubuntu-24.04', linuxWorkingDir: '/workspace' },
    });

    await manager.writeWithConfirmedSubmit(session.id, 'execute a tarefa', {
      submitDelayMs: 5,
      confirmationWindowMs: 20,
      maxAttempts: 3,
      isAccepted: async () => accepted,
    });

    expect(writes).toEqual(['execute a tarefa', '\r', '\r']);
    manager.kill(session.id);
  });

  it('espera o redraw do composer estabilizar antes de enviar Enter no ConPTY', async () => {
    const writes: Array<{ data: string; at: number }> = [];
    let emitData: ((data: string) => void) | null = null;
    const startedAt = Date.now();
    const fakePty = {
      write: (data: string) => {
        writes.push({ data, at: Date.now() - startedAt });
        if (data !== '\r') emitData?.('composer redraw');
      },
      resize: () => {},
      kill: () => {},
      onData: (callback: (data: string) => void) => {
        emitData = callback;
        return { dispose: () => {} };
      },
      onExit: () => ({ dispose: () => {} }),
      pid: 1,
    };
    const manager = new PtySessionManager((() => fakePty) as unknown as typeof spawn);
    const session = manager.create({
      command: 'claude',
      provider: 'claude',
      cwd: process.cwd(),
      runtime: { kind: 'wsl', distribution: 'Ubuntu-24.04', linuxWorkingDir: '/workspace' },
    });

    emitData?.('? for shortcuts');

    await manager.writeWithSubmit(session.id, 'mensagem entre agentes', 5);

    expect(writes.map((entry) => entry.data)).toEqual(['mensagem entre agentes', '\r']);
    expect(writes[1].at).toBeGreaterThanOrEqual(350);
    manager.kill(session.id);
  });
});
