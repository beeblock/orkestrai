import { uuidv7 } from '@beeblock/svelar/support';

export type PortalCommand = {
  id: string;
  nodeId: string;
  action: 'navigate' | 'eval' | 'screenshot' | 'dom' | 'tabs' | 'snapshot' | 'click' | 'type' | 'select' | 'upload' | 'download' | 'wait' | 'extract';
  args: Record<string, unknown>;
  createdAt: number;
};

export type PortalCommandResult = {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};

/**
 * Fila de comandos de automacao de portais: a CLI/agendamentos enfileiram
 * comandos; o no portal no renderer drena a fila, executa no <webview> e
 * posta o resultado de volta. O bridge `portal` aguarda o resultado (como o ask).
 */
export class PortalService {
  private queues = new Map<string, PortalCommand[]>();
  private results = new Map<string, PortalCommandResult>();
  private waiters = new Map<string, (result: PortalCommandResult) => void>();

  enqueue(nodeId: string, action: PortalCommand['action'], args: Record<string, unknown>): PortalCommand {
    const command: PortalCommand = {
      id: uuidv7(),
      nodeId,
      action,
      args,
      createdAt: Date.now(),
    };
    const queue = this.queues.get(nodeId) ?? [];
    queue.push(command);
    this.queues.set(nodeId, queue);
    return command;
  }

  drain(nodeId: string): PortalCommand[] {
    const queue = this.queues.get(nodeId) ?? [];
    this.queues.delete(nodeId);
    return queue;
  }

  postResult(commandId: string, result: PortalCommandResult): void {
    const waiter = this.waiters.get(commandId);
    if (waiter) {
      this.waiters.delete(commandId);
      waiter(result);
      return;
    }
    this.results.set(commandId, result);
  }

  /** Aguarda o resultado de um comando (timeout em ms). */
  waitResult(commandId: string, timeoutMs = 30_000): Promise<PortalCommandResult> {
    const existing = this.results.get(commandId);
    if (existing) {
      this.results.delete(commandId);
      return Promise.resolve(existing);
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiters.delete(commandId);
        resolve({ id: commandId, ok: false, error: 'Timeout aguardando o portal.' });
      }, timeoutMs);
      this.waiters.set(commandId, (result) => {
        clearTimeout(timer);
        resolve(result);
      });
    });
  }
}

export const portalService = new PortalService();
