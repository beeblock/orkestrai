import { HERO_CLASSES, MONSTERS, type HeroAttack, type HeroClassId, type MonsterId } from './catalog.js';
import { BLUE_CHEST_CHANCE, WHITE_CHEST_CHANCE, type ChestTier } from './loot.js';
import type { ActiveAction, LearnedActive } from './skills.js';
import { armorMitigation, type CombatProfile } from './stats.js';
import {
  START_POSITION,
  WAVES_PER_STAGE,
  biomeOf,
  isActBossStage,
  monsterStats,
  nextPosition,
  power,
  previousPosition,
  regionLevel,
  stageIndex,
  xpGapFactor,
  type Difficulty,
  type StagePosition,
} from './world.js';

/**
 * The Adventure's battle as a pure, deterministic simulation. The party is
 * the team's agents in the formation, and only their real work moves it: a
 * working agent fights, one waiting for the owner raises its hand, and with
 * nobody working the party camps. Heroes carry the numbers the server built
 * from their level, gear, skills, runes and pets; the battle reports back the
 * experience, gold, kills, chests and stage results it produced. No DOM,
 * timers or Math.random: the same inputs give the same world.
 */

export type PartyActivity = 'working' | 'attention' | 'stunned' | 'idle' | 'offline' | 'done';

export type PartyMember = {
  id: string;
  classId: HeroClassId;
  leader: boolean;
  activity: PartyActivity;
  level: number;
  profile: CombatProfile;
  actives: LearnedActive[];
};

export type HeroPose = 'walk' | 'idle' | 'attack' | 'special' | 'hurt' | 'rest' | 'alert' | 'victory' | 'stunned' | 'fallen';

export type Hero = {
  id: string;
  classId: HeroClassId;
  leader: boolean;
  activity: PartyActivity;
  level: number;
  profile: CombatProfile;
  actives: LearnedActive[];
  x: number;
  pose: HeroPose;
  poseMs: number;
  hp: number;
  /** Time left before a fallen hero gets back up; 0 while standing. */
  fallenMs: number;
  attackCd: number;
  cooldowns: Record<string, number>;
  /** Hits absorbed by the Cleric's sanctuary. */
  shield: number;
  joinedMs: number;
};

export type EnemyPose = 'move' | 'attack' | 'hurt' | 'dying';

export type Enemy = {
  id: string;
  monsterId: MonsterId;
  level: number;
  x: number;
  hp: number;
  maxHp: number;
  damage: number;
  xp: number;
  gold: number;
  pose: EnemyPose;
  poseMs: number;
  attackCd: number;
  stunMs: number;
  boss: boolean;
  elite: boolean;
};

export type Projectile = {
  id: string;
  kind: HeroAttack | 'turret' | 'rocket';
  ownerId: string;
  fromX: number;
  targetId: string;
  progress: number;
  damage: number;
  skill: boolean;
};

export type Turret = { id: string; ownerId: string; x: number; ttlMs: number; cooldown: number; damage: number };

/** Timed party-wide effects from actives. */
export type PartyBuffs = {
  hasteMs: number; haste: number;
  mightMs: number; might: number;
  guardMs: number; guard: number;
  fortuneMs: number;
};

export type ChestDrop = { tier: ChestTier; level: number; difficulty: Difficulty; act: number };
export type StageResult = StagePosition & { result: 'clear' | 'fail' };

/** What the battle produced since the last report to the server. */
export type PendingReport = {
  elapsedMs: number;
  xp: Record<string, number>;
  gold: number;
  kills: Partial<Record<MonsterId, number>>;
  chests: ChestDrop[];
  bosses: Array<{ difficulty: Difficulty; act: number; monsterId: MonsterId }>;
  stages: StageResult[];
};

export type SimRules = {
  autoAdvance: boolean;
  autoRetry: boolean;
  /** Time a fallen hero stays down. */
  reviveMs: number;
  /** Extra blue chest chance (percent). */
  blueChestBonus: number;
  /** Highest stage index cleared on the current difficulty (to know what is unlocked). */
  cleared: number;
};

export const DEFAULT_RULES: SimRules = { autoAdvance: true, autoRetry: false, reviveMs: 20_000, blueChestBonus: 0, cleared: -1 };

export type AdventureEvent =
  | { type: 'attack'; heroId: string; attack: HeroAttack; targetId: string }
  | { type: 'hit'; targetId: string; amount: number; x: number; critical: boolean; skill: boolean }
  | { type: 'kill'; monsterId: MonsterId; x: number; gold: number; boss: boolean; elite: boolean }
  | { type: 'special'; heroId: string; action: ActiveAction; x: number }
  | { type: 'hero-hit'; heroId: string; amount: number; blocked: boolean }
  | { type: 'hero-down'; heroId: string; x: number }
  | { type: 'hero-up'; heroId: string }
  | { type: 'heal'; heroId: string; amount: number }
  | { type: 'chest'; tier: ChestTier; x: number }
  | { type: 'wave'; wave: number; boss: boolean; elite: boolean }
  | { type: 'stage-clear'; position: StagePosition; actClear: boolean }
  | { type: 'stage-fail'; position: StagePosition }
  | { type: 'quest'; title: string | null }
  | { type: 'join'; heroId: string }
  | { type: 'leave'; heroId: string; classId: HeroClassId; x: number }
  | { type: 'camp' }
  | { type: 'march' };

export type AdventureState = {
  version: 2;
  rng: number;
  timeMs: number;
  mode: 'march' | 'battle' | 'camp';
  position: StagePosition;
  wave: number;
  rules: SimRules;
  /** World position of the party's front line; the camera follows it. */
  frontX: number;
  heroes: Hero[];
  enemies: Enemy[];
  projectiles: Projectile[];
  turrets: Turret[];
  buffs: PartyBuffs;
  waveActive: boolean;
  nextId: number;
  events: AdventureEvent[];
  pending: PendingReport;
};

export const HERO_SPACING = 40;
export const MARCH_SPEED = 34;
const SPAWN_AHEAD = 230;
const MELEE_GAP = 14;
// Half the body width of a size-1 monster: reach and stops count from its front edge.
const BODY_HALF = 14;
// How close to the front line a monster is once it engages the melee hero.
const ENGAGED_GAP = MELEE_GAP + 2;
const ENEMY_SPACING = 30;
const POSE_MS: Partial<Record<HeroPose, number>> = { attack: 420, special: 700, hurt: 320, victory: 1_800 };
const PROJECTILE_SPEED = 2.6;
const BUFF_MS = 6_000;

function emptyPending(): PendingReport {
  return { elapsedMs: 0, xp: {}, gold: 0, kills: {}, chests: [], bosses: [], stages: [] };
}

export function createAdventure(options: { position?: StagePosition; wave?: number; rules?: Partial<SimRules> } = {}, seed = 1): AdventureState {
  return {
    version: 2,
    rng: (seed >>> 0) || 1,
    timeMs: 0,
    mode: 'camp',
    position: { ...(options.position ?? START_POSITION) },
    wave: Math.max(0, Math.min(WAVES_PER_STAGE - 1, Math.floor(options.wave ?? 0))),
    rules: { ...DEFAULT_RULES, ...options.rules },
    frontX: 0,
    heroes: [],
    enemies: [],
    projectiles: [],
    turrets: [],
    buffs: { hasteMs: 0, haste: 0, mightMs: 0, might: 0, guardMs: 0, guard: 0, fortuneMs: 0 },
    waveActive: false,
    nextId: 1,
    events: [],
    pending: emptyPending(),
  };
}

/** Hands over what the battle produced and starts a new report. */
export function drainReport(state: AdventureState): PendingReport {
  const report = state.pending;
  state.pending = emptyPending();
  return report;
}

/** The server's rules changed (settings, runes, a new clear) or the owner travelled. */
export function configureAdventure(state: AdventureState, rules: Partial<SimRules>, position?: StagePosition): void {
  state.rules = { ...state.rules, ...rules };
  if (position && (position.difficulty !== state.position.difficulty || position.act !== state.position.act || position.stage !== state.position.stage)) {
    state.position = { ...position };
    restartStage(state);
  }
}

function random(state: AdventureState): number {
  // mulberry32
  state.rng = (state.rng + 0x6d2b79f5) >>> 0;
  let value = state.rng;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

function id(state: AdventureState, prefix: string): string {
  return `${prefix}${state.nextId++}`;
}

function setPose(hero: Hero, pose: HeroPose): void {
  if (hero.pose === pose) return;
  hero.pose = pose;
  hero.poseMs = 0;
}

const standing = (hero: Hero) => hero.fallenMs <= 0;
const fighting = (hero: Hero) => hero.activity === 'working' && standing(hero);

/** Working heroes lead in class order; the others trail behind them. */
function formationOrder(state: AdventureState): Hero[] {
  const rank = (hero: Hero) => HERO_CLASSES[hero.classId].rank;
  const working = state.heroes.filter((hero) => hero.activity === 'working').sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
  const others = state.heroes.filter((hero) => hero.activity !== 'working').sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
  return [...working, ...others];
}

function formationX(state: AdventureState, hero: Hero, order: Hero[]): number {
  return state.frontX - order.indexOf(hero) * HERO_SPACING;
}

/** Brings the heroes in line with the formation: new agents join, removed ones leave, numbers refresh. */
function syncParty(state: AdventureState, party: readonly PartyMember[]): void {
  const wanted = new Map(party.map((member) => [member.id, member]));
  for (const hero of [...state.heroes]) {
    if (wanted.has(hero.id)) continue;
    state.heroes = state.heroes.filter((candidate) => candidate !== hero);
    state.events.push({ type: 'leave', heroId: hero.id, classId: hero.classId, x: hero.x });
  }
  for (const member of party) {
    const existing = state.heroes.find((hero) => hero.id === member.id);
    if (existing) {
      if (existing.activity !== member.activity && member.activity === 'done') setPose(existing, 'victory');
      const ratio = existing.hp / Math.max(1, existing.profile.maxHp);
      existing.activity = member.activity;
      existing.classId = member.classId;
      existing.leader = member.leader;
      existing.level = member.level;
      existing.actives = member.actives;
      if (existing.profile !== member.profile) {
        existing.profile = member.profile;
        existing.hp = Math.min(member.profile.maxHp, Math.max(standing(existing) ? 1 : 0, ratio * member.profile.maxHp));
      }
      continue;
    }
    const cooldowns: Record<string, number> = {};
    for (const active of member.actives) cooldowns[active.id] = active.cooldownMs / 2;
    const hero: Hero = {
      id: member.id, classId: member.classId, leader: member.leader, activity: member.activity, level: member.level,
      profile: member.profile, actives: member.actives,
      x: state.frontX - (state.heroes.length + 2) * HERO_SPACING, pose: 'walk', poseMs: 0,
      hp: member.profile.maxHp, fallenMs: 0, attackCd: 400, cooldowns, shield: 0, joinedMs: state.timeMs,
    };
    state.heroes.push(hero);
    state.events.push({ type: 'join', heroId: hero.id });
  }
}

function restartStage(state: AdventureState): void {
  state.wave = 0;
  state.enemies = [];
  state.projectiles = [];
  state.turrets = [];
  state.waveActive = false;
  for (const hero of state.heroes) {
    hero.fallenMs = 0;
    hero.hp = hero.profile.maxHp;
    hero.shield = 0;
    if (hero.pose === 'fallen') setPose(hero, 'idle');
  }
}

function spawnWave(state: AdventureState): void {
  const position = state.position;
  const biome = biomeOf(position);
  const level = regionLevel(position);
  const finalWave = state.wave === WAVES_PER_STAGE - 1;
  const bossWave = finalWave && isActBossStage(position);
  const count = 2 + Math.min(3, Math.floor(state.wave / 2) + Math.floor((position.stage - 1) / 3));
  const kinds: MonsterId[] = [];
  for (let index = 0; index < count; index += 1) kinds.push(biome.mobs[Math.floor(random(state) * biome.mobs.length)]);
  if (bossWave) kinds.push(biome.boss);
  // Smaller parties meet sturdier-looking but softer monsters: a lone agent can play too.
  const fighters = Math.min(3, Math.max(1, state.heroes.filter((hero) => hero.activity === 'working').length));
  const partyScale = 0.5 + 0.5 * fighters / 3;
  let x = state.frontX + SPAWN_AHEAD;
  kinds.forEach((monsterId, index) => {
    const monster = MONSTERS[monsterId];
    // A stage's last wave without the act boss brings an elite in front.
    const elite = finalWave && !bossWave && index === 0;
    const stats = monsterStats(monsterId, level, position.difficulty, elite);
    const hp = Math.max(1, Math.round(stats.hp * partyScale));
    state.enemies.push({
      id: id(state, 'e'), monsterId, level, x: x + (monster.boss ? 40 : 0), hp, maxHp: hp,
      damage: stats.damage, xp: stats.xp, gold: stats.gold, pose: 'move', poseMs: 0,
      attackCd: monster.attackMs * (0.5 + random(state) * 0.5), stunMs: 0, boss: monster.boss, elite,
    });
    x += ENEMY_SPACING * monster.size * (elite ? 1.3 : 1);
  });
  state.waveActive = true;
  state.events.push({ type: 'wave', wave: state.wave, boss: bossWave, elite: finalWave && !bossWave });
}

function partyGoldMultiplier(state: AdventureState): number {
  const fighters = state.heroes.filter((hero) => hero.activity === 'working');
  if (!fighters.length) return 1;
  return fighters.reduce((sum, hero) => sum + hero.profile.goldMultiplier, 0) / fighters.length;
}

function partyChestMultiplier(state: AdventureState): number {
  const fighters = state.heroes.filter((hero) => hero.activity === 'working');
  if (!fighters.length) return 1;
  return fighters.reduce((sum, hero) => sum + hero.profile.chestMultiplier, 0) / fighters.length;
}

function damageEnemy(state: AdventureState, enemy: Enemy, amount: number, source: Hero | null, skill: boolean): void {
  if (enemy.pose === 'dying') return;
  const profile = source?.profile;
  const critical = profile ? random(state) < profile.critChance : false;
  let dealt = amount * (critical && profile ? profile.critMultiplier : 1);
  if (profile && (enemy.boss || enemy.elite)) dealt *= profile.bossMultiplier;
  if (state.buffs.mightMs > 0) dealt *= 1 + state.buffs.might;
  dealt = Math.max(1, Math.round(dealt));
  enemy.hp -= dealt;
  state.events.push({ type: 'hit', targetId: enemy.id, amount: dealt, x: enemy.x, critical, skill });
  if (source && profile && profile.lifeSteal > 0 && standing(source)) {
    source.hp = Math.min(profile.maxHp, source.hp + dealt * profile.lifeSteal);
  }
  if (enemy.hp > 0) {
    if (enemy.pose !== 'attack') { enemy.pose = 'hurt'; enemy.poseMs = 0; }
    return;
  }
  killEnemy(state, enemy);
}

function killEnemy(state: AdventureState, enemy: Enemy): void {
  enemy.hp = 0;
  enemy.pose = 'dying';
  enemy.poseMs = 0;
  const gold = Math.round(enemy.gold * partyGoldMultiplier(state) * (state.buffs.fortuneMs > 0 ? 2 : 1));
  state.pending.gold += gold;
  state.pending.kills[enemy.monsterId] = (state.pending.kills[enemy.monsterId] ?? 0) + 1;
  for (const hero of state.heroes) {
    if (hero.activity !== 'working') continue;
    const xp = enemy.xp * xpGapFactor(hero.level, enemy.level) * hero.profile.xpMultiplier;
    state.pending.xp[hero.id] = (state.pending.xp[hero.id] ?? 0) + xp;
  }
  state.events.push({ type: 'kill', monsterId: enemy.monsterId, x: enemy.x, gold, boss: enemy.boss, elite: enemy.elite });
  const { difficulty, act } = state.position;
  const drop = (tier: ChestTier) => {
    state.pending.chests.push({ tier, level: enemy.level, difficulty, act });
    state.events.push({ type: 'chest', tier, x: enemy.x });
  };
  if (enemy.boss) {
    state.pending.bosses.push({ difficulty, act, monsterId: enemy.monsterId });
    drop('red');
  } else if (enemy.elite) {
    if (random(state) < BLUE_CHEST_CHANCE * (1 + state.rules.blueChestBonus / 100)) drop('blue');
  } else if (random(state) < WHITE_CHEST_CHANCE * partyChestMultiplier(state)) {
    drop('white');
  }
}

function frontEnemy(state: AdventureState): Enemy | null {
  let front: Enemy | null = null;
  for (const enemy of state.enemies) if (enemy.pose !== 'dying' && (!front || enemy.x < front.x)) front = enemy;
  return front;
}

function frontEdge(enemy: Enemy): number {
  return enemy.x - BODY_HALF * MONSTERS[enemy.monsterId].size;
}

function living(state: AdventureState): Enemy[] {
  return state.enemies.filter((enemy) => enemy.pose !== 'dying').sort((a, b) => a.x - b.x);
}

function heroAttack(hero: Hero): number {
  return hero.profile.attack;
}

function castActive(state: AdventureState, hero: Hero, active: LearnedActive, target: Enemy): void {
  const damage = heroAttack(hero) * active.power * hero.profile.skillMultiplier;
  setPose(hero, 'special');
  state.events.push({ type: 'special', heroId: hero.id, action: active.action, x: hero.x });
  switch (active.action) {
    case 'bash':
      damageEnemy(state, target, damage, hero, true);
      target.stunMs = 1_600;
      target.x += 14;
      break;
    case 'whirlwind':
      for (const enemy of living(state)) if (frontEdge(enemy) - hero.x <= 70) damageEnemy(state, enemy, damage, hero, true);
      break;
    case 'bulwark':
      state.buffs.guard = Math.max(state.buffs.guard, Math.min(0.6, active.power));
      state.buffs.guardMs = BUFF_MS;
      break;
    case 'earthshatter':
      for (const enemy of living(state)) { damageEnemy(state, enemy, damage, hero, true); enemy.stunMs = Math.max(enemy.stunMs, 1_200); }
      break;
    case 'volley':
      for (const enemy of living(state).slice(0, 3)) state.projectiles.push({ id: id(state, 'p'), kind: 'arrow', ownerId: hero.id, fromX: hero.x, targetId: enemy.id, progress: 0, damage, skill: true });
      break;
    case 'pierce': {
      const [first, second] = living(state);
      if (first) damageEnemy(state, first, damage, hero, true);
      if (second) damageEnemy(state, second, damage * 0.6, hero, true);
      break;
    }
    case 'arrow-rain':
    case 'meteor':
      for (const enemy of living(state)) damageEnemy(state, enemy, damage, hero, true);
      break;
    case 'frost-nova':
      for (const enemy of living(state)) { damageEnemy(state, enemy, damage, hero, true); enemy.stunMs = Math.max(enemy.stunMs, 2_000); }
      break;
    case 'arcane-storm':
      for (let index = 0; index < 6; index += 1) {
        const pool = living(state);
        if (!pool.length) break;
        damageEnemy(state, pool[Math.floor(random(state) * pool.length)], damage, hero, true);
      }
      break;
    case 'sanctuary':
      for (const ally of state.heroes) {
        if (!standing(ally)) continue;
        ally.shield = Math.max(ally.shield, Math.round(active.power));
        if (ally.pose === 'stunned' || ally.pose === 'hurt') setPose(ally, 'idle');
      }
      break;
    case 'heal':
      for (const ally of state.heroes) {
        if (!standing(ally)) continue;
        const amount = ally.profile.maxHp * active.power * hero.profile.skillMultiplier;
        ally.hp = Math.min(ally.profile.maxHp, ally.hp + amount);
        state.events.push({ type: 'heal', heroId: ally.id, amount: Math.round(amount) });
      }
      break;
    case 'judgment':
      for (const ally of state.heroes) {
        if (standing(ally)) continue;
        ally.fallenMs = 0;
        ally.hp = ally.profile.maxHp * 0.6;
        setPose(ally, 'idle');
        state.events.push({ type: 'hero-up', heroId: ally.id });
      }
      for (const enemy of living(state)) damageEnemy(state, enemy, damage, hero, true);
      break;
    case 'turret':
      state.turrets.push({ id: id(state, 't'), ownerId: hero.id, x: hero.x + 18, ttlMs: 8_000, cooldown: 0, damage });
      break;
    case 'overclock':
    case 'anthem':
      state.buffs.haste = Math.max(state.buffs.haste, active.power);
      state.buffs.hasteMs = BUFF_MS;
      break;
    case 'crescendo':
      state.buffs.might = Math.max(state.buffs.might, active.power);
      state.buffs.mightMs = BUFF_MS;
      break;
    case 'barrage':
      for (let index = 0; index < 8; index += 1) {
        const pool = living(state);
        if (!pool.length) break;
        state.projectiles.push({ id: id(state, 'p'), kind: 'rocket', ownerId: hero.id, fromX: hero.x, targetId: pool[Math.floor(random(state) * pool.length)].id, progress: -index * 0.12, damage, skill: true });
      }
      break;
    case 'finale':
      for (const enemy of living(state)) damageEnemy(state, enemy, damage, hero, true);
      state.buffs.fortuneMs = 5_000;
      break;
  }
}

function strike(state: AdventureState, hero: Hero, target: Enemy): void {
  const attack = HERO_CLASSES[hero.classId].attack;
  setPose(hero, 'attack');
  state.events.push({ type: 'attack', heroId: hero.id, attack, targetId: target.id });
  if (attack === 'melee') damageEnemy(state, target, heroAttack(hero), hero, false);
  else state.projectiles.push({ id: id(state, 'p'), kind: attack, ownerId: hero.id, fromX: hero.x + 10, targetId: target.id, progress: 0, damage: heroAttack(hero), skill: false });
}

function hurtHero(state: AdventureState, hero: Hero, enemy: Enemy): void {
  if (hero.shield > 0) {
    hero.shield -= 1;
    state.events.push({ type: 'hero-hit', heroId: hero.id, amount: 0, blocked: true });
    return;
  }
  const mitigation = armorMitigation(hero.profile.armor, power(enemy.level));
  const reduction = Math.min(0.9, mitigation + hero.profile.damageReduction + (state.buffs.guardMs > 0 ? state.buffs.guard : 0));
  const amount = Math.max(1, Math.round(enemy.damage * (1 - reduction)));
  hero.hp -= amount;
  state.events.push({ type: 'hero-hit', heroId: hero.id, amount, blocked: false });
  if (hero.hp > 0) {
    if (hero.pose !== 'special') setPose(hero, 'hurt');
    return;
  }
  hero.hp = 0;
  hero.fallenMs = state.rules.reviveMs;
  setPose(hero, 'fallen');
  state.events.push({ type: 'hero-down', heroId: hero.id, x: hero.x });
}

/** Advances the world by `dtMs`; returns the events of this step. */
export function stepAdventure(state: AdventureState, party: readonly PartyMember[], dtMs: number): AdventureEvent[] {
  state.events = [];
  const dt = Math.max(0, Math.min(dtMs, 250));
  state.timeMs += dt;
  syncParty(state, party);
  const order = formationOrder(state);

  for (const hero of state.heroes) {
    hero.poseMs += dt;
    if (!standing(hero)) {
      hero.fallenMs = Math.max(0, hero.fallenMs - dt);
      if (hero.fallenMs <= 0) {
        hero.hp = hero.profile.maxHp * 0.5;
        setPose(hero, 'idle');
        state.events.push({ type: 'hero-up', heroId: hero.id });
      }
      continue;
    }
    hero.hp = Math.min(hero.profile.maxHp, hero.hp + hero.profile.hpRegen * dt / 1000);
  }

  // Nobody working: the party camps, heals by the fire, the monsters hold.
  if (!state.heroes.some((hero) => hero.activity === 'working')) {
    if (state.mode !== 'camp') { state.mode = 'camp'; state.events.push({ type: 'camp' }); }
    for (const hero of state.heroes) {
      const target = formationX(state, hero, order);
      hero.x += Math.sign(target - hero.x) * Math.min(Math.abs(target - hero.x), MARCH_SPEED * dt / 1000);
      if (standing(hero)) hero.hp = Math.min(hero.profile.maxHp, hero.hp + hero.profile.maxHp * 0.08 * dt / 1000);
      settlePose(hero, state.mode);
    }
    return state.events;
  }
  state.pending.elapsedMs += dt;
  if (state.mode === 'camp') { state.mode = 'march'; state.events.push({ type: 'march' }); }

  for (const key of ['hasteMs', 'mightMs', 'guardMs', 'fortuneMs'] as const) state.buffs[key] = Math.max(0, state.buffs[key] - dt);
  if (!state.waveActive) spawnWave(state);

  const front = frontEnemy(state);
  // March until the first monster is close, then hold the line.
  const engaged = front !== null && front.x - state.frontX < 70;
  state.mode = engaged ? 'battle' : 'march';
  if (!engaged) {
    state.frontX += MARCH_SPEED * dt / 1000;
    // Between fights the party catches its breath.
    for (const hero of state.heroes) if (standing(hero)) hero.hp = Math.min(hero.profile.maxHp, hero.hp + hero.profile.maxHp * 0.04 * dt / 1000);
  }
  for (const hero of state.heroes) {
    if (!standing(hero)) continue;
    const target = formationX(state, hero, order);
    const speed = (hero.x < target - 40 ? MARCH_SPEED * 2.2 : MARCH_SPEED) * dt / 1000;
    hero.x += Math.sign(target - hero.x) * Math.min(Math.abs(target - hero.x), speed);
  }

  // Heroes. Ranged heroes cover the whole line from behind: their reach counts
  // from the front. While a working knight holds the front they wait for the
  // monster to engage it, so the knight fights too.
  const haste = 1 + (state.buffs.hasteMs > 0 ? state.buffs.haste : 0);
  const fighters = state.heroes.filter(fighting);
  const frontLine = fighters.length ? Math.max(...fighters.map((hero) => hero.x)) : state.frontX;
  const tank = fighters.some((hero) => HERO_CLASSES[hero.classId].attack === 'melee');
  for (const hero of state.heroes) {
    if (!standing(hero)) continue;
    hero.attackCd -= dt * haste;
    for (const active of hero.actives) hero.cooldowns[active.id] = (hero.cooldowns[active.id] ?? 0) - dt * haste;
    if (hero.activity !== 'working') { settlePose(hero, state.mode); continue; }
    if (POSE_MS[hero.pose] && hero.poseMs < POSE_MS[hero.pose]!) continue;
    const target = frontEnemy(state);
    const heroClass = HERO_CLASSES[hero.classId];
    const reach = heroClass.attack === 'melee' ? heroClass.range : tank ? ENGAGED_GAP : heroClass.range;
    const inRange = target !== null && frontEdge(target) - (heroClass.attack === 'melee' ? hero.x : frontLine) <= reach;
    const ready = hero.actives.find((active) => (hero.cooldowns[active.id] ?? 0) <= 0);
    if (target && inRange && ready) {
      castActive(state, hero, ready, target);
      hero.cooldowns[ready.id] = ready.cooldownMs * hero.profile.cooldownMultiplier;
      hero.attackCd = Math.max(hero.attackCd, 300);
    } else if (target && inRange && hero.attackCd <= 0) {
      strike(state, hero, target);
      hero.attackCd = hero.profile.attackMs;
    } else {
      setPose(hero, engaged ? 'idle' : 'walk');
    }
  }

  // Turrets.
  for (const turret of state.turrets) {
    turret.ttlMs -= dt;
    turret.cooldown -= dt;
    const target = frontEnemy(state);
    if (target && turret.cooldown <= 0 && target.x - turret.x < 140) {
      state.projectiles.push({ id: id(state, 'p'), kind: 'turret', ownerId: turret.ownerId, fromX: turret.x, targetId: target.id, progress: 0, damage: turret.damage, skill: true });
      turret.cooldown = 700;
    }
  }
  state.turrets = state.turrets.filter((turret) => turret.ttlMs > 0);

  // Projectiles.
  for (const projectile of state.projectiles) {
    const target = state.enemies.find((enemy) => enemy.id === projectile.targetId);
    if (!target || target.pose === 'dying') { projectile.progress = 2; continue; }
    const distance = Math.max(8, target.x - projectile.fromX);
    projectile.progress += (PROJECTILE_SPEED * dt) / distance * 60;
    if (projectile.progress >= 1) {
      const owner = state.heroes.find((hero) => hero.id === projectile.ownerId) ?? null;
      damageEnemy(state, target, projectile.damage, owner, projectile.skill);
    }
  }
  state.projectiles = state.projectiles.filter((projectile) => projectile.progress < 1);

  // Monsters: they stop at the front working hero and hit it.
  const frontHero = state.heroes.filter(fighting).sort((a, b) => b.x - a.x)[0] ?? null;
  let line = (frontHero ? frontHero.x : frontLine) + MELEE_GAP;
  for (const enemy of [...state.enemies].sort((a, b) => a.x - b.x)) {
    enemy.poseMs += dt;
    if (enemy.pose === 'dying') continue;
    if (enemy.stunMs > 0) { enemy.stunMs -= dt; continue; }
    if (enemy.pose === 'hurt' && enemy.poseMs > 240) { enemy.pose = 'move'; enemy.poseMs = 0; }
    const monster = MONSTERS[enemy.monsterId];
    const stop = line + BODY_HALF * monster.size;
    if (enemy.x > stop) {
      enemy.x = Math.max(stop, enemy.x - monster.speed * dt / 1000);
    } else if (frontHero) {
      enemy.attackCd -= dt;
      if (enemy.attackCd <= 0) {
        enemy.pose = 'attack';
        enemy.poseMs = 0;
        enemy.attackCd = monster.attackMs;
        hurtHero(state, frontHero, enemy);
      } else if (enemy.pose === 'attack' && enemy.poseMs > 360) {
        enemy.pose = 'move';
        enemy.poseMs = 0;
      }
    }
    line = Math.max(line, enemy.x) + ENEMY_SPACING * monster.size * 0.8;
  }
  // The dead linger for their death animation.
  state.enemies = state.enemies.filter((enemy) => enemy.pose !== 'dying' || enemy.poseMs < 600);

  // Every working hero down: the stage is lost.
  if (!state.heroes.some(fighting)) {
    failStage(state);
    return state.events;
  }
  if (state.waveActive && state.enemies.every((enemy) => enemy.pose === 'dying')) finishWave(state);
  return state.events;
}

function failStage(state: AdventureState): void {
  const position = { ...state.position };
  state.pending.stages.push({ ...position, result: 'fail' });
  state.events.push({ type: 'stage-fail', position });
  if (!state.rules.autoRetry && stageIndex(position) > 0) state.position = previousPosition(position);
  restartStage(state);
}

function finishWave(state: AdventureState): void {
  state.waveActive = false;
  state.wave += 1;
  if (state.wave < WAVES_PER_STAGE) return;
  const position = { ...state.position };
  const actClear = isActBossStage(position);
  state.pending.stages.push({ ...position, result: 'clear' });
  state.rules.cleared = Math.max(state.rules.cleared, stageIndex(position));
  state.events.push({ type: 'stage-clear', position, actClear });
  const next = nextPosition(position);
  if (state.rules.autoAdvance && next) state.position = next;
  state.wave = 0;
  for (const hero of state.heroes) if (fighting(hero)) setPose(hero, 'victory');
}

/**
 * A pose for a hero that is not fighting right now, from what its agent is
 * doing: one waiting for the owner raises its hand, an idle one keeps pace
 * with the party or sits by the fire when the whole party camps.
 */
function settlePose(hero: Hero, mode: AdventureState['mode']): void {
  if (!standing(hero)) { setPose(hero, 'fallen'); return; }
  if (hero.pose === 'victory' && hero.poseMs < POSE_MS.victory!) return;
  if (hero.pose === 'hurt' && hero.poseMs < POSE_MS.hurt!) return;
  switch (hero.activity) {
    case 'attention': setPose(hero, 'alert'); break;
    case 'stunned': setPose(hero, 'stunned'); break;
    case 'offline': setPose(hero, 'rest'); break;
    case 'done': setPose(hero, mode === 'camp' ? 'rest' : 'victory'); break;
    default: setPose(hero, mode === 'camp' ? 'rest' : mode === 'march' ? 'walk' : 'idle');
  }
}

/**
 * A task the team finished: a strike from above hits every monster on the
 * road, so finished work visibly moves the battle. (The quest chest itself
 * is granted by the server, which counts finished cards.)
 */
export function completeQuest(state: AdventureState, title: string | null = null): AdventureEvent[] {
  state.events = [];
  state.events.push({ type: 'quest', title });
  for (const enemy of living(state)) damageEnemy(state, enemy, enemy.maxHp * (enemy.boss ? 0.2 : enemy.elite ? 0.35 : 0.6), null, true);
  if (state.waveActive && state.enemies.length && state.enemies.every((enemy) => enemy.pose === 'dying')) finishWave(state);
  return state.events;
}
