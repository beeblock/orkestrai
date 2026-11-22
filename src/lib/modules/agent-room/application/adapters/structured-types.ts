import type { WorkspaceExecutionRuntime } from '../../domain/types.js';
import type { StructuredAgentProcess } from '../../infrastructure/pty/StructuredAgentProcess.ts';

export type StructuredAgentOptions = {
  workspaceId?: string;
  nodeId?: string;
  cwd: string;
  hostCwd: string;
  workspaceRoot: string;
  runtime: WorkspaceExecutionRuntime;
  env: Record<string, string>;
  model?: string | null;
  effort?: string | null;
  instructions: string;
  launchArgs: string[];
  bridgeMcp: { command: string; args: string[]; env?: Record<string, string> };
  /** Issued only by the public bot boundary, never deserialized from a request. */
  publicWorker?: { serverName: string; codexCatalog?: string; disabledServers?: string[]; disabledFeatures?: string[] };
  session: (conversationKey: string) => string | null;
  saveSession: (conversationKey: string, sessionId: string) => Promise<void>;
};

export type StructuredAgentFactory = (options: StructuredAgentOptions) => StructuredAgentProcess;
