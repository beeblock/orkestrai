import { describe, expect, it } from 'vitest';
import { newAccount } from '$lib/modules/agent-room/domain/adventure/account.js';
import { buildHeroes, deployHeroes, visualTier } from '$lib/modules/agent-room/domain/adventure/build.js';
import { synthesisRarity } from '$lib/modules/agent-room/domain/adventure/cube.js';
import {
  AdventureError, applyReport, buyRune, craftItem, equipItem, makeOffering, openChests, payOffline, payQuests, salvage, socketItem,
  synthesizeItems, syncRoster, travel, unsocketItem, type AdventureSave, type EngineContext, type RosterEntry,
} from '$lib/modules/agent-room/domain/adventure/engine.js';
import { RARITIES, RARITY_RULES, canEquip, itemStats, rollItem, type Item, type Rarity } from '$lib/modules/agent-room/domain/adventure/items.js';
import { openChest, rollRarity } from '$lib/modules/agent-room/domain/adventure/loot.js';
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

function context(seed = 3): EngineContext {
  let counter = 0;
  return { rng: seeded(seed), newId: () => `id-${++counter}`, now: '2026-10-26T12:00:00.000Z', roster };
}

function freshSave(ctx: EngineContext): AdventureSave {
  const save: AdventureSave = { account: newAccount('2026-10-26T00:00:00.000Z'), heroes: {}, items: [] };
  syncRoster(save, ctx);
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
    expect(result).toEqual({ level: 3, xp: 5, levelsGained: 2 });
    expect(addXp(99, 0, Number.MAX_SAFE_INTEGER).level).toBe(MAX_HERO_LEVEL);
  });
});

describe('adventure items and loot', () => {
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
    expect(contents.items).toHaveLength(3);
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
    expect(Object.keys(save.heroes).sort()).toEqual(['api', 'lead', 'qa']);
    expect(save.items.filter((item) => item.heroNodeId === 'qa').map((item) => item.slot).sort()).toEqual(['armor', 'weapon']);
    expect(save.items.find((item) => item.heroNodeId === 'qa' && item.slot === 'weapon')?.classId).toBe('ranger');
    expect(deployHeroes(roster.map((entry) => ({ nodeId: entry.nodeId, leader: entry.leader, working: entry.working })), ['api'], 2)).toEqual(['api', 'lead']);
    // Heroes start skilled: their first point goes to the class's first active.
    expect(save.heroes.qa.skills['ranger.volley']).toBe(1);
  });

  it('applies a battle report: experience, gold, kills, chests and clears', () => {
    const ctx = context();
    const save = freshSave(ctx);
    const result = applyReport(save, {
      reportId: 'r1', elapsedMs: 60_000, position: positionAt('normal', 1), wave: 0,
      xp: { qa: xpToNext(1) * 3 }, gold: 50, kills: { 'glitch-slime': 20 },
      chests: [{ tier: 'white', level: 1, difficulty: 'normal', act: 1 }], bosses: [],
      stages: [{ difficulty: 'normal', act: 1, stage: 1, result: 'clear' }],
    }, ctx);
    expect(result.levelUps[0]).toMatchObject({ nodeId: 'qa' });
    expect(save.heroes.qa.level).toBeGreaterThan(1);
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
    const bow = save.items.find((item) => item.heroNodeId === 'qa' && item.slot === 'weapon')!;
    expect(() => equipItem(save, ctx, bow.id, 'api')).toThrow('equip-class');
    const better: Item = { ...rollItem(ctx.rng, { level: 1, rarity: 'rare', slot: 'weapon', classId: 'ranger' }), id: 'b2', location: 'inventory', heroNodeId: null, locked: false, createdAt: ctx.now };
    save.items.push(better);
    equipItem(save, ctx, 'b2', 'qa');
    expect(better.location).toBe('equipped');
    expect(bow.location).toBe('inventory');
  });

  it('synthesizes nine items of a rarity into a rarer one, and salvages for gold', () => {
    const ctx = context();
    const save = freshSave(ctx);
    save.account.gold = 1e6;
    const make = (index: number): Item => ({ ...rollItem(ctx.rng, { level: 10, rarity: 'uncommon' }), id: `s${index}`, location: 'inventory', heroNodeId: null, locked: false, createdAt: ctx.now });
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
    const item: Item = { ...rollItem(ctx.rng, { level: 10, rarity: 'rare', slot: 'helmet' }), id: 'h1', location: 'inventory', heroNodeId: null, locked: false, createdAt: ctx.now };
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
    expect(save.heroes.qa.level).toBeGreaterThan(1);
    expect(save.heroes.lead.level).toBe(1);
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
    const piece = (slot: Item['slot'], rarity: Rarity): Item => ({ slot, classId: slot === 'weapon' ? 'knight' : null, rarity, level: 1, affixes: [], sockets: [], id: slot, location: 'equipped', heroNodeId: 'k', locked: false, createdAt: '' });
    const gear = (rarity: Rarity) => (['weapon', 'helmet', 'armor', 'gloves', 'boots'] as const).map((slot) => piece(slot, rarity));
    expect(visualTier([])).toBe(1);
    expect(visualTier(gear('epic'))).toBe(2);
    expect(visualTier(gear('immortal'))).toBe(3);
    expect(visualTier(gear('cosmic'))).toBe(4);
    const builds = buildHeroes([{ nodeId: 'k', classId: 'knight', level: 10, xp: 0, skills: {}, actives: [], deployed: true }], gear('legendary'), {}, {});
    expect(builds.k.visualTier).toBe(3);
    expect(builds.k.weaponRarity).toBe('legendary');
  });
});
