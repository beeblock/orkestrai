import { ADVENTURE_EN } from './en.js';
import { ADVENTURE_ES } from './es.js';
import { ADVENTURE_PT } from './pt-BR.js';
import type { AdventureCatalog } from './types.js';

export const ADVENTURE_CATALOGS: Record<string, AdventureCatalog> = { 'pt-BR': ADVENTURE_PT, en: ADVENTURE_EN, es: ADVENTURE_ES };

export function adventureCatalog(locale: string): AdventureCatalog {
  return ADVENTURE_CATALOGS[locale] ?? ADVENTURE_EN;
}

/** Fills {name} placeholders. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}

export type { AdventureCatalog };
