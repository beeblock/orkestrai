import { execFile } from 'node:child_process';
import type { AgentModelOption, AgentRunRequest, ModelEffort } from '../../domain/types.js';
import { cliInvocation, probeCliVersion } from '../../infrastructure/agent-path.js';
import type { AgentAdapter, AgentCommandSpec, AgentDetection, ParsedAgentOutput } from './types.js';
import { parseJsonLinesOutput } from './json-lines.js';
import { codexCompanion } from './codex-companion.js';

const CODEX_FALLBACK_OPTIONS: AgentModelOption[] = [
  { provider: 'codex', value: 'gpt-5.5', label: 'GPT-5.5', efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] },
  { provider: 'codex', value: 'gpt-5-codex', label: 'GPT-5 Codex', efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] },
];

function codexSandbox(request: AgentRunRequest) {
  return request.allowWrites ? 'danger-full-access' : 'read-only';
}

export const codexAdapter: AgentAdapter = {
  id: 'codex',
  displayName: 'Codex',
  supportsResume: false,
  respondPrivately: codexCompanion,
  efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
  sessionStorage: 'codex-rollout-jsonl',
  profileStrategy: { kind: 'configDir', envVar: 'CODEX_HOME', defaultDir: '~/.codex' },
  setup: {
    docsUrl: 'https://developers.openai.com/codex/cli/',
    installCommands: {
      darwin: 'curl -fsSL https://chatgpt.com/codex/install.sh | sh',
      windows: 'npm install -g @openai/codex',
      linux: 'curl -fsSL https://chatgpt.com/codex/install.sh | sh',
    },
  },

  async detect(): Promise<AgentDetection> {
    return probeCliVersion('codex');
  },

  buildCommand(request: AgentRunRequest): AgentCommandSpec {
    const modelArgs = request.model ? ['--model', request.model] : [];
    const effortArgs = request.effort ? ['-c', `model_reasoning_effort="${request.effort}"`] : [];
    const args = request.allowWrites
      ? [
          'exec',
          '--json',
          '--ephemeral',
          '--skip-git-repo-check',
          ...modelArgs,
          ...effortArgs,
          '--dangerously-bypass-approvals-and-sandbox',
          '-',
        ]
      : [
          'exec',
          '--json',
          '--ephemeral',
          '--skip-git-repo-check',
          ...modelArgs,
          ...effortArgs,
          '--sandbox',
          codexSandbox(request),
          '-',
        ];

    return {
      command: 'codex',
      args,
      displayArgs: args.map((arg) => (arg === '-' ? '<prompt-stdin>' : arg)),
    };
  },

  /** Resume exato por session-id, ou a mais recente sem id. */
  resumeArgs(agentSessionId?: string): string[] {
    return agentSessionId ? ['resume', agentSessionId] : ['resume', '--last'];
  },

  interactiveCommand(options?: { model?: string; effort?: ModelEffort | null }): AgentCommandSpec {
    return {
      command: 'codex',
      args: [
        '--dangerously-bypass-approvals-and-sandbox',
        ...(options?.model ? ['--model', options.model] : []),
        ...(options?.effort ? ['-c', `model_reasoning_effort="${options.effort}"`] : []),
      ],
    };
  },

  initialRoleArgs(role) {
    // O valor e TOML; JSON.stringify produz uma string TOML basica valida e
    // preserva aspas/newlines sem expor a role como mensagem do usuario.
    return ['-c', `developer_instructions=${JSON.stringify(role.prompt)}`];
  },

  parseOutput(stdout: string): ParsedAgentOutput {
    return parseJsonLinesOutput(stdout);
  },

  runMetadata(request: AgentRunRequest): Record<string, unknown> {
    return { sandbox: codexSandbox(request) };
  },

  async listModels(): Promise<AgentModelOption[]> {
    const result = await new Promise<{ status: number; stdout: string }>((resolve) => {
      const inv = cliInvocation('codex', ['debug', 'models']);
      execFile(inv.command, inv.args, { timeout: 8_000, encoding: 'utf8', env: inv.env, windowsHide: true }, (error, stdout) => {
        resolve({ status: error ? 1 : 0, stdout: String(stdout ?? '') });
      });
    });

    if (result.status !== 0 || !result.stdout.trim()) return CODEX_FALLBACK_OPTIONS;

    try {
      const parsed = JSON.parse(result.stdout) as {
        models?: Array<{
          slug?: string;
          display_name?: string;
          description?: string;
          visibility?: string;
          supported_reasoning_levels?: Array<{ effort?: string }>;
        }>;
      };
      const options = (parsed.models ?? [])
        .filter((model) => model.slug && model.visibility !== 'hidden')
        .map((model) => ({
          provider: 'codex' as const,
          value: String(model.slug),
          label: String(model.display_name ?? model.slug),
          description: model.description,
          efforts: (model.supported_reasoning_levels ?? [])
            .map((level) => String(level.effort ?? ''))
            .filter(Boolean),
        }));

      return options.length ? options : CODEX_FALLBACK_OPTIONS;
    } catch {
      return CODEX_FALLBACK_OPTIONS;
    }
  },
};
