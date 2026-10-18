import type { AgentRunRequest, ModelEffort } from '../../domain/types.js';
import { probeCliVersion } from '../../infrastructure/agent-path.js';
import type { AgentAdapter, AgentCommandSpec, AgentDetection, ParsedAgentOutput } from './types.js';

/**
 * Aider. `--message` runs one instruction and exits; `--yes-always` answers
 * its confirmations. The model flag is `--model` (`-m` is `--message`).
 * Aider keeps chat history per folder, not resumable ids.
 */
export const aiderAdapter: AgentAdapter = {
  id: 'aider',
  displayName: 'Aider',
  supportsResume: false,
  profileStrategy: { kind: 'unsupported' },
  setup: {
    docsUrl: 'https://aider.chat/docs/',
    installCommands: {
      darwin: 'curl -LsSf https://aider.chat/install.sh | sh',
      windows: 'powershell -ExecutionPolicy ByPass -c "irm https://aider.chat/install.ps1 | iex"',
      linux: 'curl -LsSf https://aider.chat/install.sh | sh',
    },
  },

  async detect(): Promise<AgentDetection> {
    return probeCliVersion('aider');
  },

  buildCommand(request: AgentRunRequest): AgentCommandSpec {
    const prompt = request.allowWrites
      ? request.prompt
      : `READ-ONLY TASK. Do not modify files, dependencies, repositories, or system state.\n\n${request.prompt}`;
    const args = [
      '--message', prompt,
      '--yes-always',
      '--no-pretty',
      ...(request.allowWrites ? [] : ['--no-auto-commits', '--dry-run']),
      ...(request.model ? ['--model', request.model] : []),
    ];
    return {
      command: 'aider',
      args,
      displayArgs: args.map((arg) => (arg === prompt ? '<prompt-arg>' : arg)),
      promptDelivery: 'args',
    };
  },

  resumeArgs(): string[] | null {
    return null;
  },

  interactiveCommand(options?: { model?: string; effort?: ModelEffort | null }): AgentCommandSpec {
    return {
      command: 'aider',
      args: ['--yes-always', ...(options?.model ? ['--model', options.model] : [])],
    };
  },

  parseOutput(stdout: string): ParsedAgentOutput {
    return { content: stdout.trim() };
  },

  runMetadata(request: AgentRunRequest): Record<string, unknown> {
    return { permissionMode: request.allowWrites ? 'yes-always' : 'dry-run' };
  },

  async listModels() {
    return [];
  },
};
