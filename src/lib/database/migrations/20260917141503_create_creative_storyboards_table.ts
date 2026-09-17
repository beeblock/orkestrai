import { Migration } from '@beeblock/svelar/database';

export default class CreateCreativeStoryboardsTable extends Migration {
  async up() {
    await this.schema.createTable('creative_storyboards', (table) => {
      table.string('id', 36).primary();
      table.string('workspace_id', 36);
      table.string('node_id', 36);
      table.uniqueIndex(['workspace_id', 'node_id']);
      table.integer('revision').default(1);
      table.text('document_json');
      table.timestamps();
    });
  }

  async down() {
    await this.schema.dropTable('creative_storyboards');
  }
}
