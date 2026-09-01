import { Model } from '@beeblock/svelar/orm';

export class AgentCodeGraphEmbedding extends Model {
  static table = 'agent_code_graph_embeddings';
  static primaryKey = 'id';
  static incrementing = false;
  static timestamps = false;
  static fillable = ['id', 'workspace_id', 'project_id', 'revision_id', 'symbol_id', 'model', 'dimensions', 'vector', 'content_hash', 'created_at', 'updated_at'];

  declare id: string;
  declare workspace_id: string;
  declare project_id: string;
  declare revision_id: string;
  declare symbol_id: string;
  declare model: string;
  declare dimensions: number;
  declare vector: Buffer;
  declare content_hash: string;
  declare created_at: Date;
  declare updated_at: Date;
}
