import { Migration } from '@beeblock/svelar/database';
export default class CreateModelAccessRequestsTable extends Migration {
  async up() {
    await this.schema.createTable('model_access_requests', table => {
      table.uuid('id').primary(); table.uuid('grant_id'); table.integer('revision'); table.string('status', 20);
      table.index(['grant_id', 'created_at']); table.timestamps();
    });
  }
  async down() { await this.schema.dropTable('model_access_requests'); }
}
