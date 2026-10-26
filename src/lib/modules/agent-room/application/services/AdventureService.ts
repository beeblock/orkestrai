import { Connection } from '@beeblock/svelar/database';
import { uuidv7 } from '@beeblock/svelar/support';
import { newAccount, type AdventureAccount, type AdventureHero } from '../../domain/adventure/account.js';
import type { HeroBuild } from '../../domain/adventure/build.js';
import * as engine from '../../domain/adventure/engine.js';
import type { AdventureSave, EngineContext, OpenResult, ReportInput, ReportResult, RosterEntry } from '../../domain/adventure/engine.js';
import type { Item } from '../../domain/adventure/items.js';
import { BASE_CHEST_CAPACITY } from '../../domain/adventure/loot.js';
import { tamedPets, type PetId } from '../../domain/adventure/pets.js';
import { activeSlots, formationSlots, inventorySlots, runeRule, stashSlots } from '../../domain/adventure/runes.js';
import { highestRegionLevel } from '../../domain/adventure/world.js';
import type { AdventureAction, AdventureReportInput } from '../../contracts/schemas/adventure.schema.js';
import { AgentActivityEvent } from '../../domain/models/AgentActivityEvent.js';
import { AgentBoardTask } from '../../domain/models/AgentBoardTask.js';
import type { TerminalNodePayload } from '../../domain/types.js';
import { adventureRepository } from '../../infrastructure/repositories/AdventureRepository.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { controlCenterService } from './ControlCenterService.js';

export type AgentPresence = { nodeId: string; title: string; role: string | null; leader: boolean; working: boolean };

/** What the screens get: the save as the owner may see it, plus every hero's build. */
export type AdventureSnapshot = {
  account: Omit<AdventureAccount, 'rewardedTasks' | 'recentReports' | 'battleUntil'>;
  /** The whole guild; `agent` is the agent playing the hero now (null while it rests). */
  heroes: Array<AdventureHero & { agent: AgentPresence | null; build: HeroBuild | null; deployed: boolean }>;
  items: Item[];
  limits: { inventory: number; stash: number; chests: number; formation: number; activeSlots: number; offlineEfficiency: number; offlineHours: number };
  tamedPets: PetId[];
  highestRegionLevel: number;
  serverTime: string;
};

export type AdventureOutcome = {
  snapshot: AdventureSnapshot;
  levelUps: ReportResult['levelUps'];
  opened: OpenResult[];
  quests: ReportResult['quests'];
  pets: PetId[];
  result?: unknown;
};

const OFFLINE_AFTER_MS = 2 * 60_000;
const WORKING = new Set(['working', 'starting']);

/** A stored timestamp as ISO text, keeping its milliseconds. */
function isoDate(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

function rng(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
}

/**
 * A workspace's Adventure. The battle runs on the screens; the server owns
 * the save and the rules: experience, levels, chests and their loot, gear,
 * the cube, runes, skills, quests from finished cards and offline work.
 */
export class AdventureService {
  private async roster(workspaceId: string): Promise<RosterEntry[]> {
    const [nodes, control] = await Promise.all([
      workspaceRepository.listNodes(workspaceId),
      controlCenterService.snapshot(workspaceId, false),
    ]);
    const live = new Map(control.agents.map((agent) => [agent.nodeId, agent]));
    return nodes
      .filter((node) => node.type === 'terminal' && Boolean((node.payload as TerminalNodePayload).provider))
      .map((node) => {
        const payload = node.payload as TerminalNodePayload;
        const agent = live.get(node.id);
        return {
          nodeId: node.id,
          title: node.title ?? 'Agent',
          role: payload.role ?? null,
          leader: Boolean(payload.maestro),
          working: Boolean(agent?.sessionAlive && WORKING.has(agent.state)),
        };
      });
  }

  private async doneTasks(workspaceId: string): Promise<Array<{ id: string; title: string; assigneeNodeId: string | null; finishedAt: string }>> {
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const rows = await AgentBoardTask.query().where('workspace_id', workspaceId).where('status', 'done').where('updated_at', '>=', since).orderBy('updated_at', 'desc').limit(200).get();
    return rows.map((row) => ({
      id: String(row.getAttribute('id')),
      title: String(row.getAttribute('title') ?? ''),
      assigneeNodeId: (row.getAttribute('assignee_node_id') as string | null) ?? null,
      finishedAt: isoDate(row.getAttribute('updated_at')),
    }));
  }

  /** Working time of each agent between `from` and now, from the recorded activity states. */
  private async workTime(workspaceId: string, from: string, now: string): Promise<Record<string, number>> {
    const start = Date.parse(from);
    const end = Date.parse(now);
    const lookback = new Date(start - 24 * 3_600_000).toISOString();
    const rows = await AgentActivityEvent.query().where('workspace_id', workspaceId).where('created_at', '>=', lookback).orderBy('created_at', 'asc').limit(20_000).get();
    const state = new Map<string, { working: boolean; since: number }>();
    const worked: Record<string, number> = {};
    const close = (nodeId: string, at: number) => {
      const current = state.get(nodeId);
      if (!current?.working) return;
      const begin = Math.max(current.since, start);
      if (at > begin) worked[nodeId] = (worked[nodeId] ?? 0) + (at - begin);
    };
    for (const row of rows) {
      const nodeId = String(row.getAttribute('node_id') ?? '');
      if (!nodeId) continue;
      const at = Date.parse(isoDate(row.getAttribute('created_at')));
      close(nodeId, Math.min(at, end));
      state.set(nodeId, { working: WORKING.has(String(row.getAttribute('state'))), since: at });
    }
    for (const nodeId of state.keys()) close(nodeId, end);
    return worked;
  }

  private snapshot(save: AdventureSave, roster: RosterEntry[], now: string): AdventureSnapshot {
    const { builds, deployed } = engine.partyBuilds(save, roster, Date.parse(now));
    const { rewardedTasks: _rewarded, recentReports: _reports, battleUntil: _paid, ...account } = save.account;
    return {
      account,
      heroes: Object.values(save.heroes)
        .map((hero) => ({
          ...hero,
          agent: roster.find((entry) => entry.nodeId === hero.agentNodeId) ?? null,
          build: builds[hero.id] ?? null,
          deployed: deployed.includes(hero.id),
        }))
        // The Maestro first, then heroes played by an agent, then the resting guild by level.
        .sort((a, b) => Number(b.leader) - Number(a.leader) || Number(Boolean(b.agent)) - Number(Boolean(a.agent)) || b.level - a.level || a.name.localeCompare(b.name)),
      items: save.items,
      limits: {
        inventory: inventorySlots(account.runes),
        stash: stashSlots(account.runes),
        chests: BASE_CHEST_CAPACITY + runeRule(account.runes, 'chest-capacity'),
        formation: formationSlots(account.runes),
        activeSlots: activeSlots(account.runes),
        offlineEfficiency: engine.offlineEfficiency(save.account),
        offlineHours: engine.offlineCapMs(save.account) / 3_600_000,
      },
      tamedPets: tamedPets(account.killsByMonster),
      highestRegionLevel: highestRegionLevel(account.cleared),
      serverTime: now,
    };
  }

  /**
   * Loads the save, keeps it in step with the team (heroes, quests and, when
   * asked, offline work), runs `change` and stores the result in one
   * transaction. The team, the finished cards and the activity history are
   * read before the transaction opens.
   */
  private async withSave<T>(workspaceId: string, options: { offline: boolean }, change: (save: AdventureSave, ctx: EngineContext) => T): Promise<{ outcome: AdventureOutcome; value: T }> {
    if (!(await workspaceRepository.getWorkspace(workspaceId))) throw new engine.AdventureError('workspace');
    const now = new Date().toISOString();
    const roster = await this.roster(workspaceId);
    const done = await this.doneTasks(workspaceId);
    const peek = await adventureRepository.load(workspaceId);
    const lastReport = peek?.account.lastReportAt ?? null;
    const offlineWork = options.offline && lastReport && Date.parse(now) - Date.parse(lastReport) > OFFLINE_AFTER_MS
      ? await this.workTime(workspaceId, lastReport, now)
      : null;
    const ctx: EngineContext = { rng, newId: uuidv7, now, roster };
    return Connection.transaction(async () => {
      const before = await adventureRepository.load(workspaceId);
      const save: AdventureSave = before ? structuredClone(before) : { account: newAccount(now), heroes: {}, items: [] };
      engine.bindRoster(save, ctx);
      const quests = engine.payQuests(save, ctx, done);
      if (offlineWork && save.account.lastReportAt === lastReport) {
        engine.payOffline(save, ctx, offlineWork);
        // Offline time is paid once: the next look starts counting from now, and no battle report claims it again.
        save.account.lastReportAt = now;
        save.account.battleUntil = now;
      }
      const value = change(save, ctx);
      await adventureRepository.persist(workspaceId, before, save);
      const report = (value && typeof value === 'object' && 'levelUps' in (value as object)) ? (value as unknown as ReportResult) : null;
      const opened = Array.isArray(value) && value.every((entry) => entry && typeof entry === 'object' && 'chestId' in entry) ? (value as OpenResult[]) : report?.opened ?? [];
      return {
        value,
        outcome: {
          snapshot: this.snapshot(save, roster, now),
          levelUps: report?.levelUps ?? [],
          opened,
          quests: [...quests, ...(report?.quests ?? [])],
          pets: report?.pets ?? [],
        },
      };
    });
  }

  async state(workspaceId: string, options: { offline?: boolean } = {}): Promise<AdventureOutcome> {
    return (await this.withSave(workspaceId, { offline: options.offline ?? true }, () => null)).outcome;
  }

  async report(workspaceId: string, input: AdventureReportInput): Promise<AdventureOutcome> {
    return (await this.withSave(workspaceId, { offline: false }, (save, ctx) => engine.applyReport(save, input as ReportInput, ctx))).outcome;
  }

  async act(workspaceId: string, action: AdventureAction): Promise<AdventureOutcome> {
    const { outcome, value } = await this.withSave(workspaceId, { offline: false }, (save, ctx) => this.dispatch(save, ctx, action));
    return { ...outcome, result: value && typeof value === 'object' && 'chestId' in (value as object) ? undefined : value };
  }

  private dispatch(save: AdventureSave, ctx: EngineContext, action: AdventureAction): unknown {
    switch (action.type) {
      case 'open-chests': return engine.openChests(save, ctx, { ids: action.ids, tier: action.tier, limit: action.limit });
      case 'equip': return engine.equipItem(save, action.itemId, action.heroId, action.replaceId);
      case 'unequip': return engine.unequipItem(save, action.itemId);
      case 'auto-equip': return engine.autoEquip(save, ctx, action.heroId);
      case 'lock': return engine.setLocked(save, action.itemId, action.locked);
      case 'move': return engine.moveItem(save, action.itemId, action.location);
      case 'salvage': return { gold: engine.salvage(save, action.itemIds) };
      case 'synthesize': return { item: engine.synthesizeItems(save, ctx, action.itemIds) };
      case 'craft': return { item: engine.craftItem(save, ctx, { slot: action.slot, level: action.level, classId: action.classId ?? null, gems: action.gems }) };
      case 'socket': return engine.socketItem(save, action.itemId, action.socketIndex, action.material, action.quality);
      case 'fuse-gems': return { quality: engine.fuseGems(save, action.gem, action.quality) };
      case 'drink': return { until: engine.drinkElixir(save, ctx, action.elixirId) };
      case 'unsocket': return engine.unsocketItem(save, action.itemId, action.socketIndex);
      case 'offering': return { item: engine.makeOffering(save, ctx) };
      case 'buy-rune': return { cost: engine.buyRune(save, action.runeId) };
      case 'raise-skill': return engine.raiseSkill(save, action.heroId, action.skillId);
      case 'reset-skills': return engine.resetSkills(save, action.heroId);
      case 'auto-skills': return engine.setAutoSkills(save, action.heroId, action.enabled);
      case 'set-actives': return engine.setActives(save, action.heroId, action.actives);
      case 'set-class': return engine.setHeroClass(save, ctx, action.heroId, action.classId);
      case 'travel': return engine.travel(save, { difficulty: action.difficulty, act: action.act, stage: action.stage });
      case 'settings': return engine.updateSettings(save, action.settings);
      case 'formation': return engine.setFormation(save, action.order);
      case 'pet': return engine.setActivePet(save, action.petId);
      case 'dismiss-offline': save.account.offline = null; return null;
    }
  }
}

export const adventureService = new AdventureService();
