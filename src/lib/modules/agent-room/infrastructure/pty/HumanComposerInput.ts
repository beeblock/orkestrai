/** Incremental input filter: terminal replies are not unsent human text. */
export class HumanComposerInput {
  private state: 'text' | 'escape' | 'intermediate' | 'csi' | 'osc' | 'oscEscape' = 'text';
  private controlLength = 0;

  consume(data: string, onText: (char: string) => void): boolean {
    let submitted = false;
    const text = (char: string) => {
      if (char === '\r' || char === '\n') submitted = true;
      onText(char);
    };
    for (const char of data) {
      const code = char.charCodeAt(0);
      // Bound malformed, unterminated controls without retaining their payload.
      // On overflow prefer protecting possible human text over suppressing it.
      if (this.state !== 'text' && ++this.controlLength > 4_096) this.state = 'text';
      if (this.state === 'osc' || this.state === 'oscEscape') {
        if (code === 0x07 || code === 0x9c || (this.state === 'oscEscape' && char === '\\')) {
          this.state = 'text';
        } else this.state = code === 0x1b ? 'oscEscape' : 'osc';
        continue;
      }
      if (code === 0x1b) {
        this.state = 'escape';
        this.controlLength = 0;
        continue;
      }
      if (this.state === 'escape') {
        this.state = char === '[' || char === 'O' ? 'csi'
          : char === ']' ? 'osc'
          : code >= 0x20 && code <= 0x2f ? 'intermediate' : 'text';
        // Escape may be a standalone key followed by ordinary typing. Never
        // discard that typing (or Ctrl+C/Ctrl+U) as an unknown terminal reply.
        if (this.state === 'text') text(char);
        continue;
      }
      if (this.state === 'csi' || this.state === 'intermediate') {
        if (code >= (this.state === 'intermediate' ? 0x30 : 0x40) && code <= 0x7e) this.state = 'text';
        else if (code < 0x20 || code > 0x7e) {
          this.state = 'text';
          text(char);
        }
        continue;
      }
      if (code === 0x9b || code === 0x9d) {
        this.state = code === 0x9b ? 'csi' : 'osc';
        this.controlLength = 0;
      } else text(char);
    }
    return submitted;
  }
}
