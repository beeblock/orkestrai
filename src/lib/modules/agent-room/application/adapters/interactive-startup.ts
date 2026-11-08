import { stripVTControlCharacters } from 'node:util';

/** ConPTY can consume DECSET 2004 instead of forwarding it to the host. Codex
 * explicitly accepts bracketed paste, including when that output is missing. */
export function frameAutomaticPaste(provider: string | null | undefined, enabled: boolean, conpty: boolean, text: string): string {
  return enabled || (provider === 'codex' && conpty) ? `\x1b[200~${text}\x1b[201~` : text;
}

/** Separate a cursor-proven footer repaint from the current composer. */
function withoutCodexFooter(output: string): string {
  const badge = [...output.matchAll(/\[Pasted Content \d+ chars\](?: #\d+)?/g)].at(-1);
  if (!badge) return output;
  const end = badge.index! + badge[0].length;
  const suffix = output.slice(end);
  const restored = [...suffix.matchAll(/\x1b\[(\d+);(\d+)[Hf]/g)].at(-1);
  if (!restored) return output;
  const composerRow = Number(restored[1]);
  const prefix = output.slice(0, badge.index);
  const painted = /\x1b\[(\d+);\d+[Hf](?:[\t ]|›|\x1b\[[\d;]*m|\x1b\[\d*C)*$/.exec(prefix);
  // ConPTY also paints a whole screen using CRLF instead of absolute row
  // moves. A fresh prompt on that line is separate from the following footer;
  // an explicitly positioned prompt must still match the cursor return row.
  const relativePrompt = /(?:^|\r?\n)(?:[\t ]|\x1b\[[\d;]*m)*›(?:[\t ]|\x1b\[[\d;]*m|\x1b\[\d*C)*$/.test(prefix);
  const locatedComposer = painted ? Number(painted[1]) === composerRow : relativePrompt;
  return trimCodexFooter(output, end, composerRow, locatedComposer, restored[0]);
}

function trimCodexFooter(output: string, end: number, composerRow: number, locatedComposer: boolean, restored: string): string {
  const suffix = output.slice(end);
  let row = composerRow, footer = false;
  for (const token of suffix.matchAll(/\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|[\s\S]/g)) {
    const value = token[0];
    if (value.startsWith('\x1b]')) continue;
    if (value.startsWith('\x1b[')) {
      const final = value.at(-1)!;
      const params = value.slice(2, -1);
      if (final === 'm' || (final === 'q' && /^[\d;]* $/.test(params))) continue;
      if ('Hf'.includes(final) && /^\d*;?\d*$/.test(params)) row = Number(params.split(';')[0]) || 1;
      else if ('ABEFd'.includes(final) && /^\d*$/.test(params)) {
        const n = Number(params) || 1;
        row = final === 'd' ? n : row + ('BE'.includes(final) ? n : -n);
      } else if ('CDG'.includes(final) && /^\d*$/.test(params)) continue;
      else if ('KX'.includes(final) && /^\d*$/.test(params) && row > composerRow) continue;
      else if ('hl'.includes(final) && /^\?(?:25|1000|1002|1003|1004|1006|1015|2004|2026)(?:;(?:25|1000|1002|1003|1004|1006|1015|2004|2026))*$/.test(params)) continue;
      else return output;
      footer ||= row > composerRow;
      continue;
    }
    if (value === '\n') { row++; footer ||= row > composerRow; }
    else if (value === '\r' || value === '\t' || value === ' ') continue;
    // Nonblank footer text needs an independently located, freshly painted
    // composer. A cursor return alone cannot prove an arbitrary dialog safe.
    else if (row <= composerRow || !locatedComposer || value.charCodeAt(0) < 0x20) return output;
  }
  return footer && row === composerRow ? output.slice(0, end) + restored : output;
}

/** EL/ECH immediately after a freshly painted badge only erase its blank right side. */
function withoutCodexBlankRight(output: string): string {
  const badge = [...output.matchAll(/\[Pasted Content \d+ chars\](?: #\d+)?/g)].at(-1);
  if (!badge || !/(?:›|\x1b\[\d+;\d+[Hf])(?:[\t ]|\x1b\[[\d;]*m|\x1b\[\d*C)*$/.test(output.slice(0, badge.index))) return output;
  const end = badge.index! + badge[0].length;
  const suffix = output.slice(end);
  const controls = /^(?:\x1b\[[\d;]*m|\x1b\[(?:0?K|\d{0,5}X))+/.exec(suffix)?.[0];
  if (!controls) return output;
  return output.slice(0, end) + controls.replace(/\x1b\[(?:0?K|\d{0,5}X)/g, '') + suffix.slice(controls.length);
}

/** ConPTY can split one write into literal typing followed by a paste burst.
 * Verify the painted literal suffix against the exact prefix implied by the
 * badge count. This still runs under the writer/revision/idle guards; it does
 * not authorize submission of an arbitrary smaller badge or changed draft. */
function hasSegmentedCodexPaste(output: string, text: string, extraEnters: number): boolean {
  const badges = [...output.matchAll(/\[Pasted Content (\d+)(?:[\t \r\n]|\x1b\[\d+;\d+[Hf]){1,100}chars\](?: #\d+)?/g)];
  const badge = badges.at(-1);
  if (!badge) return false;
  const after = output.slice(badge.index! + badge[0].length);
  const before = output.slice(0, badge.index);
  const painted = /\x1b\[(\d+);(\d+)[Hf]([^\x1b]*(?:\x1b\[[\d;]*m[^\x1b]*)*)$/.exec(before);
  const literal = painted ? stripVTControlCharacters(painted[3]).replace(/\s+/g, ' ').trim() : '';
  const flat = stripVTControlCharacters(before.replace(/\x1b\[\d*[CG]/g, ' '));
  const prompt = flat.lastIndexOf('›');
  const wholeLiteral = prompt >= 0 ? flat.slice(prompt + 1).replace(/\s/g, '') : '';
  const source = Array.from(text.replace(/\r\n?/g, '\n'));
  const count = Number(badge[1]);
  for (let added = 0; added <= extraEnters; added++) {
    const prefixLength = source.length + added - count;
    if (prefixLength <= 0 || prefixLength >= source.length) continue;
    const prefix = source.slice(0, prefixLength).join('').replace(/\s+/g, ' ').trim();
    // A whole painted row, not merely a coincidental final character.
    const rowMatches = literal.length >= Math.min(12, prefix.length)
      && !literal.includes('[Pasted Content') && !literal.includes('›') && prefix.endsWith(literal);
    const wholeMatches = wholeLiteral.length >= Math.min(12, prefix.replace(/\s/g, '').length)
      && wholeLiteral === prefix.replace(/\s/g, '');
    if (!rowMatches && !wholeMatches) continue;
    // Once the exact literal/count relationship is proved, use the same
    // cursor-return/footer verifier as a full badge. This also covers CRLF
    // full-screen redraws; arbitrary footer text or composer erases still fail.
    const restored = [...after.matchAll(/\x1b\[(\d+);\d+[Hf]/g)].at(-1);
    const located = `\x1b[${restored?.[1] ?? painted?.[1] ?? '1'};3H[Pasted Content ${count} chars]`;
    const suffix = withoutCodexFooter(withoutCodexBlankRight(located + after)).slice(located.length);
    if (/^(?:(?:\x1b\[\d+;\d+[Hf]|\x1b\[\?(?:25|2026)[hl]|\x1b\[[\d;]*m)|[\t \r\n])*$/.test(suffix)) return true;
  }
  return false;
}

/** Short Codex inputs are painted literally rather than as a paste badge.
 * Require a fresh prompt and the complete owned body, not a prompt glyph or
 * output activity alone. Ignore only presentation and visual wrapping. */
function hasOwnedCodexLiteral(output: string, text: string): boolean {
  const prompt = output.lastIndexOf('›');
  if (prompt < 0 || text.length > 4096) return false;
  let literal = output.slice(prompt + 1);
  const returned = [...literal.matchAll(/\x1b\[(\d+);(\d+)[Hf]/g)].at(-1);
  if (returned) {
    const bottom = Number(returned[1]);
    const footer = [...literal.matchAll(/\x1b\[(\d+);(\d+)[Hf]/g)].find(move => Number(move[1]) > bottom);
    if (footer) literal = trimCodexFooter(literal, footer.index!, bottom, true, returned[0]);
  }
  // Erases, inserts, deletes and unknown controls cannot prove an intact draft.
  literal = literal.replace(/\x1b\](?:0|7501);[^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[\d;]*m/g, '')
    .replace(/\x1b\[\d*;?\d*[Hf]|\x1b\[\d*[ABCDEFGd]/g, ' ')
    .replace(/\x1b\[\?(?:25|2026)[hl]/g, '');
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(literal)) return false;
  // Cursor-positioned painting can wrap even inside a message UUID. This is
  // visual evidence only: the transcript receipt still matches the full prompt.
  return literal.replace(/\s/g, '') === text.replace(/\s/g, '');
}

/** Inspect only output produced for this delivery. A badge in historical output
 * is not proof of a pending composer. Counts are Unicode scalars, as in Codex. */
export function hasOwnedCodexPaste(output: string, text: string, extraEnters = 0): boolean {
  let fresh = output.slice(-32_768);
  const clear = [...fresh.matchAll(/\x1b\[[23]J/g)].at(-1);
  if (clear) fresh = fresh.slice(clear.index! + clear[0].length);
  // DECSCUSR changes only cursor shape/blinking. Node's ANSI stripper leaves
  // its final " q" behind, falsely making the pending paste look edited.
  fresh = fresh.replace(/\x1b\[[0-6]? q/g, '');
  fresh = withoutCodexBlankRight(fresh);
  // ConPTY footer erases and model/path redraws are separate screen rows,
  // not edits to the paste. Keep clears, unknown controls and composer edits.
  fresh = withoutCodexFooter(fresh);
  if (!fresh.includes('[Pasted Content ') && hasOwnedCodexLiteral(fresh, text)) return true;
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
  if (!badge || Number(badge[1]) < length || Number(badge[1]) > length + extraEnters) return hasSegmentedCodexPaste(fresh, text, extraEnters);
  const rawBadgeAt = fresh.lastIndexOf('[Pasted Content ');
  return rawBadgeAt >= 0 && !/\x1b\[[\d;]*[JKX]/.test(fresh.slice(rawBadgeAt));
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

/** ConPTY hands Codex a paste as key events, and its paste-burst heuristic types
 * an Enter read within 120 ms of the burst as a newline. That window is timed when
 * the TUI reads each key, so a loaded machine reads the queued paste and Enter back
 * to back however long we waited before writing it. Any non-text key flushes the
 * burst and clears the window first; End only moves the cursor, which is already
 * at the end of the paste. Input order then decides, not read timing. */
export function automaticSubmitPrefix(provider: string | null | undefined, conpty: boolean): string {
  return provider === 'codex' && conpty ? '\x1b[F' : '';
}

export function expectsPasteEcho(provider: string | null | undefined, text: string, conpty: boolean): boolean {
  return provider === 'codex' && conpty && Array.from(text).length > 1000;
}
