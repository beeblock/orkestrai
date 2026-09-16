import { runInNewContext } from 'node:vm';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { MAC_CLICK_SCRIPT, MAC_TYPE_SCRIPT } from '$lib/modules/agent-room/application/adapters/computers/MacComputerAdapter.js';

function nativeInput(granted = true, input: string | null = '') {
  const posted: any[] = [];
  const delays: number[] = [];
  const $ = Object.assign((text: string) => ({ dataUsingEncoding: () => ({ bytes: text }) }), {
    NSFileHandle: { fileHandleWithStandardInput: { readDataToEndOfFile: input } },
    NSString: { alloc: { initWithDataEncoding: (text: string | null) => ({ isNil: () => text === null, js: text }) } },
    CGPreflightPostEventAccess: () => granted,
    CGEventCreateKeyboardEvent: (_source: unknown, key: number, down: boolean) => ({ key, down }),
    CGEventKeyboardSetUnicodeString: (event: any, units: number, text: string) => { event.text = text; event.units = units; },
    CGEventSetFlags: (event: any, flags: number) => { event.flags = flags; },
    CGEventPost: (_tap: unknown, event: any) => posted.push(structuredClone(event)),
    CGPointMake: (x: number, y: number) => ({ x, y }),
    CGEventCreateMouseEvent: (_source: unknown, type: string, position: unknown, button: string) => ({ type, position, button }),
    CGEventSetIntegerValueField: (event: any, _field: unknown, count: number) => { event.count = count; },
    kCGEventLeftMouseDown: 'down', kCGEventLeftMouseUp: 'up', kCGMouseButtonLeft: 'left',
  });
  const context = { $, ObjC: { import() {}, bindFunction() {} }, delay: (seconds: number) => delays.push(seconds) };
  return { context, posted, delays };
}

describe('macOS native input', () => {
  it('delivers the complete stdin payload in one invocation with millisecond pacing', () => {
    const value = 'Ol\u00e1 aqui \u00e9 o orkestrai; a\u00e7\u00e3o \ud83d\ude80';
    const host = nativeInput(true, value);
    runInNewContext(`${MAC_TYPE_SCRIPT}; run()`, host.context);
    expect(host.posted.filter((event) => event.down).map((event) => event.text).join('')).toBe(value);
    expect(host.posted.filter((event) => !event.down).map((event) => event.text).join('')).toBe(value);
    expect(host.delays.reduce((total, delay) => total + delay, 0)).toBeLessThan(0.01);
  });

  it('rejects missing permission, malformed encoding and oversized text before posting input', () => {
    for (const [permission, value, error] of [
      [false, 'private', 'Accessibility permission'],
      [true, null, 'Invalid native text encoding'],
      [true, 'x'.repeat(20001), 'safe limit'],
    ] as const) {
      const host = nativeInput(permission, value);
      expect(() => runInNewContext(`${MAC_TYPE_SCRIPT}; run()`, host.context)).toThrow(error);
      expect(host.posted).toEqual([]);
    }
  });

  it('builds Unicode text events without keyboard-layout substitution or clipboard access', () => {
    const host = nativeInput();
    const value = 'Ol\u00e1 aqui \u00e9 o orkestrai; a\u00e7\u00e3o, coraz\u00f3n, \u65e5\u672c\u8a9e, \ud83d\ude80';
    const chunks = runInNewContext(`${MAC_TYPE_SCRIPT}; unicodeChunks(${JSON.stringify(value)}).map(chunk => unicodeEvents(chunk))`, host.context);
    expect(chunks.flat().filter((event: any) => event.down).map((event: any) => event.text).join('')).toBe(value);
    expect(chunks.flat().every((event: any) => event.flags === 0 && event.units === event.text.length && event.units <= 20)).toBe(true);
    expect(host.posted).toEqual([]);
    expect(MAC_TYPE_SCRIPT).not.toMatch(/pasteboard|clipboard|keystroke\(/i);
    expect(MAC_TYPE_SCRIPT).toContain('fileHandleWithStandardInput');
  });

  it('does not split a surrogate pair at the native event size boundary', () => {
    const host = nativeInput();
    const value = 'x'.repeat(19) + '\ud83d\ude80' + 'e\u0301'.repeat(50);
    const chunks = runInNewContext(`${MAC_TYPE_SCRIPT}; unicodeChunks(${JSON.stringify(value)})`, host.context) as string[];
    expect(chunks[0]).toHaveLength(19);
    expect(chunks[1].startsWith('\ud83d\ude80')).toBe(true);
    expect(chunks.join('')).toBe(value);
    expect(chunks.every((chunk) => !/[\ud800-\udbff]$/.test(chunk))).toBe(true);
  });

  it('posts real, paired mouse events with correct click counts and coordinates', () => {
    const host = nativeInput();
    runInNewContext(`${MAC_CLICK_SCRIPT}; run(['-150','420','2'])`, host.context);
    expect(host.posted).toEqual([
      { type: 'down', position: { x: -150, y: 420 }, button: 'left', flags: 0, count: 1 },
      { type: 'up', position: { x: -150, y: 420 }, button: 'left', flags: 0, count: 1 },
      { type: 'down', position: { x: -150, y: 420 }, button: 'left', flags: 0, count: 2 },
      { type: 'up', position: { x: -150, y: 420 }, button: 'left', flags: 0, count: 2 },
    ]);
  });

  it('never posts input when OS permission is absent or coordinates are invalid', () => {
    const host = nativeInput(false);
    expect(() => runInNewContext(`${MAC_CLICK_SCRIPT}; run(['1','2','1'])`, host.context)).toThrow('Accessibility permission');
    expect(host.posted).toEqual([]);
    for (const args of [['NaN', '0', '1'], ['0', 'Infinity', '1'], ['0', '0', '4'], ['0', '0', '1.5']]) {
      expect(() => runInNewContext(`${MAC_CLICK_SCRIPT}; run(${JSON.stringify(args)})`, host.context)).toThrow('Invalid mouse input');
    }
    expect(host.posted).toEqual([]);
  });

  it.skipIf(process.platform !== 'darwin')('round-trips real CoreGraphics UTF-16 event payloads without posting any input', () => {
    const value = 'Ol\u00e1 aqui \u00e9 o orkestrai; a\u00e7\u00e3o \ud83d\ude80 \u65e5\u672c\u8a9e\n'.repeat(3);
    const script = `${MAC_TYPE_SCRIPT}
      ObjC.bindFunction('CGEventKeyboardGetUnicodeString',['void',['void *','unsigned long','void *','void *']]);
      function run() {
        return JSON.stringify(unicodeChunks(${JSON.stringify(value)}).map(chunk => {
          const event = unicodeEvents(chunk)[0];
          const out = $.NSMutableData.dataWithLength(chunk.length * 2), count = Ref('unsigned long');
          $.CGEventKeyboardGetUnicodeString(event,chunk.length,count,out.mutableBytes);
          return { text: $.NSString.alloc.initWithDataEncoding(out,$.NSUTF16LittleEndianStringEncoding).js, units: Number(count[0]) };
        }));
      }`;
    const result = JSON.parse(execFileSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script], { encoding: 'utf8', timeout: 10_000 }));
    expect(result.map((chunk: { text: string }) => chunk.text).join('')).toBe(value);
    expect(result.every((chunk: { units: number }) => chunk.units <= 20)).toBe(true);
  });
});
