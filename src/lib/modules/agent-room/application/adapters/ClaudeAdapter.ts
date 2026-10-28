import type { AgentModelOption, AgentRunRequest, ModelEffort } from '../../domain/types.js';
import { probeCliVersion } from '../../infrastructure/agent-path.js';
import type { AgentAdapter, AgentCommandSpec, AgentDetection, ParsedAgentOutput } from './types.js';
import { hasJsonLineError, parseJsonLinesOutput } from './json-lines.js';

const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

const CLAUDE_MODEL_OPTIONS: AgentModelOption[] = [
  { provider: 'claude', value: 'fable', label: 'Fable', description: 'Alias Claude atual', efforts: CLAUDE_EFFORTS },
  { provider: 'claude', value: 'opus', label: 'Opus', description: 'Alias Claude atual', efforts: CLAUDE_EFFORTS },
  { provider: 'claude', value: 'sonnet', label: 'Sonnet', description: 'Alias Claude atual', efforts: CLAUDE_EFFORTS },
  { provider: 'claude', value: 'claude-fable-5', label: 'Claude Fable 5', description: 'Nome completo aceito pela CLI', efforts: CLAUDE_EFFORTS },
];

export const claudeAdapter: AgentAdapter = {
  id: 'claude',
  displayName: 'Claude',
  supportsResume: false,
  efforts: CLAUDE_EFFORTS,
  sessionStorage: 'claude-project-jsonl',
  supportsProfileSessionTransfer: true,
  profileAuthenticationEnvKeys: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'],
  profileStrategy: { kind: 'configDir', envVar: 'CLAUDE_CONFIG_DIR', defaultDir: '~/.claude' },
  setup: {
    docsUrl: 'https://code.claude.com/docs/en/setup',
    installCommands: {
      darwin: 'curl -fsSL https://claude.ai/install.sh | bash',
      windows: 'irm https://claude.ai/install.ps1 | iex',
      linux: 'curl -fsSL https://claude.ai/install.sh | bash',
    },
  },

  async detect(): Promise<AgentDetection> {
    return probeCliVersion('claude');
  },

  buildCommand(request: AgentRunRequest): AgentCommandSpec {
    const modelArgs = request.model ? ['--model', request.model] : [];
    const effortArgs = request.effort ? ['--effort', request.effort] : [];
    const args = request.allowWrites
      ? [
          '-p',
          ...modelArgs,
          ...effortArgs,
          '--output-format',
          'stream-json',
          '--verbose',
          '--include-partial-messages',
          '--no-session-persistence',
          '--dangerously-skip-permissions',
        ]
      : [
          '-p',
          ...modelArgs,
          ...effortArgs,
          '--output-format',
          'stream-json',
          '--verbose',
          '--include-partial-messages',
          '--no-session-persistence',
        ];

    return {
      command: 'claude',
      args,
      displayArgs: ['-p', '<prompt-stdin>', ...args.slice(1)],
    };
  },

  /**
   * Resume exato por session-id. SEM id, comeca fresco (`[]`) em vez de
   * `--continue`: o claude sai com erro "No conversation found to continue" e
   * codigo 1 quando ainda nao houve conversa naquele diretorio (ex.: nó reaberto
   * sem nenhuma mensagem enviada). Diferente de codex/kimi, que persistem sessao
   * ja no start. Quando existe conversa, o rastreador acha o id e usa --resume.
   */
  resumeArgs(agentSessionId?: string): string[] {
    return agentSessionId ? ['--resume', agentSessionId] : [];
  },

  /**
   * Impede a corrida do rastreador quando varios Claude nascem juntos no
   * mesmo cwd: cada processo cria exatamente o transcript que o no reservou.
   */
  freshSessionArgs(agentSessionId: string): string[] {
    return ['--session-id', agentSessionId];
  },

  interactiveCommand(options?: { model?: string; effort?: ModelEffort | null }): AgentCommandSpec {
    return {
      command: 'claude',
      args: [
        '--dangerously-skip-permissions',
        ...(options?.model ? ['--model', options.model] : []),
        ...(options?.effort ? ['--effort', options.effort] : []),
      ],
    };
  },

  initialRoleArgs(role) {
    return ['--append-system-prompt', role.prompt];
  },

  parseOutput(stdout: string): ParsedAgentOutput {
    const parsedOutput = parseJsonLinesOutput(stdout);
    const content = parsedOutput.content;
    let metadata: Record<string, unknown> | undefined;
    let cliError: string | undefined;

    try {
      const parsed = JSON.parse(stdout);
      metadata =
        parsed && typeof parsed === 'object'
          ? { ...parsedOutput.metadata, ...(parsed as Record<string, unknown>) }
          : parsedOutput.metadata;
      if ((parsed as Record<string, unknown>)?.is_error === true && content) {
        cliError = content;
      }
    } catch {
      metadata = parsedOutput.metadata;
    }
    if (!cliError && hasJsonLineError(metadata) && content) {
      cliError = content;
    }

    return { content, metadata, cliError };
  },

  runMetadata(request: AgentRunRequest): Record<string, unknown> {
    return { permissionMode: request.allowWrites ? 'dangerous-skip' : 'default' };
  },

  async listModels(): Promise<AgentModelOption[]> {
    return CLAUDE_MODEL_OPTIONS;
  },
};
