/** One chunk of terminal input and whether it pasted an image the app saw on the clipboard. */
export type TerminalInput = { data: string; imagePaste: boolean };

const MAX_BUFFERED_CHARS = 16_384;

/**
 * Input typed while a terminal is opening or reconnecting, replayed in order
 * once it attaches. Each chunk keeps its image-paste mark, which tells the
 * server that a Ctrl+V left a draft the inbox must not type over. The oldest
 * chunks give way first once their text exceeds the bound.
 */
export class TerminalInputBuffer {
  private entries: TerminalInput[] = [];

  push(data: string, imagePaste = false): void {
    this.entries.push({ data, imagePaste });
    let total = this.entries.reduce((sum, entry) => sum + entry.data.length, 0);
    while (total > MAX_BUFFERED_CHARS && this.entries.length) total -= this.entries.shift()!.data.length;
  }

  drain(): TerminalInput[] {
    return this.entries.splice(0);
  }
}

/** The socket frame for one chunk; only a real image paste carries the mark. */
export function terminalInputFrame(sessionId: string, input: TerminalInput): Record<string, unknown> {
  return { type: 'input', sessionId, data: input.data, ...(input.imagePaste ? { imagePaste: true } : {}) };
}
