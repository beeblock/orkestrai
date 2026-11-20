import { StructuredAgentProcess, type StructuredAgentDriver, type StructuredTurn } from '../../infrastructure/pty/StructuredAgentProcess.ts';
import { spawnStructuredAgent, stopStructuredAgent } from './structured-launch.js';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { StructuredAgentOptions } from './structured-types.js';
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';

type QueryFunction = typeof import('@anthropic-ai/claude-agent-sdk').query;

export class ClaudeStructuredDriver implements StructuredAgentDriver {
  private active: { close(): void } | null = null;
  private closed = false;
  private readonly children = new Set<ChildProcessWithoutNullStreams>();
  get pid() { return this.children.values().next().value?.pid ?? 0; }
  constructor(private readonly options: StructuredAgentOptions, private readonly queryOverride?: QueryFunction) {}

  async run(turn: StructuredTurn): Promise<string> {
    if (this.closed || turn.signal.aborted) throw new Error('STRUCTURED_SESSION_CLOSED');
    const query = this.queryOverride ?? (await import('@anthropic-ai/claude-agent-sdk')).query;
    const controller = new AbortController();
    const abort = () => controller.abort();
    turn.signal.addEventListener('abort', abort, { once: true });
    const previous = this.options.session(turn.conversationKey);
    const options: Options = {
      cwd: this.options.cwd,
      // With a custom launcher this identifies a native executable. Otherwise
      // the SDK prepends its bundled cli.js to args for a Node launch.
      pathToClaudeCodeExecutable: 'claude',
      env: this.options.env,
      abortController: controller,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      settingSources: ['user', 'project', 'local'],
      includePartialMessages: true,
      // The CLI and its MCP children already inherit the authenticated bridge
      // environment from spawnStructuredAgent. Never serialize those secrets
      // into --mcp-config. This secret-free config also supports installed CLIs
      // older than the SDK's initialize-delivery extension.
      mcpServers: { orkestrai: { type: 'stdio', command: this.options.bridgeMcp.command,
        args: this.options.bridgeMcp.args,
        ...(this.options.bridgeMcp.env?.ELECTRON_RUN_AS_NODE === '1' ? { env: { ELECTRON_RUN_AS_NODE: '1' } } : {}) } },
      mcpServersDelivery: 'argv',
      systemPrompt: { type: 'preset', preset: 'claude_code', append: this.options.instructions },
      ...(previous ? { resume: previous } : {}),
      ...(this.options.model ? { model: this.options.model } : {}),
      ...(this.options.effort ? { effort: this.options.effort as Options['effort'] } : {}),
      spawnClaudeCodeProcess: launch => {
        // Run the owner's unchanged CLI in its own native/WSL runtime; the SDK
        // owns the protocol, while the existing profile owns authentication.
        const env = Object.fromEntries(Object.entries({ ...this.options.env, ...launch.env }).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
        const child = spawnStructuredAgent('claude', launch.args, { ...this.options, env });
        this.children.add(child);
        child.once('exit', () => this.children.delete(child));
        launch.signal.addEventListener('abort', () => { try { child.kill(); } catch { /* already exited */ } }, { once: true });
        return child;
      },
    };
    const stream = query({ prompt: turn.prompt, options });
    this.active = stream;
    let accepted = false;
    let sessionId = previous;
    let final = '';
    let resultSeen = false;
    try {
      for await (const message of stream) {
        if (turn.signal.aborted) throw new Error('STRUCTURED_TURN_CANCELLED');
        const record = message as SDKMessage & { session_id?: string };
        if (typeof record.session_id === 'string' && record.session_id !== sessionId) {
          if (!/^[a-zA-Z0-9_-]{1,180}$/.test(record.session_id)) throw new Error('CLAUDE_SESSION_INVALID');
          sessionId = record.session_id;
          await this.options.saveSession(turn.conversationKey, sessionId);
        }
        if (!accepted && sessionId && ((message.type === 'system' && message.subtype === 'init') || message.type === 'assistant')) {
          accepted = true;
          turn.accepted(sessionId, turn.messageId);
        }
        if (message.type === 'assistant') {
          if (message.error) throw new Error(`CLAUDE_TURN_FAILED: ${message.error}`);
          const text = message.message.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
          if (text) { final = text.slice(0, 2_000_000); turn.output(`${text}\n`); }
        }
        if (message.type === 'result') {
          resultSeen = true;
          if (message.subtype !== 'success' || message.is_error) throw new Error('CLAUDE_TURN_FAILED');
          if (typeof message.result === 'string') final = message.result.slice(0, 2_000_000);
        }
      }
      if (!resultSeen) throw new Error('CLAUDE_TURN_INCOMPLETE');
      return final.trim();
    } finally {
      turn.signal.removeEventListener('abort', abort);
      stream.close();
      await Promise.all([...this.children].map(child => stopStructuredAgent(child)));
      if (this.active === stream) this.active = null;
    }
  }

  async close(): Promise<void> {
    this.closed = true; this.active?.close(); this.active = null;
    await Promise.all([...this.children].map(child => stopStructuredAgent(child)));
  }
}

export const createClaudeStructuredProcess = (options: StructuredAgentOptions) => new StructuredAgentProcess(new ClaudeStructuredDriver(options));
