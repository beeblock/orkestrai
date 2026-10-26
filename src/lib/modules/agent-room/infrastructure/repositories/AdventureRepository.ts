import { uuidv7 } from '@beeblock/svelar/support';
import { AgentAdventure } from '../../domain/models/AgentAdventure.js';
import { AgentAdventureHero } from '../../domain/models/AgentAdventureHero.js';
import { AgentAdventureItem } from '../../domain/models/AgentAdventureItem.js';
import { DEFAULT_SETTINGS, newAccount, type AdventureAccount, type AdventureHero } from '../../domain/adventure/account.js';
import { HERO_CLASS_IDS, type HeroClassId } from '../../domain/adventure/catalog.js';
import type { AdventureSave } from '../../domain/adventure/engine.js';
import { MATERIALS, RARITIES, SLOTS, type Item, type ItemAffix, type ItemSocket, type Rarity, type Slot } from '../../domain/adventure/items.js';
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
  const stored = parse<Partial<AdventureAccount>>(raw, {});
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
    journal: Array.isArray(stored.journal) ? stored.journal : [],
    formation: Array.isArray(stored.formation) ? stored.formation : [],
    firstBossClears: Array.isArray(stored.firstBossClears) ? stored.firstBossClears : [],
    rewardedTasks: Array.isArray(stored.rewardedTasks) ? stored.rewardedTasks : [],
  };
}

function readHero(model: AgentAdventureHero): AdventureHero {
  const chosen = model.getAttribute('chosen_class') as string | null;
  return {
    nodeId: String(model.getAttribute('node_id')),
    chosenClass: chosen && (HERO_CLASS_IDS as string[]).includes(chosen) ? (chosen as HeroClassId) : null,
    level: Math.max(1, Number(model.getAttribute('level')) || 1),
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
  const sockets = parse<ItemSocket[]>(model.getAttribute('sockets_json'), []).map((socket) => ({ kind: socket.kind, material: socket.material && MATERIALS[socket.material] ? socket.material : null }));
  return {
    id: String(model.getAttribute('id')),
    slot,
    classId: classId && (HERO_CLASS_IDS as string[]).includes(classId) ? (classId as HeroClassId) : null,
    rarity,
    level: Math.max(1, Number(model.getAttribute('level')) || 1),
    affixes,
    sockets,
    location: location === 'equipped' || location === 'stash' ? location : 'inventory',
    heroNodeId: (model.getAttribute('hero_node_id') as string | null) ?? null,
    locked: Boolean(model.getAttribute('locked')),
    createdAt: String(model.getAttribute('created_at') ?? ''),
  };
}

function heroRow(hero: AdventureHero) {
  return {
    chosen_class: hero.chosenClass,
    level: hero.level,
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
    hero_node_id: item.heroNodeId,
    slot: item.slot,
    class_id: item.classId,
    rarity: item.rarity,
    level: item.level,
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
      heroes: Object.fromEntries(heroes.map(readHero).map((hero) => [hero.nodeId, hero])),
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
    for (const [nodeId, hero] of Object.entries(after.heroes)) {
      const previous = oldHeroes[nodeId];
      if (!previous) {
        await AgentAdventureHero.create({ id: uuidv7(), workspace_id: workspaceId, node_id: nodeId, ...heroRow(hero), created_at: now, updated_at: now });
      } else if (JSON.stringify(previous) !== JSON.stringify(hero)) {
        await AgentAdventureHero.query().where('workspace_id', workspaceId).where('node_id', nodeId).update({ ...heroRow(hero), updated_at: now });
      }
    }
    for (const nodeId of Object.keys(oldHeroes)) {
      if (!after.heroes[nodeId]) await AgentAdventureHero.query().where('workspace_id', workspaceId).where('node_id', nodeId).delete();
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
