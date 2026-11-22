import { describe, expect, it } from 'vitest';
import { botPresetIds, botPresetLocales } from '$lib/modules/agent-room/domain/bot-preset-types.js';
import { composeBotInstructions, getBotPreset, listBotPresets } from '$lib/modules/agent-room/domain/bot-presets.js';
import { personalBotCommandSchema, personalBotEditorSchema } from '$lib/modules/agent-room/contracts/schemas/personal-bot.schema.js';

describe('public-safe bot presets', () => {
  it.each(botPresetLocales)('has the same complete usable presets in %s within public-role bounds', locale => {
    const presets = listBotPresets(locale);
    expect(presets.map(item => item.id)).toEqual([...botPresetIds]);
    expect(new Set(presets.map(item => item.name)).size).toBe(botPresetIds.length);
    for (const preset of presets) {
      const instructions = composeBotInstructions(preset, locale);
      expect(instructions.length).toBeLessThanOrEqual(6_000);
      expect(preset.description.length).toBeGreaterThan(15);
      expect(preset.personality.length).toBeGreaterThan(15);
      expect(preset.rules.length).toBeGreaterThan(30);
      expect(personalBotEditorSchema.parse({ title: preset.name, instructions: preset.purpose,
        personality: preset.personality, rules: preset.rules, provider: 'claude' }).personality).toBe(preset.personality);
      expect(personalBotCommandSchema.parse({ command: 'create', settings: { title: preset.name, provider: 'claude',
        presetId: preset.id, presetLocale: locale, instructions, publicRole: instructions } }).command).toBe('create');
    }
  });
  it('selects the explicit requested language independently of a caller locale', () => {
    expect(getBotPreset('support', 'pt-BR').name).toBe('Suporte ao cliente');
    expect(getBotPreset('support', 'es').name).toBe('Atención al cliente');
    expect(getBotPreset('support', 'en').name).toBe('Customer support');
    expect(getBotPreset('support', 'pt-BR').name).toBe('Suporte ao cliente');
  });
  it('keeps manually composed text without adding empty sections', () => {
    expect(composeBotInstructions({ purpose: '  A custom role  ' })).toBe('A custom role');
    const text = composeBotInstructions({ purpose: 'My role', personality: 'My voice', rules: 'My rule' });
    expect(text).toContain('My role'); expect(text).toContain('My voice'); expect(text).toContain('My rule');
  });
  it('allows preset-only creation and rejects unknown presets, locales and incomplete custom bots', () => {
    expect(personalBotCommandSchema.parse({ command: 'create', settings: { title: 'Jarvis', provider: 'codex', presetId: 'assistant' } }).command).toBe('create');
    for (const settings of [{ title: 'Jarvis', provider: 'codex' },
      { title: 'Jarvis', provider: 'codex', presetId: '__proto__' },
      { title: 'Jarvis', provider: 'codex', presetId: 'support', presetLocale: 'unknown' }]) {
      expect(personalBotCommandSchema.safeParse({ command: 'create', settings }).success).toBe(false);
    }
    expect(personalBotCommandSchema.safeParse({ command: 'update', nodeId: '00000000-0000-4000-8000-000000000001',
      settings: { title: 'Jarvis', provider: 'codex', instructions: 'Keep existing instructions', presetId: 'support' } }).success).toBe(false);
  });
});
