import { Connection, Migration } from '@beeblock/svelar/database';

export default class AddFormatToAgentCodeGraphRevisionManifestsTable extends Migration {
  async up() {
    await this.schema.table('agent_code_graph_revision_manifests', (table) => {
      table.integer('format').default(1);
      table.index(['project_id', 'format']);
    });
  }

  async down() {
    await Connection.raw('DROP INDEX IF EXISTS idx_agent_code_graph_revision_manifests_project_id_format');
    await this.schema.table('agent_code_graph_revision_manifests', (table) => {
      table.dropColumn('format');
    });
  }
}
