/** Public Slack app configuration. Contains no tokens, URLs or workspace data. */
export function slackBotManifest() {
  return {
    display_information: { name: 'Orkestrai Bot', description: 'Personal assistant connected to Orkestrai' },
    features: { bot_user: { display_name: 'Orkestrai Bot', always_online: false } },
    oauth_config: { scopes: { bot: ['chat:write', 'files:read', 'files:write',
      'channels:read', 'channels:history', 'groups:read', 'groups:history',
      'im:read', 'im:history', 'mpim:read', 'mpim:history'] } },
    settings: { socket_mode_enabled: false, org_deploy_enabled: false, token_rotation_enabled: false },
  };
}
