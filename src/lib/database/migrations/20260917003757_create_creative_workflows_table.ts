import { Migration } from '@beeblock/svelar/database';

export default class CreateCreativeWorkflowsTable extends Migration {
  async up() {
    await this.schema.createTable('creative_workflows', (table) => {
      table.string('id', 36).primary();
      table.string('workspace_id', 36);
      table.index(['workspace_id']);
      table.string('node_id', 36).unique();
      table.string('title', 120);
      table.text('config_json');
      table.integer('revision').default(1);
      table.timestamps();
    });
  }

  async down() {
    await this.schema.dropTable('creative_workflows');
  }
}
