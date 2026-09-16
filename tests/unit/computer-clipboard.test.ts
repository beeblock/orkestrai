import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
const { createComputerClipboard } = createRequire(import.meta.url)('../../electron/computer-clipboard.cjs');

function fixture() {
  let contents: Record<string, string> = { 'text/plain': 'Original', 'text/html': '<b>Original</b>' };
  const clipboard = {
    availableFormats: () => Object.keys(contents), readBuffer: (format: string) => Buffer.from(contents[format] ?? ''),
    readText: () => contents['text/plain'] ?? '', readHTML: () => contents['text/html'] ?? '', readRTF: () => contents['text/rtf'] ?? '',
    readImage: () => ({ isEmpty: () => true }),
    writeText: vi.fn((text: string) => { contents = { 'text/plain': text }; }),
    write: vi.fn((data: { text: string; html: string }) => { contents = { 'text/plain': data.text, 'text/html': data.html }; }),
    clear: vi.fn(() => { contents = {}; }),
  };
  return { clipboard, useText: createComputerClipboard(clipboard), set: (next: Record<string, string>) => { contents = next; } };
}

describe('Temporary native text clipboard', () => {
  it('restores rich text after a confirmed paste and after a failure', async () => {
    const f = fixture();
    expect(await f.useText('Complete reply\nNext line', async () => {
      expect(f.clipboard.readText()).toBe('Complete reply\nNext line');
      expect(f.clipboard.readHTML()).toBe('');
      return 'verified';
    })).toEqual({ used: true, result: 'verified' });
    expect(f.clipboard.readHTML()).toBe('<b>Original</b>');
    await expect(f.useText('Reply', async () => { throw new Error('uncertain'); })).rejects.toThrow('uncertain');
    expect(f.clipboard.readText()).toBe('Original');
  });
  it('preserves new user clipboard contents instead of overwriting them during restoration', async () => {
    const f = fixture();
    await f.useText('Reply', async () => { f.clipboard.writeText('New human copy'); });
    expect(f.clipboard.readText()).toBe('New human copy');
    expect(f.clipboard.write).not.toHaveBeenCalled();
  });
  it('does not discard unknown, file-promise or oversized clipboard formats', async () => {
    const f = fixture(), deliver = vi.fn();
    f.set({ 'com.editor.private-format': 'Important private metadata' });
    expect(await f.useText('Reply', deliver)).toEqual({ used: false });
    f.set({ 'text/plain': 'x'.repeat(17 * 1024 * 1024) });
    expect(await f.useText('Reply', deliver)).toEqual({ used: false });
    expect(deliver).not.toHaveBeenCalled();
    expect(f.clipboard.writeText).not.toHaveBeenCalled();
  });
  it('does not overlap clipboard ownership and restores an originally empty clipboard', async () => {
    const f = fixture(); f.set({});
    await f.useText('Reply', async () => {
      expect(await f.useText('Other reply', vi.fn())).toEqual({ used: false });
    });
    expect(f.clipboard.availableFormats()).toEqual([]);
    expect(f.clipboard.clear).toHaveBeenCalledOnce();
  });
});
