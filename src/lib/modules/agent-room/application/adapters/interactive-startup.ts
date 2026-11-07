import { stripVTControlCharacters } from 'node:util';

/** ConPTY can consume DECSET 2004 instead of forwarding it to the host. Codex
 * explicitly accepts bracketed paste, including when that output is missing. */
export function frameAutomaticPaste(provider: string | null | undefined, enabled: boolean, conpty: boolean, text: string): string {
  return enabled || (provider === 'codex' && conpty) ? `\x1b[200~${text}\x1b[201~` : text;
}

/** Inspect only output produced for this delivery. A badge in historical output
 * is not proof of a pending composer. Counts are Unicode scalars, as in Codex. */
export function hasOwnedCodexPaste(output: string, text: string, extraEnters = 0): boolean {
  let fresh = output.slice(-32_768);
  const clear = [...fresh.matchAll(/\x1b\[[23]J/g)].at(-1);
  if (clear) fresh = fresh.slice(clear.index! + clear[0].length);
  const tail = stripVTControlCharacters(fresh
    .replace(/\x1b\[[\d;]*[BHEFfd]/g, '\n').replace(/\x1b\[\d*[CG]/g, ' '));
  const prompt = tail.lastIndexOf('›');
  const composer = prompt >= 0 ? tail.slice(prompt) : tail;
  // The real TUI also paints just the badge at an absolute cursor position,
  // leaving the existing › untouched. Require that fresh badge to be the final
  // visible content; unknown text/dialogs or subsequent clears refuse recovery.
  const badge = /(?:^›[\s\u00a0]*|(?:^|\n)[\t ]*)\[Pasted Content (\d+) chars\](?: #\d+)?\s*$/.exec(composer);
  // More than one block or non-whitespace composer text may belong to a human.
  const length = Array.from(text.replace(/\r\n?/g, '\n')).length;
  if (!badge || Number(badge[1]) < length || Number(badge[1]) > length + extraEnters) return false;
  const rawBadgeAt = fresh.lastIndexOf('[Pasted Content ');
  return rawBadgeAt >= 0 && !/\x1b\[[\d;]*[JK]/.test(fresh.slice(rawBadgeAt));
}

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

export function hasPendingAutomaticPaste(provider: string | null | undefined, output: string, text: string, startup: InteractiveStartupGuard | null, extraEnters = 0): boolean {
  return provider === 'codex' ? hasOwnedCodexPaste(output, text, extraEnters) : startup?.hasPendingPaste(output) ?? false;
}

/** Codex emits OSC 7501 independently of repaint noise. This is readiness
 * evidence, never a receipt or permission to replay an uncertain prompt. */
export function nativeComposerState(provider: string | null | undefined, output: string): 'idle' | 'working' | undefined {
  if (provider !== 'codex') return undefined;
  let state: 'idle' | 'working' | undefined;
  for (const match of output.matchAll(/\x1b\]7501;state=([a-z_-]+)(?::app=(codex)(?::kind=(?:permission|question|auth))?)?(?:\x07|\x1b\\)/g)) {
    if (!match[2] && match[1] !== 'clear') continue;
    // Upstream reports Done/Error as idle as well. Done may persist while the
    // terminal is unfocused; treating it as working deadlocks the next prompt.
    state = ['idle', 'done', 'error'].includes(match[1]) ? 'idle' : 'working';
  }
  return state;
}

export function expectsPasteEcho(provider: string | null | undefined, text: string, conpty: boolean): boolean {
  return provider === 'codex' && conpty && Array.from(text).length > 1000;
}
