import { Migration } from '@beeblock/svelar/database';
import { addResumableWorkspaceColumns } from '../resumable-workspace-schema.ts';

export default class AddCollapsedToAgentWorkspaceGroupsTable extends Migration {
  async up() {
    await addResumableWorkspaceColumns(this.schema, 'agent_workspace_groups', {
      collapsed: (table) => { table.boolean('collapsed').default(false); },
    });
  }

  async down() {
    await this.schema.table('agent_workspace_groups', (table) => {
      table.dropColumn('collapsed');
    });
  }
}
