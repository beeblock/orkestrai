import type { HeroClassId } from './catalog.js';

/**
 * Heroes have names of their own, because the agent playing a hero changes:
 * "Lyra the Ranger, played by QA Upload". Proper names, the same in every
 * language.
 */
const NAMES: Record<HeroClassId, string[]> = {
  maestro: ['Amadeus', 'Orfeu', 'Vivaldo', 'Lorenzo'],
  knight: ['Aldric', 'Bram', 'Cedric', 'Doran', 'Edric', 'Gareth', 'Hector', 'Ivo', 'Leon', 'Marek', 'Osric', 'Roland', 'Tristan', 'Ulric', 'Corwin', 'Baldwin'],
  ranger: ['Ash', 'Briar', 'Cael', 'Fen', 'Hawk', 'Kestrel', 'Lark', 'Nyx', 'Quill', 'Reed', 'Rowan', 'Sable', 'Talon', 'Wren', 'Sorrel', 'Yarrow'],
  sorceress: ['Aria', 'Celeste', 'Elara', 'Iris', 'Lyra', 'Mira', 'Nova', 'Ophelia', 'Selene', 'Seraphine', 'Thalia', 'Vesper', 'Ysolde', 'Zaira', 'Lunara', 'Astra'],
  cleric: ['Adela', 'Beatrix', 'Clara', 'Dalia', 'Evangeline', 'Grace', 'Helena', 'Irene', 'Lucia', 'Marisol', 'Noelle', 'Pia', 'Rosa', 'Solana', 'Teresa', 'Vera'],
  artificer: ['Bolt', 'Cog', 'Dyna', 'Ferra', 'Gizmo', 'Hexa', 'Jinx', 'Kit', 'Mags', 'Nix', 'Pip', 'Rivet', 'Sprocket', 'Tinka', 'Volta', 'Zinc'],
};

/** A name for a new hero of a class, avoiding the ones the guild already uses. */
export function heroName(classId: HeroClassId, taken: Iterable<string>, pick: number): string {
  const used = new Set(taken);
  const pool = NAMES[classId];
  const free = pool.filter((name) => !used.has(name));
  if (free.length) return free[Math.abs(Math.floor(pick)) % free.length];
  // Every name taken: number them, like a second Lyra.
  let suffix = 2;
  const base = pool[Math.abs(Math.floor(pick)) % pool.length];
  while (used.has(`${base} ${toRoman(suffix)}`)) suffix += 1;
  return `${base} ${toRoman(suffix)}`;
}

function toRoman(value: number): string {
  const numerals: Array<[number, string]> = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let rest = value;
  let text = '';
  for (const [amount, numeral] of numerals) while (rest >= amount) { text += numeral; rest -= amount; }
  return text;
}
