import { Migration } from '@beeblock/svelar/database';

export default class CreateAgentLearningEntriesTable extends Migration {
  async up() {
    await this.schema.createTable('agent_learning_entries', (table) => {
      table.uuid('id').primary();
      table.uuid('workspace_id').references('id', 'agent_workspaces');
      table.uuid('node_id');
      table.uuid('task_id');
      table.string('status');
      table.string('fingerprint');
      table.integer('revision').default(1);
      table.text('document_json');
      table.timestamp('created_at');
      table.timestamp('updated_at');
      table.index(['workspace_id', 'node_id', 'status']);
      table.uniqueIndex(['workspace_id', 'node_id', 'fingerprint']);
    });
  }

  async down() {
    await this.schema.dropTable('agent_learning_entries');
  }
}
