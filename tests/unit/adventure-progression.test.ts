import { describe, expect, it } from 'vitest';
import type { HeroClassId } from '$lib/modules/agent-room/domain/adventure/catalog.js';
import { newAccount, newHero } from '$lib/modules/agent-room/domain/adventure/account.js';
import { buildHeroes, deployHeroes, outfitProgress, visualTier } from '$lib/modules/agent-room/domain/adventure/build.js';
import { craft, synthesisRarity } from '$lib/modules/agent-room/domain/adventure/cube.js';
import { SETS, SET_PIECES, UNIQUES, elixirStats, setBonuses, type SetId } from '$lib/modules/agent-room/domain/adventure/artifacts.js';
import {
  AdventureError, applyReport, autoOpenChests, balanceGuild, buyRune, craftItem, settleLoot, updateSettings, drinkElixir, equipItem, fuseGems, makeOffering, openChests, partyBuilds, payOffline, payQuests, salvage, socketItem,
  synthesizeItems, bindRoster, heroOfAgent, setHeroClass, travel, unsocketItem, type AdventureSave, type EngineContext, type RosterEntry,
} from '$lib/modules/agent-room/domain/adventure/engine.js';
import {
  RARITIES, RARITY_RULES, canEquip, gemQualityFor, itemBaseKey, itemIcon, itemStats, materialKey, materialStats, parseMaterialKey, rollItem,
  type Item, type Rarity, type Slot,
} from '$lib/modules/agent-room/domain/adventure/items.js';
import { openChest, rollRarity, rollUnique } from '$lib/modules/agent-room/domain/adventure/loot.js';
import { canBuyRune, formationSlots } from '$lib/modules/agent-room/domain/adventure/runes.js';
import { SKILL_TREES, autoAllocate, canRaise, pointsSpent, sanitizeRanks } from '$lib/modules/agent-room/domain/adventure/skills.js';
import { NO_CLEARS, addXp, positionAt, regionLevel, stageUnlocked, xpToNext, difficultyUnlocked, MAX_HERO_LEVEL } from '$lib/modules/agent-room/domain/adventure/world.js';

function seeded(seed = 7) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const roster: RosterEntry[] = [
  { nodeId: 'lead', title: 'Lead', role: 'Tech lead', leader: true, working: true },
  { nodeId: 'qa', title: 'QA', role: 'QA engineer', leader: false, working: true },
  { nodeId: 'api', title: 'API', role: 'Backend', leader: false, working: false },
];

// Ids stay unique across contexts, like uuids would.
let counter = 0;

function context(seed = 3, team: RosterEntry[] = roster): EngineContext {
  return { rng: seeded(seed), newId: () => `id-${++counter}`, now: '2026-10-26T12:00:00.000Z', roster: team };
}

/** The hero an agent of the test roster plays. */
function hero(save: AdventureSave, nodeId: string) {
  return heroOfAgent(save, nodeId)!;
}

function freshSave(ctx: EngineContext): AdventureSave {
  const save: AdventureSave = { account: newAccount('2026-10-26T00:00:00.000Z'), heroes: {}, items: [] };
  bindRoster(save, ctx);
  return save;
}

describe('adventure world', () => {
  it('maps acts, stages and difficulties to region levels and unlocks them in order', () => {
    expect(regionLevel(positionAt('normal', 0))).toBe(1);
    expect(regionLevel(positionAt('normal', 49))).toBe(50);
    expect(regionLevel(positionAt('torment', 49))).toBe(110);
    expect(stageUnlocked(NO_CLEARS, positionAt('normal', 0))).toBe(true);
    expect(stageUnlocked(NO_CLEARS, positionAt('normal', 1))).toBe(false);
    expect(difficultyUnlocked({ ...NO_CLEARS, normal: 48 }, 'nightmare')).toBe(false);
    expect(difficultyUnlocked({ ...NO_CLEARS, normal: 49 }, 'nightmare')).toBe(true);
  });

  it('levels heroes up to 100 on a growing curve', () => {
    expect(xpToNext(50)).toBeGreaterThan(xpToNext(10) * 5);
    const result = addXp(1, 0, xpToNext(1) + xpToNext(2) + 5);
    expect(result).toMatchObject({ level: 3, xp: 5, levelsGained: 2, paragon: 0 });
    expect(addXp(99, 0, Number.MAX_SAFE_INTEGER).level).toBe(MAX_HERO_LEVEL);
  });
});

describe('adventure items and loot', () => {
  it('crafts main and off hands for the class picked, whatever classes the guild has', () => {
    for (const slot of ['weapon', 'offhand'] as const) {
      for (const classId of ['sorceress', 'cleric', 'artificer'] as const) {
        const item = craft(() => 0.42, { slot, level: 1, classId, cubeLevel: 2, magicFind: 0, difficulty: 'normal', partyClasses: ['knight'] });
        expect(item).toMatchObject({ slot, classId });
      }
    }
    expect(craft(() => 0.42, { slot: 'boots', level: 1, classId: 'sorceress', cubeLevel: 2, magicFind: 0, difficulty: 'normal', partyClasses: ['knight'] }).classId).toBeNull();
  });

  it('rolls affixes and sockets by rarity', () => {
    const rng = seeded(11);
    for (const rarity of RARITIES) {
      const item = rollItem(rng, { level: 40, rarity, slot: 'helmet' });
      expect(item.affixes).toHaveLength(RARITY_RULES[rarity].affixes);
      expect(item.sockets.map((socket) => socket.kind)).toEqual(RARITY_RULES[rarity].sockets);
      expect(new Set(item.affixes.map((affix) => affix.stat)).size).toBe(item.affixes.length);
    }
  });

  it('makes higher levels and rarities stronger', () => {
    const base = { slot: 'weapon' as const, classId: 'knight' as const, affixes: [], sockets: [] };
    expect(itemStats({ ...base, rarity: 'common', level: 50 }).attack!).toBeGreaterThan(itemStats({ ...base, rarity: 'common', level: 10 }).attack!);
    expect(itemStats({ ...base, rarity: 'legendary', level: 10 }).attack!).toBeGreaterThan(itemStats({ ...base, rarity: 'common', level: 10 }).attack!);
  });

  it('keeps weapons to their class and gear within ten levels', () => {
    const sword = { slot: 'weapon' as const, classId: 'knight' as const, level: 20 };
    expect(canEquip(sword, { classId: 'ranger', level: 30 })).toBe('class');
    expect(canEquip(sword, { classId: 'knight', level: 9 })).toBe('level');
    expect(canEquip(sword, { classId: 'knight', level: 10 })).toBe('ok');
  });

  it('finds rarer gear with magic find, harder difficulties and better chests', () => {
    const share = (draw: () => Rarity) => {
      let rare = 0;
      for (let index = 0; index < 4000; index += 1) if (RARITIES.indexOf(draw()) >= 3) rare += 1;
      return rare / 4000;
    };
    const rng = seeded(5);
    const plain = share(() => rollRarity(rng, 'white', 0, 'normal'));
    expect(share(() => rollRarity(rng, 'white', 200, 'normal'))).toBeGreaterThan(plain);
    expect(share(() => rollRarity(rng, 'white', 0, 'torment'))).toBeGreaterThan(plain);
    expect(share(() => rollRarity(rng, 'red', 0, 'normal'))).toBeGreaterThan(0.5);
  });

  it('fills red chests with three items and a coin', () => {
    const contents = openChest(seeded(2), { tier: 'red', level: 20, difficulty: 'normal', act: 2, magicFind: 0, goldMultiplier: 1, partyClasses: ['knight'] });
    // Three items, plus the act boss's unique when luck strikes.
    expect(contents.items.filter((item) => !item.uniqueId)).toHaveLength(3);
    expect(contents.items.every((item) => RARITIES.indexOf(item.rarity) >= 2)).toBe(true);
    expect(contents.coins).toBe(1);
    expect(contents.gold).toBeGreaterThan(0);
  });
});

describe('adventure skills and runes', () => {
  it('opens a tier after ten points per previous tier, up to the 70-point capstone', () => {
    const ultimate = SKILL_TREES.ranger.find((node) => node.tier === 8)!;
    expect(canRaise('ranger', 100, {}, ultimate.id)).toBe('tier');
    const ranks = autoAllocate('ranger', 80, {});
    expect(pointsSpent(ranks)).toBe(80);
    expect(canRaise('ranger', 100, ranks, ultimate.id)).toBe('ok');
    expect(canRaise('ranger', 1, {}, 'knight.drill')).toBe('unknown');
  });

  it('refunds skills a hero can no longer hold', () => {
    const ranks = autoAllocate('knight', 30, {});
    expect(pointsSpent(sanitizeRanks('knight', 10, ranks))).toBe(10);
    expect(sanitizeRanks('ranger', 30, ranks)).toEqual({});
  });

  it('chains runes and charges gold', () => {
    expect(canBuyRune('fortune', {}, 1e9)).toBe('locked');
    expect(canBuyRune('greed', {}, 10)).toBe('gold');
    expect(canBuyRune('greed', { greed: 5 }, 1e9)).toBe('max');
    expect(formationSlots({ command: 2 })).toBe(5);
  });
});

describe('adventure engine', () => {
  it('gives every agent a hero with a starter kit and builds the formation from who works', () => {
    const ctx = context();
    const save = freshSave(ctx);
    expect(Object.values(save.heroes).map((entry) => [entry.agentNodeId, entry.classId, entry.leader]).sort()).toEqual([['api', 'knight', false], ['lead', 'maestro', true], ['qa', 'ranger', false]]);
    expect(save.items.filter((item) => item.heroId === hero(save, 'qa').id).map((item) => item.slot).sort()).toEqual(['armor', 'weapon']);
    expect(save.items.find((item) => item.heroId === hero(save, 'qa').id && item.slot === 'weapon')?.classId).toBe('ranger');
    const candidates = [
      { heroId: 'lead', leader: true, working: false, present: true, level: 3 },
      { heroId: 'qa', leader: false, working: true, present: true, level: 2 },
      { heroId: 'old', leader: false, working: false, present: false, level: 40 },
      { heroId: 'api', leader: false, working: false, present: true, level: 9 },
    ];
    expect(deployHeroes(candidates, ['api'], 3)).toEqual(['api', 'qa', 'lead']);
    // A lone agent still fields a full party from the resting guild.
    expect(deployHeroes(candidates.filter((entry) => entry.heroId !== 'api' && entry.heroId !== 'qa'), [], 3)).toEqual(['lead', 'old']);
    // Heroes start skilled: their first point goes to the class's first active.
    expect(hero(save, 'qa').skills['ranger.volley']).toBe(1);
  });

  it('keeps a dismissed agent\'s hero in the guild and hands it to the next agent of its class', () => {
    const ctx = context();
    const save = freshSave(ctx);
    const ranger = hero(save, 'qa');
    ranger.level = 30;
    // The leader dismisses QA: its hero rests, with its level and gear.
    bindRoster(save, context(4, roster.filter((entry) => entry.nodeId !== 'qa')));
    expect(save.heroes[ranger.id].agentNodeId).toBeNull();
    expect(save.items.filter((item) => item.heroId === ranger.id)).toHaveLength(2);
    // A new QA agent takes up the resting ranger instead of starting over.
    bindRoster(save, context(5, [...roster.filter((entry) => entry.nodeId !== 'qa'), { nodeId: 'qa-2', title: 'QA Login', role: 'QA engineer', leader: false, working: true }]));
    expect(heroOfAgent(save, 'qa-2')?.id).toBe(ranger.id);
    expect(save.heroes[ranger.id].level).toBe(30);
    expect(save.heroes[ranger.id].agentTitle).toBe('QA Login');
    // Two QA agents at once: the second one recruits a new ranger.
    bindRoster(save, context(6, [...roster, { nodeId: 'qa-3', title: 'QA Upload', role: 'QA', leader: false, working: true }]));
    expect(Object.values(save.heroes).filter((entry) => entry.classId === 'ranger')).toHaveLength(2);
  });

  it('gives the Maestro to whoever leads and names every hero', () => {
    const ctx = context();
    const save = freshSave(ctx);
    const maestro = hero(save, 'lead');
    bindRoster(save, context(7, roster.map((entry) => ({ ...entry, leader: entry.nodeId === 'api' }))));
    expect(heroOfAgent(save, 'api')?.id).toBe(maestro.id);
    expect(new Set(Object.values(save.heroes).map((entry) => entry.name)).size).toBe(Object.keys(save.heroes).length);
    expect(() => setHeroClass(save, ctx, maestro.id, 'knight')).toThrow('leader-class');
  });

  it('lets new recruits catch up with a guild far ahead', () => {
    const earned = (topLevel: number) => {
      const ctx = context();
      const save = freshSave(ctx);
      hero(save, 'lead').level = topLevel;
      const recruit = hero(save, 'api');
      applyReport(save, { reportId: `c${topLevel}`, elapsedMs: 60_000, position: positionAt('normal', 0), wave: 0, xp: { [recruit.id]: 300 }, gold: 0, kills: { 'glitch-slime': 30 }, chests: [], bosses: [], stages: [] }, ctx);
      // Total experience: every level climbed plus the progress into the current one.
      let total = recruit.xp;
      for (let level = 1; level < recruit.level; level += 1) total += xpToNext(level);
      return total;
    };
    expect(earned(40)).toBe(earned(1) * 1.5);
  });

  it('turns experience past level 100 into endless Paragon levels', () => {
    const ctx = context();
    const save = freshSave(ctx);
    const lead = hero(save, 'lead');
    lead.level = 100;
    const result = applyReport(save, { reportId: 'p1', elapsedMs: 600_000, position: positionAt('torment', 49), wave: 0, xp: { [lead.id]: 1e12 }, gold: 0, kills: { 'outage-kraken': 3000 }, chests: [], bosses: [], stages: [] }, ctx);
    expect(lead.level).toBe(100);
    expect(lead.paragon).toBeGreaterThan(0);
    expect(result.levelUps.some((entry) => entry.paragon)).toBe(true);
  });

  it('applies a battle report: experience, gold, kills, chests and clears', () => {
    const ctx = context();
    const save = freshSave(ctx);
    const result = applyReport(save, {
      reportId: 'r1', elapsedMs: 60_000, position: positionAt('normal', 1), wave: 0,
      xp: { [hero(save, 'qa').id]: xpToNext(1) * 3 }, gold: 50, kills: { 'glitch-slime': 20 },
      chests: [{ tier: 'white', level: 1, difficulty: 'normal', act: 1 }], bosses: [],
      stages: [{ difficulty: 'normal', act: 1, stage: 1, result: 'clear' }],
    }, ctx);
    expect(result.levelUps[0]).toMatchObject({ heroId: hero(save, 'qa').id });
    expect(hero(save, 'qa').level).toBeGreaterThan(1);
    expect(save.account.gold).toBe(50);
    expect(save.account.killsByMonster['glitch-slime']).toBe(20);
    expect(save.account.chests).toHaveLength(1);
    expect(save.account.cleared.normal).toBe(0);
    expect(save.account.position).toEqual(positionAt('normal', 1));
    // The same report twice is applied once.
    expect(applyReport(save, { reportId: 'r1', elapsedMs: 1000, position: positionAt('normal', 1), wave: 0, xp: {}, gold: 999, kills: {}, chests: [], bosses: [], stages: [] }, ctx).duplicate).toBe(true);
    expect(save.account.gold).toBe(50);
  });

  it('opens chests into the inventory and charges a soulstone for repeat red chests', () => {
    const ctx = context();
    const save = freshSave(ctx);
    save.account.chests = [
      { id: 'c1', tier: 'red', level: 10, difficulty: 'normal', act: 1 },
      { id: 'c2', tier: 'red', level: 10, difficulty: 'normal', act: 1 },
    ];
    const [first] = openChests(save, ctx, { ids: ['c1'] });
    expect(first.items).toHaveLength(3);
    // The first chest may itself hold a soulstone.
    save.account.soulstones.normal = 0;
    expect(() => openChests(save, ctx, { ids: ['c2'] })).toThrow(AdventureError);
    save.account.soulstones.normal = 1;
    const [second] = openChests(save, ctx, { ids: ['c2'] });
    expect(save.account.soulstones.normal).toBe(second.soulstones);
  });

  it('equips, swaps and refuses gear a hero cannot use', () => {
    const ctx = context();
    const save = freshSave(ctx);
    const bow = save.items.find((item) => item.heroId === hero(save, 'qa').id && item.slot === 'weapon')!;
    expect(() => equipItem(save, bow.id, hero(save, 'api').id)).toThrow('equip-class');
    const better: Item = { ...rollItem(ctx.rng, { level: 1, rarity: 'rare', slot: 'weapon', classId: 'ranger' }), id: 'b2', location: 'inventory', heroId: null, locked: false, createdAt: ctx.now };
    save.items.push(better);
    equipItem(save, 'b2', hero(save, 'qa').id);
    expect(better.location).toBe('equipped');
    expect(bow.location).toBe('inventory');
  });

  it('synthesizes nine items of a rarity into a rarer one, and salvages for gold', () => {
    const ctx = context();
    const save = freshSave(ctx);
    save.account.gold = 1e6;
    const make = (index: number): Item => ({ ...rollItem(ctx.rng, { level: 10, rarity: 'uncommon' }), id: `s${index}`, location: 'inventory', heroId: null, locked: false, createdAt: ctx.now });
    save.items.push(...Array.from({ length: 10 }, (_, index) => make(index)));
    const result = synthesizeItems(save, ctx, Array.from({ length: 9 }, (_, index) => `s${index}`));
    expect(RARITIES.indexOf(result.rarity)).toBeGreaterThan(RARITIES.indexOf('uncommon'));
    expect(save.items.some((item) => item.id === 's0')).toBe(false);
    const before = save.account.gold;
    expect(salvage(save, ['s9'])).toBeGreaterThan(0);
    expect(save.account.gold).toBeGreaterThan(before);
    expect(synthesisRarity(() => 0.99, 'epic', 1)).toBe('legendary');
  });

  it('sockets materials, removes them for gold, crafts and makes offerings as the cube levels', () => {
    const ctx = context();
    const save = freshSave(ctx);
    save.account.gold = 1e6;
    save.account.materials = { ruby: 3, sapphire: 2 };
    const item: Item = { ...rollItem(ctx.rng, { level: 10, rarity: 'rare', slot: 'helmet' }), id: 'h1', location: 'inventory', heroId: null, locked: false, createdAt: ctx.now };
    save.items.push(item);
    socketItem(save, 'h1', 0, 'ruby');
    expect(item.sockets[0].material).toBe('ruby');
    expect(() => unsocketItem(save, 'h1', 0)).toThrow('cube-level');
    save.account.cube.level = 6;
    unsocketItem(save, 'h1', 0);
    expect(item.sockets[0].material).toBeNull();
    expect(() => craftItem(save, ctx, { slot: 'ring', level: 30, classId: null, gems: ['ruby', 'sapphire'] })).not.toThrow();
    save.account.coins = 5;
    expect(makeOffering(save, ctx).level).toBe(1);
  });

  it('pays finished Kanban cards once, after the Adventure started', () => {
    const ctx = context();
    const save = freshSave(ctx);
    const done = [
      { id: 't1', title: 'Ship login', assigneeNodeId: 'qa', finishedAt: '2026-10-26T10:00:00.000Z' },
      { id: 't0', title: 'Old card', assigneeNodeId: 'qa', finishedAt: '2026-10-20T10:00:00.000Z' },
    ];
    expect(payQuests(save, ctx, done)).toHaveLength(1);
    expect(payQuests(save, ctx, done)).toHaveLength(0);
    expect(save.account.chests.map((chest) => chest.tier)).toEqual(['quest']);
  });

  it('pays offline work per hero, without chests', () => {
    const ctx = context();
    const save = freshSave(ctx);
    payOffline(save, ctx, { qa: 2 * 3_600_000, lead: 10_000 });
    expect(hero(save, 'qa').level).toBeGreaterThan(1);
    expect(hero(save, 'lead').level).toBe(1);
    expect(save.account.offline?.minutes).toBe(120);
    expect(save.account.chests).toHaveLength(0);
  });

  it('only travels to unlocked stages and buys runes with gold', () => {
    const ctx = context();
    const save = freshSave(ctx);
    expect(() => travel(save, positionAt('normal', 5))).toThrow('locked-stage');
    save.account.cleared.normal = 10;
    travel(save, positionAt('normal', 5));
    expect(save.account.position).toEqual(positionAt('normal', 5));
    expect(() => buyRune(save, 'greed')).toThrow('rune-gold');
    save.account.gold = 2_000;
    buyRune(save, 'greed');
    expect(save.account.runes.greed).toBe(1);
    expect(save.account.gold).toBe(0);
  });

  it('dresses heroes by the rarity of their gear', () => {
    const piece = (slot: Item['slot'], rarity: Rarity): Item => ({ slot, classId: slot === 'weapon' ? 'knight' : null, rarity, level: 1, affixes: [], sockets: [], id: slot, location: 'equipped', heroId: 'k', locked: false, createdAt: '' });
    const gear = (rarity: Rarity) => (['weapon', 'helmet', 'shoulders', 'armor', 'gloves', 'legs', 'boots'] as const).map((slot) => piece(slot, rarity));
    expect(visualTier([])).toBe(1);
    expect(visualTier(gear('epic'))).toBe(2);
    expect(visualTier(gear('immortal'))).toBe(3);
    expect(visualTier(gear('cosmic'))).toBe(4);
    const builds = buildHeroes([{ heroId: 'k', classId: 'knight', level: 10, xp: 0, skills: {}, actives: [], deployed: true }], gear('legendary'), {}, {});
    expect(builds.k.visualTier).toBe(3);
    expect(builds.k.weaponRarity).toBe('legendary');
  });
});

describe('adventure armory', () => {
  const owned = (data: ReturnType<typeof rollItem>, id: string, heroId: string | null = null): Item => ({ ...data, id, location: heroId ? 'equipped' : 'inventory', heroId, locked: false, createdAt: '' });

  it('rolls three variants per base, each with its own focus, name and icon', () => {
    const rng = seeded(11);
    const seen = new Set<number>();
    for (let index = 0; index < 60; index += 1) seen.add(rollItem(rng, { level: 30, rarity: 'rare', slot: 'boots' }).variant ?? 0);
    expect([...seen].sort()).toEqual([0, 1, 2]);
    const swift = rollItem(rng, { level: 30, rarity: 'common', slot: 'weapon', classId: 'ranger', variant: 1 });
    expect(itemStats(swift).attackSpeed).toBeGreaterThan(0);
    expect(itemBaseKey(swift)).toBe('weapon-ranger.1.1');
    expect(itemIcon(swift)).toEqual({ atlas: 'icons-weapons-v-ranger', frame: 1 });
    // Off hands belong to a class and have one look per tier.
    const shield = rollItem(rng, { level: 45, rarity: 'rare', slot: 'offhand', classId: 'knight' });
    expect(shield.variant ?? 0).toBe(0);
    expect(itemBaseKey(shield)).toBe('offhand-knight.2');
    expect(canEquip(shield, { classId: 'ranger', level: 50 })).toBe('class');
  });

  it('wears two rings and two trinkets, replacing the chosen or the weaker one', () => {
    const ctx = context();
    const save = freshSave(ctx);
    const qa = hero(save, 'qa');
    const ring = (id: string, rarity: Rarity) => owned(rollItem(ctx.rng, { level: 1, rarity, slot: 'ring' }), id);
    save.items.push(ring('r1', 'common'), ring('r2', 'epic'), ring('r3', 'rare'), ring('r4', 'rare'));
    equipItem(save, 'r1', qa.id);
    equipItem(save, 'r2', qa.id);
    const worn = () => save.items.filter((item) => item.slot === 'ring' && item.location === 'equipped' && item.heroId === qa.id).map((item) => item.id).sort();
    expect(worn()).toEqual(['r1', 'r2']);
    equipItem(save, 'r3', qa.id);
    expect(worn()).toEqual(['r2', 'r3']);
    equipItem(save, 'r4', qa.id, 'r2');
    expect(worn()).toEqual(['r3', 'r4']);
  });

  it('adds up set pieces into two-, four- and six-piece bonuses, for the set\'s class only', () => {
    const rng = seeded(5);
    const pieces = SET_PIECES.map((slot, index) => owned(rollItem(rng, { level: 30, rarity: 'epic', setId: 'oathkeeper', slot }), `p${index}`, 'k'));
    expect(pieces.map((item) => item.slot)).toEqual(SET_PIECES);
    expect(canEquip(pieces[0], { classId: 'ranger', level: 40 })).toBe('class');
    expect(setBonuses({ oathkeeper: 3 }).stats).toEqual(SETS.oathkeeper.bonuses[2]);
    expect(setBonuses({ oathkeeper: 6 }).powers).toEqual(['bastion']);
    const build = (count: number) => buildHeroes([{ heroId: 'k', classId: 'knight', level: 30, xp: 0, skills: {}, actives: [], deployed: true }], pieces.slice(0, count), {}, {}).k;
    expect(build(1).sets).toEqual({ oathkeeper: 1 });
    expect(build(4).stats.damageReduction).toBeGreaterThan(build(3).stats.damageReduction ?? 0);
    expect(build(5).powers).toEqual([]);
    expect(build(6).powers).toEqual(['bastion']);
  });

  it('drops each act boss\'s uniques from its red chests, and the wandering ones only on Hell and Torment', () => {
    const rng = seeded(21);
    const found = (act: number, difficulty: 'normal' | 'hell') => {
      const ids = new Set<string>();
      for (let index = 0; index < 2_000; index += 1) {
        const uniqueId = rollUnique(rng, { act, difficulty, magicFind: 200 });
        if (uniqueId) ids.add(uniqueId);
      }
      return [...ids].sort();
    };
    const act1 = Object.values(UNIQUES).filter((unique) => unique.act === 1).map((unique) => unique.id).sort();
    const wandering = Object.values(UNIQUES).filter((unique) => unique.act === null).map((unique) => unique.id);
    expect(found(1, 'normal')).toEqual(act1);
    expect(found(1, 'hell')).toEqual([...act1, ...wandering].sort());
    const item = rollItem(rng, { level: 40, rarity: 'legendary', uniqueId: 'hydra-merge' });
    expect(item).toMatchObject({ slot: 'weapon', classId: 'knight', uniqueId: 'hydra-merge' });
    expect(itemIcon(item)).toEqual(UNIQUES['hydra-merge'].icon);
    expect(buildHeroes([{ heroId: 'k', classId: 'knight', level: 40, xp: 0, skills: {}, actives: [], deployed: true }], [owned(item, 'u', 'k')], {}, {}).k.powers).toEqual(['cleave']);
  });

  it('keeps gems by cut, scales what they grant and fuses three into the next cut', () => {
    expect(materialKey('ruby')).toBe('ruby');
    expect(materialKey('ruby', 1)).toBe('ruby:1');
    expect(materialKey('fury-rune', 1)).toBe('fury-rune');
    expect(parseMaterialKey('sapphire:5')).toEqual({ material: 'sapphire', quality: 5 });
    expect(parseMaterialKey('fury-rune:2')).toBeNull();
    expect(materialStats('ruby', 5, 'weapon').attackPct).toBeGreaterThan(materialStats('ruby', 1, 'weapon').attackPct!);
    expect(gemQualityFor(() => 0, 1)).toBe(1);
    expect(gemQualityFor(() => 0.99, 110)).toBe(3);
    const ctx = context();
    const save = freshSave(ctx);
    save.account.gold = 1e6;
    save.account.materials = { 'ruby:1': 4 };
    expect(() => fuseGems(save, 'ruby', 1)).toThrow('cube-level');
    save.account.cube.level = 2;
    expect(fuseGems(save, 'ruby', 1)).toBe(2);
    expect(save.account.materials).toEqual({ 'ruby:1': 1, 'ruby:2': 1 });
    expect(() => fuseGems(save, 'ruby', 1)).toThrow('fusion-gems');
    expect(() => fuseGems(save, 'ruby', 5)).toThrow('fusion-max');
    // A socketed gem keeps its cut.
    const helm = owned(rollItem(ctx.rng, { level: 10, rarity: 'rare', slot: 'helmet' }), 'h');
    save.items.push(helm);
    socketItem(save, 'h', 0, 'ruby', 2);
    expect(helm.sockets[0]).toEqual({ kind: 'decoration', material: 'ruby', quality: 2 });
    expect(save.account.materials['ruby:2']).toBe(0);
  });

  it('drinks elixirs for half an hour that every hero feels, stacking up to four hours', () => {
    const ctx = context();
    const save = freshSave(ctx);
    expect(() => drinkElixir(save, ctx, 'wisdom')).toThrow('elixir');
    save.account.elixirs = { wisdom: 10 };
    const before = partyBuilds(save, roster, Date.parse(ctx.now)).builds[hero(save, 'qa').id].profile.xpMultiplier;
    const until = drinkElixir(save, ctx, 'wisdom');
    expect(Date.parse(until) - Date.parse(ctx.now)).toBe(30 * 60_000);
    const during = partyBuilds(save, roster, Date.parse(ctx.now) + 60_000).builds[hero(save, 'qa').id].profile.xpMultiplier;
    expect(during).toBeCloseTo(before + 0.5);
    for (let index = 0; index < 9; index += 1) drinkElixir(save, ctx, 'wisdom');
    expect(Date.parse(save.account.activeElixirs.wisdom!) - Date.parse(ctx.now)).toBe(4 * 3_600_000);
    expect(elixirStats(save.account.activeElixirs, Date.parse(ctx.now) + 5 * 3_600_000)).toEqual({});
  });

  it('opens chests into elixirs and cut gems as well', () => {
    let elixirs = 0;
    const cuts = new Set<string>();
    for (let seed = 0; seed < 40; seed += 1) {
      const contents = openChest(seeded(seed), { tier: 'quest', level: 30, difficulty: 'normal', act: 3, magicFind: 0, goldMultiplier: 1, partyClasses: ['knight'] });
      elixirs += Object.values(contents.elixirs).reduce((sum, count) => sum + (count ?? 0), 0);
      for (const key of Object.keys(contents.materials)) cuts.add(key.includes(':') ? key.split(':')[1] : '3');
    }
    expect(elixirs).toBe(40);
    expect(cuts.size).toBeGreaterThan(1);
    const sets = new Set<SetId>();
    for (let seed = 0; seed < 300; seed += 1) {
      for (const item of openChest(seeded(seed), { tier: 'red', level: 40, difficulty: 'hell', act: 4, magicFind: 0, goldMultiplier: 1, partyClasses: ['ranger'] }).items) if (item.setId) sets.add(item.setId);
    }
    expect(sets.has('windrunner')).toBe(true);
  });
});

describe('adventure automation', () => {
  function stored(save: AdventureSave, ctx: EngineContext, id: string, data: ReturnType<typeof rollItem>, locked = false): Item {
    const item: Item = { ...data, id, location: 'inventory', heroId: null, locked, createdAt: ctx.now };
    save.items.push(item);
    return item;
  }

  function chest(items: Item[]) {
    return { chestId: 'chest', tier: 'white' as const, items, gold: 0, materials: {}, elixirs: {}, soulstones: 0, coins: 0, equipped: {} as Record<string, string>, salvaged: [] as string[] };
  }

  it('opens every kind of chest as it arrives, keeping red ones that need a soulstone', () => {
    const ctx = context(21);
    const save = freshSave(ctx);
    save.account.chests = [
      { id: 'white', tier: 'white', level: 3, difficulty: 'normal', act: 1 },
      { id: 'quest', tier: 'quest', level: 3, difficulty: 'normal', act: 1 },
      { id: 'boss', tier: 'red', level: 5, difficulty: 'normal', act: 1 },
      { id: 'boss-again', tier: 'red', level: 5, difficulty: 'normal', act: 1 },
    ];
    expect(autoOpenChests(save, ctx).map((opened) => opened.chestId)).toEqual(['white', 'quest', 'boss']);
    expect(save.account.chests.map((entry) => entry.id)).toEqual(['boss-again']);
    save.account.soulstones.normal = 1;
    expect(autoOpenChests(save, ctx).map((opened) => opened.chestId)).toEqual(['boss-again']);
    save.account.chests = [{ id: 'later', tier: 'white', level: 3, difficulty: 'normal', act: 1 }];
    updateSettings(save, { autoOpen: false });
    expect(autoOpenChests(save, ctx)).toEqual([]);
  });

  it('puts a clear upgrade on the hero with automatic gear and salvages what nobody wears', () => {
    const ctx = context(22);
    const save = freshSave(ctx);
    const ranger = hero(save, 'qa');
    for (const entry of Object.values(save.heroes)) {
      entry.level = 20;
      entry.autoGear = entry.id === ranger.id;
    }
    const helm = stored(save, ctx, 'helm', rollItem(seeded(1), { level: 20, rarity: 'epic', slot: 'helmet' }));
    // Nobody in this guild is a sorceress: her staffs are leftovers.
    const scrap = stored(save, ctx, 'scrap', rollItem(seeded(2), { level: 5, rarity: 'common', slot: 'weapon', classId: 'sorceress' }));
    const better = stored(save, ctx, 'better', rollItem(seeded(3), { level: 5, rarity: 'uncommon', slot: 'weapon', classId: 'sorceress' }));
    const kept = stored(save, ctx, 'kept', rollItem(seeded(4), { level: 5, rarity: 'common', slot: 'weapon', classId: 'sorceress' }), true);
    const opened = chest([helm, scrap, better, kept]);
    const goldBefore = save.account.gold;
    settleLoot(save, ctx, [opened]);
    expect(opened.equipped).toEqual({ helm: ranger.id });
    expect(save.items.find((item) => item.id === 'helm')).toMatchObject({ location: 'equipped', heroId: ranger.id });
    // Salvage stops at Common by default and never takes a locked item.
    expect(opened.salvaged).toEqual(['scrap']);
    expect(save.items.map((item) => item.id)).toEqual(expect.arrayContaining(['better', 'kept']));
    expect(save.items.some((item) => item.id === 'scrap')).toBe(false);
    expect(save.account.gold).toBeGreaterThan(goldBefore);
    expect(save.account.journal.slice(0, 2).map((entry) => entry.kind)).toEqual(['salvage', 'equip']);
  });

  it('never takes off a locked, unique or set piece and leaves loot alone with everything off', () => {
    const ctx = context(23);
    const save = freshSave(ctx);
    const ranger = hero(save, 'qa');
    for (const entry of Object.values(save.heroes)) {
      entry.level = 30;
      entry.autoGear = entry.id === ranger.id;
    }
    const worn = stored(save, ctx, 'worn', rollItem(seeded(5), { level: 1, rarity: 'common', slot: 'helmet' }), true);
    worn.location = 'equipped';
    worn.heroId = ranger.id;
    const set = stored(save, ctx, 'set', rollItem(seeded(6), { level: 25, rarity: 'epic', setId: 'windrunner', slot: 'boots' }));
    set.location = 'equipped';
    set.heroId = ranger.id;
    const helm = stored(save, ctx, 'helm', rollItem(seeded(7), { level: 30, rarity: 'legendary', slot: 'helmet' }));
    const boots = stored(save, ctx, 'boots', rollItem(seeded(8), { level: 30, rarity: 'legendary', slot: 'boots' }));
    const opened = chest([helm, boots]);
    settleLoot(save, ctx, [opened]);
    expect(opened.equipped).toEqual({});
    expect(save.items.find((item) => item.id === 'worn')?.heroId).toBe(ranger.id);
    expect(save.items.find((item) => item.id === 'set')?.heroId).toBe(ranger.id);
    // Legendary leftovers are past the salvage limit.
    expect(opened.salvaged).toEqual([]);

    // With automatic gear and salvage off, new loot just waits in the bag.
    ranger.autoGear = false;
    updateSettings(save, { autoSalvage: 'off' });
    const spare = stored(save, ctx, 'spare', rollItem(seeded(9), { level: 5, rarity: 'common', slot: 'gloves' }));
    const quiet = chest([spare]);
    settleLoot(save, ctx, [quiet]);
    expect(quiet).toMatchObject({ equipped: {}, salvaged: [] });
    expect(save.items.find((item) => item.id === 'spare')?.location).toBe('inventory');
  });

  it('checks the salvage level and gives Unsealing and Locksmith one more item per chest', () => {
    const ctx = context(24);
    const save = freshSave(ctx);
    updateSettings(save, { autoSalvage: 'mythic' as never });
    expect(save.account.settings.autoSalvage).toBe('common');
    updateSettings(save, { autoSalvage: 'rare' });
    expect(save.account.settings.autoSalvage).toBe('rare');
    const base = { level: 5, difficulty: 'normal' as const, act: 1, magicFind: 0, goldMultiplier: 1, partyClasses: ['knight' as const] };
    expect(openChest(seeded(10), { ...base, tier: 'white' }).items).toHaveLength(1);
    expect(openChest(seeded(10), { ...base, tier: 'white', bonusItems: 1 }).items).toHaveLength(2);
    expect(openChest(seeded(10), { ...base, tier: 'blue', bonusItems: 1 }).items).toHaveLength(3);
  });
});

describe('adventure outfits', () => {
  it('tells how far a hero is from its next outfit and which pieces hold it back', () => {
    const ctx = context(31);
    const wear = (slot: Slot, rarity: Rarity): Item => ({ ...rollItem(seeded(slot.length), { level: 10, rarity, slot }), id: slot, location: 'equipped', heroId: 'h', locked: false, createdAt: ctx.now });
    expect(outfitProgress([])).toMatchObject({ tier: 1, next: 2, average: 0, progress: 0, weakest: ['weapon', 'helmet', 'shoulders'] });
    const half = [wear('weapon', 'rare'), wear('helmet', 'rare'), wear('armor', 'epic'), wear('legs', 'uncommon')];
    const progress = outfitProgress(half);
    expect(progress.tier).toBe(1);
    expect(progress.progress).toBeCloseTo((2 + 2 + 3 + 1) / 7 / 1.5);
    expect(progress.weakest).toEqual(['shoulders', 'gloves', 'boots']);
    const adept = [...half, wear('shoulders', 'rare'), wear('gloves', 'rare'), wear('boots', 'rare')];
    expect(outfitProgress(adept)).toMatchObject({ tier: 2, next: 3 });
    expect(visualTier(adept)).toBe(2);
  });
});

describe('adventure guild classes', () => {
  const team = (roles: string[]): RosterEntry[] => [
    { nodeId: 'lead', title: 'Lead', role: 'Tech lead', leader: true, working: true },
    ...roles.map((role, index) => ({ nodeId: `agent-${index}`, title: `Agent ${index}`, role, leader: false, working: true })),
  ];

  it('recruits the class the guild lacks once it has two of the one a role suggests', () => {
    const ctx = context(41, team(['Backend', 'API', 'Infra', 'Database']));
    const save = freshSave(ctx);
    const classes = ['agent-0', 'agent-1', 'agent-2', 'agent-3'].map((nodeId) => hero(save, nodeId).classId);
    expect(classes).toEqual(['knight', 'knight', 'cleric', 'ranger']);
    // Chosen on purpose, so the camp shows it instead of "by role".
    expect(hero(save, 'agent-2').chosenClass).toBe('cleric');
    expect(hero(save, 'agent-0').chosenClass).toBeNull();
  });

  it('balances a crowded guild on request, healer first, keeping the Maestro', () => {
    const ctx = context(42, team(['Backend', 'Frontend', 'QA']));
    const save = freshSave(ctx);
    // Five knights, three sorceresses and a ranger, like a guild made before balancing.
    const extra: Array<[string, HeroClassId, number]> = [['k1', 'knight', 9], ['k2', 'knight', 3], ['k3', 'knight', 12], ['k4', 'knight', 5], ['s1', 'sorceress', 4], ['s2', 'sorceress', 6]];
    for (const [id, classId, level] of extra) save.heroes[id] = { ...newHero(id, id, classId), level };
    const changes = balanceGuild(save, ctx);
    expect(changes.map((change) => change.to)).toEqual(['cleric', 'artificer']);
    expect(changes.every((change) => change.from === 'knight')).toBe(true);
    // The lowest-level knights change: the new recruit, then k2.
    expect(hero(save, 'agent-0').classId).toBe('cleric');
    expect(save.heroes.k2.classId).toBe('artificer');
    expect(Object.keys(hero(save, 'agent-0').skills).every((skillId) => skillId.startsWith('cleric.'))).toBe(true);
    expect(hero(save, 'lead').classId).toBe('maestro');
    expect(balanceGuild(save, ctx)).toEqual([]);
  });
});
