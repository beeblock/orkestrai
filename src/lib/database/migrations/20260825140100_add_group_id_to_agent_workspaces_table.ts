import { Migration } from '@beeblock/svelar/database';
import { addResumableWorkspaceColumns } from '../resumable-workspace-schema.ts';

export default class AddGroupIdToAgentWorkspacesTable extends Migration {
  async up() {
    // O schema builder do Svelar so grava a clausula FOREIGN KEY em CREATE
    // TABLE, nao em ALTER TABLE ADD COLUMN (verificado: o onDelete aqui
    // nunca vira SQL de verdade) — a pasta apagada e removida do workspace
    // explicitamente em WorkspaceGroupService.remove, nao via cascade do banco.
    await addResumableWorkspaceColumns(this.schema, 'agent_workspaces', {
      group_id: (table) => { table.uuid('group_id').nullable().references('id', 'agent_workspace_groups'); },
      position: (table) => { table.integer('position').default(0); },
    });
  }

  async down() {
    await this.schema.table('agent_workspaces', (table) => {
      table.dropColumn('position');
      table.dropColumn('group_id');
    });
  }
}
