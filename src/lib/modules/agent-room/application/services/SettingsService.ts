import { AgentSetting } from '../../domain/models/AgentSetting.js';
import { DEFAULT_EMBEDDED_TTS_SPEED, DEFAULT_EMBEDDED_TTS_VOICE } from '../../domain/voice.js';

const DEFAULTS: Record<string, string> = {
  uiLanguage: 'en',
  appTheme: 'orkestrai-dark',
  customAppThemes: '[]',
  terminalTheme: 'dark',
  showMinimap: 'true',
  showControls: 'true',
  canvasEdgeRendering: 'auto',
  terminalFontSize: '13',
  terminalFontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  terminalPadding: '6',
  editorMinimap: 'true',
  editorWordWrap: 'false',
  editorAutoSave: 'false',
  editorFontSize: '13',
  newTerminalWidth: '560',
  newTerminalHeight: '340',
  newNoteWidth: '320',
  newNoteHeight: '220',
  dictationHotkey: 'alt+space',
  dictationAutoSubmit: 'false',
  audioInputDeviceId: 'default',
  audioOutputDeviceId: 'default',
  voiceBackend: 'embedded',
  voiceStackUrl: 'http://localhost:8000',
  voiceSttModel: 'whisper-large-v3-turbo',
  voiceTtsVoice: DEFAULT_EMBEDDED_TTS_VOICE,
  voiceTtsSpeed: String(DEFAULT_EMBEDDED_TTS_SPEED),
  voiceSidecarTtsVoice: 'pf_dora',
  pinnedAgentProviders: '[]',
  terminalGlobalCommands: '[]',
};

/** Configuracoes globais do app (chave/valor, com defaults). */
export class SettingsService {
  private cache = new Map<string, string>();

  async get(key: string): Promise<string> {
    if (this.cache.has(key)) return this.cache.get(key)!;
    const model = await AgentSetting.find(key);
    const value = (model?.getAttribute('value') as string | undefined) ?? DEFAULTS[key] ?? '';
    this.cache.set(key, value);
    return value;
  }

  async set(key: string, value: string): Promise<string> {
    const existing = await AgentSetting.find(key);
    if (existing) await existing.update({ value });
    else await AgentSetting.create({ key, value });
    this.cache.set(key, value);
    return value;
  }

  async all(): Promise<Record<string, string>> {
    const rows = await AgentSetting.query().get();
    const result = { ...DEFAULTS };
    for (const row of rows) {
      result[row.getAttribute('key')] = row.getAttribute('value');
    }
    this.cache = new Map(Object.entries(result));
    return result;
  }
}

export const settingsService = new SettingsService();
