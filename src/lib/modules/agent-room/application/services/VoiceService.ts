import { settingsService } from './SettingsService.js';
import {
  DEFAULT_EMBEDDED_TTS_SPEED,
  DEFAULT_EMBEDDED_TTS_VOICE,
  normalizeEmbeddedTtsSpeed,
  normalizeEmbeddedTtsVoice,
} from '../../domain/voice.js';
import { embeddedModelsReady, speakWav, transcribePcm, wavToPcm16 } from '../../infrastructure/voice/EmbeddedVoice.js';
import { normalizeSpeechAudio } from '../../domain/voice-audio.js';

const DEFAULT_VOICE_STACK_URL = 'http://localhost:8000';
const DEFAULT_STT_MODEL = 'whisper-large-v3-turbo';
const DEFAULT_SIDECAR_TTS_VOICE = 'pf_dora';
/** STT: primeiro uso baixa o modelo (~1,5 GB) — timeout generoso. */
const STT_TIMEOUT_MS = 600_000;
/** TTS local ou remoto: inclui cold start do modelo no primeiro uso. */
const TTS_TIMEOUT_MS = 300_000;

export type VoiceHealth = { ok: boolean; url: string; detail?: string };
export const VOICE_MODELS_MISSING_ERROR = 'Os modelos locais de voz nao estao instalados. Confirme o download no app antes de usar voz.';

/** WAV PCM16 mono -> Float32Array (+resample linear se nao for 16 kHz). */
/**
 * Voz do app: motor EMBARCADO (sherpa-onnx nativo, sem Docker/Python) por
 * padrao; sidecar voice-stack (Docker, API compativel com OpenAI) como opcao
 * avancada. O backend vem da setting voiceBackend.
 */
export class VoiceService {
  constructor(
    private readonly fetchFn: typeof fetch = fetch,
    private readonly settings: { get(key: string): Promise<string> } = settingsService,
    private readonly embeddedReady: () => boolean = embeddedModelsReady
  ) {}

  private async baseUrl(): Promise<string> {
    const url = await this.settings.get('voiceStackUrl');
    return (url || DEFAULT_VOICE_STACK_URL).replace(/\/$/, '');
  }

  private async sttModel(): Promise<string> {
    return (await this.settings.get('voiceSttModel')) || DEFAULT_STT_MODEL;
  }

  private async embeddedTtsVoice(): Promise<string> {
    return normalizeEmbeddedTtsVoice((await this.settings.get('voiceTtsVoice')) || DEFAULT_EMBEDDED_TTS_VOICE);
  }

  private async sidecarTtsVoice(): Promise<string> {
    return (await this.settings.get('voiceSidecarTtsVoice')) || DEFAULT_SIDECAR_TTS_VOICE;
  }

  private async embeddedTtsSpeed(): Promise<number> {
    return normalizeEmbeddedTtsSpeed((await this.settings.get('voiceTtsSpeed')) || DEFAULT_EMBEDDED_TTS_SPEED);
  }

  async health(): Promise<VoiceHealth> {
    const backend = await this.backend();
    if (backend === 'embedded') {
      return {
        ok: true,
        url: 'embedded',
        detail: this.embeddedReady() ? 'motor local ativo' : 'motor local — baixa ~670 MB na 1a vez',
      };
    }
    const url = await this.baseUrl();
    try {
      const response = await this.fetchFn(`${url}/health`, { signal: AbortSignal.timeout(5_000) });
      if (!response.ok) return { ok: false, url, detail: `HTTP ${response.status}` };
      const payload = (await response.json()) as { device?: string };
      return { ok: true, url, detail: payload.device ? `device: ${payload.device}` : undefined };
    } catch (error) {
      return { ok: false, url, detail: error instanceof Error ? error.message.split('\n')[0] : 'fora do ar' };
    }
  }

  /** Transcreve audio: WAV PCM16 16 kHz no modo embarcado; blob cru no sidecar. */
  async transcribe(audio: Buffer, filename: string, language?: string | null): Promise<string> {
    const backend = await this.backend();
    if (backend === 'embedded') {
      if (!this.embeddedReady()) throw new Error(VOICE_MODELS_MISSING_ERROR);
      const { samples } = wavToPcm16(audio);
      return transcribePcm(normalizeSpeechAudio(samples));
    }
    const url = await this.baseUrl();
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(audio)]), filename);
    form.append('model', await this.sttModel());
    if (language && language !== 'auto') form.append('language', language);

    let response: Response;
    try {
      response = await this.fetchFn(`${url}/v1/audio/transcriptions`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(STT_TIMEOUT_MS),
      });
    } catch (error) {
      throw new Error(this.offlineMessage(url, error));
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`STT do sidecar falhou (HTTP ${response.status}): ${detail.slice(0, 200)}`);
    }
    const payload = (await response.json()) as { text?: string };
    return (payload.text ?? '').trim();
  }

  /** Sintetiza texto em audio (wav) com a voz configurada. */
  async speak(text: string, voice?: string, speed?: number): Promise<Buffer> {
    const backend = await this.backend();
    if (backend === 'embedded') {
      if (voice !== undefined) {
        const { requireEmbeddedTtsVoice } = await import('../../domain/voice.js');
        requireEmbeddedTtsVoice(voice);
      }
      if (!this.embeddedReady()) throw new Error(VOICE_MODELS_MISSING_ERROR);
      return speakWav(
        text,
        normalizeEmbeddedTtsVoice(voice ?? (await this.embeddedTtsVoice())),
        normalizeEmbeddedTtsSpeed(speed ?? (await this.embeddedTtsSpeed()))
      );
    }
    const url = await this.baseUrl();
    let response: Response;
    try {
      response = await this.fetchFn(`${url}/v1/audio/speech`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'kokoro', voice: voice ?? (await this.sidecarTtsVoice()), input: text.slice(0, 2_000) }),
        signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
      });
    } catch (error) {
      throw new Error(this.offlineMessage(url, error));
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`TTS do sidecar falhou (HTTP ${response.status}): ${detail.slice(0, 200)}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  private async backend(): Promise<'embedded' | 'sidecar'> {
    return (await this.settings.get('voiceBackend')) === 'sidecar' ? 'sidecar' : 'embedded';
  }

  private offlineMessage(url: string, error: unknown): string {
    const cause = error instanceof Error ? error.message.split('\n')[0] : '';
    return `Sidecar de voz fora do ar em ${url} (${cause}). Suba com: cd voice-stack && docker compose up --build`;
  }
}

export const voiceService = new VoiceService();
