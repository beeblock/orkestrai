import type { AgentRunRequest } from '../../domain/types.js';
import { probeCliVersion } from '../../infrastructure/agent-path.js';
import type { AgentAdapter, AgentCommandSpec, AgentDetection, ParsedAgentOutput } from './types.js';

/**
 * Amp CLI. `-x` runs one instruction and prints the answer. Amp chooses the
 * model itself (no model flag), and reports its version with `amp version`.
 */
export const ampAdapter: AgentAdapter = {
  id: 'amp',
  displayName: 'Amp',
  supportsResume: false,
  profileStrategy: { kind: 'unsupported' },
  setup: {
    docsUrl: 'https://ampcode.com/docs',
    installCommands: {
      darwin: 'curl -fsSL https://ampcode.com/install.sh | bash',
      linux: 'curl -fsSL https://ampcode.com/install.sh | bash',
    },
  },

  async detect(): Promise<AgentDetection> {
    return probeCliVersion('amp', ['version']);
  },

  buildCommand(request: AgentRunRequest): AgentCommandSpec {
    const prompt = request.allowWrites
      ? request.prompt
      : `READ-ONLY TASK. Do not modify files, dependencies, repositories, or system state.\n\n${request.prompt}`;
    const args = ['-x', prompt];
    return {
      command: 'amp',
      args,
      displayArgs: args.map((arg) => (arg === prompt ? '<prompt-arg>' : arg)),
      promptDelivery: 'args',
    };
  },

  resumeArgs(): string[] | null {
    return null;
  },

  interactiveCommand(): AgentCommandSpec {
    return { command: 'amp', args: [] };
  },

  parseOutput(stdout: string): ParsedAgentOutput {
    return { content: stdout.trim() };
  },

  runMetadata(request: AgentRunRequest): Record<string, unknown> {
    return { permissionMode: request.allowWrites ? 'default' : 'read-only-instruction' };
  },

  async listModels() {
    return [];
  },
};
