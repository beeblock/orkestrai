import { Migration } from '@beeblock/svelar/database';

export default class CreateCreativeSequencesTable extends Migration {
  async up() {
    await this.schema.createTable('creative_sequences', (table) => {
      table.string('id', 36).primary(); table.string('workspace_id', 36); table.string('node_id', 36).unique();
      table.integer('revision'); table.text('document_json'); table.text('export_json').nullable();
      table.timestamps();
    });
  }

  async down() {
    await this.schema.dropTable('creative_sequences');
  }
}
