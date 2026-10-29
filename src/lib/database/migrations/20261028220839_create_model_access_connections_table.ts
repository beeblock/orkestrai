import { Migration } from '@beeblock/svelar/database';

export default class CreateModelAccessConnectionsTable extends Migration {
  async up() {
    await this.schema.createTable('model_access_connections', (table) => {
      table.uuid('id').primary();
      table.uuid('grant_id');
      table.string('name', 100);
      table.text('relay_url');
      table.text('owner_public_key');
      table.uuid('guest_id');
      table.string('guest_name', 100);
      table.string('status', 20).default('pending');
      table.text('policy_json').nullable();
      table.timestamp('expires_at').nullable();
      table.index(['grant_id']);
      table.timestamps();
    });
  }
  async down() { await this.schema.dropTable('model_access_connections'); }
}
