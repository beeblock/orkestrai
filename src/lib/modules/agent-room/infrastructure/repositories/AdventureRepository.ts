import { uuidv7 } from '@beeblock/svelar/support';
import { AgentAdventureProgress } from '../../domain/models/AgentAdventureProgress.js';
import { EMPTY_PROGRESS, type AdventureProgress } from '../../domain/adventure/simulation.js';
import { TEAMMATE_CLASS_IDS, type HeroClassId } from '../../domain/adventure/catalog.js';

export type AdventureRecord = { progress: AdventureProgress; heroClasses: Record<string, HeroClassId> };

function heroClasses(raw: unknown): Record<string, HeroClassId> {
  if (typeof raw !== 'string' || !raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, HeroClassId] => (TEAMMATE_CLASS_IDS as string[]).includes(String(entry[1]))));
  } catch {
    return {};
  }
}

function progressOf(model: AgentAdventureProgress): AdventureProgress {
  const number = (key: string) => Number(model.getAttribute(key)) || 0;
  return { stageIndex: number('stage_index'), wave: number('wave'), xp: number('xp'), gold: number('gold'), kills: number('kills'), bosses: number('bosses'), quests: number('quests') };
}

/** Whether `next` is further along the road than `current`. */
function ahead(next: AdventureProgress, current: AdventureProgress): boolean {
  return next.stageIndex > current.stageIndex || (next.stageIndex === current.stageIndex && next.wave > current.wave);
}

export class AdventureRepository {
  async find(workspaceId: string): Promise<AdventureRecord> {
    const model = await AgentAdventureProgress.query().where('workspace_id', workspaceId).first();
    if (!model) return { progress: { ...EMPTY_PROGRESS }, heroClasses: {} };
    return { progress: progressOf(model), heroClasses: heroClasses(model.getAttribute('hero_classes_json')) };
  }

  /**
   * Keeps the furthest progress any screen reported: two screens running the
   * same party (the desktop strip and a window) never move it backwards.
   */
  async saveProgress(workspaceId: string, next: AdventureProgress): Promise<AdventureProgress> {
    const now = new Date().toISOString();
    const model = await AgentAdventureProgress.query().where('workspace_id', workspaceId).first();
    if (!model) {
      await AgentAdventureProgress.create({
        id: uuidv7(), workspace_id: workspaceId, stage_index: next.stageIndex, wave: next.wave, xp: next.xp, gold: next.gold,
        kills: next.kills, bosses: next.bosses, quests: next.quests, hero_classes_json: null, created_at: now, updated_at: now,
      });
      return next;
    }
    const current = progressOf(model);
    const position = ahead(next, current) ? next : current;
    const merged: AdventureProgress = {
      stageIndex: position.stageIndex,
      wave: position.wave,
      xp: Math.max(current.xp, next.xp),
      gold: Math.max(current.gold, next.gold),
      kills: Math.max(current.kills, next.kills),
      bosses: Math.max(current.bosses, next.bosses),
      quests: Math.max(current.quests, next.quests),
    };
    await AgentAdventureProgress.query().where('workspace_id', workspaceId).update({
      stage_index: merged.stageIndex, wave: merged.wave, xp: merged.xp, gold: merged.gold,
      kills: merged.kills, bosses: merged.bosses, quests: merged.quests, updated_at: now,
    });
    return merged;
  }

  async setHeroClass(workspaceId: string, nodeId: string, classId: HeroClassId | null): Promise<Record<string, HeroClassId>> {
    const record = await this.find(workspaceId);
    if (!(await AgentAdventureProgress.query().where('workspace_id', workspaceId).first())) await this.saveProgress(workspaceId, record.progress);
    const next = { ...record.heroClasses };
    if (classId) next[nodeId] = classId;
    else delete next[nodeId];
    await AgentAdventureProgress.query().where('workspace_id', workspaceId).update({ hero_classes_json: JSON.stringify(next), updated_at: new Date().toISOString() });
    return next;
  }
}

export const adventureRepository = new AdventureRepository();
