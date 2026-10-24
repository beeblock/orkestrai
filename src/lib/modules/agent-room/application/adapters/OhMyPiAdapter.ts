import type { AgentModelOption, AgentRoleLaunchContext, AgentRunRequest, ModelEffort } from '../../domain/types.js';
import { probeCliVersion } from '../../infrastructure/agent-path.js';
import type { AgentAdapter, AgentCommandSpec, AgentDetection, ParsedAgentOutput } from './types.js';

export const OMP_EFFORTS: ModelEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export function parseOhMyPiOutput(stdout: string): ParsedAgentOutput {
  const texts: string[] = [];
  const metadata: Record<string, unknown> = {};
  let cliError: string | undefined;
  let parsedAnyJson = false;

  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(trimmed);
      parsedAnyJson = true;
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

    if (event.type === 'message_end') {
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

  if (parsedAnyJson) {
    const content = texts.length > 0 ? texts[texts.length - 1] : '';
    return {
      content,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      cliError,
    };
  }

  // Fallback para saida em texto puro quando nao houver JSON lines
  const cleanLines = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('Working...'));

  const rawText = cleanLines.join('\n');
  return {
    content: rawText,
    cliError,
  };
}

export const ohMyPiAdapter: AgentAdapter = {
  id: 'omp',
  displayName: 'Oh My Pi',
  supportsResume: false,
  efforts: OMP_EFFORTS,
  profileStrategy: { kind: 'unsupported' },
  setup: {
    docsUrl: 'https://github.com/can1357/oh-my-pi',
    installCommands: {
      darwin: 'curl -fsSL https://omp.sh/install | sh',
      linux: 'curl -fsSL https://omp.sh/install | sh',
      windows: 'irm https://omp.sh/install.ps1 | iex',
    },
  },

  async detect(): Promise<AgentDetection> {
    return probeCliVersion('omp');
  },

  buildCommand(request: AgentRunRequest): AgentCommandSpec {
    const modelArgs = request.model ? ['--model', request.model] : [];
    const effortArgs =
      request.effort && (OMP_EFFORTS as string[]).includes(request.effort)
        ? ['--thinking', request.effort]
        : [];
    const policyArgs = request.allowWrites
      ? ['--approval-mode', 'yolo']
      : ['--no-extensions', '--no-lsp', '--tools', 'read,grep,glob'];
    const args = ['-p', '--mode', 'json', '--no-session', ...policyArgs, ...modelArgs, ...effortArgs];

    return {
      command: 'omp',
      args,
      displayArgs: [...args, '<prompt-stdin>'],
      promptDelivery: 'stdin',
    };
  },

  interactiveCommand(options?: { model?: string; effort?: ModelEffort | null }): AgentCommandSpec {
    const args: string[] = ['--approval-mode', 'yolo'];
    if (options?.model) args.push('--model', options.model);
    if (options?.effort && (OMP_EFFORTS as string[]).includes(options.effort)) {
      args.push('--thinking', options.effort);
    }
    return {
      command: 'omp',
      args,
    };
  },

  initialRoleArgs(role: AgentRoleLaunchContext): string[] {
    if (!role.prompt.trim()) return [];
    return ['--append-system-prompt', role.prompt];
  },

  // Do not resume the latest conversation of a different agent in the same cwd.
  resumeArgs(): string[] | null {
    return null;
  },

  parseOutput(stdout: string): ParsedAgentOutput {
    return parseOhMyPiOutput(stdout);
  },

  runMetadata(request: AgentRunRequest): Record<string, unknown> {
    return { permissionMode: request.allowWrites ? 'yolo' : 'read-only-tools' };
  },

  async listModels(): Promise<AgentModelOption[]> {
    return [];
  },
};
