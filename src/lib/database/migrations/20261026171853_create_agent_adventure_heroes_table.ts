import { Migration } from '@beeblock/svelar/database';

export default class CreateAgentAdventureHeroesTable extends Migration {
  async up() {
    await this.schema.createTable('agent_adventure_heroes', (table) => {
      table.uuid('id').primary();
      table.uuid('workspace_id').references('id', 'agent_workspaces').onDelete('cascade');
      table.string('name');
      table.string('class_id');
      table.string('chosen_class').nullable();
      table.boolean('leader').default(false);
      table.uuid('agent_node_id').nullable();
      table.string('agent_title').nullable();
      table.integer('level').default(1);
      table.integer('paragon').default(0);
      table.integer('xp').default(0);
      table.text('skills_json');
      table.text('actives_json');
      table.boolean('auto_skills').default(true);
      table.integer('kills').default(0);
      table.timestamp('created_at');
      table.timestamp('updated_at');
      table.index(['workspace_id']);
    });
  }

  async down() {
    await this.schema.dropTable('agent_adventure_heroes');
  }
}
