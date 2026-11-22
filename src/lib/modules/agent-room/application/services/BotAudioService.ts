import { fork, type ForkOptions } from 'node:child_process';
import { resolve } from 'node:path';
import { voiceService, VOICE_MODELS_MISSING_ERROR } from './VoiceService.js';

/** Decode untrusted media off the Core, with one bounded decoder at a time. */
export class BotAudioService {
  private tail: Promise<unknown> = Promise.resolve();
  private speechTail: Promise<unknown> = Promise.resolve();
  decode(bytes: Buffer): Promise<Buffer> {
    if (!bytes.length || bytes.length > 10 * 1024 * 1024) return Promise.reject(new Error('BOT_AUDIO_UNREADABLE'));
    const run = this.tail.catch(() => undefined).then(() => new Promise<Buffer>((yes, no) => {
      const env: NodeJS.ProcessEnv = { ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '' };
      for (const key of ['PATH', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR']) if (process.env[key]) env[key] = process.env[key];
      const forkOptions: ForkOptions & { windowsHide: boolean } = {
        env, execArgv: ['--max-old-space-size=128'], serialization: 'advanced', windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      };
      const worker = fork(resolve('src/lib/modules/agent-room/infrastructure/voice/channel-audio-worker.mjs'), [], forkOptions);
      let result: Buffer | null = null, finished = false;
      const timer = setTimeout(() => worker.kill('SIGKILL'), 30_000); timer.unref();
      worker.on('message', (value: { ok?: boolean; wav?: Uint8Array }) => {
        if (value.ok && value.wav instanceof Uint8Array && value.wav.length <= 16_000 * 300 * 2 + 44) result = Buffer.from(value.wav);
      });
      const finish = () => { if (finished) return; finished = true; clearTimeout(timer); if (result) yes(result); else no(new Error('BOT_AUDIO_UNREADABLE')); };
      worker.once('error', () => { worker.kill('SIGKILL'); finish(); }); worker.once('close', finish);
      worker.send({ bytes: new Uint8Array(bytes) }, error => { if (error) worker.kill('SIGKILL'); });
    }));
    this.tail = run; return run;
  }
  transcribe(bytes: Buffer): Promise<string> {
    const run = this.speechTail.catch(() => undefined).then(async () => {
      try {
        const wav = await this.decode(bytes);
        const text = (await voiceService.transcribe(wav, 'voice-message.wav')).trim();
        if (!text) throw new Error('BOT_AUDIO_EMPTY');
        return text.slice(0, 8000);
      } catch (error) {
        if (error instanceof Error && error.message === VOICE_MODELS_MISSING_ERROR) throw new Error('BOT_AUDIO_NOT_READY');
        throw new Error(error instanceof Error && error.message === 'BOT_AUDIO_EMPTY' ? 'BOT_AUDIO_EMPTY' : 'BOT_AUDIO_UNREADABLE');
      }
    });
    this.speechTail = run; return run;
  }
}
export const botAudioService = new BotAudioService();
