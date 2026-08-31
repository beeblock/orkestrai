import { Migration } from '@beeblock/svelar/database';

export default class AddMetadataToAgentCodeGraphSymbols extends Migration {
  async up() {
    await this.schema.table('agent_code_graph_symbols', (table) => {
      table.text('metadata_json').nullable();
    });
  }

  async down() {
    await this.schema.dropColumn('agent_code_graph_symbols', 'metadata_json');
  }
}
