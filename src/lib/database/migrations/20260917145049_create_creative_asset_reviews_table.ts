import { Migration } from '@beeblock/svelar/database';

export default class CreateCreativeAssetReviewsTable extends Migration {
  async up() {
    await this.schema.createTable('creative_asset_reviews', (table) => {
      table.string('id', 36).primary();
      table.string('workspace_id', 36);
      table.string('node_id', 36);
      table.integer('revision');
      table.string('digest', 64);
      table.string('decision', 32);
      table.text('snapshot_json');
      table.text('comment');
      table.string('actor_type', 16);
      table.string('actor_id', 36).nullable();
      table.uniqueIndex(['workspace_id', 'node_id', 'revision']);
      table.timestamps();
    });
  }

  async down() {
    await this.schema.dropTable('creative_asset_reviews');
  }
}
