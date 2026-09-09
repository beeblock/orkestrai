import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { performGoogleDesktopOauth } = require('../../electron/google-oauth.cjs');

describe('Google desktop OAuth', () => {
  it('uses PKCE and stores tokens without returning them', async () => {
    let stored = '';
    let authorizeUrl = '';
    const result = await performGoogleDesktopOauth({
      clientId: '123456789012-abcdefghijklmnopqrstuvwxyz.apps.googleusercontent.com',
      permissions: ['gmail.list_messages', 'gmail.send_email'],
      storageKey: 'automation:secret-ref:workspace:credential',
      openExternal: async (value: string) => {
        authorizeUrl = value;
        const authorize = new URL(value);
        expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
        const callback = new URL(String(authorize.searchParams.get('redirect_uri')));
        callback.searchParams.set('state', String(authorize.searchParams.get('state')));
        callback.searchParams.set('code', 'one-time-code');
        await fetch(callback);
      },
      saveSecret: async (_key: string, value: string) => { stored = value; },
      fetchFn: async (url: string) => url.includes('/token')
        ? new Response(JSON.stringify({ access_token: 'access-secret', refresh_token: 'refresh-secret', expires_in: 3600, token_type: 'Bearer' }), { status: 200 })
        : new Response(JSON.stringify({ emailAddress: 'owner@example.com' }), { status: 200 }),
    });

    expect(authorizeUrl).toContain('accounts.google.com');
    expect(stored).toContain('refresh-secret');
    expect(result).toMatchObject({ stored: true, accountEmail: 'owner@example.com', hasRefreshToken: true });
    expect(JSON.stringify(result)).not.toContain('access-secret');
    expect(JSON.stringify(result)).not.toContain('refresh-secret');
  });
});
