import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const { createAudioDecoder, decodeInRenderer } = require('../../electron/audio-decoder.cjs');

describe('Desktop audio decoding', () => {
  it('converts decoded samples into bounded canonical mono PCM without microphone, network or playback', async () => {
    const decode = vi.fn(async () => ({ duration: 1, numberOfChannels: 2, sampleRate: 16000, getChannelData: (channel: number) => channel ? new Float32Array([0, 0.5, -1]) : new Float32Array([0, 0, 0]) }));
    const output = await runInNewContext(`(${decodeInRenderer.toString()})('YWJj')`, {
      OfflineAudioContext: class { decodeAudioData = decode; },
      atob: (text: string) => Buffer.from(text, 'base64').toString('binary'),
      btoa: (text: string) => Buffer.from(text, 'binary').toString('base64'),
    });
    const bytes = Buffer.from(output, 'base64');
    expect(bytes.toString('ascii', 8, 12)).toBe('WAVE');
    expect(bytes.readUInt32LE(24)).toBe(16000);
    expect(bytes.readInt16LE(46)).toBe(16384);
    expect(bytes.readInt16LE(48)).toBe(-32768);
    expect(decode).toHaveBeenCalledTimes(1);
  });
  it('rejects untrusted origins and oversized input before invoking the renderer', async () => {
    const execute = vi.fn();
    const decoder = createAudioDecoder();
    const contents = { isDestroyed: () => false, getURL: () => 'https://attacker.invalid', executeJavaScriptInIsolatedWorld: execute };
    await expect(decoder(contents, 'http://127.0.0.1:4173', { base64: 'YWJj' })).rejects.toThrow('trusted');
    contents.getURL = () => 'http://127.0.0.1:4173/canvas';
    await expect(decoder(contents, 'http://127.0.0.1:4173', { base64: 'A'.repeat(15_000_000) })).rejects.toThrow('limit');
    expect(execute).not.toHaveBeenCalled();
  });
  it('serializes decoding and rejects non-PCM results from the isolated world', async () => {
    let finish!: (value: string) => void;
    const execute = vi.fn((_world: number) => new Promise<string>(resolve => { finish = resolve; }));
    const contents = { isDestroyed: () => false, getURL: () => 'http://127.0.0.1:4173', executeJavaScriptInIsolatedWorld: execute };
    const decoder = createAudioDecoder(), first = decoder(contents, contents.getURL(), { base64: 'YWJj' });
    await expect(decoder(contents, contents.getURL(), { base64: 'YWJj' })).rejects.toThrow('already running');
    expect(execute.mock.calls[0][0]).toBe(1002);
    finish('YWJj'); await expect(first).rejects.toThrow('invalid PCM');
  });
});
