/**
 * Camada de transporte WebSocket para sessões PTY do Agent Room.
 *
 * Arquivo deliberadamente autocontido (só depende de PtySessionManager e ws)
 * para ser importado tanto pelo vite (dev) quanto pelo servidor de producao
 * (scripts/orkestrai-server.mjs, rodado com type stripping do Node 24+).
 *
 * Protocolo (frames JSON texto):
 *   C->S {type:'create', command, args?, cwd, cols?, rows?, env?, profileId?}
 *   C->S {type:'attach', sessionId, cols?, rows?}
 *   C->S {type:'input', sessionId, data}
 *   C->S {type:'resize', sessionId, cols, rows}
 *   C->S {type:'kill', sessionId}
 *   C->S {type:'list'}
 *   S->C {type:'created'|'attached', session, scrollback}
 *   S->C {type:'output', sessionId, data}
 *   S->C {type:'exit', sessionId, exitCode}
 *   S->C {type:'killed', sessionId}
 *   S->C {type:'list', sessions}
 *   S->C {type:'error', code?, message}
 */
import { existsSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { posix } from 'node:path';
import type { WebSocket } from 'ws';
import { ptySessionManager } from './PtySessionManager.ts';
import { agentSessionTracker, agentSessionTrackerForRuntime, type AgentSessionTracker } from './AgentSessionTracker.ts';
import type { WorkspaceExecutionRuntime } from '../../domain/types.ts';
import { executionRuntimeKey } from '../../domain/runtime.ts';
import { preflightWslLaunch, WslLaunchError, type WslTrackingContext } from '../WslRuntime.ts';
import { codexMcpLaunchForRuntime, codexMcpOverrideArgs } from '../codex-mcp-config.ts';

export const PTY_WS_PATH = '/ws/agent-room/pty';

type ClientMessage =
  | { type: 'create'; command: string; args?: string[]; conversationArgs?: string[]; freshSessionArgs?: string[]; cwd: string; cols?: number; rows?: number; env?: Record<string, string>; provider?: string; profileId?: string | null; sessionStorage?: string; label?: string; workspace?: string; workspaceId?: string; nodeId?: string; runtime?: WorkspaceExecutionRuntime; workspaceRoot?: string }
  | { type: 'attach'; sessionId: string; cols?: number; rows?: number }
  | { type: 'input'; sessionId: string; data: string }
  | { type: 'resize'; sessionId: string; cols: number; rows: number }
  | { type: 'kill'; sessionId: string }
  | { type: 'list' };

export function isPtyWsPath(pathname: string): boolean {
  return pathname === PTY_WS_PATH;
}

// Registro global de sockets vivos + broadcast para eventos de workspace
// (ex.: edge "talking"). Vai em globalThis porque o bundle SSR e a camada
// type-stripped carregam copias separadas deste módulo no mesmo processo.
const wsGlobal = globalThis as unknown as {
  __orkestraiWsClients?: Set<WebSocket>;
  __orkestraiBroadcast?: (payload: Record<string, unknown>) => void;
  __orkestraiResolveProviderProfileEnv?: (profileId: string, providerId: string, options?: { runtimeHome?: string }) => Promise<Record<string, string>>;
  __orkestraiCanStartWorkspaceSession?: (workspaceId: string) => Promise<boolean>;
};
const allSockets = (wsGlobal.__orkestraiWsClients ??= new Set<WebSocket>());
wsGlobal.__orkestraiBroadcast = (payload) => {
  const frame = JSON.stringify(payload);
  for (const client of allSockets) {
    if (client.readyState === client.OPEN) client.send(frame);
  }
};

/**
 * Aceita apenas origens same-origin ou loopback (o servidor só escuta em
 * 127.0.0.1; sem origin — ex.: curl/testes — também passa).
 */
export function isAllowedPtyWsOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return true;
  if (!host) return false;
  try {
    const originUrl = new URL(origin);
    const serverUrl = new URL(`http://${host}`);
    if (originUrl.host === serverUrl.host) return true;

    // Electron may load 127.0.0.1 while a renderer resolves the same server as
    // localhost. Treat those spellings as equivalent only on the exact port;
    // a different localhost service must never gain PTY access.
    const loopback = new Set(['127.0.0.1', 'localhost', '[::1]']);
    return loopback.has(originUrl.hostname.toLowerCase())
      && loopback.has(serverUrl.hostname.toLowerCase())
      && originUrl.port === serverUrl.port;
  } catch {
    return false;
  }
}

function resolveCwd(cwd: unknown): string {
  if (typeof cwd !== 'string' || !cwd.trim()) {
    throw new Error('Informe um diretório de trabalho (cwd) para a sessão PTY.');
  }
  const resolved = cwd.trim();
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
    throw new Error(`Diretório de trabalho não existe: ${resolved}`);
  }
  return resolved;
}

export function handlePtyConnection(socket: WebSocket): void {
  const detachers = new Map<string, () => void>();
  const sessionTrackers = new Map<string, AgentSessionTracker>();
  allSockets.add(socket);
  socket.on('close', () => allSockets.delete(socket));

  const send = (payload: Record<string, unknown>) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
  };

  const attachSession = (sessionId: string) => {
    if (detachers.has(sessionId)) return;
    const { scrollback, detach } = ptySessionManager.attach(
      sessionId,
      (data) => send({ type: 'output', sessionId, data }),
      (exitCode) => send({ type: 'exit', sessionId, exitCode }),
      (waiting) => send({ type: 'idle', sessionId, idle: waiting }),
      (cwd) => send({ type: 'cwd', sessionId, cwd }),
    );
    detachers.set(sessionId, detach);
    return scrollback;
  };

  socket.on('message', async (raw) => {
    let message: ClientMessage;
    try {
      message = JSON.parse(String(raw));
    } catch {
      send({ type: 'error', message: 'Mensagem inválida (JSON esperado).' });
      return;
    }

    try {
      switch (message.type) {
        case 'create': {
          if (typeof message.command !== 'string' || !message.command.trim()) {
            throw new Error('Informe o comando da sessão PTY.');
          }
          if (message.workspaceId && wsGlobal.__orkestraiCanStartWorkspaceSession) {
            const canStart = await wsGlobal.__orkestraiCanStartWorkspaceSession(message.workspaceId);
            if (!canStart) {
              send({
                type: 'error',
                code: 'WORKSPACE_SUSPENDED',
                message: 'Workspace suspended.',
              });
              break;
            }
          }

          const reuseLiveNodeSession = () => {
            if (typeof message.workspaceId !== 'string' || typeof message.nodeId !== 'string') return false;
            const expectedCommand = message.command.trim();
            const expectedProvider = typeof message.provider === 'string' ? message.provider : null;
            const expectedRuntime = executionRuntimeKey(message.runtime ?? { kind: 'native' });
            const live = ptySessionManager.listLiveForNode(message.workspaceId, message.nodeId);
            const existing = live.find(
              (session) => session.command === expectedCommand
                && (session.provider ?? null) === expectedProvider
                && session.runtimeKey === expectedRuntime,
            );
            if (!existing) {
              // A provider/runtime change should have retired the old PTY. If
              // it did not, do it here before starting the replacement.
              if (live.length) ptySessionManager.killNode(message.workspaceId, message.nodeId);
              return false;
            }
            ptySessionManager.killNode(message.workspaceId, message.nodeId, existing.id);
            const scrollback = attachSession(existing.id);
            send({ type: 'created', session: existing, scrollback, reused: true });
            return true;
          };

          // Page remounts and reconnects must reattach to the PTY already
          // owned by this node instead of starting the same conversation twice.
          if (reuseLiveNodeSession()) break;

          const trackingStartedAt = Date.now();
          const resolvedCwd = resolveCwd(message.cwd);
          const wslContext: WslTrackingContext | null = message.runtime?.kind === 'wsl'
            ? await preflightWslLaunch({
                runtime: message.runtime,
                command: message.command.trim(),
                hostCwd: resolvedCwd,
                workspaceRoot: typeof message.workspaceRoot === 'string' ? message.workspaceRoot : undefined,
              })
            : null;
          const tracker = wslContext && message.runtime?.kind === 'wsl'
            ? agentSessionTrackerForRuntime(
                `${message.runtime.distribution}:${wslContext.homeHostPath}`,
                wslContext.homeHostPath,
                (cwd) => posix.normalize(cwd),
              )
            : agentSessionTracker;
          const runtime = message.runtime ?? { kind: 'native' as const };
          const providerArgs = message.provider === 'codex'
            ? codexMcpOverrideArgs(codexMcpLaunchForRuntime(runtime))
            : [];
          let profileEnv: Record<string, string> = {};
          if (message.profileId) {
            if (!message.provider) throw new Error('A provider is required when launching a profile.');
            const resolveProfileEnv = wsGlobal.__orkestraiResolveProviderProfileEnv;
            if (!resolveProfileEnv) throw new Error('Provider profile resolution is unavailable.');
            profileEnv = await resolveProfileEnv(message.profileId, message.provider, {
              runtimeHome: wslContext?.linuxHomePath,
            });
          }

          // A concurrent renderer may have created the PTY while preflight or
          // secure profile resolution was awaiting I/O.
          if (reuseLiveNodeSession()) break;

          const freshSessionId = Array.isArray(message.freshSessionArgs) && message.freshSessionArgs.length
            ? randomUUID()
            : null;
          const freshSessionArgs = freshSessionId
            ? message.freshSessionArgs!.map((arg) => String(arg).replace('__ORKESTRAI_SESSION_ID__', freshSessionId))
            : [];
          if (freshSessionId) tracker.claim(freshSessionId);
          const session = ptySessionManager.create({
            command: message.command.trim(),
            args: [
              ...(Array.isArray(message.args) ? message.args.map(String) : []),
              ...providerArgs,
              ...freshSessionArgs,
              ...(Array.isArray(message.conversationArgs) ? message.conversationArgs.map(String) : []),
            ],
            cwd: resolvedCwd,
            cols: message.cols,
            rows: message.rows,
            env: { ...(message.env ?? {}), ...profileEnv },
            forwardEnvToWsl: Object.keys(profileEnv),
            label: typeof message.label === 'string' ? message.label : null,
            workspace: typeof message.workspace === 'string' ? message.workspace : null,
            workspaceId: typeof message.workspaceId === 'string' ? message.workspaceId : null,
            nodeId: typeof message.nodeId === 'string' ? message.nodeId : null,
            provider: typeof message.provider === 'string' ? message.provider : null,
            runtime: message.runtime,
            workspaceRoot: typeof message.workspaceRoot === 'string' ? message.workspaceRoot : undefined,
          });
          sessionTrackers.set(session.id, tracker);
          const scrollback = attachSession(session.id);
          send({ type: 'created', session, scrollback });

          // Encerramento normal pode ser unload/reload solicitado pelo usuário
          // e não deve gerar ruído. Só uma saída anormal vira notificação; para
          // conclusões e pedidos de atenção, o agente usa `orkestrai notify`.
          const label = typeof message.label === 'string' && message.label.trim() ? message.label.trim() : null;
          if (label) {
            const workspaceName = typeof message.workspace === 'string' && message.workspace.trim() ? message.workspace.trim() : 'Orkestrai';
            ptySessionManager.attach(
              session.id,
              () => {},
              (exitCode) => {
                if (exitCode !== 0) {
                  console.log(`[orkestrai:notify] [${workspaceName}] ${label} encerrou com erro (código ${exitCode}).`);
                }
              }
            );
          }

          // Rastreia o session-id REAL da CLI para resume exato futuro.
          const provider = typeof message.provider === 'string' && message.provider.trim() ? message.provider : null;
          if (provider) {
            const reportAgentSession = (agentSessionId: string) => {
              tracker.bind(session.id, agentSessionId);
              // Broadcast global: o socket criador pode já ter sido fechado
              // (o no remonta em modo attach ao receber o sessionId).
              wsGlobal.__orkestraiBroadcast?.({
                type: 'agentSession',
                workspaceId: typeof message.workspaceId === 'string' ? message.workspaceId : null,
                sessionId: session.id,
                agentSessionId,
                provider,
              });
              send({ type: 'agentSession', sessionId: session.id, agentSessionId, provider });
            };
            const trackingCwd = wslContext?.linuxWorkingDir ?? session.cwd;
            if (freshSessionId) {
              const watchingExpected = tracker.watchExpected(
                session.id,
                message.sessionStorage,
                trackingCwd,
                freshSessionId,
                reportAgentSession
              );
              // So Claude reserva um id antes de criar a conversa. Providers
              // sem validacao exata mantem o contrato anterior.
              if (!watchingExpected) reportAgentSession(freshSessionId);
            } else {
              tracker.watch(session.id, message.sessionStorage, trackingCwd, trackingStartedAt, reportAgentSession);
            }
          }
          break;
        }
        case 'attach': {
          const info = ptySessionManager.get(message.sessionId);
          if (!info) {
            send({
              type: 'error',
              code: 'PTY_SESSION_NOT_FOUND',
              sessionId: message.sessionId,
              message: `Sessão PTY não encontrada: ${message.sessionId}`,
            });
            break;
          }
          if (message.cols !== undefined || message.rows !== undefined) {
            const cols = Math.max(2, Math.min(500, Number(message.cols) || info.cols));
            const rows = Math.max(2, Math.min(200, Number(message.rows) || info.rows));
            ptySessionManager.resize(message.sessionId, cols, rows);
          }
          const scrollback = attachSession(message.sessionId);
          send({ type: 'attached', session: ptySessionManager.get(message.sessionId), scrollback });
          break;
        }
        case 'input': {
          ptySessionManager.writeHumanInput(message.sessionId, String(message.data ?? ''));
          break;
        }
        case 'resize': {
          const cols = Math.max(2, Math.min(500, Number(message.cols) || 80));
          const rows = Math.max(2, Math.min(200, Number(message.rows) || 24));
          ptySessionManager.resize(message.sessionId, cols, rows);
          break;
        }
        case 'kill': {
          const killed = ptySessionManager.kill(message.sessionId);
          (sessionTrackers.get(message.sessionId) ?? agentSessionTracker).forget(message.sessionId);
          sessionTrackers.delete(message.sessionId);
          detachers.get(message.sessionId)?.();
          detachers.delete(message.sessionId);
          send({ type: 'killed', sessionId: message.sessionId, killed });
          break;
        }
        case 'list': {
          send({ type: 'list', sessions: ptySessionManager.list() });
          break;
        }
        default:
          send({ type: 'error', message: `Tipo de mensagem desconhecido: ${(message as { type?: string }).type}` });
      }
    } catch (error) {
      send({
        type: 'error',
        ...(error instanceof WslLaunchError ? { code: error.code } : {}),
        message: error instanceof Error ? error.message : 'Erro na sessão PTY.',
      });
    }
  });

  socket.on('close', () => {
    for (const detach of detachers.values()) detach();
    detachers.clear();
  });

}
