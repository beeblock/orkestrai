import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { resolveCommand } from '../../infrastructure/agent-path.js';
import { buildWslLaunch } from '../../infrastructure/WslRuntime.js';
import type { StructuredAgentOptions } from './structured-types.js';

export function spawnStructuredAgent(command: string, args: string[], options: StructuredAgentOptions): ChildProcessWithoutNullStreams {
  const target = options.runtime.kind === 'wsl'
    ? buildWslLaunch({ runtime: options.runtime, command, args, hostCwd: options.hostCwd,
        resolvedGuestCwd: options.cwd, workspaceRoot: options.workspaceRoot, hostEnv: options.env,
        forwardEnvToWsl: Object.keys(options.env).filter(key => /^(ORKESTRAI_|CLAUDE_CONFIG_DIR$|CODEX_HOME$|ANTHROPIC_)/.test(key)) })
    : { ...resolveCommand(command, args, options.env), cwd: options.hostCwd, env: options.env };
  return spawn(target.command, target.args, { cwd: target.cwd, env: target.env,
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32' });
}

/** Only a process group created by spawnStructuredAgent is ever signalled. */
export function stopStructuredAgent(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  child.stdin.end();
  return new Promise((resolve, reject) => {
  const deadline = setTimeout(() => reject(new Error('STRUCTURED_PROCESS_EXIT_UNCONFIRMED')), 8_000);
  deadline.unref();
  child.once('exit', () => { clearTimeout(deadline); clearTimeout(timer); clearTimeout(force); resolve(); });
  const timer = setTimeout(() => {
    if (child.exitCode !== null || child.signalCode !== null || !child.pid || child.pid <= 1) return;
    if (process.platform === 'win32') {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      killer.on('error', () => { try { child.kill(); } catch { /* already gone */ } });
    } else {
      try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill(); } catch { /* already gone */ } }
    }
  }, 2_000);
  timer.unref();
  const force = setTimeout(() => {
    if (child.exitCode !== null || child.signalCode !== null || !child.pid || child.pid <= 1) return;
    try { if (process.platform === 'win32') child.kill('SIGKILL'); else process.kill(-child.pid, 'SIGKILL'); } catch { /* observe exit */ }
  }, 5_000);
  force.unref();
  });
}
