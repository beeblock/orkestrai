import { Migration } from '@beeblock/svelar/database';

export default class CreateCreativeCharactersTable extends Migration {
  async up() {
    await this.schema.createTable('creative_characters', (table) => {
      table.string('id', 36).primary();
      table.string('workspace_id', 36);
      table.index(['workspace_id']);
      table.string('family_id', 36);
      table.integer('version');
      table.uniqueIndex(['workspace_id', 'family_id', 'version']);
      table.integer('revision').default(1);
      table.string('state', 16).default('draft');
      table.text('definition_json');
      table.text('snapshot_json').nullable();
      table.timestamps();
    });
  }

  async down() {
    await this.schema.dropTable('creative_characters');
  }
}
