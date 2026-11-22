/** Stable built-in ids shared by UI, validation and the bridge. */
export const botPresetIds = ['assistant', 'support', 'sales', 'calendar', 'research', 'reports', 'developer', 'devops', 'writer', 'social', 'teacher', 'coach', 'finance', 'travel', 'community', 'creative'] as const;
export const botPresetLocales = ['pt-BR', 'en', 'es'] as const;
export type BotPresetId = (typeof botPresetIds)[number];
export type BotPresetLocale = (typeof botPresetLocales)[number];
export type BotPreset = { id: BotPresetId; name: string; description: string; purpose: string; personality: string; rules: string };
