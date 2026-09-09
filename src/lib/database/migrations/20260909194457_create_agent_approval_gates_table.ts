import { Migration } from '@beeblock/svelar/database';

export default class CreateAgentApprovalGatesTable extends Migration {
  async up() {
    await this.schema.createTable('agent_approval_gates', (table) => {
      table.uuid('id').primary();
      table.uuid('workspace_id').references('id', 'agent_workspaces');
      table.uuid('run_id').nullable();
      table.text('step_id').nullable();
      table.text('risk');
      table.text('capability');
      table.text('target').nullable();
      table.text('summary');
      table.text('status').default('pending');
      table.text('requirement').default('user');
      table.text('requested_by').nullable();
      table.text('resolved_by').nullable();
      table.text('resolution_note').nullable();
      table.text('request_digest');
      table.timestamp('expires_at').nullable();
      table.timestamp('resolved_at').nullable();
      table.timestamp('created_at');
      table.timestamp('updated_at');
      table.index(['workspace_id', 'status']);
      table.index(['run_id']);
    });
  }

  async down() {
    await this.schema.dropTable('agent_approval_gates');
  }
}
