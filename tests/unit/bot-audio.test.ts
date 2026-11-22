import { describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { BotAudioService } from '$lib/modules/agent-room/application/services/BotAudioService.js';
import { voiceService, VOICE_MODELS_MISSING_ERROR } from '$lib/modules/agent-room/application/services/VoiceService.js';
import { pcmToWav, wavToPcm16 } from '$lib/modules/agent-room/infrastructure/voice/EmbeddedVoice.js';
import { voicePrefixBody } from '$lib/modules/agent-room/domain/bot-voice-prefix.js';

describe('channel voice messages use the embedded speech pipeline off the Core', () => {
  it.each(['ogg', 'mp3'])('decodes a real synthetic %s fixture to bounded 16 kHz PCM WAV', async extension => {
    const bytes = await readFile(new URL(`../fixtures/channel-audio/tone.${extension}`, import.meta.url));
    const wav = await new BotAudioService().decode(bytes);
    const { samples, sampleRate } = wavToPcm16(wav);
    expect(sampleRate).toBe(16000); expect(samples.length).toBeGreaterThan(5000); expect(samples.length).toBeLessThan(9000);
    expect(samples.some(value => Math.abs(value) > 0.01)).toBe(true);
  });
  it('transcribes decoded audio through the existing voice service and makes missing models explicit', async () => {
    const service = new BotAudioService(), bytes = pcmToWav(new Float32Array(1600).fill(0.1), 16000);
    const stt = vi.spyOn(voiceService, 'transcribe').mockResolvedValue('Jarvis, me lembre amanhã.');
    try {
      expect(await service.transcribe(bytes)).toBe('Jarvis, me lembre amanhã.');
      expect(stt.mock.calls[0][0].subarray(0, 4).toString()).toBe('RIFF');
      stt.mockRejectedValueOnce(new Error(VOICE_MODELS_MISSING_ERROR));
      await expect(service.transcribe(bytes)).rejects.toThrow('BOT_AUDIO_NOT_READY');
    } finally { stt.mockRestore(); }
  });
  it('serializes speech inference across chats while allowing independent decoder callers', async () => {
    const service = new BotAudioService(), bytes = pcmToWav(new Float32Array(1600).fill(0.1), 16000);
    let active = 0, peak = 0;
    const stt = vi.spyOn(voiceService, 'transcribe').mockImplementation(async () => {
      active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 30)); active--;
      return 'Jarvis test';
    });
    try {
      expect(await Promise.all([service.transcribe(bytes), service.transcribe(bytes), service.transcribe(bytes)])).toEqual(['Jarvis test', 'Jarvis test', 'Jarvis test']);
      expect(peak).toBe(1); expect(stt).toHaveBeenCalledTimes(3);
    } finally { stt.mockRestore(); }
  });

  it('rejects oversized or malformed media without starting speech inference', async () => {
    const service = new BotAudioService();
    await expect(service.decode(Buffer.alloc(10 * 1024 * 1024 + 1))).rejects.toThrow('BOT_AUDIO_UNREADABLE');
    await expect(service.decode(Buffer.from('not an audio file'))).rejects.toThrow('BOT_AUDIO_UNREADABLE');
  });
  it('matches a leading spoken bot name but never changes a word elsewhere', () => {
    expect(voicePrefixBody('Jarvis, qual a cotação?', ['#jarvis'])).toBe('#jarvis, qual a cotação?');
    expect(voicePrefixBody('hashtag Jarvis gere uma imagem', ['#jarvis'])).toBe('#jarvis gere uma imagem');
    expect(voicePrefixBody('Fale com Jarvis depois', ['#jarvis'])).toBe('Fale com Jarvis depois');
    expect(voicePrefixBody('JarvisExtra confirme', ['#jarvis'])).toBe('JarvisExtra confirme');
  });
});
