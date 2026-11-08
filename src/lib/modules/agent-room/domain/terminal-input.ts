/** xterm emits keys and terminal replies on the same onData channel. */
export type TerminalInputSource = 'keyboard' | 'terminal';

const reports = String.raw`\x1b\[[IO]|\x1b\[[?>]?[\d;:]+c|\x1b\[<\d{1,5};\d{1,5};\d{1,5}[Mm]|\x1b\[M[\x20-\uffff]{3}|\x1b\[\d{1,5};\d{1,5};\d{1,5}M|\x1b\](?:10|11|12);rgba?:[a-fA-F\d/]+(?:\x07|\x1b\\)`;
const reportsOnly = new RegExp(`^(?:${reports})+$`);
const reportsWithCursor = new RegExp(String.raw`^(?:\x1b\[\??\d{1,5};\d{1,5}R|${reports})+$`);

/** Strict, complete non-editing reports only; never trust a source label for text. */
export function isTerminalReport(data: string, cursorReply = false): boolean {
  if (!data || data.length > 4096) return false;
  return (cursorReply ? reportsWithCursor : reportsOnly).test(data);
}
