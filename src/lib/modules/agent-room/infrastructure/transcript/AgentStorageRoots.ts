import { resolve, posix } from 'node:path';

/** Provider storage paths only. Never include authentication values here. */
export type AgentStorageRoots = { claudeConfigDir?: string; codexHome?: string };

export function agentStorageRoots(
  env: Record<string, string | undefined>,
  cwd: string,
  toHost: ((path: string) => string) | null = null,
): AgentStorageRoots {
  const pathFor = (value: string | undefined) => {
    if (!value) return undefined;
    return toHost ? toHost(posix.resolve(cwd, value)) : resolve(cwd, value);
  };
  return {
    ...(env.CLAUDE_CONFIG_DIR ? { claudeConfigDir: pathFor(env.CLAUDE_CONFIG_DIR) } : {}),
    ...(env.CODEX_HOME ? { codexHome: pathFor(env.CODEX_HOME) } : {}),
  };
}
