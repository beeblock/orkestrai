import { Migration } from '@beeblock/svelar/database';

export default class ExtendAgentAutomationIntegrationsForSdk extends Migration {
  async up() {
    await this.schema.table('agent_automation_integrations', (table) => {
      table.text('manifest_version').default('1.0.0');
      table.text('secret_refs_json').default('[]');
      table.text('permissions_json').default('[]');
      table.boolean('enabled').default(true);
      table.timestamp('last_used_at').nullable();
    });
  }

  async down() {
    for (const column of ['manifest_version', 'secret_refs_json', 'permissions_json', 'enabled', 'last_used_at']) {
      await this.schema.dropColumn('agent_automation_integrations', column);
    }
  }
}
