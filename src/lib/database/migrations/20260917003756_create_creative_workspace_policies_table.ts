import { Migration } from '@beeblock/svelar/database';

export default class CreateCreativeWorkspacePolicysTable extends Migration {
  async up() {
    await this.schema.createTable('creative_workspace_policies', (table) => {
      table.string('id', 36).primary();
      table.string('workspace_id', 36);
      table.string('profile_id', 36);
      table.text('policy_json');
      table.integer('revision').default(1);
      table.uniqueIndex(['workspace_id', 'profile_id']);
      table.index(['profile_id']);
      table.timestamps();
    });
  }

  async down() {
    await this.schema.dropTable('creative_workspace_policies');
  }
}
