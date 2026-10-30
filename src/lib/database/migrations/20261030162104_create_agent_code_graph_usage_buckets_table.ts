import { Migration } from '@beeblock/svelar/database';

export default class CreateAgentCodeGraphUsageBucketsTable extends Migration {
  async up() {
    await this.schema.createTable('agent_code_graph_usage_buckets', table => {
      table.uuid('id').primary();
      table.uuid('workspace_id').references('id', 'agent_workspaces').onDelete('cascade');
      table.string('hour');
      table.string('actor');
      table.string('operation');
      table.text('counters_json');
      table.uniqueIndex(['workspace_id', 'hour', 'actor', 'operation']);
    });
  }
  async down() { await this.schema.dropTable('agent_code_graph_usage_buckets'); }
}
