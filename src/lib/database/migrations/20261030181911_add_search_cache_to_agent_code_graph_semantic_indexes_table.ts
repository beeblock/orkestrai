import { Migration } from '@beeblock/svelar/database';

export default class AddSearchCacheToAgentCodeGraphSemanticIndexesTable extends Migration {
  async up() {
    await this.schema.table('agent_code_graph_semantic_indexes', (table) => {
      table.string('revision_hash').nullable();
      table.integer('symbol_count').nullable();
      table.blob('search_data').nullable();
    });
  }

  async down() {
    await this.schema.table('agent_code_graph_semantic_indexes', (table) => {
      table.dropColumn('search_data');
      table.dropColumn('symbol_count');
      table.dropColumn('revision_hash');
    });
  }
}
