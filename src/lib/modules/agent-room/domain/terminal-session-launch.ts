export type SafeAgentRespawn = {
  args: string[];
  freshSessionArgs?: string[];
};

/**
 * A terminal may resume only a conversation that was previously attributed to
 * that exact canvas node. Provider shortcuts such as `resume --last` and
 * `--continue` are intentionally excluded because another agent can be the
 * most recent conversation in the same working directory.
 */
export function safeAgentRespawn(
  baseArgs: string[],
  agentSessionId: string | null,
  exactResumeArgsFor: ((agentSessionId: string) => string[] | null) | undefined,
  freshSessionArgs: string[] | null | undefined,
): SafeAgentRespawn {
  const exactResumeArgs = agentSessionId ? exactResumeArgsFor?.(agentSessionId) : null;
  if (exactResumeArgs?.length) {
    return { args: [...baseArgs, ...exactResumeArgs] };
  }

  return {
    args: [...baseArgs],
    ...(freshSessionArgs?.length ? { freshSessionArgs: [...freshSessionArgs] } : {}),
  };
}
