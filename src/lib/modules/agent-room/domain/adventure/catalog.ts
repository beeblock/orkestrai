/**
 * The Adventure's fixed content: hero classes, the bestiary of software bugs
 * and the biomes they live in. Pure data shared by the simulation, the renderer
 * and the server; display names live in the i18n catalogs under the same ids.
 */

export type HeroClassId = 'maestro' | 'artificer' | 'sorceress' | 'knight' | 'ranger' | 'cleric';

export type HeroAttack = 'melee' | 'arrow' | 'bolt' | 'note' | 'cog' | 'smite';

export type HeroClass = {
  id: HeroClassId;
  attack: HeroAttack;
  /** Distance (world units) from which the hero hits its target. */
  range: number;
  attackMs: number;
  damage: number;
  /** Marching order, front to back. */
  rank: number;
};

export const HERO_CLASSES: Record<HeroClassId, HeroClass> = {
  knight: { id: 'knight', attack: 'melee', range: 18, attackMs: 900, damage: 14, rank: 0 },
  artificer: { id: 'artificer', attack: 'cog', range: 70, attackMs: 1_000, damage: 10, rank: 1 },
  ranger: { id: 'ranger', attack: 'arrow', range: 110, attackMs: 800, damage: 9, rank: 2 },
  sorceress: { id: 'sorceress', attack: 'bolt', range: 95, attackMs: 1_250, damage: 15, rank: 3 },
  cleric: { id: 'cleric', attack: 'smite', range: 80, attackMs: 1_100, damage: 8, rank: 4 },
  maestro: { id: 'maestro', attack: 'note', range: 90, attackMs: 1_000, damage: 10, rank: 5 },
};

export const HERO_CLASS_IDS = Object.keys(HERO_CLASSES) as HeroClassId[];

/** Classes a teammate may take; the Maestro is the team leader's alone. */
export const TEAMMATE_CLASS_IDS: HeroClassId[] = ['knight', 'artificer', 'ranger', 'sorceress', 'cleric'];

// What a teammate does decides how it fights: words from its role and title.
const ROLE_HINTS: Array<[HeroClassId, RegExp]> = [
  ['ranger', /\b(qa|test|tests|teste|testes|e2e|quality|qualidade|review|revis)/i],
  ['knight', /\b(back|backend|api|server|servidor|infra|devops|db|database|banco|seguran|security|auth)/i],
  ['sorceress', /\b(front|frontend|ui|ux|design|css|visual|mobile|web|anima)/i],
  ['cleric', /\b(doc|docs|support|suporte|pm|product|produto|planej|plan|analy|anal|research|pesquis|writer|escrit)/i],
  ['artificer', /\b(build|tool|tools|script|automa|data|dados|ml|ai|ia|integra|platform|plataforma|codex|eng)/i],
];

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

/**
 * The class a party member takes: the owner's choice when it is a teammate
 * class, the Maestro for the team leader, otherwise what its role suggests,
 * and finally a stable pick from its id so it never changes between screens.
 */
export function heroClassFor(member: { nodeId: string; title: string; role?: string | null; leader: boolean; chosen?: string | null }): HeroClassId {
  if (member.leader) return 'maestro';
  if (member.chosen && (TEAMMATE_CLASS_IDS as string[]).includes(member.chosen)) return member.chosen as HeroClassId;
  const text = `${member.role ?? ''} ${member.title}`;
  for (const [classId, hint] of ROLE_HINTS) if (hint.test(text)) return classId;
  return TEAMMATE_CLASS_IDS[hash(member.nodeId) % TEAMMATE_CLASS_IDS.length];
}

export type BiomeId = 'repo-forest' | 'deploy-desert' | 'cache-peaks' | 'build-forge' | 'cloud-citadel';

export type MonsterId =
  | 'glitch-slime' | 'bug-beetle' | 'conflict-hydra'
  | 'null-wisp' | 'flaky-gremlin' | 'loop-serpent'
  | 'stale-imp' | 'leak-ooze' | 'deadlock-golem'
  | 'race-imps' | 'dependency-spider' | 'legacy-dragon'
  | 'timeout-harpy' | 'regression-knight' | 'outage-kraken';

export type Monster = {
  id: MonsterId;
  hp: number;
  damage: number;
  /** World units per second while advancing. */
  speed: number;
  attackMs: number;
  boss: boolean;
  /** How much wider than a regular monster it is drawn and occupies. */
  size: number;
  xp: number;
  gold: number;
};

// Base numbers at level 1: the region level scales them, so later acts are
// not stronger by nature, only by level. They differ in speed, bulk and reach.
export const MONSTERS: Record<MonsterId, Monster> = {
  'glitch-slime': { id: 'glitch-slime', hp: 40, damage: 4, speed: 16, attackMs: 1_400, boss: false, size: 1, xp: 4, gold: 1 },
  'bug-beetle': { id: 'bug-beetle', hp: 50, damage: 5, speed: 20, attackMs: 1_300, boss: false, size: 1, xp: 5, gold: 2 },
  'conflict-hydra': { id: 'conflict-hydra', hp: 900, damage: 12, speed: 8, attackMs: 1_600, boss: true, size: 2.6, xp: 120, gold: 60 },
  'null-wisp': { id: 'null-wisp', hp: 38, damage: 5, speed: 24, attackMs: 1_200, boss: false, size: 1, xp: 4, gold: 1 },
  'flaky-gremlin': { id: 'flaky-gremlin', hp: 45, damage: 5, speed: 26, attackMs: 1_000, boss: false, size: 1, xp: 5, gold: 2 },
  'loop-serpent': { id: 'loop-serpent', hp: 950, damage: 12, speed: 9, attackMs: 1_500, boss: true, size: 2.8, xp: 125, gold: 62 },
  'stale-imp': { id: 'stale-imp', hp: 44, damage: 5, speed: 22, attackMs: 1_100, boss: false, size: 1, xp: 5, gold: 2 },
  'leak-ooze': { id: 'leak-ooze', hp: 60, damage: 4, speed: 12, attackMs: 1_500, boss: false, size: 1.3, xp: 6, gold: 2 },
  'deadlock-golem': { id: 'deadlock-golem', hp: 1100, damage: 13, speed: 7, attackMs: 1_800, boss: true, size: 2.8, xp: 130, gold: 65 },
  'race-imps': { id: 'race-imps', hp: 42, damage: 5, speed: 30, attackMs: 900, boss: false, size: 1.1, xp: 5, gold: 2 },
  'dependency-spider': { id: 'dependency-spider', hp: 55, damage: 5, speed: 18, attackMs: 1_300, boss: false, size: 1.3, xp: 6, gold: 2 },
  'legacy-dragon': { id: 'legacy-dragon', hp: 1000, damage: 14, speed: 8, attackMs: 1_700, boss: true, size: 3.2, xp: 135, gold: 68 },
  'timeout-harpy': { id: 'timeout-harpy', hp: 46, damage: 5, speed: 28, attackMs: 1_100, boss: false, size: 1.1, xp: 5, gold: 2 },
  'regression-knight': { id: 'regression-knight', hp: 62, damage: 6, speed: 15, attackMs: 1_400, boss: false, size: 1.2, xp: 6, gold: 3 },
  'outage-kraken': { id: 'outage-kraken', hp: 1050, damage: 14, speed: 7, attackMs: 1_600, boss: true, size: 3.4, xp: 140, gold: 70 },
};

export type Biome = { id: BiomeId; mobs: MonsterId[]; boss: MonsterId };

/** The road, in order: each biome is an act whose last stage holds its boss. */
export const BIOMES: Biome[] = [
  { id: 'repo-forest', mobs: ['glitch-slime', 'bug-beetle'], boss: 'conflict-hydra' },
  { id: 'deploy-desert', mobs: ['null-wisp', 'flaky-gremlin'], boss: 'loop-serpent' },
  { id: 'cache-peaks', mobs: ['stale-imp', 'leak-ooze'], boss: 'deadlock-golem' },
  { id: 'build-forge', mobs: ['race-imps', 'dependency-spider'], boss: 'legacy-dragon' },
  { id: 'cloud-citadel', mobs: ['timeout-harpy', 'regression-knight'], boss: 'outage-kraken' },
];
