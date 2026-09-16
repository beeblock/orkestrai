import type { AgentModelOption, AgentName, AgentProfileStrategy, AgentProviderSetup, AgentRunRequest, ModelEffort } from '../../domain/types.js';
import type { AgentSessionStorage } from '../../infrastructure/pty/AgentSessionTracker.js';

/**
 * Resultado da deteccao da CLI de um agente na maquina local.
 */
export type AgentDetection = {
  installed: boolean;
  detail?: string;
};

/**
 * Comando headless one-shot pronto para spawn (sem shell string).
 * `displayArgs` e a versao segura dos args para logs/progresso (prompt mascarado).
 */
export type AgentCommandSpec = {
  command: string;
  args: string[];
  env?: Record<string, string>;
  displayArgs?: string[];
  /**
   * Como o runner entrega o prompt: 'stdin' (padrao, prompt no stdin)
   * ou 'args' (o adapter ja embutiu o prompt nos args; stdin recebe vazio).
   */
  promptDelivery?: 'stdin' | 'args';
};

/** Role persistida que um adapter pode instalar no nivel nativo do CLI. */
export type AgentRoleLaunchContext = {
  name: string;
  prompt: string;
  instructionFile: string;
};

export type { AgentProfileStrategy };

/**
 * Resultado do parse do stream de saida da CLI.
 * `cliError` sinaliza erro reportado pela propria CLI no payload (ex.: is_error),
 * mesmo quando o exit code e zero.
 */
export type ParsedAgentOutput = {
  content: string;
  metadata?: Record<string, unknown>;
  cliError?: string;
};

/**
 * Adaptador de um agente CLI (claude, codex, ...).
 *
 * O runner generico (agents.ts) cuida do spawn, timeout, kill e progresso;
 * o adapter decide apenas comando/args, parse do stream e metadados.
 * Registrar um novo adapter no registry torna um novo provider utilizavel
 * sem tocar no runner.
 */
export interface AgentAdapter {
  /** Identificador unico do provider (ex.: 'claude', 'codex'). */
  id: AgentName;
  /** Nome amigavel exibido na UI e nas mensagens de erro. */
  displayName: string;
  /** Se a CLI suporta retomar sessoes (resume). Ainda nao usado pelo runner. */
  supportsResume: boolean;
  /** Niveis de raciocinio aceitos pela CLI, quando configuraveis. */
  efforts?: string[];
  /** Layout persistido pela CLI, usado para descobrir o id exato da sessao. */
  sessionStorage?: AgentSessionStorage;
  /** Guia oficial e instaladores exibidos pela Central de Providers. */
  setup: AgentProviderSetup;
  /** Mecanismo oficial de multi-conta dessa CLI (ou 'unsupported'). */
  profileStrategy: AgentProfileStrategy;
  /** Verifica se a CLI esta instalada (hoje via `<cli> --version`). */
  detect(): Promise<AgentDetection>;
  /** Monta o comando headless one-shot a partir do payload de execucao. */
  buildCommand(request: AgentRunRequest): AgentCommandSpec;
  /** Separate tool-free inference; never reuse an interactive development session. */
  respondPrivately?(input: { instructions: string; content: string; model?: string | null; launchArgs?: string[]; signal?: AbortSignal; profileEnv?: Record<string, string> }): Promise<string>;
  /** Monta o comando TUI interativo para rodar o agente num terminal PTY. */
  interactiveCommand(options?: { model?: string; effort?: ModelEffort | null }): AgentCommandSpec;
  /**
   * Args usados somente ao criar uma conversa nova. Providers com suporte
   * nativo recebem a role como system/developer prompt, nunca no composer.
   */
  initialRoleArgs?(role: AgentRoleLaunchContext): string[];
  /** Args de resume: exato com session-id, ou a mais recente do diretorio sem id. */
  resumeArgs(agentSessionId?: string): string[] | null;
  /** Args para reservar um id conhecido ao criar uma conversa nova, quando a CLI suporta. */
  freshSessionArgs?(agentSessionId: string): string[];
  /** Extrai o texto final e metadados do stdout (JSON-lines) da CLI. */
  parseOutput(stdout: string): ParsedAgentOutput;
  /** Metadados especificos do provider anexados ao resultado da execucao. */
  runMetadata(request: AgentRunRequest): Record<string, unknown>;
  /** Lista modelos disponiveis (com fallback estatico quando a CLI falha). */
  listModels(): Promise<AgentModelOption[]>;
}
