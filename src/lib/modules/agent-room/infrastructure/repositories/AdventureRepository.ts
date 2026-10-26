import { uuidv7 } from '@beeblock/svelar/support';
import { AgentAdventure } from '../../domain/models/AgentAdventure.js';
import { AgentAdventureHero } from '../../domain/models/AgentAdventureHero.js';
import { AgentAdventureItem } from '../../domain/models/AgentAdventureItem.js';
import { ELIXIRS, SETS, UNIQUES, type ElixirId, type SetId, type UniqueId } from '../../domain/adventure/artifacts.js';
import { DEFAULT_SETTINGS, REPORT_MEMORY, newAccount, type AdventureAccount, type AdventureHero } from '../../domain/adventure/account.js';
import { HERO_CLASS_IDS, type HeroClassId } from '../../domain/adventure/catalog.js';
import type { AdventureSave } from '../../domain/adventure/engine.js';
import { GEM_QUALITIES, MATERIALS, RARITIES, SLOTS, parseMaterialKey, type BaseVariant, type GemQuality, type Item, type ItemAffix, type ItemSocket, type Rarity, type Slot } from '../../domain/adventure/items.js';
import { STAT_IDS } from '../../domain/adventure/stats.js';
import { NO_CLEARS, START_POSITION } from '../../domain/adventure/world.js';

function parse<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** A stored account, with every field a newer version added filled in. */
function readAccount(raw: unknown, now: string): AdventureAccount {
  // `lastReportId` was the single report id kept before `recentReports`.
  const { lastReportId: _lastReportId, ...stored } = parse<Partial<AdventureAccount> & { lastReportId?: unknown }>(raw, {});
  const base = newAccount(stored.questsSince ?? now);
  return {
    ...base,
    ...stored,
    version: 2,
    position: { ...START_POSITION, ...stored.position },
    cleared: { ...NO_CLEARS, ...stored.cleared },
    soulstones: { ...base.soulstones, ...stored.soulstones },
    settings: { ...DEFAULT_SETTINGS, ...stored.settings },
    cube: { ...base.cube, ...stored.cube },
    chests: Array.isArray(stored.chests) ? stored.chests : [],
    // Only known material keys and elixirs survive a read.
    materials: Object.fromEntries(Object.entries(stored.materials ?? {}).filter(([key, count]) => parseMaterialKey(key) && Number.isFinite(count) && count > 0)),
    elixirs: Object.fromEntries(Object.entries(stored.elixirs ?? {}).filter(([elixirId, count]) => ELIXIRS[elixirId as ElixirId] && Number.isFinite(count) && (count as number) > 0)),
    activeElixirs: Object.fromEntries(Object.entries(stored.activeElixirs ?? {}).filter(([elixirId, until]) => ELIXIRS[elixirId as ElixirId] && typeof until === 'string' && !Number.isNaN(Date.parse(until)))),
    journal: Array.isArray(stored.journal) ? stored.journal : [],
    formation: Array.isArray(stored.formation) ? stored.formation : [],
    firstBossClears: Array.isArray(stored.firstBossClears) ? stored.firstBossClears : [],
    rewardedTasks: Array.isArray(stored.rewardedTasks) ? stored.rewardedTasks : [],
    battleUntil: typeof stored.battleUntil === 'string' && !Number.isNaN(Date.parse(stored.battleUntil)) ? stored.battleUntil : null,
    recentReports: Array.isArray(stored.recentReports) ? stored.recentReports.filter((id): id is string => typeof id === 'string').slice(-REPORT_MEMORY) : [],
  };
}

function heroClassOf(value: unknown): HeroClassId | null {
  return typeof value === 'string' && (HERO_CLASS_IDS as string[]).includes(value) ? (value as HeroClassId) : null;
}

function readHero(model: AgentAdventureHero): AdventureHero {
  const leader = Boolean(model.getAttribute('leader'));
  return {
    id: String(model.getAttribute('id')),
    name: String(model.getAttribute('name') ?? ''),
    classId: heroClassOf(model.getAttribute('class_id')) ?? (leader ? 'maestro' : 'knight'),
    chosenClass: heroClassOf(model.getAttribute('chosen_class')),
    leader,
    agentNodeId: (model.getAttribute('agent_node_id') as string | null) ?? null,
    agentTitle: (model.getAttribute('agent_title') as string | null) ?? null,
    level: Math.max(1, Number(model.getAttribute('level')) || 1),
    paragon: Math.max(0, Number(model.getAttribute('paragon')) || 0),
    xp: Math.max(0, Number(model.getAttribute('xp')) || 0),
    skills: parse<Record<string, number>>(model.getAttribute('skills_json'), {}),
    actives: parse<string[]>(model.getAttribute('actives_json'), []),
    autoSkills: Boolean(model.getAttribute('auto_skills')),
    kills: Number(model.getAttribute('kills')) || 0,
  };
}

function readItem(model: AgentAdventureItem): Item | null {
  const slot = String(model.getAttribute('slot')) as Slot;
  const rarity = String(model.getAttribute('rarity')) as Rarity;
  if (!SLOTS.includes(slot) || !RARITIES.includes(rarity)) return null;
  const classId = model.getAttribute('class_id') as string | null;
  const location = String(model.getAttribute('location'));
  const affixes = parse<ItemAffix[]>(model.getAttribute('affixes_json'), []).filter((affix) => STAT_IDS.includes(affix?.stat) && Number.isFinite(affix?.value));
  const sockets = parse<ItemSocket[]>(model.getAttribute('sockets_json'), []).map((socket) => {
    const read: ItemSocket = { kind: socket.kind, material: socket.material && MATERIALS[socket.material] ? socket.material : null };
    if (read.material && socket.quality && GEM_QUALITIES.includes(socket.quality as GemQuality) && socket.quality !== 3) read.quality = socket.quality;
    return read;
  });
  const variant = Number(model.getAttribute('variant')) || 0;
  const uniqueId = model.getAttribute('unique_id') as string | null;
  const setId = model.getAttribute('set_id') as string | null;
  const item: Item = {
    id: String(model.getAttribute('id')),
    slot,
    classId: classId && (HERO_CLASS_IDS as string[]).includes(classId) ? (classId as HeroClassId) : null,
    rarity,
    level: Math.max(1, Number(model.getAttribute('level')) || 1),
    affixes,
    sockets,
    location: location === 'equipped' || location === 'stash' ? location : 'inventory',
    heroId: (model.getAttribute('hero_id') as string | null) ?? null,
    locked: Boolean(model.getAttribute('locked')),
    createdAt: String(model.getAttribute('created_at') ?? ''),
  };
  if (variant === 1 || variant === 2) item.variant = variant as BaseVariant;
  if (uniqueId && UNIQUES[uniqueId as UniqueId]) item.uniqueId = uniqueId as UniqueId;
  if (setId && SETS[setId as SetId]) item.setId = setId as SetId;
  return item;
}

function heroRow(hero: AdventureHero) {
  return {
    name: hero.name,
    class_id: hero.classId,
    chosen_class: hero.chosenClass,
    leader: hero.leader,
    agent_node_id: hero.agentNodeId,
    agent_title: hero.agentTitle,
    level: hero.level,
    paragon: hero.paragon,
    xp: Math.floor(hero.xp),
    skills_json: JSON.stringify(hero.skills),
    actives_json: JSON.stringify(hero.actives),
    auto_skills: hero.autoSkills,
    kills: hero.kills,
  };
}

function itemRow(item: Item) {
  return {
    location: item.location,
    hero_id: item.heroId,
    slot: item.slot,
    class_id: item.classId,
    rarity: item.rarity,
    level: item.level,
    variant: item.variant ?? 0,
    unique_id: item.uniqueId ?? null,
    set_id: item.setId ?? null,
    affixes_json: JSON.stringify(item.affixes),
    sockets_json: JSON.stringify(item.sockets),
    locked: item.locked,
  };
}

export class AdventureRepository {
  async load(workspaceId: string): Promise<AdventureSave | null> {
    const model = await AgentAdventure.query().where('workspace_id', workspaceId).first();
    if (!model) return null;
    const now = new Date().toISOString();
    const heroes = await AgentAdventureHero.query().where('workspace_id', workspaceId).get();
    const items = await AgentAdventureItem.query().where('workspace_id', workspaceId).get();
    return {
      account: readAccount(model.getAttribute('account_json'), now),
      heroes: Object.fromEntries(heroes.map(readHero).map((hero) => [hero.id, hero])),
      items: items.map(readItem).filter((item): item is Item => item !== null),
    };
  }

  /** Stores a save, writing only the heroes and items that changed since `before`. */
  async persist(workspaceId: string, before: AdventureSave | null, after: AdventureSave): Promise<void> {
    const now = new Date().toISOString();
    if (!before) {
      await AgentAdventure.create({ id: uuidv7(), workspace_id: workspaceId, account_json: JSON.stringify(after.account), created_at: now, updated_at: now });
    } else if (JSON.stringify(before.account) !== JSON.stringify(after.account)) {
      await AgentAdventure.query().where('workspace_id', workspaceId).update({ account_json: JSON.stringify(after.account), updated_at: now });
    }

    const oldHeroes = before?.heroes ?? {};
    for (const [heroId, hero] of Object.entries(after.heroes)) {
      const previous = oldHeroes[heroId];
      if (!previous) {
        await AgentAdventureHero.create({ id: heroId, workspace_id: workspaceId, ...heroRow(hero), created_at: now, updated_at: now });
      } else if (JSON.stringify(previous) !== JSON.stringify(hero)) {
        await AgentAdventureHero.query().where('id', heroId).update({ ...heroRow(hero), updated_at: now });
      }
    }
    for (const heroId of Object.keys(oldHeroes)) {
      if (!after.heroes[heroId]) await AgentAdventureHero.query().where('id', heroId).delete();
    }

    const oldItems = new Map((before?.items ?? []).map((item) => [item.id, item]));
    const kept = new Set<string>();
    for (const item of after.items) {
      kept.add(item.id);
      const previous = oldItems.get(item.id);
      if (!previous) {
        await AgentAdventureItem.create({ id: item.id, workspace_id: workspaceId, ...itemRow(item), created_at: item.createdAt || now, updated_at: now });
      } else if (JSON.stringify(previous) !== JSON.stringify(item)) {
        await AgentAdventureItem.query().where('id', item.id).update({ ...itemRow(item), updated_at: now });
      }
    }
    for (const id of oldItems.keys()) {
      if (!kept.has(id)) await AgentAdventureItem.query().where('id', id).delete();
    }
  }
}

export const adventureRepository = new AdventureRepository();
