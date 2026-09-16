import { describe, expect, it } from 'vitest';
import { pcm16ToWav, pcmToWav, voiceDiskSpace, voiceNodeArchive, wavToPcm16, VOICE_REQUIRED_BYTES } from '$lib/modules/agent-room/infrastructure/voice/EmbeddedVoice.js';
import {
  EMBEDDED_TTS_VOICES,
  embeddedTtsVoice,
  normalizeEmbeddedTtsSpeed,
  normalizeEmbeddedTtsVoice,
  requireEmbeddedTtsVoice,
} from '$lib/modules/agent-room/domain/voice.js';

function makeWav(samples: number[], rate = 16_000, channels = 1): Buffer {
  const buffer = Buffer.alloc(44 + samples.length * 2 * channels);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + samples.length * 2 * channels, 4);
  buffer.write('WAVEfmt ', 8, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2 * channels, 28);
  buffer.writeUInt16LE(2 * channels, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(samples.length * 2 * channels, 40);
  samples.forEach((sample, index) => buffer.writeInt16LE(sample, 44 + index * 2 * channels));
  return buffer;
}

describe('wavToPcm16 / pcmToWav', () => {
  it('parse WAV PCM16 16kHz mono', () => {
    const { samples, sampleRate } = wavToPcm16(makeWav([0, 1000, -1000, 32767]));
    expect(sampleRate).toBe(16_000);
    expect(samples.length).toBe(4);
    expect(samples[1]).toBeCloseTo(1000 / 32768, 4);
    expect(samples[2]).toBeCloseTo(-1000 / 32768, 4);
  });

  it('resample 24kHz -> 16kHz (2/3 das amostras)', () => {
    const { samples } = wavToPcm16(makeWav(new Array(300).fill(500), 24_000));
    expect(samples.length).toBe(200);
  });

  it('rejeita nao-WAV', () => {
    expect(() => wavToPcm16(Buffer.from('not a wav file at all........'))).toThrow('WAV');
  });

  it('roundtrip pcm -> wav -> pcm', () => {
    const input = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const wav = pcmToWav(input, 16_000);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.readUInt32LE(24)).toBe(16_000);
    const { samples } = wavToPcm16(wav);
    expect(samples.length).toBe(input.length);
    expect(samples[1]).toBeCloseTo(0.5, 2);
    expect(samples[3]).toBeCloseTo(1, 2);
  });

  it('encapsula PCM16 binario sem alterar as amostras', () => {
    const pcm = Buffer.from([0, 0, 255, 127, 0, 128]);
    const wav = pcm16ToWav(pcm, 24_000);
    expect(wav.readUInt32LE(24)).toBe(24_000);
    expect(wav.subarray(44)).toEqual(pcm);
  });
});

describe('vozes Supertonic', () => {
  it('offers the ten bundled styles in each supported language without changing legacy ids', () => {
    expect(EMBEDDED_TTS_VOICES).toHaveLength(30);
    for (const locale of ['pt-BR', 'en-US', 'es-MX']) {
      expect(EMBEDDED_TTS_VOICES.filter(voice => voice.locale === locale).map(voice => voice.sid)).toEqual([0,1,2,3,4,5,6,7,8,9]);
    }
    expect(new Set(EMBEDDED_TTS_VOICES.map(voice => voice.id)).size).toBe(30);
    expect(requireEmbeddedTtsVoice('en-US-m2').sid).toBe(6);
    expect(requireEmbeddedTtsVoice('pt-BR-m5').sid).toBe(9);
    expect(() => requireEmbeddedTtsVoice('invented')).toThrow('Unsupported');
  });

  it('migra vozes legadas do Kokoro e rejeita ids desconhecidos', () => {
    expect(normalizeEmbeddedTtsVoice('pf_dora')).toBe('pt-BR-f1');
    expect(normalizeEmbeddedTtsVoice('en-US-m2')).toBe('en-US-m2');
    expect(normalizeEmbeddedTtsVoice('qualquer')).toBe('pt-BR-f1');
    expect(embeddedTtsVoice('es-MX-f3')).toMatchObject({ language: 'es', sid: 2 });
  });

  it('normaliza a velocidade em passos de 0,05 e respeita a faixa segura', () => {
    expect(normalizeEmbeddedTtsSpeed()).toBe(1);
    expect(normalizeEmbeddedTtsSpeed('1.24')).toBe(1.25);
    expect(normalizeEmbeddedTtsSpeed(0.2)).toBe(0.75);
    expect(normalizeEmbeddedTtsSpeed(9)).toBe(1.5);
  });
});

describe('voiceNodeArchive', () => {
  it('mapeia runtime Node por plataforma', () => {
    const mac = voiceNodeArchive('darwin', 'arm64');
    expect(mac?.url).toContain('node-v24.12.0-darwin-arm64.tar.gz');
    expect(mac?.bin).toBe('node-v24.12.0-darwin-arm64/bin/node');
    const win = voiceNodeArchive('win32', 'x64');
    expect(win?.url).toContain('node-v24.12.0-win-x64.zip');
    expect(win?.bin).toBe('node-v24.12.0-win-x64/node.exe');
    const linux = voiceNodeArchive('linux', 'x64');
    expect(linux?.url).toContain('node-v24.12.0-linux-x64.tar.xz');
    expect(voiceNodeArchive('freebsd', 'x64')).toBeNull();
  });
});

describe('voiceDiskSpace', () => {
  it('reporta espaco livre real e o minimo de ~2 GB', () => {
    const { freeBytes, requiredBytes } = voiceDiskSpace();
    expect(requiredBytes).toBe(VOICE_REQUIRED_BYTES);
    expect(requiredBytes).toBe(2 * 1024 ** 3);
    expect(freeBytes).toBeGreaterThan(0);
  });
});
