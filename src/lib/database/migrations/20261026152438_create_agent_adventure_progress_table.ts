import { Migration } from '@beeblock/svelar/database';

export default class CreateAgentAdventureProgressTable extends Migration {
  async up() {
    await this.schema.createTable('agent_adventure_progress', (table) => {
      table.uuid('id').primary();
      table.uuid('workspace_id').references('id', 'agent_workspaces').onDelete('cascade');
      table.integer('stage_index').default(0);
      table.integer('wave').default(0);
      table.integer('xp').default(0);
      table.integer('gold').default(0);
      table.integer('kills').default(0);
      table.integer('bosses').default(0);
      table.integer('quests').default(0);
      table.text('hero_classes_json').nullable();
      table.timestamp('created_at');
      table.timestamp('updated_at');
      table.uniqueIndex(['workspace_id']);
    });
  }

  async down() {
    await this.schema.dropTable('agent_adventure_progress');
  }
}
