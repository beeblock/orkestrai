import { Connection, Migration } from '@beeblock/svelar/database';
export default class AddPagingIndexToAgentCodeGraphSymbolsTable extends Migration {
  async up() {
    await this.schema.table('agent_code_graph_symbols', table => {
      table.index(['workspace_id', 'id', 'project_id', 'revision_id'], 'idx_agent_code_graph_symbols_paging');
    });
  }
  async down() { await Connection.raw('DROP INDEX IF EXISTS idx_agent_code_graph_symbols_paging'); }
}
