import { embeddedTtsVoice } from '$lib/modules/agent-room/domain/voice.js';
import * as m from '$lib/paraglide/messages.js';

export function localVoiceLabel(id: string) {
  const voice = embeddedTtsVoice(id);
  const language = voice.language === 'en' ? m['companion.voice_en']() : voice.language === 'es' ? m['companion.voice_es']() : m['companion.voice_pt']();
  return `${language} · ${voice.style.toUpperCase()}`;
}
