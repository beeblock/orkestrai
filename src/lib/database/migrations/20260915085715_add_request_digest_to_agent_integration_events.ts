import { Migration } from '@beeblock/svelar/database';

export default class AddRequestDigestToAgentIntegrationEvents extends Migration {
  async up() {
    await this.schema.table('agent_integration_events', (table) => {
      table.string('request_digest', 64).nullable();
    });
  }

  async down() {
    await this.schema.table('agent_integration_events', (table) => {
      table.dropColumn('request_digest');
    });
  }
}
