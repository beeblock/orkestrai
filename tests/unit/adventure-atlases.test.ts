import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ELIXIR_ATLAS, SETS, UNIQUES } from '$lib/modules/agent-room/domain/adventure/artifacts.js';
import { BIOMES, HERO_CLASS_IDS, MONSTERS } from '$lib/modules/agent-room/domain/adventure/catalog.js';
import { GEM_QUALITIES, MATERIAL_IDS, SLOTS, classSlot, itemIcon, materialIcon } from '$lib/modules/agent-room/domain/adventure/items.js';
import { PETS } from '$lib/modules/agent-room/domain/adventure/pets.js';

const DIR = 'src/lib/assets/adventure/sprites';

/** A sheet the app bundles: its image and its frames. */
function sheet(id: string) {
  expect(existsSync(join(DIR, `${id}.webp`)), `${id}.webp`).toBe(true);
  expect(existsSync(join(DIR, `${id}.json`)), `${id}.json`).toBe(true);
  return JSON.parse(readFileSync(join(DIR, `${id}.json`), 'utf8')) as { frames: unknown[] };
}

describe('adventure art', () => {
  it('bundles every sheet the strip and the camp draw, with the frames they ask for', () => {
    for (const classId of HERO_CLASS_IDS) for (const suffix of ['', '-t1', '-t3', '-t4']) sheet(`hero-${classId}${suffix}`);
    for (const monsterId of Object.keys(MONSTERS)) sheet(`monster-${monsterId}`);
    for (const biome of BIOMES) for (const part of ['ground', 'props']) sheet(`biome-${biome.id}-${part}`);
    for (const id of ['fx-effects', 'fx-camp', 'icons-misc', ELIXIR_ATLAS, 'vfx-1', 'vfx-2', 'vfx-3', 'vfx-4', 'vfx-5', 'vfx-6']) sheet(id);
    for (const pet of PETS) sheet(pet.sprite.atlas);
    const icons: Array<{ atlas: string; frame: number }> = [];
    for (const slot of SLOTS) {
      for (const classId of classSlot(slot) ? HERO_CLASS_IDS : [null]) {
        for (const level of [1, 30, 60, 100]) for (const variant of [0, 1, 2] as const) icons.push(itemIcon({ slot, classId, level, variant }));
      }
    }
    for (const unique of Object.values(UNIQUES)) icons.push(itemIcon({ slot: unique.slot, classId: unique.classId, level: 50, uniqueId: unique.id }));
    for (const set of Object.values(SETS)) for (const slot of ['helmet', 'shoulders', 'armor', 'gloves', 'legs', 'boots'] as const) icons.push(itemIcon({ slot, classId: null, level: 50, setId: set.id }));
    for (const material of MATERIAL_IDS) for (const quality of GEM_QUALITIES) icons.push(materialIcon(material, quality));
    for (const icon of icons) expect(sheet(icon.atlas).frames.length, `${icon.atlas}#${icon.frame}`).toBeGreaterThan(icon.frame);
  });

  it('keeps no sheet outside the bundled assets', () => {
    expect(existsSync('static/adventure/sprites')).toBe(false);
    const files = readdirSync(DIR);
    for (const file of files.filter((name) => name.endsWith('.webp'))) expect(files).toContain(file.replace(/\.webp$/, '.json'));
  });
});
