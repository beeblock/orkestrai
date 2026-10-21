import type { AgentRunRequest, ModelEffort } from '../../domain/types.js';
import { probeCliVersion } from '../../infrastructure/agent-path.js';
import type { AgentAdapter, AgentCommandSpec, AgentDetection, ParsedAgentOutput } from './types.js';

/**
 * goose CLI. `goose run -t` runs one instruction; `GOOSE_MODE` picks the
 * permission level (`auto` writes, `chat` never calls tools). The terminal
 * opens `goose session`.
 */
export const gooseAdapter: AgentAdapter = {
  id: 'goose',
  displayName: 'goose',
  supportsResume: false,
  profileStrategy: { kind: 'unsupported' },
  setup: {
    docsUrl: 'https://goose-docs.ai/docs/',
    installCommands: {
      darwin: 'brew install block-goose-cli',
      windows: 'Invoke-WebRequest -Uri "https://raw.githubusercontent.com/aaif-goose/goose/main/download_cli.ps1" -OutFile "download_cli.ps1"; .\\download_cli.ps1',
      linux: 'curl -fsSL https://github.com/aaif-goose/goose/releases/download/stable/download_cli.sh | bash',
    },
  },

  async detect(): Promise<AgentDetection> {
    return probeCliVersion('goose');
  },

  buildCommand(request: AgentRunRequest): AgentCommandSpec {
    const prompt = request.allowWrites
      ? request.prompt
      : `READ-ONLY TASK. Do not modify files, dependencies, repositories, or system state.\n\n${request.prompt}`;
    const args = [
      'run',
      '-t', prompt,
      '--no-session',
      ...(request.model ? ['--model', request.model] : []),
    ];
    return {
      command: 'goose',
      args,
      env: { GOOSE_MODE: request.allowWrites ? 'auto' : 'chat' },
      displayArgs: args.map((arg) => (arg === prompt ? '<prompt-arg>' : arg)),
      promptDelivery: 'args',
    };
  },

  // Resuming needs the exact conversation, which Orkestrai learns only by reading the
  // CLI's own session files (`sessionStorage`). Until that is read for this CLI, a
  // restarted terminal starts a new conversation instead of claiming a resume.
  resumeArgs(): string[] | null {
    return null;
  },

  interactiveCommand(options?: { model?: string; effort?: ModelEffort | null }): AgentCommandSpec {
    return {
      command: 'goose',
      args: ['session'],
      env: { GOOSE_MODE: 'auto', ...(options?.model ? { GOOSE_MODEL: options.model } : {}) },
    };
  },

  parseOutput(stdout: string): ParsedAgentOutput {
    return { content: stdout.trim() };
  },

  runMetadata(request: AgentRunRequest): Record<string, unknown> {
    return { permissionMode: request.allowWrites ? 'auto' : 'chat' };
  },

  async listModels() {
    return [];
  },
};
