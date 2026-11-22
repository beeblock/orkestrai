import * as m from '$lib/paraglide/messages.js';
import type { BotPreset, BotPresetId, BotPresetLocale } from './bot-preset-types.js';

/** Public-safe starting text only; presets never grant tools, accounts or publication. */
export function listBotPresets(locale: BotPresetLocale = 'en'): BotPreset[] {
  const options = { locale };
  const presets: BotPreset[] = [
    { id: 'assistant', name: m['bots.preset.assistant.name']({}, options), description: m['bots.preset.assistant.description']({}, options), purpose: m['bots.preset.assistant.purpose']({}, options), personality: m['bots.preset.assistant.personality']({}, options), rules: m['bots.preset.assistant.rules']({}, options) },
    { id: 'support', name: m['bots.preset.support.name']({}, options), description: m['bots.preset.support.description']({}, options), purpose: m['bots.preset.support.purpose']({}, options), personality: m['bots.preset.support.personality']({}, options), rules: m['bots.preset.support.rules']({}, options) },
    { id: 'sales', name: m['bots.preset.sales.name']({}, options), description: m['bots.preset.sales.description']({}, options), purpose: m['bots.preset.sales.purpose']({}, options), personality: m['bots.preset.sales.personality']({}, options), rules: m['bots.preset.sales.rules']({}, options) },
    { id: 'calendar', name: m['bots.preset.calendar.name']({}, options), description: m['bots.preset.calendar.description']({}, options), purpose: m['bots.preset.calendar.purpose']({}, options), personality: m['bots.preset.calendar.personality']({}, options), rules: m['bots.preset.calendar.rules']({}, options) },
    { id: 'research', name: m['bots.preset.research.name']({}, options), description: m['bots.preset.research.description']({}, options), purpose: m['bots.preset.research.purpose']({}, options), personality: m['bots.preset.research.personality']({}, options), rules: m['bots.preset.research.rules']({}, options) },
    { id: 'reports', name: m['bots.preset.reports.name']({}, options), description: m['bots.preset.reports.description']({}, options), purpose: m['bots.preset.reports.purpose']({}, options), personality: m['bots.preset.reports.personality']({}, options), rules: m['bots.preset.reports.rules']({}, options) },
    { id: 'developer', name: m['bots.preset.developer.name']({}, options), description: m['bots.preset.developer.description']({}, options), purpose: m['bots.preset.developer.purpose']({}, options), personality: m['bots.preset.developer.personality']({}, options), rules: m['bots.preset.developer.rules']({}, options) },
    { id: 'devops', name: m['bots.preset.devops.name']({}, options), description: m['bots.preset.devops.description']({}, options), purpose: m['bots.preset.devops.purpose']({}, options), personality: m['bots.preset.devops.personality']({}, options), rules: m['bots.preset.devops.rules']({}, options) },
    { id: 'writer', name: m['bots.preset.writer.name']({}, options), description: m['bots.preset.writer.description']({}, options), purpose: m['bots.preset.writer.purpose']({}, options), personality: m['bots.preset.writer.personality']({}, options), rules: m['bots.preset.writer.rules']({}, options) },
    { id: 'social', name: m['bots.preset.social.name']({}, options), description: m['bots.preset.social.description']({}, options), purpose: m['bots.preset.social.purpose']({}, options), personality: m['bots.preset.social.personality']({}, options), rules: m['bots.preset.social.rules']({}, options) },
    { id: 'teacher', name: m['bots.preset.teacher.name']({}, options), description: m['bots.preset.teacher.description']({}, options), purpose: m['bots.preset.teacher.purpose']({}, options), personality: m['bots.preset.teacher.personality']({}, options), rules: m['bots.preset.teacher.rules']({}, options) },
    { id: 'coach', name: m['bots.preset.coach.name']({}, options), description: m['bots.preset.coach.description']({}, options), purpose: m['bots.preset.coach.purpose']({}, options), personality: m['bots.preset.coach.personality']({}, options), rules: m['bots.preset.coach.rules']({}, options) },
    { id: 'finance', name: m['bots.preset.finance.name']({}, options), description: m['bots.preset.finance.description']({}, options), purpose: m['bots.preset.finance.purpose']({}, options), personality: m['bots.preset.finance.personality']({}, options), rules: m['bots.preset.finance.rules']({}, options) },
    { id: 'travel', name: m['bots.preset.travel.name']({}, options), description: m['bots.preset.travel.description']({}, options), purpose: m['bots.preset.travel.purpose']({}, options), personality: m['bots.preset.travel.personality']({}, options), rules: m['bots.preset.travel.rules']({}, options) },
    { id: 'community', name: m['bots.preset.community.name']({}, options), description: m['bots.preset.community.description']({}, options), purpose: m['bots.preset.community.purpose']({}, options), personality: m['bots.preset.community.personality']({}, options), rules: m['bots.preset.community.rules']({}, options) },
    { id: 'creative', name: m['bots.preset.creative.name']({}, options), description: m['bots.preset.creative.description']({}, options), purpose: m['bots.preset.creative.purpose']({}, options), personality: m['bots.preset.creative.personality']({}, options), rules: m['bots.preset.creative.rules']({}, options) },
  ];
  return presets.map(preset => ({ ...preset, rules: `${preset.rules}\n${m['bots.preset.safe_rules']({}, options)}` }));
}

export function getBotPreset(id: BotPresetId, locale: BotPresetLocale = 'en'): BotPreset {
  const preset = listBotPresets(locale).find(item => item.id === id);
  if (!preset) throw new Error('BOT_PRESET_NOT_FOUND');
  return preset;
}

export function composeBotInstructions(parts: { purpose: string; personality?: string; rules?: string }, locale: BotPresetLocale = 'en'): string {
  const purpose = parts.purpose.trim(), personality = parts.personality?.trim(), rules = parts.rules?.trim();
  if (!personality && !rules) return purpose;
  const options = { locale };
  return [
    `${m['bots.purpose']({}, options)}\n${purpose}`,
    personality ? `${m['bots.personality']({}, options)}\n${personality}` : '',
    rules ? `${m['bots.rules']({}, options)}\n${rules}` : '',
  ].filter(Boolean).join('\n\n');
}
