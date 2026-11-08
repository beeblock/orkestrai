/** One chunk of terminal input and whether it pasted an image the app saw on the clipboard. */
import type { TerminalInputSource } from '$lib/modules/agent-room/domain/terminal-input.js';

export type TerminalInput = { data: string; imagePaste: boolean; source?: TerminalInputSource };

/** onKey fires immediately before onData for real keys, including modified F3
 * (whose bytes can otherwise look exactly like a cursor-position reply). */
export class TerminalInputProvenance {
  private key: string | undefined;
  noteKey(key: string): void { this.key = key; }
  consume(data: string): TerminalInputSource {
    const source = this.key === data ? 'keyboard' : 'terminal';
    this.key = undefined;
    return source;
  }
}

export function bindTerminalInput(terminal: {
  onKey(listener: (event: { key: string }) => void): { dispose(): void };
  onData(listener: (data: string) => void): { dispose(): void };
}, forward: (data: string, source: TerminalInputSource) => void): () => void {
  const provenance = new TerminalInputProvenance();
  const keys = terminal.onKey(({ key }) => provenance.noteKey(key));
  const input = terminal.onData(data => forward(data, provenance.consume(data)));
  return () => { keys.dispose(); input.dispose(); };
}

const MAX_BUFFERED_CHARS = 16_384;

/**
 * Input typed while a terminal is opening or reconnecting, replayed in order
 * once it attaches. Each chunk keeps its image-paste mark, which tells the
 * server that a Ctrl+V left a draft the inbox must not type over. The oldest
 * chunks give way first once their text exceeds the bound.
 */
export class TerminalInputBuffer {
  private entries: TerminalInput[] = [];

  push(data: string, imagePaste = false, source?: TerminalInputSource): void {
    this.entries.push({ data, imagePaste, ...(source ? { source } : {}) });
    let total = this.entries.reduce((sum, entry) => sum + entry.data.length, 0);
    while (total > MAX_BUFFERED_CHARS && this.entries.length) total -= this.entries.shift()!.data.length;
  }

  drain(): TerminalInput[] {
    return this.entries.splice(0);
  }
}

/** The socket frame for one chunk; only a real image paste carries the mark. */
export function terminalInputFrame(sessionId: string, input: TerminalInput): Record<string, unknown> {
  return { type: 'input', sessionId, data: input.data, ...(input.imagePaste ? { imagePaste: true } : {}), ...(input.source ? { source: input.source } : {}) };
}
