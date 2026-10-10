import { describe, expect, it } from 'vitest';
import { HumanComposerInput } from '$lib/modules/agent-room/infrastructure/pty/HumanComposerInput.js';

describe('incremental human composer input', () => {
  it.each(['\x1b[1;1R', '\x1b[I', '\x1b[<0;10;20M', '\x1b]10;rgb:ffff/ffff/ffff\x1b\\', '\x1b]11;color\x07', '\x1bOA'])(
    'ignores %j at every chunk boundary without discarding adjacent human text', control => {
      for (let split = 1; split < control.length; split++) {
        const parser = new HumanComposerInput();
        let visible = '';
        const append = (char: string) => { visible += char; };
        parser.consume(`draft${control.slice(0, split)}`, append);
        parser.consume(`${control.slice(split)} suffix`, append);
        expect(visible).toBe('draft suffix');
      }
    },
  );

  it('counts pasted human content, editing and submission, but not paste wrappers', () => {
    const parser = new HumanComposerInput();
    let visible = '';
    let submitted = false;
    for (const char of '\x1b[200~human\x1b[201~\x7f\x15\r') {
      submitted = parser.consume(char, char => { visible += char; }) || submitted;
    }
    expect(visible).toBe('human\x7f\x15\r');
    expect(submitted).toBe(true);
  });

  it('does not interpret a newline inside an OSC response as human submission', () => {
    const parser = new HumanComposerInput();
    const chars: string[] = [];
    expect(parser.consume('\x1b]value\n', char => chars.push(char))).toBe(false);
    expect(parser.consume('\x07draft', char => chars.push(char))).toBe(false);
    expect(chars.join('')).toBe('draft');
  });

  it('protects ordinary typing and cancellation after a standalone Escape key', () => {
    const parser = new HumanComposerInput();
    let visible = '';
    const append = (char: string) => { visible += char; };
    parser.consume('\x1b', append);
    parser.consume('draft', append);
    parser.consume('\x1b', append);
    parser.consume('\x15', append);
    expect(visible).toBe('draft\x15');
  });

  it('bounds unterminated controls and conservatively protects text after overflow', () => {
    const parser = new HumanComposerInput();
    const chars: string[] = [];
    parser.consume(`\x1b]${'x'.repeat(5_000)}human draft`, char => chars.push(char));
    expect(chars.length).toBeGreaterThan(0);
    expect(chars.join('')).toContain('human draft');
  });
});
