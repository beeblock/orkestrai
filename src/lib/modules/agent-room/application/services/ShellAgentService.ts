import { ptySessionManager } from '../../infrastructure/pty/PtySessionManager.js';
import type { ShellForegroundProcess } from '../../infrastructure/pty/ShellAgentProcess.js';
import type { TranscriptLookupOptions } from '../../infrastructure/transcript/AgentTranscript.js';
import { listAgentAdapters } from '../adapters/registry.js';
import type { AgentAdapter } from '../adapters/types.js';

export type ShellAgentContext = {
  provider: string;
  processKey: string;
  cwd: string;
  sessionId: string | null;
  options: TranscriptLookupOptions;
};
const name = (path: string) => path.replaceAll('\\', '/').split('/').at(-1)?.replace(/\.exe$/i, '').toLowerCase();

export function shellProcessProvider(process: ShellForegroundProcess, adapters: AgentAdapter[]): string | null {
  const launchName = name(process.executable);
  const providers = adapters.filter(adapter => {
    const command = name(adapter.interactiveCommand().command);
    if (launchName === command || name(process.argv[0] ?? '') === command) return true;
    if (!['node', 'nodejs', 'bun'].includes(launchName ?? '')) return false;
    const entry = (process.argv[1] ?? '').replaceAll('\\', '/');
    return name(entry) === command || adapter.shellEntrypoints?.some(suffix => entry.endsWith('/' + suffix));
  });
  return providers.length === 1 ? providers[0].id : null;
}

export class ShellAgentService {
  private checks = new WeakMap<ShellAgentContext, { at: number; result: Promise<boolean> }>();
  async detect(workspaceId: string, nodeId: string, sessionId: string): Promise<ShellAgentContext | null> {
    const session = ptySessionManager.get(sessionId);
    if (!session || session.exited || session.provider) return null;
    if (session.workspaceId !== workspaceId || session.nodeId !== nodeId) {
      // Older unowned shells still support ordinary command/output exchange,
      // but cannot claim another node's agent conversation.
      return null;
    }
    const adapters = listAgentAdapters();
    const processes = await ptySessionManager.shellForeground(sessionId, process => shellProcessProvider(process, adapters) !== null);
    const agents = processes.flatMap(process => {
      const provider = shellProcessProvider(process, adapters);
      return provider ? [{ process, provider }] : [];
    });
    if (!agents.length) {
      if (processes.some(process => name(process.executable) === 'wsl' || name(process.argv[0] ?? '') === 'wsl')) {
        throw new Error('This Shell has an unlinked WSL guest. Configure its WSL runtime before requesting an agent reply; host screen output cannot confirm a Linux conversation.');
      }
      return null;
    }
    const byPid = new Map(processes.map(process => [process.pid, process]));
    const nestedIn = (process: ShellForegroundProcess, ancestor: number) => {
      const seen = new Set<number>();
      let parent = process.parent;
      while (parent && !seen.has(parent)) {
        if (parent === ancestor) return true;
        seen.add(parent);
        parent = byPid.get(parent)?.parent ?? 0;
      }
      return false;
    };
    const roots = agents.filter(agent => !agents.some(other => other !== agent && nestedIn(agent.process, other.process.pid)));
    if (roots.length !== 1) throw new Error('Multiple agents own this Shell foreground; a reply cannot be attributed safely.');
    const { provider, process } = roots[0];
    if (!process.cwd) throw new Error('The agent working directory could not be confirmed.');
    return { provider, processKey: process.key, cwd: process.cwd, sessionId: null,
      options: { ...ptySessionManager.transcriptStorageRoots(sessionId), homeDir: session.transcriptHome ?? undefined,
        posixCwd: session.runtimeKey.startsWith('wsl:') } };
  }

  async stillRunning(workspaceId: string, nodeId: string, sessionId: string, context: ShellAgentContext, beforeWrite = false): Promise<boolean> {
    const previous = this.checks.get(context);
    if (!beforeWrite && previous && Date.now() - previous.at < 1000) return previous.result;
    const result = this.detect(workspaceId, nodeId, sessionId).then(current =>
      Boolean(current && current.processKey === context.processKey && current.provider === context.provider && current.cwd === context.cwd));
    this.checks.set(context, { at: Date.now(), result });
    return result;
  }
}
export const shellAgentService = new ShellAgentService();
