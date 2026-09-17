import { uuidv7 } from '@beeblock/svelar/support';
import { CreativeAssetReview as ReviewModel } from '../../domain/models/CreativeAssetReview.js';
import type { CreativeAssetReview, CreativeAssetSnapshot } from '../../domain/asset-review.js';
import type { CreativeActor } from '../../domain/types.js';
import { CreativeMediaError } from '../../domain/types.js';
function record(row: ReviewModel): CreativeAssetReview {
  return { id: String(row.getAttribute('id')), nodeId: String(row.getAttribute('node_id')), revision: Number(row.getAttribute('revision')), digest: String(row.getAttribute('digest')), decision: row.getAttribute('decision') as CreativeAssetReview['decision'], comment: String(row.getAttribute('comment')), snapshot: JSON.parse(String(row.getAttribute('snapshot_json'))), createdAt: String(row.getAttribute('created_at')), actorType: String(row.getAttribute('actor_type')), actorId: row.getAttribute('actor_id') as string | null };
}
export class CreativeAssetReviewRepository {
  async history(workspaceId: string, nodeId: string) { return (await ReviewModel.query().where('workspace_id', workspaceId).where('node_id', nodeId).orderBy('revision', 'desc').limit(20).get()).map(record); }
  async append(workspaceId: string, nodeId: string, expectedRevision: number, digest: string, snapshot: CreativeAssetSnapshot, decision: CreativeAssetReview['decision'], comment: string, actor: CreativeActor) {
    if (((await this.history(workspaceId, nodeId))[0]?.revision ?? 0) !== expectedRevision) throw new CreativeMediaError('creative_revision_conflict', 409);
    const stamp = new Date().toISOString();
    const row = await ReviewModel.create({ id: uuidv7(), workspace_id: workspaceId, node_id: nodeId, revision: expectedRevision + 1, digest, snapshot_json: JSON.stringify(snapshot), decision, comment, actor_type: actor.type, actor_id: actor.type === 'agent' ? actor.nodeId : null, created_at: stamp, updated_at: stamp });
    return record(row);
  }
  async removeWorkspace(workspaceId: string) { await ReviewModel.query().where('workspace_id', workspaceId).delete(); }
}
export const creativeAssetReviewRepository = new CreativeAssetReviewRepository();
