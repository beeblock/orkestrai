import type { AgentRunRequest, ModelEffort } from '../../domain/types.js';
import { probeCliVersion } from '../../infrastructure/agent-path.js';
import type { AgentAdapter, AgentCommandSpec, AgentDetection, ParsedAgentOutput } from './types.js';

/**
 * Official Qwen Code CLI. Headless runs use `-p`; read-only runs use the
 * `plan` approval mode and writes use `yolo`. Sessions resume by id.
 */
export const qwenAdapter: AgentAdapter = {
  id: 'qwen',
  displayName: 'Qwen Code',
  supportsResume: true,
  profileStrategy: { kind: 'unsupported' },
  setup: {
    docsUrl: 'https://qwenlm.github.io/qwen-code-docs/en/',
    installCommands: {
      darwin: 'curl -fsSL https://qwen-code-assets.oss-cn-hangzhou.aliyuncs.com/installation/install-qwen-standalone.sh | bash',
      windows: 'irm https://qwen-code-assets.oss-cn-hangzhou.aliyuncs.com/installation/install-qwen-standalone.ps1 | iex',
      linux: 'curl -fsSL https://qwen-code-assets.oss-cn-hangzhou.aliyuncs.com/installation/install-qwen-standalone.sh | bash',
    },
  },

  async detect(): Promise<AgentDetection> {
    return probeCliVersion('qwen');
  },

  buildCommand(request: AgentRunRequest): AgentCommandSpec {
    const prompt = request.allowWrites
      ? request.prompt
      : `READ-ONLY TASK. Do not modify files, dependencies, repositories, or system state.\n\n${request.prompt}`;
    const args = [
      '-p', prompt,
      '--approval-mode', request.allowWrites ? 'yolo' : 'plan',
      ...(request.model ? ['-m', request.model] : []),
    ];
    return {
      command: 'qwen',
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
      command: 'qwen',
      args: ['--yolo', ...(options?.model ? ['-m', options.model] : [])],
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
