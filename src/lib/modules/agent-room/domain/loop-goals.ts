/** Terminal output as plain text: no escape sequences, no carriage-return redraws. */
export function plainTerminalText(raw: string): string {
  return raw
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b\][^\u0007\u001b]*(\u0007|\u001b\\)/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b[@-Z\\-_]/g, '')
    .replace(/\r(?!\n)/g, '\n');
}

function normalize(text: string): string {
  return text.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * A loop's goal is met when the agent writes the goal text in its own output.
 * Echoes of the loop's prompt (which may contain the goal) do not count.
 */
export function loopGoalReached(outputTail: string, goal: string, prompt: string | null | undefined): boolean {
  const target = normalize(goal);
  if (!target) return false;
  let haystack = normalize(plainTerminalText(outputTail));
  const echo = normalize(prompt ?? '');
  if (echo) haystack = haystack.split(echo).join(' ');
  return haystack.includes(target);
}

/** Where the watched text last appears, so one occurrence fires the loop once. */
export function outputMatchKey(outputTail: string, needle: string): string | null {
  const text = normalize(plainTerminalText(outputTail));
  const target = normalize(needle);
  if (!target) return null;
  const index = text.lastIndexOf(target);
  if (index < 0) return null;
  return text.slice(Math.max(0, index - 160), index + target.length + 40);
}
