import { Migration } from '@beeblock/svelar/database';

export default class AddResolutionHashToAgentCodeGraphFilesTable extends Migration {
  async up() {
    await this.schema.table('agent_code_graph_files', (table) => {
      table.string('resolution_hash').nullable();
    });
  }

  async down() {
    await this.schema.table('agent_code_graph_files', (table) => {
      table.dropColumn('resolution_hash');
    });
  }
}
