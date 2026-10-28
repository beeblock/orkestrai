import { stripVTControlCharacters } from 'node:util';

/** Bootstrap dialogs are not agent composers, even when their output is idle. */
export class InteractiveStartupGuard {
  private output = '';
  private ready = false;
  private blocked = false;
  private humanSubmitted = false;

  get canAcceptMessages(): boolean { return this.ready; }

  /** A paste in the current composer, rather than an older rendered message. */
  hasPendingPaste(output: string): boolean {
    let tail = output.slice(-32_768);
    const clear = [...tail.matchAll(/\x1b\[[23]J/g)].at(-1);
    if (clear) tail = tail.slice(clear.index! + clear[0].length);
    const text = stripVTControlCharacters(tail);
    const prompt = text.lastIndexOf('\u276f');
    return prompt >= 0 && /^\u276f[\s\u00a0]*\[Pasted\s*text\s*#\d+\]/i.test(text.slice(prompt));
  }

  observe(data: string): void {
    if (this.ready) return;
    this.output = (this.output + data).slice(-32_768);
    // Keep partial ANSI sequences between chunks; a full redraw discards old text.
    const clears = [...this.output.matchAll(/\x1b\[[23]J/g)];
    const lastClear = clears.at(-1);
    if (lastClear) this.output = this.output.slice(lastClear.index! + lastClear[0].length);
    // Full-screen Claude paints words at absolute columns instead of emitting
    // spaces. Stripping CSI alone turns "bypass permissions on" into one word.
    const text = stripVTControlCharacters(this.output
      .replace(/\x1b\[[\d;]*[BHEFfd]/g, '\n')
      .replace(/\x1b\[\d*[CG]/g, ' '));
    if (/Quick safety check:|Do you trust (?:the files in|this) (?:folder|directory)|Yes, I trust this folder|No, exit/i.test(text)) {
      this.blocked = true;
      return;
    }
    // Only a human decision followed by the real composer can release the gate.
    const composerVisible = /\?\s*for shortcuts|bypass permissions on|shift\+tab to cycle/i.test(text)
      || /^[\t ]*\u276f[\t ]*\r?$/m.test(text);
    if ((!this.blocked || this.humanSubmitted) && composerVisible) {
      this.blocked = false;
      this.ready = true;
      this.output = '';
    }
  }

  humanInput(data: string): void {
    if (!this.blocked || !/[\r\n]/.test(data)) return;
    this.humanSubmitted = true;
    this.output = '';
  }
}

export function interactiveStartupGuard(provider: string | null | undefined): InteractiveStartupGuard | null {
  return provider === 'claude' ? new InteractiveStartupGuard() : null;
}
