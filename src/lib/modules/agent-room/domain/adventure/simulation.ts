import {
  HERO_CLASSES,
  MONSTERS,
  STAGES_PER_BIOME,
  WAVES_PER_STAGE,
  levelFromXp,
  stageOf,
  stageScale,
  type HeroAttack,
  type HeroClassId,
  type HeroSpecial,
  type MonsterId,
} from './catalog.js';

/**
 * The Adventure as a pure, deterministic simulation. The party is the team's
 * agents and only their real work moves it: a working agent fights, one that
 * waits for the owner raises its hand, and with nobody working the party sets
 * camp and the waves wait. No DOM, timers or Math.random: the same inputs give
 * the same world, so it is tested without a screen and resumed from a save.
 */

/** What an agent is doing, as the Adventure reads it. */
export type PartyActivity = 'working' | 'attention' | 'stunned' | 'idle' | 'offline' | 'done';

export type PartyMember = {
  id: string;
  classId: HeroClassId;
  leader: boolean;
  activity: PartyActivity;
};

export type HeroPose = 'walk' | 'idle' | 'attack' | 'special' | 'hurt' | 'rest' | 'alert' | 'victory' | 'stunned';

export type Hero = {
  id: string;
  classId: HeroClassId;
  leader: boolean;
  activity: PartyActivity;
  x: number;
  pose: HeroPose;
  poseMs: number;
  attackCd: number;
  specialCd: number;
  /** Hits absorbed by the Cleric's sanctuary. */
  shield: number;
  /** When it joined, for the arrival animation. */
  joinedMs: number;
};

export type EnemyPose = 'move' | 'attack' | 'hurt' | 'dying';

export type Enemy = {
  id: string;
  monsterId: MonsterId;
  x: number;
  hp: number;
  maxHp: number;
  damage: number;
  pose: EnemyPose;
  poseMs: number;
  attackCd: number;
  stunMs: number;
  boss: boolean;
};

export type Projectile = {
  id: string;
  kind: HeroAttack | 'turret';
  fromX: number;
  targetId: string;
  progress: number;
  damage: number;
};

export type Turret = { id: string; ownerId: string; x: number; ttlMs: number; cooldown: number };

export type AdventureEvent =
  | { type: 'attack'; heroId: string; attack: HeroAttack; targetId: string }
  | { type: 'hit'; targetId: string; amount: number; x: number; critical: boolean }
  | { type: 'kill'; monsterId: MonsterId; x: number; xp: number; gold: number; boss: boolean }
  | { type: 'special'; heroId: string; special: HeroSpecial; x: number }
  | { type: 'hero-hit'; heroId: string; amount: number; blocked: boolean }
  | { type: 'wave'; wave: number; stageIndex: number; boss: boolean }
  | { type: 'stage-clear'; stageIndex: number; chapterClear: boolean }
  | { type: 'level-up'; level: number }
  | { type: 'quest'; xp: number; gold: number; title: string | null }
  | { type: 'join'; heroId: string }
  | { type: 'leave'; heroId: string; classId: HeroClassId; x: number }
  | { type: 'camp' }
  | { type: 'march' };

export type AdventureProgress = {
  stageIndex: number;
  wave: number;
  xp: number;
  gold: number;
  kills: number;
  bosses: number;
  quests: number;
};

export type AdventureState = AdventureProgress & {
  version: 1;
  rng: number;
  timeMs: number;
  mode: 'march' | 'battle' | 'camp';
  /** World position of the party's front line; the camera follows it. */
  frontX: number;
  heroes: Hero[];
  enemies: Enemy[];
  projectiles: Projectile[];
  turrets: Turret[];
  /** Time left on the Maestro's anthem. */
  anthemMs: number;
  waveActive: boolean;
  nextId: number;
  events: AdventureEvent[];
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

export const EMPTY_PROGRESS: AdventureProgress = { stageIndex: 0, wave: 0, xp: 0, gold: 0, kills: 0, bosses: 0, quests: 0 };

export function createAdventure(progress: Partial<AdventureProgress> = {}, seed = 1): AdventureState {
  const saved = { ...EMPTY_PROGRESS, ...progress };
  return {
    version: 1,
    ...saved,
    wave: Math.max(0, Math.min(WAVES_PER_STAGE - 1, Math.floor(saved.wave))),
    rng: (seed >>> 0) || 1,
    timeMs: 0,
    mode: 'camp',
    frontX: 0,
    heroes: [],
    enemies: [],
    projectiles: [],
    turrets: [],
    anthemMs: 0,
    waveActive: false,
    nextId: 1,
    events: [],
  };
}

/** What a save keeps: where the party is on the road and what it earned. */
export function progressOf(state: AdventureState): AdventureProgress {
  return { stageIndex: state.stageIndex, wave: state.wave, xp: state.xp, gold: state.gold, kills: state.kills, bosses: state.bosses, quests: state.quests };
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

/** Party level from the experience earned; it scales every hero's damage. */
export function partyLevel(state: Pick<AdventureState, 'xp'>): number {
  return levelFromXp(state.xp).level;
}

function heroDamage(state: AdventureState, hero: Hero): number {
  const base = HERO_CLASSES[hero.classId].damage * (1 + (partyLevel(state) - 1) * 0.08);
  return Math.round(base * (state.anthemMs > 0 ? 1.25 : 1));
}

function formationX(state: AdventureState, hero: Hero): number {
  const ordered = [...state.heroes].sort((a, b) => HERO_CLASSES[a.classId].rank - HERO_CLASSES[b.classId].rank || a.id.localeCompare(b.id));
  return state.frontX - ordered.indexOf(hero) * HERO_SPACING;
}

function setPose(hero: Hero, pose: HeroPose): void {
  if (hero.pose === pose) return;
  hero.pose = pose;
  hero.poseMs = 0;
}

/** Brings the heroes in line with the team: new agents join, removed ones leave. */
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
      existing.activity = member.activity;
      existing.classId = member.classId;
      existing.leader = member.leader;
      continue;
    }
    const hero: Hero = {
      id: member.id, classId: member.classId, leader: member.leader, activity: member.activity,
      x: state.frontX - (state.heroes.length + 2) * HERO_SPACING, pose: 'walk', poseMs: 0,
      attackCd: 400, specialCd: HERO_CLASSES[member.classId].specialMs / 2, shield: 0, joinedMs: state.timeMs,
    };
    state.heroes.push(hero);
    state.events.push({ type: 'join', heroId: hero.id });
  }
}

function spawnWave(state: AdventureState): void {
  const { biome, stage } = stageOf(state.stageIndex);
  const scale = stageScale(state.stageIndex);
  const finalWave = state.wave === WAVES_PER_STAGE - 1;
  const bossWave = finalWave && stage === STAGES_PER_BIOME;
  const count = 2 + Math.min(3, Math.floor(state.wave / 2) + (stage - 1));
  const kinds: MonsterId[] = [];
  for (let index = 0; index < count; index += 1) kinds.push(biome.mobs[Math.floor(random(state) * biome.mobs.length)]);
  if (bossWave) kinds.push(biome.boss);
  let x = state.frontX + SPAWN_AHEAD;
  for (const monsterId of kinds) {
    const monster = MONSTERS[monsterId];
    // A stage's last wave without a boss brings a tougher elite in front.
    const elite = finalWave && !bossWave && kinds[0] === monsterId && x === state.frontX + SPAWN_AHEAD;
    const hp = Math.round(monster.hp * scale * (elite ? 2.2 : 1));
    state.enemies.push({
      id: id(state, 'e'), monsterId, x: x + (monster.boss ? 40 : 0), hp, maxHp: hp,
      damage: Math.round(monster.damage * scale), pose: 'move', poseMs: 0,
      attackCd: monster.attackMs * (0.5 + random(state) * 0.5), stunMs: 0, boss: monster.boss,
    });
    x += ENEMY_SPACING * monster.size;
  }
  state.waveActive = true;
  state.events.push({ type: 'wave', wave: state.wave, stageIndex: state.stageIndex, boss: bossWave });
}

function damageEnemy(state: AdventureState, enemy: Enemy, amount: number): void {
  if (enemy.pose === 'dying') return;
  const critical = random(state) < 0.12;
  const dealt = Math.max(1, Math.round(amount * (critical ? 1.8 : 1)));
  enemy.hp -= dealt;
  state.events.push({ type: 'hit', targetId: enemy.id, amount: dealt, x: enemy.x, critical });
  if (enemy.hp > 0) {
    if (enemy.pose !== 'attack') { enemy.pose = 'hurt'; enemy.poseMs = 0; }
    return;
  }
  enemy.hp = 0;
  enemy.pose = 'dying';
  enemy.poseMs = 0;
  const monster = MONSTERS[enemy.monsterId];
  const scale = stageScale(state.stageIndex);
  const xp = Math.round(monster.xp * scale);
  const gold = Math.round(monster.gold * scale);
  gainXp(state, xp);
  state.gold += gold;
  state.kills += 1;
  if (enemy.boss) state.bosses += 1;
  state.events.push({ type: 'kill', monsterId: enemy.monsterId, x: enemy.x, xp, gold, boss: enemy.boss });
}

function gainXp(state: AdventureState, amount: number): void {
  const before = partyLevel(state);
  state.xp += amount;
  const after = partyLevel(state);
  if (after > before) state.events.push({ type: 'level-up', level: after });
}

function frontEnemy(state: AdventureState): Enemy | null {
  let front: Enemy | null = null;
  for (const enemy of state.enemies) if (enemy.pose !== 'dying' && (!front || enemy.x < front.x)) front = enemy;
  return front;
}

function useSpecial(state: AdventureState, hero: Hero, target: Enemy): void {
  const special = HERO_CLASSES[hero.classId].special;
  const damage = heroDamage(state, hero);
  setPose(hero, 'special');
  state.events.push({ type: 'special', heroId: hero.id, special, x: hero.x });
  switch (special) {
    case 'anthem':
      state.anthemMs = 6_000;
      break;
    case 'turret':
      state.turrets.push({ id: id(state, 't'), ownerId: hero.id, x: hero.x + 18, ttlMs: 8_000, cooldown: 0 });
      break;
    case 'meteor':
      for (const enemy of state.enemies) damageEnemy(state, enemy, damage * 1.6);
      break;
    case 'shield-bash':
      damageEnemy(state, target, damage * 1.5);
      target.stunMs = 1_600;
      target.x += 14;
      break;
    case 'volley': {
      const targets = state.enemies.filter((enemy) => enemy.pose !== 'dying').sort((a, b) => a.x - b.x).slice(0, 3);
      for (const enemy of targets) state.projectiles.push({ id: id(state, 'p'), kind: 'arrow', fromX: hero.x, targetId: enemy.id, progress: 0, damage });
      break;
    }
    case 'sanctuary':
      for (const ally of state.heroes) {
        ally.shield = 2;
        if (ally.pose === 'stunned' || ally.pose === 'hurt') setPose(ally, 'idle');
      }
      break;
  }
}

function strike(state: AdventureState, hero: Hero, target: Enemy): void {
  const attack = HERO_CLASSES[hero.classId].attack;
  setPose(hero, 'attack');
  state.events.push({ type: 'attack', heroId: hero.id, attack, targetId: target.id });
  const damage = heroDamage(state, hero);
  if (attack === 'melee') damageEnemy(state, target, damage);
  else state.projectiles.push({ id: id(state, 'p'), kind: attack, fromX: hero.x + 10, targetId: target.id, progress: 0, damage });
}

/** Advances the world by `dtMs`; returns the events of this step (also kept on `state.events` until cleared). */
export function stepAdventure(state: AdventureState, party: readonly PartyMember[], dtMs: number): AdventureEvent[] {
  state.events = [];
  const dt = Math.max(0, Math.min(dtMs, 250));
  state.timeMs += dt;
  syncParty(state, party);

  for (const hero of state.heroes) hero.poseMs += dt;
  const fighters = state.heroes.filter((hero) => hero.activity === 'working');

  // Nobody working: the party camps, the monsters hold their ground.
  if (!fighters.length) {
    if (state.mode !== 'camp') { state.mode = 'camp'; state.events.push({ type: 'camp' }); }
    for (const hero of state.heroes) {
      const target = formationX(state, hero);
      hero.x += Math.sign(target - hero.x) * Math.min(Math.abs(target - hero.x), MARCH_SPEED * dt / 1000);
      settlePose(hero, state.mode);
    }
    return state.events;
  }
  if (state.mode === 'camp') { state.mode = 'march'; state.events.push({ type: 'march' }); }

  state.anthemMs = Math.max(0, state.anthemMs - dt);
  if (!state.waveActive) spawnWave(state);

  const front = frontEnemy(state);
  // March until the first monster is close, then hold the line.
  const engaged = front !== null && front.x - state.frontX < 70;
  state.mode = engaged ? 'battle' : 'march';
  if (!engaged) state.frontX += MARCH_SPEED * dt / 1000;
  for (const hero of state.heroes) {
    const target = formationX(state, hero);
    const speed = (hero.x < target - 40 ? MARCH_SPEED * 2.2 : MARCH_SPEED) * dt / 1000;
    hero.x += Math.sign(target - hero.x) * Math.min(Math.abs(target - hero.x), speed);
  }

  // Heroes.
  const haste = state.anthemMs > 0 ? 1.35 : 1;
  // Ranged heroes cover the whole line from behind: their reach counts from the
  // front. While a working knight holds the front they wait for the monster to
  // engage it, so the knight fights too instead of watching the volleys.
  const frontLine = Math.max(...state.heroes.map((hero) => hero.x));
  const tank = state.heroes.some((hero) => hero.activity === 'working' && HERO_CLASSES[hero.classId].attack === 'melee');
  for (const hero of state.heroes) {
    hero.attackCd -= dt * haste;
    hero.specialCd -= dt * haste;
    if (hero.activity !== 'working') { settlePose(hero, state.mode); continue; }
    if (POSE_MS[hero.pose] && hero.poseMs < POSE_MS[hero.pose]!) continue;
    const target = frontEnemy(state);
    const heroClass = HERO_CLASSES[hero.classId];
    const reach = heroClass.attack === 'melee' ? heroClass.range : tank ? ENGAGED_GAP : heroClass.range;
    const inRange = target !== null && frontEdge(target) - (heroClass.attack === 'melee' ? hero.x : frontLine) <= reach;
    if (target && inRange && hero.specialCd <= 0) {
      useSpecial(state, hero, target);
      hero.specialCd = HERO_CLASSES[hero.classId].specialMs;
      hero.attackCd = Math.max(hero.attackCd, 300);
    } else if (target && inRange && hero.attackCd <= 0) {
      strike(state, hero, target);
      hero.attackCd = HERO_CLASSES[hero.classId].attackMs;
    } else {
      setPose(hero, engaged ? 'idle' : 'walk');
    }
  }

  // Turrets.
  for (const turret of state.turrets) {
    turret.ttlMs -= dt;
    turret.cooldown -= dt;
    const target = frontEnemy(state);
    if (target && turret.cooldown <= 0 && target.x - turret.x < 120) {
      state.projectiles.push({ id: id(state, 'p'), kind: 'turret', fromX: turret.x, targetId: target.id, progress: 0, damage: 5 + partyLevel(state) });
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
    if (projectile.progress >= 1) damageEnemy(state, target, projectile.damage);
  }
  state.projectiles = state.projectiles.filter((projectile) => projectile.progress < 1);

  // Monsters.
  const frontHero = [...state.heroes].sort((a, b) => b.x - a.x)[0];
  // Monsters stop within reach of the front hero's sword.
  let line = (frontHero ? frontHero.x : state.frontX) + MELEE_GAP;
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
        const blocked = frontHero.shield > 0;
        if (blocked) frontHero.shield -= 1;
        else if (frontHero.activity === 'working' && frontHero.pose !== 'special') setPose(frontHero, 'hurt');
        state.events.push({ type: 'hero-hit', heroId: frontHero.id, amount: enemy.damage, blocked });
      } else if (enemy.pose === 'attack' && enemy.poseMs > 360) {
        enemy.pose = 'move';
        enemy.poseMs = 0;
      }
    }
    line = Math.max(line, enemy.x) + ENEMY_SPACING * monster.size * 0.8;
  }
  // The dead linger for their death animation.
  state.enemies = state.enemies.filter((enemy) => enemy.pose !== 'dying' || enemy.poseMs < 600);

  if (state.waveActive && state.enemies.every((enemy) => enemy.pose === 'dying')) finishWave(state);
  return state.events;
}

function frontEdge(enemy: Enemy): number {
  return enemy.x - BODY_HALF * MONSTERS[enemy.monsterId].size;
}

function finishWave(state: AdventureState): void {
  state.waveActive = false;
  state.wave += 1;
  if (state.wave < WAVES_PER_STAGE) return;
  const { stage } = stageOf(state.stageIndex);
  state.events.push({ type: 'stage-clear', stageIndex: state.stageIndex, chapterClear: stage === STAGES_PER_BIOME });
  state.stageIndex += 1;
  state.wave = 0;
  for (const hero of state.heroes) if (hero.activity === 'working') setPose(hero, 'victory');
}

/**
 * A pose for a hero that is not fighting right now, from what its agent is
 * doing: one waiting for the owner raises its hand, an idle one keeps pace
 * with the party or sits by the fire when the whole party camps.
 */
function settlePose(hero: Hero, mode: AdventureState['mode']): void {
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
 * A task the team finished: the quest pays out and a strike from above hits
 * every monster on the road, so finished work visibly moves the battle.
 */
export function completeQuest(state: AdventureState, title: string | null = null): AdventureEvent[] {
  state.events = [];
  const scale = stageScale(state.stageIndex);
  const xp = Math.round(25 * scale);
  const gold = Math.round(12 * scale);
  gainXp(state, xp);
  state.gold += gold;
  state.quests += 1;
  state.events.push({ type: 'quest', xp, gold, title });
  for (const enemy of state.enemies) damageEnemy(state, enemy, enemy.maxHp * (enemy.boss ? 0.25 : 0.6));
  if (state.waveActive && state.enemies.length && state.enemies.every((enemy) => enemy.pose === 'dying')) finishWave(state);
  return state.events;
}
