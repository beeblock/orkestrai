import { afterEach, describe, expect, it } from 'vitest';
import { createMobileGateway, hashMobileToken, mobileRequestAllowed } from '../../scripts/mobile-gateway.mjs';

let stop: (() => Promise<unknown>) | null = null;

describe('phone gateway', () => {
  afterEach(async () => { await stop?.(); stop = null; });

  it('allows only the phone page, its assets and the phone APIs', () => {
    expect(mobileRequestAllowed('GET', '/m')).toBe('public');
    expect(mobileRequestAllowed('GET', '/_app/immutable/x.js')).toBe('public');
    expect(mobileRequestAllowed('GET', '/canvas')).toBeNull();
    expect(mobileRequestAllowed('GET', '/api/agent-room/settings')).toBeNull();
    expect(mobileRequestAllowed('POST', '/api/agent-room/mobile')).toBeNull();
    expect(mobileRequestAllowed('GET', '/api/agent-room/attention')).toBe('api');
    expect(mobileRequestAllowed('POST', '/api/agent-room/attention/01a14a44-5d87-7d1c-90e7-7b697f79bf77/decide')).toBe('api');
    expect(mobileRequestAllowed('DELETE', '/api/agent-room/attention/01a14a44-5d87-7d1c-90e7-7b697f79bf77')).toBeNull();
    expect(mobileRequestAllowed('POST', '/api/agent-room/workspaces/01a14a44-5d87-7d1c-90e7-7b697f79bf77/channels/team/messages')).toBe('api');
    expect(mobileRequestAllowed('POST', '/api/agent-room/workspaces/01a14a44-5d87-7d1c-90e7-7b697f79bf77/terminals/x/write')).toBeNull();
  });

  it('forwards authenticated phone API calls as a loopback client and refuses the rest', async () => {
    const seen: Array<{ url: string; host?: string; origin?: string; token?: string }> = [];
    const gateway = createMobileGateway({
      loopbackHost: '127.0.0.1:4173',
      handler: (request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) => {
        seen.push({ url: String(request.url), host: request.headers.host, origin: request.headers.origin as string | undefined, token: request.headers['x-orkestrai-mobile-token'] as string | undefined });
        response.end('{"data":true}');
      },
    });
    const port = 47000 + Math.floor(Math.random() * 1000);
    await gateway.start({ port, tokenHash: hashMobileToken('secret-token') });
    stop = () => gateway.stop();
    const base = `http://127.0.0.1:${port}`;
    expect((await fetch(`${base}/api/agent-room/attention`)).status).toBe(401);
    expect((await fetch(`${base}/api/agent-room/attention`, { headers: { 'x-orkestrai-mobile-token': 'wrong' } })).status).toBe(401);
    expect((await fetch(`${base}/api/agent-room/settings`, { headers: { 'x-orkestrai-mobile-token': 'secret-token' } })).status).toBe(404);
    const ok = await fetch(`${base}/api/agent-room/attention`, { headers: { 'x-orkestrai-mobile-token': 'secret-token', origin: 'http://192.168.0.9:7420' } });
    expect(ok.status).toBe(200);
    expect(seen).toEqual([{ url: '/api/agent-room/attention', host: '127.0.0.1:4173', origin: 'http://127.0.0.1:4173', token: undefined }]);
    expect((await fetch(`${base}/m`)).status).toBe(200);
  });
});
