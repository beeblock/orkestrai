import { Migration } from '@beeblock/svelar/database';

export default class AddIntegrationStateToAgentFloorsTable extends Migration {
  async up() {
    await this.schema.table('agent_floors', (table) => {
      // Commit the floor was created from (a working-tree snapshot when the
      // main checkout had uncommitted changes), so landing can apply only the
      // floor's own delta.
      table.string('base_commit', 64).nullable();
      table.string('base_kind', 16).nullable();
      // Floor HEAD applied to a dirty main checkout without a merge commit.
      table.string('landed_head', 64).nullable();
    });
  }

  async down() {
    await this.schema.table('agent_floors', (table) => {
      table.dropColumn('landed_head');
      table.dropColumn('base_kind');
      table.dropColumn('base_commit');
    });
  }
}
