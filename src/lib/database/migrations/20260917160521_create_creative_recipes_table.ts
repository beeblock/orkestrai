import { Migration } from '@beeblock/svelar/database';

export default class CreateCreativeRecipesTable extends Migration {
  async up() {
    await this.schema.createTable('creative_recipes', (table) => {
      table.string('id', 36).primary(); table.string('workspace_id', 36);
      table.string('family_id', 36); table.integer('version');
      table.string('name', 120); table.text('description');
      table.text('definition_json'); table.string('digest', 64);
      table.uniqueIndex(['family_id', 'version']);
      table.timestamps();
    });
  }

  async down() {
    await this.schema.dropTable('creative_recipes');
  }
}
