import { Connection, Migration } from '@beeblock/svelar/database';

export default class CreateAgentCodeGraphSymbolSearchTable extends Migration {
  async up() {
    // FTS5 is intentionally isolated behind CodeGraphStore. The desktop uses
    // SQLite, while another graph/search backend can implement the same port.
    await Connection.raw(`
      CREATE VIRTUAL TABLE agent_code_graph_symbol_search USING fts5(
        symbol_id UNINDEXED,
        revision_id UNINDEXED,
        workspace_id UNINDEXED,
        project_id UNINDEXED,
        name,
        qualified_name,
        path,
        documentation,
        signature,
        tokenize = 'unicode61 remove_diacritics 2'
      )
    `);
  }

  async down() {
    await Connection.raw('DROP TABLE IF EXISTS agent_code_graph_symbol_search');
  }
}
