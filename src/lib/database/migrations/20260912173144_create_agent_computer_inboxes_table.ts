import { Connection, Migration } from '@beeblock/svelar/database';

export default class CreateAgentComputerInboxesTable extends Migration {
  async up() {
    await this.schema.createTable('agent_computer_inboxes', (table) => {
      table.uuid('id').primary();
      table.uuid('workspace_id').references('id', 'agent_workspaces').onDelete('cascade');
      table.uuid('grant_id');
      table.integer('revision').default(0);
      table.text('state_json');
      table.timestamp('updated_at');
    });
    await Connection.raw('CREATE UNIQUE INDEX agent_computer_inboxes_scope ON agent_computer_inboxes (workspace_id, grant_id)');
  }

  async down() {
    await Connection.raw('DROP INDEX IF EXISTS agent_computer_inboxes_scope');
    await this.schema.dropTable('agent_computer_inboxes');
  }
}
