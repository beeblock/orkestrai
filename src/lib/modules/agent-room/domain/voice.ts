const locales = [
  { locale: 'pt-BR', language: 'pt' },
  { locale: 'en-US', language: 'en' },
  { locale: 'es-MX', language: 'es' },
] as const;
const styles = ['f1', 'f2', 'f3', 'f4', 'f5', 'm1', 'm2', 'm3', 'm4', 'm5'] as const;
export type EmbeddedTtsVoiceId = `${typeof locales[number]['locale']}-${typeof styles[number]}`;
export type EmbeddedTtsVoice = typeof locales[number] & { id: EmbeddedTtsVoiceId; style: typeof styles[number]; sid: number };
// The pinned Supertonic voice.bin contains F1..F5 followed by M1..M5.
export const EMBEDDED_TTS_VOICES: readonly EmbeddedTtsVoice[] = locales.flatMap(locale =>
  styles.map((style, sid) => ({ ...locale, style, sid, id: `${locale.locale}-${style}` as EmbeddedTtsVoiceId })));

export const DEFAULT_EMBEDDED_TTS_VOICE: EmbeddedTtsVoiceId = 'pt-BR-f1';
export const DEFAULT_EMBEDDED_TTS_SPEED = 1;
export const MIN_EMBEDDED_TTS_SPEED = 0.75;
export const MAX_EMBEDDED_TTS_SPEED = 1.5;

const LEGACY_KOKORO_VOICES = new Set(['pf_dora', 'pm_alex', 'pm_santa']);

export function embeddedTtsVoice(value?: string | null): EmbeddedTtsVoice {
  const voice = EMBEDDED_TTS_VOICES.find((candidate) => candidate.id === value);
  if (voice) return voice;
  return EMBEDDED_TTS_VOICES[0];
}

export function normalizeEmbeddedTtsVoice(value?: string | null): EmbeddedTtsVoiceId {
  if (!value || LEGACY_KOKORO_VOICES.has(value)) return DEFAULT_EMBEDDED_TTS_VOICE;
  return embeddedTtsVoice(value).id;
}

/** Explicit requests must not silently select another voice. */
export function requireEmbeddedTtsVoice(value: string): EmbeddedTtsVoice {
  const voice = EMBEDDED_TTS_VOICES.find(candidate => candidate.id === value);
  if (!voice) throw new Error('Unsupported local voice. Choose an id from the voice catalog.');
  return voice;
}

export function normalizeEmbeddedTtsSpeed(value?: string | number | null): number {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value ?? '');
  if (!Number.isFinite(parsed)) return DEFAULT_EMBEDDED_TTS_SPEED;
  const clamped = Math.min(MAX_EMBEDDED_TTS_SPEED, Math.max(MIN_EMBEDDED_TTS_SPEED, parsed));
  return Math.round(clamped * 20) / 20;
}
