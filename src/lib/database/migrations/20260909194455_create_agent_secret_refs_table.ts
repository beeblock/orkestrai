import { Connection, Migration } from '@beeblock/svelar/database';

export default class CreateAgentSecretRefsTable extends Migration {
  async up() {
    await this.schema.createTable('agent_secret_refs', (table) => {
      table.uuid('id').primary();
      table.uuid('workspace_id').references('id', 'agent_workspaces');
      table.text('name');
      table.text('purpose').nullable();
      table.text('provider').default('desktop');
      table.text('secret_key');
      table.text('bindings_json');
      table.boolean('enabled').default(true);
      table.timestamp('last_used_at').nullable();
      table.timestamp('created_at');
      table.timestamp('updated_at');
      table.index(['workspace_id']);
    });
    await Connection.raw('CREATE UNIQUE INDEX IF NOT EXISTS agent_secret_refs_workspace_name_unique ON agent_secret_refs (workspace_id, name)');
  }

  async down() {
    await Connection.raw('DROP INDEX IF EXISTS agent_secret_refs_workspace_name_unique');
    await this.schema.dropTable('agent_secret_refs');
  }
}
