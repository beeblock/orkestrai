import { HERO_CLASSES, MONSTERS, heroClassFor, type HeroClassId, type MonsterId } from './catalog.js';
import { JOURNAL_SIZE, newHero, starterKit, type AdventureAccount, type AdventureHero, type AdventureSettings, type ChestEntry, type JournalEntry } from './account.js';
import { buildHeroes, deployHeroes, type HeroBuild } from './build.js';
import {
  CRAFT_GEMS, CUBE_XP, COINS_PER_OFFERING, SYNTHESIS_INPUTS,
  addCubeXp, alchemyGold, canSocket, craft, craftCost, cubeAllows, offering, removalCost, socketFunction, synthesisCost, synthesize,
} from './cube.js';
import { MATERIALS, RARITIES, canEquip, type Item, type ItemData, type ItemLocation, type MaterialId, type Rng, type Slot } from './items.js';
import { BASE_CHEST_CAPACITY, CHEST_TIERS, openChest, type ChestTier } from './loot.js';
import { PETS, tamedPets, type PetId } from './pets.js';
import { activeSlots, canBuyRune, formationSlots, inventorySlots, runeCost, runeRule, stashSlots } from './runes.js';
import { autoAllocate, canRaise, learnedActives, sanitizeRanks } from './skills.js';
import type { ChestDrop, StageResult } from './simulation.js';
import {
  DIFFICULTIES, MAX_HERO_LEVEL, STAGE_COUNT,
  addXp, highestRegionLevel, monsterStats, positionAt, regionLevel, stageIndex, stageUnlocked, xpGapFactor,
  type Difficulty, type StagePosition,
} from './world.js';

/**
 * The Adventure's rules on the server side, as pure functions over a save:
 * keeping the heroes in step with the team, applying what the battle reported,
 * paying quests and offline work, and every action of the camp (chests, gear,
 * the cube, runes, skills, travel). The service only loads and stores saves.
 */

export type AdventureSave = { account: AdventureAccount; heroes: Record<string, AdventureHero>; items: Item[] };

/** An agent of the workspace, as the Adventure needs it. */
export type RosterEntry = { nodeId: string; title: string; role: string | null; leader: boolean; working: boolean };

export type EngineContext = { rng: Rng; newId: () => string; now: string; roster: RosterEntry[] };

export class AdventureError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function fail(code: string): never {
  throw new AdventureError(code);
}

function journal(save: AdventureSave, entry: JournalEntry): void {
  save.account.journal = [entry, ...save.account.journal].slice(0, JOURNAL_SIZE);
}

export function heroClass(save: AdventureSave, roster: RosterEntry[], nodeId: string): HeroClassId {
  const entry = roster.find((candidate) => candidate.nodeId === nodeId);
  const hero = save.heroes[nodeId];
  return heroClassFor({ nodeId, title: entry?.title ?? '', role: entry?.role ?? null, leader: entry?.leader ?? false, chosen: hero?.chosenClass ?? null });
}

function addItem(save: AdventureSave, ctx: EngineContext, data: ItemData, location: ItemLocation = 'inventory', heroNodeId: string | null = null): Item {
  const item: Item = { ...data, id: ctx.newId(), location, heroNodeId, locked: false, createdAt: ctx.now };
  save.items.push(item);
  return item;
}

export function inventoryCount(save: AdventureSave): number {
  return save.items.filter((item) => item.location === 'inventory').length;
}

export function stashCount(save: AdventureSave): number {
  return save.items.filter((item) => item.location === 'stash').length;
}

function freeInventory(save: AdventureSave): number {
  return inventorySlots(save.account.runes) - inventoryCount(save);
}

function partyClasses(save: AdventureSave, roster: RosterEntry[]): HeroClassId[] {
  return [...new Set(roster.map((entry) => heroClass(save, roster, entry.nodeId)))];
}

/** Every hero's build, with the formation decided from who is working. */
export function partyBuilds(save: AdventureSave, roster: RosterEntry[]): { builds: Record<string, HeroBuild>; deployed: string[] } {
  const deployed = deployHeroes(roster.map((entry) => ({ nodeId: entry.nodeId, leader: entry.leader, working: entry.working })), save.account.formation, formationSlots(save.account.runes));
  const builds = buildHeroes(
    roster.filter((entry) => save.heroes[entry.nodeId]).map((entry) => {
      const hero = save.heroes[entry.nodeId];
      return { nodeId: entry.nodeId, classId: heroClass(save, roster, entry.nodeId), level: hero.level, xp: hero.xp, skills: hero.skills, actives: hero.actives, deployed: deployed.includes(entry.nodeId) };
    }),
    save.items,
    save.account.runes,
    save.account.killsByMonster,
  );
  return { builds, deployed };
}

/** Luck of the formation, used when opening chests. */
function partyLuck(save: AdventureSave, roster: RosterEntry[]): { magicFind: number; goldMultiplier: number } {
  const { builds, deployed } = partyBuilds(save, roster);
  const heroes = deployed.map((nodeId) => builds[nodeId]).filter(Boolean);
  if (!heroes.length) return { magicFind: 0, goldMultiplier: 1 };
  return {
    magicFind: heroes.reduce((sum, build) => sum + build.profile.magicFind, 0) / heroes.length,
    goldMultiplier: heroes.reduce((sum, build) => sum + build.profile.goldMultiplier, 0) / heroes.length,
  };
}

/**
 * Keeps one hero per agent: newcomers get a record and a starter kit; when an
 * agent leaves the team its gear goes back to the inventory. A hero whose
 * class changed keeps only skills of its new tree and drops a foreign weapon.
 */
export function syncRoster(save: AdventureSave, ctx: EngineContext): void {
  const present = new Set(ctx.roster.map((entry) => entry.nodeId));
  for (const nodeId of Object.keys(save.heroes)) {
    if (present.has(nodeId)) continue;
    for (const item of save.items) if (item.heroNodeId === nodeId) { item.location = 'inventory'; item.heroNodeId = null; }
    delete save.heroes[nodeId];
  }
  for (const entry of ctx.roster) {
    let hero = save.heroes[entry.nodeId];
    const classId = heroClass(save, ctx.roster, entry.nodeId);
    if (!hero) {
      hero = newHero(entry.nodeId);
      save.heroes[entry.nodeId] = hero;
      for (const data of starterKit(classId)) {
        const item = addItem(save, ctx, data, 'equipped', entry.nodeId);
        journal(save, { at: ctx.now, kind: 'item', itemId: item.id, rarity: item.rarity, source: 'starter', heroNodeId: entry.nodeId });
      }
    }
    hero.skills = sanitizeRanks(classId, hero.level, hero.skills);
    if (hero.autoSkills) hero.skills = autoAllocate(classId, hero.level, hero.skills);
    hero.actives = hero.actives.filter((id) => learnedActives(classId, hero.skills).some((active) => active.id === id));
    for (const item of save.items) {
      if (item.heroNodeId === entry.nodeId && item.location === 'equipped' && canEquip(item, { classId, level: MAX_HERO_LEVEL }) === 'class') {
        item.location = 'inventory';
        item.heroNodeId = null;
      }
    }
  }
}

export type ReportInput = {
  reportId: string;
  elapsedMs: number;
  position: StagePosition;
  wave: number;
  xp: Record<string, number>;
  gold: number;
  kills: Partial<Record<MonsterId, number>>;
  chests: ChestDrop[];
  bosses: Array<{ difficulty: Difficulty; act: number; monsterId: MonsterId }>;
  stages: StageResult[];
};

export type ReportResult = {
  levelUps: Array<{ nodeId: string; level: number }>;
  opened: OpenResult[];
  pets: PetId[];
  quests: Array<{ title: string; nodeId: string | null }>;
  duplicate: boolean;
};

/** The most a report may claim, so a broken client cannot flood the save. */
function clampReport(report: ReportInput, sinceLastMs: number): ReportInput {
  const elapsed = Math.max(0, Math.min(report.elapsedMs, sinceLastMs + 60_000, 10 * 60_000));
  const maxKills = Math.ceil(elapsed / 200) + 10;
  let killCount = 0;
  const kills: Partial<Record<MonsterId, number>> = {};
  for (const [monsterId, count] of Object.entries(report.kills) as Array<[MonsterId, number]>) {
    if (!MONSTERS[monsterId] || !Number.isFinite(count) || count <= 0) continue;
    const allowed = Math.min(Math.floor(count), maxKills - killCount);
    if (allowed <= 0) break;
    kills[monsterId] = allowed;
    killCount += allowed;
  }
  const level = regionLevel(report.position);
  const maxXp = (killCount + 1) * monsterStats('outage-kraken', level + 5, 'torment', true).xp;
  const maxGold = (killCount + 1) * monsterStats('outage-kraken', level + 5, 'torment', true).gold * 4;
  const xp: Record<string, number> = {};
  for (const [nodeId, value] of Object.entries(report.xp)) if (Number.isFinite(value) && value > 0) xp[nodeId] = Math.min(value, maxXp);
  return {
    ...report,
    elapsedMs: elapsed,
    gold: Number.isFinite(report.gold) ? Math.max(0, Math.min(report.gold, maxGold)) : 0,
    kills,
    xp,
    chests: report.chests.slice(0, killCount + 2),
    bosses: report.bosses.slice(0, 3),
    stages: report.stages.slice(0, 12),
  };
}

function grantXp(save: AdventureSave, ctx: EngineContext, nodeId: string, amount: number, levelUps: ReportResult['levelUps']): void {
  const hero = save.heroes[nodeId];
  if (!hero || amount <= 0) return;
  const before = hero.level;
  const next = addXp(hero.level, hero.xp, amount);
  hero.level = next.level;
  hero.xp = next.xp;
  if (hero.level > before) {
    const classId = heroClass(save, ctx.roster, nodeId);
    if (hero.autoSkills) hero.skills = autoAllocate(classId, hero.level, hero.skills);
    levelUps.push({ nodeId, level: hero.level });
    journal(save, { at: ctx.now, kind: 'level', heroNodeId: nodeId, level: hero.level });
  }
}

/** Catch-up: heroes behind the strongest one learn faster with the Mentorship rune. */
function mentorshipBonus(save: AdventureSave, nodeId: string): number {
  const bonus = runeRule(save.account.runes, 'mentorship');
  if (!bonus) return 1;
  const top = Math.max(...Object.values(save.heroes).map((hero) => hero.level));
  return save.heroes[nodeId] && save.heroes[nodeId].level < top ? 1 + bonus / 100 : 1;
}

function chestCapacity(account: AdventureAccount): number {
  return BASE_CHEST_CAPACITY + runeRule(account.runes, 'chest-capacity');
}

function addChest(save: AdventureSave, ctx: EngineContext, drop: ChestDrop): ChestEntry | null {
  if (save.account.chests.length >= chestCapacity(save.account)) return null;
  const entry: ChestEntry = { id: ctx.newId(), tier: drop.tier, level: Math.max(1, Math.round(drop.level)), difficulty: drop.difficulty, act: drop.act };
  save.account.chests.push(entry);
  return entry;
}

export function applyReport(save: AdventureSave, input: ReportInput, ctx: EngineContext): ReportResult {
  const result: ReportResult = { levelUps: [], opened: [], pets: [], quests: [], duplicate: false };
  const account = save.account;
  if (input.reportId && input.reportId === account.lastReportId) return { ...result, duplicate: true };
  const sinceLast = account.lastReportAt ? Date.parse(ctx.now) - Date.parse(account.lastReportAt) : 10 * 60_000;
  const report = clampReport(input, Math.max(0, sinceLast));
  const petsBefore = tamedPets(account.killsByMonster);

  account.gold += Math.round(report.gold);
  for (const [monsterId, count] of Object.entries(report.kills) as Array<[MonsterId, number]>) {
    account.killsByMonster[monsterId] = (account.killsByMonster[monsterId] ?? 0) + count;
    account.kills += count;
  }
  for (const [nodeId, amount] of Object.entries(report.xp)) {
    if (!save.heroes[nodeId]) continue;
    save.heroes[nodeId].kills += Math.round(Object.values(report.kills).reduce((sum, count) => sum + (count ?? 0), 0));
    grantXp(save, ctx, nodeId, amount * mentorshipBonus(save, nodeId), result.levelUps);
  }
  for (const drop of report.chests) {
    if (!CHEST_TIERS.includes(drop.tier) || drop.tier === 'quest') continue;
    addChest(save, ctx, drop);
  }
  for (const boss of report.bosses) {
    account.bosses += 1;
    journal(save, { at: ctx.now, kind: 'boss', difficulty: boss.difficulty, act: boss.act, monsterId: boss.monsterId });
  }
  for (const stage of report.stages) {
    if (!DIFFICULTIES.includes(stage.difficulty)) continue;
    const index = stageIndex(stage);
    if (index < 0 || index >= STAGE_COUNT) continue;
    if (stage.result === 'clear' && stageUnlocked(account.cleared, stage)) account.cleared[stage.difficulty] = Math.max(account.cleared[stage.difficulty], index);
    journal(save, { at: ctx.now, kind: 'stage', difficulty: stage.difficulty, act: stage.act, stage: stage.stage, result: stage.result });
  }
  if (DIFFICULTIES.includes(report.position.difficulty) && stageUnlocked(account.cleared, report.position)) {
    account.position = positionAt(report.position.difficulty, stageIndex(report.position));
  }
  for (const petId of tamedPets(account.killsByMonster)) {
    if (petsBefore.includes(petId)) continue;
    result.pets.push(petId);
    journal(save, { at: ctx.now, kind: 'pet', petId });
    account.activePet ??= petId;
  }
  result.opened.push(...autoOpen(save, ctx));
  account.lastReportAt = ctx.now;
  account.lastReportId = input.reportId;
  return result;
}

/** Runes of unsealing open chests as they arrive, a few at a time. */
function autoOpen(save: AdventureSave, ctx: EngineContext): OpenResult[] {
  if (!save.account.settings.autoOpen) return [];
  const tiers: ChestTier[] = [];
  if (runeRule(save.account.runes, 'auto-white')) tiers.push('white');
  if (runeRule(save.account.runes, 'auto-blue')) tiers.push('blue');
  const opened: OpenResult[] = [];
  for (const chest of [...save.account.chests]) {
    if (!tiers.includes(chest.tier) || freeInventory(save) < 3 || opened.length >= 4) continue;
    opened.push(openChestEntry(save, ctx, chest));
  }
  return opened;
}

export type OpenResult = { chestId: string; tier: ChestTier; items: Item[]; gold: number; materials: Partial<Record<MaterialId, number>>; soulstones: number; coins: number };

function openChestEntry(save: AdventureSave, ctx: EngineContext, chest: ChestEntry): OpenResult {
  const account = save.account;
  if (chest.tier === 'red') {
    const key = `${chest.difficulty}:${chest.act}`;
    if (account.firstBossClears.includes(key)) {
      if (account.soulstones[chest.difficulty] <= 0) fail('soulstone');
      account.soulstones[chest.difficulty] -= 1;
    } else {
      account.firstBossClears.push(key);
    }
  }
  const luck = partyLuck(save, ctx.roster);
  const contents = openChest(ctx.rng, {
    tier: chest.tier, level: chest.level, difficulty: chest.difficulty, act: chest.act,
    magicFind: luck.magicFind, goldMultiplier: luck.goldMultiplier, partyClasses: partyClasses(save, ctx.roster),
  });
  account.chests = account.chests.filter((entry) => entry.id !== chest.id);
  account.gold += contents.gold;
  account.coins += contents.coins;
  account.soulstones[chest.difficulty] += contents.soulstones;
  for (const [material, count] of Object.entries(contents.materials) as Array<[MaterialId, number]>) account.materials[material] = (account.materials[material] ?? 0) + count;
  const items = contents.items.map((data) => {
    const item = addItem(save, ctx, data);
    journal(save, { at: ctx.now, kind: 'item', itemId: item.id, rarity: item.rarity, source: chest.tier });
    return item;
  });
  return { chestId: chest.id, tier: chest.tier, items, gold: contents.gold, materials: contents.materials, soulstones: contents.soulstones, coins: contents.coins };
}

/** Opens chests by id, or every chest of a tier when no ids are given. */
export function openChests(save: AdventureSave, ctx: EngineContext, options: { ids?: string[]; tier?: ChestTier; limit?: number }): OpenResult[] {
  const wanted = save.account.chests.filter((chest) => (options.ids ? options.ids.includes(chest.id) : !options.tier || chest.tier === options.tier));
  if (!wanted.length) fail('no-chest');
  const opened: OpenResult[] = [];
  for (const chest of wanted.slice(0, options.limit ?? 20)) {
    if (freeInventory(save) < 4) {
      if (!opened.length) fail('inventory-full');
      break;
    }
    try {
      opened.push(openChestEntry(save, ctx, chest));
    } catch (error) {
      if (!opened.length) throw error;
      break;
    }
  }
  return opened;
}

/**
 * Pays the Kanban cards finished since the Adventure started: each one is a
 * golden quest chest, and the agent that finished it gets a share of
 * experience.
 */
export function payQuests(save: AdventureSave, ctx: EngineContext, done: Array<{ id: string; title: string; assigneeNodeId: string | null; finishedAt: string }>): ReportResult['quests'] {
  const account = save.account;
  const paid: ReportResult['quests'] = [];
  const since = Date.parse(account.questsSince);
  for (const task of done) {
    if (account.rewardedTasks.includes(task.id) || Date.parse(task.finishedAt) < since) continue;
    account.rewardedTasks = [task.id, ...account.rewardedTasks].slice(0, 500);
    account.quests += 1;
    const level = regionLevel(account.position);
    addChest(save, ctx, { tier: 'quest', level, difficulty: account.position.difficulty, act: account.position.act });
    const nodeId = task.assigneeNodeId && save.heroes[task.assigneeNodeId] ? task.assigneeNodeId : null;
    if (nodeId) {
      const hero = save.heroes[nodeId];
      grantXp(save, ctx, nodeId, monsterStats('bug-beetle', level, account.position.difficulty, true).xp * 3 * xpGapFactor(hero.level, level), []);
    }
    journal(save, { at: ctx.now, kind: 'quest', title: task.title.slice(0, 120), heroNodeId: nodeId });
    paid.push({ title: task.title, nodeId });
  }
  return paid;
}

/** Offline efficiency: a quarter of the battle's pace, more with the Respite rune. */
export function offlineEfficiency(account: AdventureAccount): number {
  return 0.25 + runeRule(account.runes, 'offline') / 100;
}

export function offlineCapMs(account: AdventureAccount): number {
  return (8 + runeRule(account.runes, 'offline') / 10) * 3_600_000;
}

/**
 * Work the agents did while the strip was closed still counts: each hero
 * earns experience and gold for its own working time, at offline efficiency
 * and without chests (those only drop in battle).
 */
export function payOffline(save: AdventureSave, ctx: EngineContext, workMs: Record<string, number>): void {
  const account = save.account;
  const cap = offlineCapMs(account);
  const efficiency = offlineEfficiency(account);
  const level = regionLevel(account.position);
  const typical = monsterStats('bug-beetle', level, account.position.difficulty);
  const killsPerMs = 1 / 3_000;
  const { builds } = partyBuilds(save, ctx.roster);
  let gold = 0;
  let longest = 0;
  const xp: Record<string, number> = {};
  const levels: Record<string, number> = {};
  for (const [nodeId, rawMs] of Object.entries(workMs)) {
    const hero = save.heroes[nodeId];
    if (!hero || rawMs < 60_000) continue;
    const ms = Math.min(rawMs, cap);
    longest = Math.max(longest, ms);
    const kills = ms * killsPerMs * efficiency;
    const build = builds[nodeId];
    const amount = kills * typical.xp * xpGapFactor(hero.level, level) * (build?.profile.xpMultiplier ?? 1);
    const before = hero.level;
    grantXp(save, ctx, nodeId, amount, []);
    xp[nodeId] = Math.round(amount);
    if (hero.level > before) levels[nodeId] = hero.level;
    gold += kills * typical.gold * (build?.profile.goldMultiplier ?? 1) / Math.max(1, Object.keys(workMs).length);
  }
  if (!longest) return;
  account.gold += Math.round(gold);
  account.offline = { minutes: Math.round(longest / 60_000), gold: Math.round(gold), xp, levels, at: ctx.now };
  journal(save, { at: ctx.now, kind: 'offline', minutes: Math.round(longest / 60_000), gold: Math.round(gold) });
}

// ---------------------------------------------------------------------------
// Camp actions.

function findItem(save: AdventureSave, itemId: string): Item {
  return save.items.find((item) => item.id === itemId) ?? fail('item');
}

export function equipItem(save: AdventureSave, ctx: EngineContext, itemId: string, nodeId: string): void {
  const item = findItem(save, itemId);
  const hero = save.heroes[nodeId] ?? fail('hero');
  const verdict = canEquip(item, { classId: heroClass(save, ctx.roster, nodeId), level: hero.level });
  if (verdict !== 'ok') fail(verdict === 'class' ? 'equip-class' : 'equip-level');
  const current = save.items.find((candidate) => candidate.location === 'equipped' && candidate.heroNodeId === nodeId && candidate.slot === item.slot);
  const from = { location: item.location, heroNodeId: item.heroNodeId };
  if (current && current.id !== item.id) {
    // Swap: the old piece goes where the new one came from.
    current.location = from.location === 'equipped' ? 'equipped' : from.location;
    current.heroNodeId = from.location === 'equipped' ? from.heroNodeId : null;
    if (current.location === 'equipped' && current.heroNodeId) {
      const other = save.heroes[current.heroNodeId];
      if (!other || canEquip(current, { classId: heroClass(save, ctx.roster, current.heroNodeId), level: other.level }) !== 'ok') {
        current.location = 'inventory';
        current.heroNodeId = null;
      }
    }
  }
  item.location = 'equipped';
  item.heroNodeId = nodeId;
}

export function unequipItem(save: AdventureSave, itemId: string): void {
  const item = findItem(save, itemId);
  if (item.location !== 'equipped') return;
  if (freeInventory(save) <= 0) fail('inventory-full');
  item.location = 'inventory';
  item.heroNodeId = null;
}

/** Equips the best piece for each slot a hero can wear, from the inventory and stash. */
export function autoEquip(save: AdventureSave, ctx: EngineContext, nodeId: string): number {
  const hero = save.heroes[nodeId] ?? fail('hero');
  const classId = heroClass(save, ctx.roster, nodeId);
  let changed = 0;
  const { builds } = partyBuilds(save, ctx.roster);
  const ratingOf = () => partyBuilds(save, ctx.roster).builds[nodeId]?.rating ?? builds[nodeId]?.rating ?? 0;
  for (const slot of ['weapon', 'helmet', 'armor', 'gloves', 'boots', 'amulet', 'ring'] as Slot[]) {
    const candidates = save.items.filter((item) => item.slot === slot && item.location !== 'equipped' && canEquip(item, { classId, level: hero.level }) === 'ok');
    for (const candidate of candidates) {
      const before = ratingOf();
      const snapshot = save.items.map((item) => ({ ...item }));
      equipItem(save, ctx, candidate.id, nodeId);
      if (ratingOf() <= before) save.items = snapshot;
      else changed += 1;
    }
  }
  return changed;
}

export function setLocked(save: AdventureSave, itemId: string, locked: boolean): void {
  findItem(save, itemId).locked = locked;
}

export function moveItem(save: AdventureSave, itemId: string, location: 'inventory' | 'stash'): void {
  const item = findItem(save, itemId);
  if (item.location === location) return;
  if (item.location === 'equipped') fail('equipped');
  if (location === 'stash' && stashCount(save) >= stashSlots(save.account.runes)) fail('stash-full');
  if (location === 'inventory' && freeInventory(save) <= 0) fail('inventory-full');
  item.location = location;
}

function consumable(save: AdventureSave, itemIds: string[]): Item[] {
  const unique = [...new Set(itemIds)];
  const items = unique.map((itemId) => findItem(save, itemId));
  if (items.some((item) => item.location === 'equipped')) fail('equipped');
  if (items.some((item) => item.locked)) fail('locked');
  return items;
}

function removeItems(save: AdventureSave, items: Item[]): void {
  const ids = new Set(items.map((item) => item.id));
  save.items = save.items.filter((item) => !ids.has(item.id));
}

function cubeXp(save: AdventureSave, amount: number): void {
  const next = addCubeXp(save.account.cube, amount);
  save.account.cube = { level: next.level, xp: next.xp };
}

export function salvage(save: AdventureSave, itemIds: string[]): number {
  const items = consumable(save, itemIds);
  if (!items.length) fail('no-items');
  const gold = alchemyGold(items, save.account.cube.level, runeRule(save.account.runes, 'alchemy'));
  removeItems(save, items);
  save.account.gold += gold;
  cubeXp(save, CUBE_XP.alchemy * items.length);
  return gold;
}

export function synthesizeItems(save: AdventureSave, ctx: EngineContext, itemIds: string[]): Item {
  const items = consumable(save, itemIds);
  if (items.length !== SYNTHESIS_INPUTS) fail('synthesis-count');
  const rarity = items[0].rarity;
  if (items.some((item) => item.rarity !== rarity)) fail('synthesis-rarity');
  if (rarity === RARITIES[RARITIES.length - 1]) fail('synthesis-max');
  const cost = synthesisCost(rarity, Math.max(...items.map((item) => item.level)));
  if (save.account.gold < cost) fail('gold');
  save.account.gold -= cost;
  const data = synthesize(ctx.rng, items, save.account.cube.level, partyClasses(save, ctx.roster));
  removeItems(save, items);
  const item = addItem(save, ctx, data);
  cubeXp(save, CUBE_XP.synthesis * (RARITIES.indexOf(rarity) + 1));
  journal(save, { at: ctx.now, kind: 'item', itemId: item.id, rarity: item.rarity, source: 'synthesis' });
  return item;
}

export function craftItem(save: AdventureSave, ctx: EngineContext, options: { slot: Slot; level: number; classId: HeroClassId | null; gems: MaterialId[] }): Item {
  if (!cubeAllows(save.account.cube.level, 'crafting')) fail('cube-level');
  if (freeInventory(save) <= 0) fail('inventory-full');
  const level = Math.max(1, Math.min(Math.round(options.level), highestRegionLevel(save.account.cleared)));
  const gems = options.gems.slice(0, CRAFT_GEMS);
  if (gems.length !== CRAFT_GEMS || gems.some((gem) => MATERIALS[gem]?.socket !== 'decoration')) fail('gems');
  const needed: Partial<Record<MaterialId, number>> = {};
  for (const gem of gems) needed[gem] = (needed[gem] ?? 0) + 1;
  for (const [gem, count] of Object.entries(needed) as Array<[MaterialId, number]>) if ((save.account.materials[gem] ?? 0) < count) fail('gems');
  const cost = craftCost(level);
  if (save.account.gold < cost) fail('gold');
  save.account.gold -= cost;
  for (const [gem, count] of Object.entries(needed) as Array<[MaterialId, number]>) save.account.materials[gem]! -= count;
  const luck = partyLuck(save, ctx.roster);
  const data = craft(ctx.rng, {
    slot: options.slot, level, classId: options.classId ?? heroClass(save, ctx.roster, ctx.roster[0]?.nodeId ?? ''),
    cubeLevel: save.account.cube.level, magicFind: luck.magicFind, difficulty: save.account.position.difficulty, partyClasses: partyClasses(save, ctx.roster),
  });
  const item = addItem(save, ctx, data);
  cubeXp(save, CUBE_XP.crafting);
  journal(save, { at: ctx.now, kind: 'item', itemId: item.id, rarity: item.rarity, source: 'crafting' });
  return item;
}

export function socketItem(save: AdventureSave, itemId: string, socketIndex: number, material: MaterialId): void {
  const item = findItem(save, itemId);
  if (!MATERIALS[material]) fail('material');
  if (!cubeAllows(save.account.cube.level, socketFunction(MATERIALS[material].socket))) fail('cube-level');
  const verdict = canSocket(item, socketIndex, material);
  if (verdict !== 'ok') fail(`socket-${verdict}`);
  if ((save.account.materials[material] ?? 0) <= 0) fail('material');
  save.account.materials[material]! -= 1;
  item.sockets[socketIndex] = { ...item.sockets[socketIndex], material };
  cubeXp(save, CUBE_XP.socket);
}

/** Removal destroys the material; the item must be taken off first. */
export function unsocketItem(save: AdventureSave, itemId: string, socketIndex: number): void {
  const item = findItem(save, itemId);
  if (!cubeAllows(save.account.cube.level, 'removal')) fail('cube-level');
  if (item.location === 'equipped') fail('equipped');
  if (!item.sockets[socketIndex]?.material) fail('socket-empty');
  const cost = removalCost(item);
  if (save.account.gold < cost) fail('gold');
  save.account.gold -= cost;
  item.sockets[socketIndex] = { ...item.sockets[socketIndex], material: null };
  cubeXp(save, CUBE_XP.removal);
}

export function makeOffering(save: AdventureSave, ctx: EngineContext): Item {
  if (!cubeAllows(save.account.cube.level, 'offering')) fail('cube-level');
  if (save.account.coins < COINS_PER_OFFERING) fail('coins');
  if (freeInventory(save) <= 0) fail('inventory-full');
  save.account.coins -= COINS_PER_OFFERING;
  const luck = partyLuck(save, ctx.roster);
  const data = offering(ctx.rng, { level: highestRegionLevel(save.account.cleared), magicFind: luck.magicFind, difficulty: save.account.position.difficulty, partyClasses: partyClasses(save, ctx.roster) });
  const item = addItem(save, ctx, data);
  cubeXp(save, CUBE_XP.offering);
  journal(save, { at: ctx.now, kind: 'item', itemId: item.id, rarity: item.rarity, source: 'offering' });
  return item;
}

export function buyRune(save: AdventureSave, runeId: string): number {
  const verdict = canBuyRune(runeId, save.account.runes, save.account.gold);
  if (verdict !== 'ok') fail(`rune-${verdict}`);
  const cost = runeCost(runeId, save.account.runes)!;
  save.account.gold -= cost;
  save.account.runes[runeId] = (save.account.runes[runeId] ?? 0) + 1;
  return cost;
}

export function raiseSkill(save: AdventureSave, ctx: EngineContext, nodeId: string, skillId: string): void {
  const hero = save.heroes[nodeId] ?? fail('hero');
  const classId = heroClass(save, ctx.roster, nodeId);
  const verdict = canRaise(classId, hero.level, hero.skills, skillId);
  if (verdict !== 'ok') fail(`skill-${verdict}`);
  hero.skills = { ...hero.skills, [skillId]: (hero.skills[skillId] ?? 0) + 1 };
  hero.autoSkills = false;
}

export function resetSkills(save: AdventureSave, nodeId: string): void {
  const hero = save.heroes[nodeId] ?? fail('hero');
  hero.skills = {};
  hero.actives = [];
  hero.autoSkills = false;
}

export function setAutoSkills(save: AdventureSave, ctx: EngineContext, nodeId: string, enabled: boolean): void {
  const hero = save.heroes[nodeId] ?? fail('hero');
  hero.autoSkills = enabled;
  if (enabled) hero.skills = autoAllocate(heroClass(save, ctx.roster, nodeId), hero.level, hero.skills);
}

export function setActives(save: AdventureSave, ctx: EngineContext, nodeId: string, actives: string[]): void {
  const hero = save.heroes[nodeId] ?? fail('hero');
  const learned = learnedActives(heroClass(save, ctx.roster, nodeId), hero.skills).map((active) => active.id);
  const chosen = [...new Set(actives)].filter((id) => learned.includes(id));
  if (chosen.length > activeSlots(save.account.runes)) fail('active-slots');
  hero.actives = chosen;
}

export function setHeroClass(save: AdventureSave, ctx: EngineContext, nodeId: string, classId: HeroClassId | null): void {
  const entry = ctx.roster.find((candidate) => candidate.nodeId === nodeId) ?? fail('hero');
  if (entry.leader && classId) fail('leader-class');
  if (classId === 'maestro') fail('leader-class');
  const hero = save.heroes[nodeId] ?? fail('hero');
  hero.chosenClass = classId;
  syncRoster(save, ctx);
}

export function travel(save: AdventureSave, position: StagePosition): void {
  if (!DIFFICULTIES.includes(position.difficulty) || !stageUnlocked(save.account.cleared, position)) fail('locked-stage');
  save.account.position = positionAt(position.difficulty, stageIndex(position));
}

export function updateSettings(save: AdventureSave, patch: Partial<AdventureSettings>): void {
  save.account.settings = { ...save.account.settings, ...Object.fromEntries(Object.entries(patch).filter(([, value]) => typeof value === 'boolean')) };
}

export function setFormation(save: AdventureSave, ctx: EngineContext, order: string[]): void {
  const known = new Set(ctx.roster.map((entry) => entry.nodeId));
  save.account.formation = [...new Set(order)].filter((nodeId) => known.has(nodeId)).slice(0, formationSlots(save.account.runes));
}

export function setActivePet(save: AdventureSave, petId: PetId | null): void {
  if (petId && !tamedPets(save.account.killsByMonster).includes(petId)) fail('pet');
  save.account.activePet = petId;
}

export { PETS, HERO_CLASSES };
