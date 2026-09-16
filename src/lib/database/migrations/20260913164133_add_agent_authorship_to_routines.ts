import { Connection, Migration } from '@beeblock/svelar/database';

export default class AddAgentAuthorshipToRoutines extends Migration {
  async up() {
    await this.schema.table('agent_routines', (table) => {
      table.uuid('author_agent_id').nullable();
      table.uuid('author_task_id').nullable();
      table.string('author_key').nullable();
      table.string('author_digest').nullable();
      table.integer('revision').default(1);
    });
    // Schema.table currently ignores index declarations on existing tables.
    await Connection.raw('CREATE UNIQUE INDEX agent_routine_author_key ON agent_routines (workspace_id, author_agent_id, author_key)');
  }

  async down() {
    await Connection.raw('DROP INDEX IF EXISTS agent_routine_author_key');
    await this.schema.table('agent_routines', (table) => {
      for (const column of ['author_agent_id', 'author_task_id', 'author_key', 'author_digest', 'revision']) table.dropColumn(column);
    });
  }
}
