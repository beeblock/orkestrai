import { describe, expect, it } from 'vitest';
import { ADVENTURE_EN } from '$lib/i18n/adventure/en.js';
import { ADVENTURE_ES } from '$lib/i18n/adventure/es.js';
import { ADVENTURE_PT } from '$lib/i18n/adventure/pt-BR.js';
import type { AdventureCatalog } from '$lib/i18n/adventure/types.js';
import { HERO_CLASS_IDS } from '$lib/modules/agent-room/domain/adventure/catalog.js';
import { SLOTS } from '$lib/modules/agent-room/domain/adventure/items.js';
import { RUNES } from '$lib/modules/agent-room/domain/adventure/runes.js';
import { SKILL_NODES } from '$lib/modules/agent-room/domain/adventure/skills.js';

const CATALOGS: Record<string, AdventureCatalog> = { en: ADVENTURE_EN, 'pt-BR': ADVENTURE_PT, es: ADVENTURE_ES };
const TRANSLATIONS = Object.entries(CATALOGS).filter(([locale]) => locale !== 'en');
const TIERS = [0, 1, 2, 3, 4, 5];

/** Every leaf of the catalog as `path -> string`, so nesting differences show up as missing paths. */
function leaves(value: unknown, path = ''): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      for (const [childPath, leaf] of leaves(child, path ? `${path}/${key}` : key)) out.set(childPath, leaf);
    }
  } else {
    out.set(path, value);
  }
  return out;
}

function placeholders(text: string): string[] {
  return [...new Set(text.match(/\{\w+\}/g) ?? [])].sort();
}

const EN_LEAVES = leaves(ADVENTURE_EN);

describe('adventure catalog (i18n integrity)', () => {
  it.each(TRANSLATIONS)('%s has exactly the same keys and nesting as en', (_locale, catalog) => {
    expect([...leaves(catalog).keys()].sort()).toEqual([...EN_LEAVES.keys()].sort());
  });

  it.each(Object.entries(CATALOGS))('%s has only non-empty strings', (_locale, catalog) => {
    const bad = [...leaves(catalog)].filter(([, leaf]) => typeof leaf !== 'string' || leaf.trim() === '').map(([path]) => path);
    expect(bad).toEqual([]);
  });

  it.each(TRANSLATIONS)('%s keeps the placeholders of every en string', (_locale, catalog) => {
    const translated = leaves(catalog);
    const mismatches = [...EN_LEAVES]
      .filter(([path, leaf]) => typeof leaf === 'string' && typeof translated.get(path) === 'string')
      .filter(([path, leaf]) => placeholders(translated.get(path) as string).join() !== placeholders(leaf as string).join())
      .map(([path]) => path);
    expect(mismatches).toEqual([]);
  });

  it.each(Object.entries(CATALOGS))('%s names every skill node and rune', (_locale, catalog) => {
    expect(Object.keys(SKILL_NODES).filter((id) => !catalog.skills[id])).toEqual([]);
    expect(RUNES.map((rune) => rune.id).filter((id) => !catalog.runes[id])).toEqual([]);
  });

  it.each(Object.entries(CATALOGS))('%s names every base item for tiers 0..5', (_locale, catalog) => {
    const expected = [
      ...SLOTS.filter((slot) => slot !== 'weapon').flatMap((slot) => TIERS.map((tier) => `${slot}.${tier}`)),
      ...HERO_CLASS_IDS.flatMap((classId) => TIERS.map((tier) => `weapon-${classId}.${tier}`)),
    ];
    expect(HERO_CLASS_IDS).toEqual(expect.arrayContaining(['knight', 'ranger', 'sorceress', 'cleric', 'artificer', 'maestro']));
    expect(expected.filter((key) => !catalog.bases[key])).toEqual([]);
  });
});
