import { parse } from 'smol-toml';
import { realpathSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import type { WorkspaceExecutionRuntime } from '../domain/types.js';

export type CodexMcpLaunch = {
  command: string;
  args: string[];
  electronRuntime: boolean;
};

export const FIGMA_MCP_URL = 'https://mcp.figma.com/mcp';

type SectionRange = { bodyStart: number; bodyEnd: number };

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sectionRange(source: string, name: string): SectionRange | null {
  const header = new RegExp(`^\\[${escapeRegExp(name)}\\][ \\t]*\\r?$`, 'm').exec(source);
  if (!header) return null;
  const lineEnd = source.indexOf('\n', header.index + header[0].length);
  const bodyStart = lineEnd === -1 ? source.length : lineEnd + 1;
  const nextHeader = /^\[\[?[^\]\r\n]+\]\]?[ \t]*\r?$/gm;
  nextHeader.lastIndex = bodyStart;
  const next = nextHeader.exec(source);
  return { bodyStart, bodyEnd: next?.index ?? source.length };
}

/**
 * Repairs only the orphaned array tail and duplicate inline env emitted by
 * Orkestrai <= 0.20.0. Unrelated malformed TOML is rejected and never changed.
 */
export function repairLegacyCodexMcpConfig(current: string): { content: string; repaired: boolean } {
  try {
    parse(current);
    return { content: current, repaired: false };
  } catch {
    // Continue only with the exact legacy corruption signature below.
  }

  const range = sectionRange(current, 'mcp_servers.orkestrai');
  if (!range) return { content: current, repaired: false };
  const body = current.slice(range.bodyStart, range.bodyEnd);
  const orphanedArgs = /^[ \t]*((?:"(?:[^"\\]|\\.)*"|'[^']*'))[ \t]*,[ \t]*\r?\n[ \t]*["']mcp["'][ \t]*,?[ \t]*\r?\n[ \t]*\][ \t]*\r?$/gm;
  let matchedOwnedTail = false;
  const repairedBody = body.replace(orphanedArgs, (whole, encodedPath: string) => {
    let path = encodedPath.slice(1, -1);
    if (encodedPath.startsWith('"')) {
      try {
        path = JSON.parse(encodedPath) as string;
      } catch {
        return whole;
      }
    }
    if (!/orkestrai(?:\.js)?$/i.test(path.replace(/\\\\/g, '/'))) return whole;
    matchedOwnedTail = true;
    return '';
  });
  if (!matchedOwnedTail) return { content: current, repaired: false };

  let candidate = `${current.slice(0, range.bodyStart)}${repairedBody}${current.slice(range.bodyEnd)}`;
  if (sectionRange(candidate, 'mcp_servers.orkestrai.env')) {
    const main = sectionRange(candidate, 'mcp_servers.orkestrai');
    if (main) {
      const mainBody = candidate.slice(main.bodyStart, main.bodyEnd);
      const cleaned = mainBody.replace(
        /^[ \t]*env[ \t]*=[ \t]*\{[ \t]*ELECTRON_RUN_AS_NODE[ \t]*=[ \t]*["']1["'][ \t]*\}[ \t]*\r?$/gm,
        '',
      );
      candidate = `${candidate.slice(0, main.bodyStart)}${cleaned}${candidate.slice(main.bodyEnd)}`;
    }
  }

  try {
    parse(candidate);
    return { content: candidate, repaired: true };
  } catch {
    return { content: current, repaired: false };
  }
}

/** Builds ephemeral Codex config overrides, keeping user dotfiles untouched. */
export function codexMcpOverrideArgs(launch: CodexMcpLaunch): string[] {
  const args = launch.args.map((value) => JSON.stringify(value)).join(', ');
  return [
    '-c', `mcp_servers.orkestrai.command=${JSON.stringify(launch.command)}`,
    '-c', `mcp_servers.orkestrai.args=[${args}]`,
    ...(launch.electronRuntime
      ? ['-c', 'mcp_servers.orkestrai.env={ ELECTRON_RUN_AS_NODE = "1" }']
      : []),
    '-c', `mcp_servers.figma.url=${JSON.stringify(FIGMA_MCP_URL)}`,
  ];
}

/**
 * Codex asks for project trust before its composer becomes available. An
 * automatic task sent to that screen would select an option instead of
 * reaching the agent. Orkestrai only suppresses that bootstrap prompt when
 * the same launch already opted into Codex's full-access mode, and the trust
 * applies to this process and exact working directory only.
 */
export function codexWorkspaceTrustOverrideArgs(workingDirectory: string, fullAccess: boolean): string[] {
  if (!fullAccess || !workingDirectory.trim()) return [];
  const requestedPath = workingDirectory.trim();
  let canonicalPath = requestedPath;
  try {
    // Codex evaluates trust against the physical cwd. On macOS, for example,
    // /tmp resolves to /private/tmp; trusting the logical alias does not match.
    canonicalPath = realpathSync(requestedPath);
  } catch {
    // WSL paths are not necessarily addressable from the Windows host. The
    // Linux path produced by preflight remains the correct process-local key.
  }
  const path = JSON.stringify(canonicalPath);
  return ['-c', `projects={${path}={trust_level="trusted"}}`];
}

/** Resolves an MCP launch in the same OS namespace where Codex will run. */
export function codexMcpLaunchForRuntime(
  runtime: WorkspaceExecutionRuntime,
  env: NodeJS.ProcessEnv = process.env,
  workingDirectory = process.cwd(),
): CodexMcpLaunch {
  if (runtime.kind === 'wsl') {
    return {
      command: posix.join(runtime.linuxWorkingDir, '.orkestrai', 'bin', 'orkestrai'),
      args: ['mcp'],
      electronRuntime: false,
    };
  }
  return {
    command: env.ORKESTRAI_CLI_RUNTIME ?? process.execPath,
    args: [
      env.ORKESTRAI_CLI_JS ?? resolve(workingDirectory, 'packages', 'orkestrai-cli', 'bin', 'orkestrai.js'),
      'mcp',
    ],
    electronRuntime: env.ORKESTRAI_CLI_RUNTIME_IS_ELECTRON === '1' || Boolean(process.versions.electron),
  };
}
