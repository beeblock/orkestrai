import { Controller } from '@beeblock/svelar/routing';
import { FormValidationError } from '@beeblock/svelar/forms';
import { canvasTidyService } from '../../../application/services/CanvasTidyService.js';
import { workspaceRepository } from '../../../infrastructure/repositories/WorkspaceRepository.js';
import { RestoreArchivedNodesRequest } from '../requests/RestoreArchivedNodesRequest.js';

/** Archived canvas items: list, restore, and tidy finished work off the board. */
export class CanvasTidyController extends Controller {
  private async workspace(event: any) {
    return workspaceRepository.getWorkspace(String(event.params.id));
  }

  async archived(event: any) {
    const workspace = await this.workspace(event);
    if (!workspace) return this.json({ error: 'workspace_not_found' }, 404);
    return this.json({ data: { nodes: await canvasTidyService.listArchived(workspace.id), autoTidy: await canvasTidyService.enabled() } });
  }

  async restore(event: any) {
    const workspace = await this.workspace(event);
    if (!workspace) return this.json({ error: 'workspace_not_found' }, 404);
    try {
      const input = await RestoreArchivedNodesRequest.validate(event);
      return this.json({ data: { restored: await canvasTidyService.restore(workspace.id, input.nodeIds) } });
    } catch (error) {
      if (error instanceof FormValidationError) return this.json({ error: 'restore_invalid_request' }, 422);
      return this.json({ error: 'restore_failed' }, 400);
    }
  }

  async tidy(event: any) {
    const workspace = await this.workspace(event);
    if (!workspace) return this.json({ error: 'workspace_not_found' }, 404);
    const result = await canvasTidyService.tidyFinished(workspace.id);
    return this.json({ data: { archived: result.archived.length, gathered: result.gathered.length } });
  }
}
