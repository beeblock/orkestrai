import { Migration } from '@beeblock/svelar/database';

export default class AddAutoGearToAgentAdventureHeroesTable extends Migration {
  async up() {
    await this.schema.table('agent_adventure_heroes', (table) => {
      // Whether the hero puts on clear upgrades from opened chests by itself.
      table.boolean('auto_gear').default(true);
    });
  }

  async down() {
    await this.schema.table('agent_adventure_heroes', (table) => {
      table.dropColumn('auto_gear');
    });
  }
}
