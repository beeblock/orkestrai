import type { AgentModelOption, AgentRoleLaunchContext, AgentRunRequest, ModelEffort } from '../../domain/types.js';
import { probeCliVersion } from '../../infrastructure/agent-path.js';
import type { AgentAdapter, AgentCommandSpec, AgentDetection, ParsedAgentOutput } from './types.js';

export const PI_EFFORTS: ModelEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export function parsePiOutput(stdout: string): ParsedAgentOutput {
  const texts: string[] = [];
  const metadata: Record<string, unknown> = {};
  let cliError: string | undefined;

  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(trimmed);
    } catch {
      if (/^(error|fatal|unauthorized):/i.test(trimmed) || trimmed.includes('Error:')) {
        cliError = cliError ?? trimmed;
      }
      continue;
    }
    if (!event || typeof event !== 'object') continue;

    if (event.type === 'session' && typeof event.id === 'string') {
      metadata.sessionId = event.id;
    }

    if (event.type === 'message_end' || event.type === 'message_start') {
      const msg = event.message as Record<string, unknown> | undefined;
      if (msg && typeof msg === 'object') {
        if (msg.role === 'assistant') {
          if (Array.isArray(msg.content)) {
            const assistantParts = msg.content
              .filter((part): part is { type: string; text: string } =>
                Boolean(part && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string')
              )
              .map((part) => part.text);
            if (assistantParts.length > 0) {
              texts.push(assistantParts.join('\n'));
            }
          } else if (typeof msg.content === 'string' && msg.content.trim()) {
            texts.push(msg.content.trim());
          }

          if (msg.stopReason === 'error' || msg.stopReason === 'aborted') {
            const err = typeof msg.errorMessage === 'string' ? msg.errorMessage : `Stop reason: ${msg.stopReason}`;
            cliError = cliError ?? err;
          }
        }
      }
    }

    if (event.type === 'error' || event.is_error === true) {
      const err =
        typeof event.message === 'string'
          ? event.message
          : typeof event.error === 'string'
            ? event.error
            : JSON.stringify(event.error ?? event);
      cliError = cliError ?? err;
    }
  }

  const content = texts.length > 0 ? texts[texts.length - 1] : '';

  return {
    content,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    cliError,
  };
}

export const piAdapter: AgentAdapter = {
  id: 'pi',
  displayName: 'Pi',
  supportsResume: true,
  efforts: PI_EFFORTS,
  profileStrategy: { kind: 'configDir', envVar: 'PI_CODING_AGENT_DIR', defaultDir: '~/.pi/agent' },
  setup: {
    docsUrl: 'https://pi.dev/docs/latest/',
    installCommands: {
      darwin: 'npm install -g @earendil-works/pi-coding-agent',
      linux: 'npm install -g @earendil-works/pi-coding-agent',
    },
  },

  async detect(): Promise<AgentDetection> {
    return probeCliVersion('pi');
  },

  buildCommand(request: AgentRunRequest): AgentCommandSpec {
    const modelArgs = request.model ? ['--model', request.model] : [];
    const effortArgs =
      request.effort && (PI_EFFORTS as string[]).includes(request.effort)
        ? ['--thinking', request.effort]
        : [];
    const args = ['-p', '--mode', 'json', ...modelArgs, ...effortArgs];

    return {
      command: 'pi',
      args,
      displayArgs: ['-p', '--mode', 'json', ...modelArgs, ...effortArgs, '<prompt-stdin>'],
      promptDelivery: 'stdin',
    };
  },

  interactiveCommand(options?: { model?: string; effort?: ModelEffort | null }): AgentCommandSpec {
    const args: string[] = [];
    if (options?.model) args.push('--model', options.model);
    if (options?.effort && (PI_EFFORTS as string[]).includes(options.effort)) {
      args.push('--thinking', options.effort);
    }
    return {
      command: 'pi',
      args,
    };
  },

  initialRoleArgs(role: AgentRoleLaunchContext): string[] {
    if (!role.prompt.trim()) return [];
    return ['--append-system-prompt', role.prompt];
  },

  resumeArgs(agentSessionId?: string): string[] | null {
    if (agentSessionId) return null;
    return ['--continue'];
  },

  parseOutput(stdout: string): ParsedAgentOutput {
    return parsePiOutput(stdout);
  },

  async listModels(): Promise<AgentModelOption[]> {
    return [];
  },
};
