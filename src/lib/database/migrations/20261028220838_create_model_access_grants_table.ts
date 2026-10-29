import { Migration } from '@beeblock/svelar/database';

export default class CreateModelAccessGrantsTable extends Migration {
  async up() {
    await this.schema.createTable('model_access_grants', (table) => {
      table.uuid('id').primary();
      table.string('name', 100);
      table.string('status', 20).default('draft');
      table.text('relay_url');
      table.integer('revision').default(1);
      table.text('policy_json');
      table.text('guest_json').nullable();
      table.integer('requests_used').default(0);
      table.timestamp('expires_at');
      table.index(['status']);
      table.timestamps();
    });
  }
  async down() { await this.schema.dropTable('model_access_grants'); }
}
