import { Connection, Migration } from '@beeblock/svelar/database';

export default class AddStorageRevisionToAgentCodeGraphProjectsTable extends Migration {
  async up() {
    await this.schema.table('agent_code_graph_projects', (table) => {
      // Logical publication advances without retagging every unchanged row.
      table.string('storage_revision_id').nullable();
      table.string('indexed_config_hash').nullable();
    });
    await Connection.raw('UPDATE agent_code_graph_projects SET indexed_config_hash = config_hash WHERE current_revision_id IS NOT NULL');
  }

  async down() {
    await this.schema.table('agent_code_graph_projects', (table) => {
      table.dropColumn('storage_revision_id');
      table.dropColumn('indexed_config_hash');
    });
  }
}
