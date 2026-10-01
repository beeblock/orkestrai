import { Migration } from '@beeblock/svelar/database';
import { createResumableWorkspaceGroups } from '../resumable-workspace-schema.ts';

export default class CreateAgentWorkspaceGroupsTable extends Migration {
  async up() {
    await createResumableWorkspaceGroups(this.schema, (table) => {
      table.uuid('id').primary();
      table.string('name');
      table.uuid('parent_id').nullable().references('id', 'agent_workspace_groups').onDelete('set null');
      table.integer('position').default(0);
      table.timestamps();
      table.index(['parent_id', 'position']);
    });
  }

  async down() {
    await this.schema.dropTable('agent_workspace_groups');
  }
}
