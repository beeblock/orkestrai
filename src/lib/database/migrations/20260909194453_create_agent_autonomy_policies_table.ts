import { Connection, Migration } from '@beeblock/svelar/database';

export default class CreateAgentAutonomyPoliciesTable extends Migration {
  async up() {
    await this.schema.createTable('agent_autonomy_policies', (table) => {
      table.uuid('id').primary();
      table.uuid('workspace_id').references('id', 'agent_workspaces');
      table.text('mode').default('observe');
      table.boolean('enabled').default(false);
      table.text('policy_json');
      table.integer('revision').default(1);
      table.timestamp('created_at');
      table.timestamp('updated_at');
      table.index(['workspace_id']);
    });
    await Connection.raw('CREATE UNIQUE INDEX IF NOT EXISTS agent_autonomy_policies_workspace_unique ON agent_autonomy_policies (workspace_id)');
  }

  async down() {
    await Connection.raw('DROP INDEX IF EXISTS agent_autonomy_policies_workspace_unique');
    await this.schema.dropTable('agent_autonomy_policies');
  }
}
