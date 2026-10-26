/**
 * The Adventure's fixed content: hero classes, the bestiary of software bugs,
 * biomes and their stages. Pure data shared by the simulation, the renderer
 * and the server; display names live in the i18n catalogs under the same ids.
 */

export type HeroClassId = 'maestro' | 'artificer' | 'sorceress' | 'knight' | 'ranger' | 'cleric';

export type HeroAttack = 'melee' | 'arrow' | 'bolt' | 'note' | 'cog' | 'smite';

export type HeroSpecial =
  /** The leader conducts: working teammates attack faster for a while. */
  | 'anthem'
  /** Drops a turret that keeps shooting the front enemy. */
  | 'turret'
  /** Strikes every enemy on screen. */
  | 'meteor'
  /** Stuns the front enemy and pushes it back. */
  | 'shield-bash'
  /** Fires a fan of arrows at the three front enemies. */
  | 'volley'
  /** Clears the party's debuffs and grants a shield that absorbs hits. */
  | 'sanctuary';

export type HeroClass = {
  id: HeroClassId;
  attack: HeroAttack;
  /** Distance (world units) from which the hero hits its target. */
  range: number;
  attackMs: number;
  damage: number;
  special: HeroSpecial;
  specialMs: number;
  /** Marching order, front to back. */
  rank: number;
};

export const HERO_CLASSES: Record<HeroClassId, HeroClass> = {
  knight: { id: 'knight', attack: 'melee', range: 18, attackMs: 900, damage: 14, special: 'shield-bash', specialMs: 7_000, rank: 0 },
  artificer: { id: 'artificer', attack: 'cog', range: 70, attackMs: 1_000, damage: 10, special: 'turret', specialMs: 12_000, rank: 1 },
  ranger: { id: 'ranger', attack: 'arrow', range: 110, attackMs: 800, damage: 9, special: 'volley', specialMs: 8_000, rank: 2 },
  sorceress: { id: 'sorceress', attack: 'bolt', range: 95, attackMs: 1_250, damage: 15, special: 'meteor', specialMs: 11_000, rank: 3 },
  cleric: { id: 'cleric', attack: 'smite', range: 80, attackMs: 1_100, damage: 8, special: 'sanctuary', specialMs: 10_000, rank: 4 },
  maestro: { id: 'maestro', attack: 'note', range: 90, attackMs: 1_000, damage: 10, special: 'anthem', specialMs: 9_000, rank: 5 },
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

export const MONSTERS: Record<MonsterId, Monster> = {
  'glitch-slime': { id: 'glitch-slime', hp: 40, damage: 4, speed: 16, attackMs: 1_400, boss: false, size: 1, xp: 4, gold: 1 },
  'bug-beetle': { id: 'bug-beetle', hp: 55, damage: 5, speed: 20, attackMs: 1_300, boss: false, size: 1, xp: 5, gold: 2 },
  'conflict-hydra': { id: 'conflict-hydra', hp: 900, damage: 12, speed: 8, attackMs: 1_600, boss: true, size: 2.6, xp: 120, gold: 60 },
  'null-wisp': { id: 'null-wisp', hp: 50, damage: 6, speed: 24, attackMs: 1_200, boss: false, size: 1, xp: 6, gold: 2 },
  'flaky-gremlin': { id: 'flaky-gremlin', hp: 65, damage: 6, speed: 26, attackMs: 1_000, boss: false, size: 1, xp: 7, gold: 3 },
  'loop-serpent': { id: 'loop-serpent', hp: 1_300, damage: 14, speed: 9, attackMs: 1_500, boss: true, size: 2.8, xp: 170, gold: 85 },
  'stale-imp': { id: 'stale-imp', hp: 75, damage: 7, speed: 22, attackMs: 1_100, boss: false, size: 1, xp: 8, gold: 3 },
  'leak-ooze': { id: 'leak-ooze', hp: 110, damage: 6, speed: 12, attackMs: 1_500, boss: false, size: 1.3, xp: 10, gold: 4 },
  'deadlock-golem': { id: 'deadlock-golem', hp: 1_800, damage: 16, speed: 7, attackMs: 1_800, boss: true, size: 2.8, xp: 230, gold: 115 },
  'race-imps': { id: 'race-imps', hp: 85, damage: 8, speed: 30, attackMs: 900, boss: false, size: 1.1, xp: 10, gold: 4 },
  'dependency-spider': { id: 'dependency-spider', hp: 120, damage: 9, speed: 18, attackMs: 1_300, boss: false, size: 1.3, xp: 12, gold: 5 },
  'legacy-dragon': { id: 'legacy-dragon', hp: 2_500, damage: 19, speed: 8, attackMs: 1_700, boss: true, size: 3.2, xp: 320, gold: 160 },
  'timeout-harpy': { id: 'timeout-harpy', hp: 115, damage: 10, speed: 28, attackMs: 1_100, boss: false, size: 1.1, xp: 13, gold: 5 },
  'regression-knight': { id: 'regression-knight', hp: 170, damage: 11, speed: 15, attackMs: 1_400, boss: false, size: 1.2, xp: 15, gold: 6 },
  'outage-kraken': { id: 'outage-kraken', hp: 3_400, damage: 22, speed: 7, attackMs: 1_600, boss: true, size: 3.4, xp: 450, gold: 220 },
};

export type Biome = { id: BiomeId; mobs: MonsterId[]; boss: MonsterId };

/** The road, in order: each biome is a chapter of three stages ending with its boss. */
export const BIOMES: Biome[] = [
  { id: 'repo-forest', mobs: ['glitch-slime', 'bug-beetle'], boss: 'conflict-hydra' },
  { id: 'deploy-desert', mobs: ['null-wisp', 'flaky-gremlin'], boss: 'loop-serpent' },
  { id: 'cache-peaks', mobs: ['stale-imp', 'leak-ooze'], boss: 'deadlock-golem' },
  { id: 'build-forge', mobs: ['race-imps', 'dependency-spider'], boss: 'legacy-dragon' },
  { id: 'cloud-citadel', mobs: ['timeout-harpy', 'regression-knight'], boss: 'outage-kraken' },
];

export const STAGES_PER_BIOME = 3;
export const WAVES_PER_STAGE = 5;

/** Chapter and stage of a 0-based stage index, wrapping into harder laps after the last biome. */
export function stageOf(stageIndex: number): { biome: Biome; chapter: number; stage: number; lap: number } {
  const perLap = BIOMES.length * STAGES_PER_BIOME;
  const lap = Math.floor(stageIndex / perLap);
  const inLap = stageIndex % perLap;
  const chapter = Math.floor(inLap / STAGES_PER_BIOME);
  return { biome: BIOMES[chapter], chapter: chapter + 1, stage: (inLap % STAGES_PER_BIOME) + 1, lap };
}

/** Monsters get tougher with each stage and each lap of the road. */
export function stageScale(stageIndex: number): number {
  return 1 + stageIndex * 0.12;
}

/** Experience to go from `level` to the next one. */
export function xpForLevel(level: number): number {
  return Math.round(40 * level ** 1.6);
}

/** Level reached with `totalXp`, and the progress towards the next one. */
export function levelFromXp(totalXp: number): { level: number; into: number; next: number } {
  let level = 1;
  let remaining = Math.max(0, Math.floor(totalXp));
  while (remaining >= xpForLevel(level)) {
    remaining -= xpForLevel(level);
    level += 1;
  }
  return { level, into: remaining, next: xpForLevel(level) };
}
