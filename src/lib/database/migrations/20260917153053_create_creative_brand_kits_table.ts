import { Migration } from '@beeblock/svelar/database';

export default class CreateCreativeBrandKitsTable extends Migration {
  async up() {
    await this.schema.createTable('creative_brand_kits', (table) => {
      table.string('id', 36).primary();
      table.string('workspace_id', 36);
      table.string('family_id', 36);
      table.integer('version');
      table.integer('revision');
      table.string('state', 16);
      table.text('definition_json');
      table.text('snapshot_json').nullable();
      table.uniqueIndex(['workspace_id', 'family_id', 'version']);
      table.timestamps();
    });
  }

  async down() {
    await this.schema.dropTable('creative_brand_kits');
  }
}
