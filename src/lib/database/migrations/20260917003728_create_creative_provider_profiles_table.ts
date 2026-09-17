import { Migration } from '@beeblock/svelar/database';

export default class CreateCreativeProviderProfilesTable extends Migration {
  async up() {
    await this.schema.createTable('creative_provider_profiles', (table) => {
      table.string('id', 36).primary();
      table.string('provider', 30);
      table.string('name', 80);
      table.boolean('enabled').default(false);
      table.boolean('has_credential').default(false);
      table.integer('revision').default(1);
      table.timestamps();
    });
  }

  async down() {
    await this.schema.dropTable('creative_provider_profiles');
  }
}
