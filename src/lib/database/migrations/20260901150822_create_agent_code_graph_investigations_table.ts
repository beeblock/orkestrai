import { Migration } from '@beeblock/svelar/database';

export default class CreateAgentCodeGraphInvestigationsTable extends Migration {
  async up() {
    await this.schema.createTable('agent_code_graph_investigations', (table) => {
      table.uuid('id').primary();
      table.uuid('workspace_id').references('id', 'agent_workspaces').onDelete('cascade');
      table.string('name');
      table.text('state_json');
      table.string('created_by').default('user');
      table.timestamp('created_at');
      table.timestamp('updated_at');
      table.index(['workspace_id', 'updated_at']);
    });
  }

  async down() {
    await this.schema.dropTable('agent_code_graph_investigations');
  }
}
