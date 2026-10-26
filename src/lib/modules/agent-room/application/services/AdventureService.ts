import type { HeroClassId } from '../../domain/adventure/catalog.js';
import type { AdventureProgress } from '../../domain/adventure/simulation.js';
import { adventureRepository, type AdventureRecord } from '../../infrastructure/repositories/AdventureRepository.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';

/** A workspace's Adventure: its party's progress on the road and the classes the owner picked. */
export class AdventureService {
  private async requireWorkspace(workspaceId: string): Promise<void> {
    if (!(await workspaceRepository.getWorkspace(workspaceId))) throw new Error('Workspace não encontrado.');
  }

  async read(workspaceId: string): Promise<AdventureRecord> {
    await this.requireWorkspace(workspaceId);
    return adventureRepository.find(workspaceId);
  }

  async saveProgress(workspaceId: string, progress: AdventureProgress): Promise<AdventureProgress> {
    await this.requireWorkspace(workspaceId);
    return adventureRepository.saveProgress(workspaceId, progress);
  }

  async setHeroClass(workspaceId: string, nodeId: string, classId: HeroClassId | null): Promise<Record<string, HeroClassId>> {
    await this.requireWorkspace(workspaceId);
    const node = await workspaceRepository.getNode(nodeId);
    if (!node || node.workspaceId !== workspaceId || node.type !== 'terminal') throw new Error('Agente não encontrado neste workspace.');
    return adventureRepository.setHeroClass(workspaceId, nodeId, classId);
  }
}

export const adventureService = new AdventureService();
