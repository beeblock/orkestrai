import { Migration } from '@beeblock/svelar/database';

export default class CreateModelAccessAuditsTable extends Migration {
  async up() {
    await this.schema.createTable('model_access_audits', (table) => {
      table.uuid('id').primary();
      table.uuid('grant_id');
      table.string('event', 64);
      table.text('metadata_json');
      table.index(['grant_id', 'created_at']);
      table.timestamps();
    });
  }
  async down() { await this.schema.dropTable('model_access_audits'); }
}
