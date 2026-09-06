import { describe, expect, it } from 'vitest';
import { sanitizeAgentEnvironment } from '$lib/modules/agent-room/infrastructure/agent-path.ts';

describe('agent environment isolation', () => {
  it('removes Orkestrai server configuration without hiding the user environment or bridge', () => {
    const env = sanitizeAgentEnvironment({
      APP_KEY: 'base64:orkestrai-key',
      INTERNAL_SECRET: 'server-secret',
      APP_URL: 'http://orkestrai.internal',
      DB_DRIVER: 'sqlite',
      RESEND_API_KEY: 'server-mail-token',
      HOST: '127.0.0.1',
      PORT: '4173',
      ORIGIN: 'http://127.0.0.1:4173',
      ELECTRON_RUN_AS_NODE: '1',
      ORKESTRAI_DATA_DIR: '/tmp/orkestrai',
      ORKESTRAI_PRIVATE_ENV_KEYS: 'APP_URL,DB_DRIVER,RESEND_API_KEY,ORKESTRAI_API_URL',
      ORKESTRAI_API_URL: 'http://127.0.0.1:4173',
      ORKESTRAI_CLI: '/tmp/bin/orkestrai',
      ORKESTRAI_CLI_CONSOLE_RUNTIME: 'C:\\Program Files\\Orkestrai\\resources\\orkestrai-cli-runtime\\node.exe',
      PATH: '/usr/local/bin:/usr/bin',
      HOME: '/Users/developer',
      SSH_AUTH_SOCK: '/tmp/ssh-agent.sock',
      GH_TOKEN: 'user-owned-token',
    });

    expect(env).not.toHaveProperty('APP_KEY');
    expect(env).not.toHaveProperty('INTERNAL_SECRET');
    expect(env).not.toHaveProperty('APP_URL');
    expect(env).not.toHaveProperty('DB_DRIVER');
    expect(env).not.toHaveProperty('RESEND_API_KEY');
    expect(env).not.toHaveProperty('HOST');
    expect(env).not.toHaveProperty('PORT');
    expect(env).not.toHaveProperty('ORIGIN');
    expect(env).not.toHaveProperty('ELECTRON_RUN_AS_NODE');
    expect(env).not.toHaveProperty('ORKESTRAI_DATA_DIR');
    expect(env).not.toHaveProperty('ORKESTRAI_PRIVATE_ENV_KEYS');
    expect(env).toMatchObject({
      ORKESTRAI_API_URL: 'http://127.0.0.1:4173',
      ORKESTRAI_CLI: '/tmp/bin/orkestrai',
      ORKESTRAI_CLI_CONSOLE_RUNTIME: 'C:\\Program Files\\Orkestrai\\resources\\orkestrai-cli-runtime\\node.exe',
      PATH: '/usr/local/bin:/usr/bin',
      HOME: '/Users/developer',
      SSH_AUTH_SOCK: '/tmp/ssh-agent.sock',
      GH_TOKEN: 'user-owned-token',
    });
  });

  it('allows a terminal-specific variable to opt back in explicitly', () => {
    const env = {
      ...sanitizeAgentEnvironment({ APP_KEY: 'orkestrai-key', PATH: '/usr/bin' }),
      APP_KEY: 'laravel-project-key',
    };

    expect(env.APP_KEY).toBe('laravel-project-key');
  });
});
