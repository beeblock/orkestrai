import { Migration } from '@beeblock/svelar/database';

export default class CreateAgentAdventureItemsTable extends Migration {
  async up() {
    await this.schema.createTable('agent_adventure_items', (table) => {
      table.uuid('id').primary();
      table.uuid('workspace_id').references('id', 'agent_workspaces').onDelete('cascade');
      table.string('location');
      table.uuid('hero_id').nullable();
      table.string('slot');
      table.string('class_id').nullable();
      table.string('rarity');
      table.integer('level');
      table.integer('variant').default(0);
      table.string('unique_id').nullable();
      table.string('set_id').nullable();
      table.text('affixes_json');
      table.text('sockets_json');
      table.boolean('locked').default(false);
      table.timestamp('created_at');
      table.timestamp('updated_at');
      table.index(['workspace_id']);
    });
  }

  async down() {
    await this.schema.dropTable('agent_adventure_items');
  }
}
