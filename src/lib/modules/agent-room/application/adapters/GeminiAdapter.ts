import type { AgentRunRequest, ModelEffort } from '../../domain/types.js';
import { probeCliVersion } from '../../infrastructure/agent-path.js';
import type { AgentAdapter, AgentCommandSpec, AgentDetection, ParsedAgentOutput } from './types.js';

/**
 * Official Gemini CLI (`@google/gemini-cli`). Headless runs use `-p` with plain
 * text output; read-only runs use the documented `plan` approval mode, writes
 * use `yolo`. Sessions resume by id with `--resume`.
 */
export const geminiAdapter: AgentAdapter = {
  id: 'gemini',
  displayName: 'Gemini CLI',
  supportsResume: true,
  profileStrategy: { kind: 'unsupported' },
  setup: {
    docsUrl: 'https://geminicli.com/docs/',
    installCommands: {
      darwin: 'brew install gemini-cli',
      windows: 'npm install -g @google/gemini-cli',
      linux: 'npm install -g @google/gemini-cli',
    },
  },

  async detect(): Promise<AgentDetection> {
    return probeCliVersion('gemini');
  },

  buildCommand(request: AgentRunRequest): AgentCommandSpec {
    const prompt = request.allowWrites
      ? request.prompt
      : `READ-ONLY TASK. Do not modify files, dependencies, repositories, or system state.\n\n${request.prompt}`;
    const args = [
      '-p', prompt,
      '--output-format', 'text',
      `--approval-mode=${request.allowWrites ? 'yolo' : 'plan'}`,
      ...(request.model ? ['-m', request.model] : []),
    ];
    return {
      command: 'gemini',
      args,
      displayArgs: args.map((arg) => (arg === prompt ? '<prompt-arg>' : arg)),
      promptDelivery: 'args',
    };
  },

  resumeArgs(agentSessionId?: string): string[] | null {
    return agentSessionId ? ['--resume', agentSessionId] : null;
  },

  interactiveCommand(options?: { model?: string; effort?: ModelEffort | null }): AgentCommandSpec {
    return {
      command: 'gemini',
      args: ['--approval-mode=yolo', ...(options?.model ? ['-m', options.model] : [])],
    };
  },

  parseOutput(stdout: string): ParsedAgentOutput {
    return { content: stdout.trim() };
  },

  runMetadata(request: AgentRunRequest): Record<string, unknown> {
    return { permissionMode: request.allowWrites ? 'yolo' : 'plan' };
  },

  async listModels() {
    return [];
  },
};
