// Phone access on the local network. The main server listens on loopback only;
// when the owner turns this on, a second listener on the LAN forwards a short
// allowlist of routes (the phone page, its assets and the Needs you / Chat /
// team APIs) to the same SvelteKit handler. API calls must carry the pairing
// token, which is compared by hash; clients outside private networks are refused.
import http from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { networkInterfaces } from 'node:os';

const TOKEN_HEADER = 'x-orkestrai-mobile-token';
const UUID = '[0-9a-f-]{36}';

const PUBLIC_PATHS = [
  /^\/m\/?$/,
  /^\/m\/__data\.json$/,
  /^\/_app\//,
  /^\/pwa\//,
  /^\/favicon\.svg$/,
  /^\/brand\//,
  /^\/fonts\//,
];

/** @type {Array<[string, RegExp]>} */
const API_RULES = [
  ['GET', new RegExp('^/api/agent-room/mobile/session$')],
  ['GET', new RegExp('^/api/agent-room/attention$')],
  ['PATCH', new RegExp(`^/api/agent-room/attention/${UUID}$`)],
  ['POST', new RegExp(`^/api/agent-room/attention/${UUID}/decide$`)],
  ['GET', new RegExp(`^/api/agent-room/workspaces/${UUID}/channels$`)],
  ['GET', new RegExp(`^/api/agent-room/workspaces/${UUID}/channels/[^/]+/messages$`)],
  ['POST', new RegExp(`^/api/agent-room/workspaces/${UUID}/channels/[^/]+/messages$`)],
  ['GET', new RegExp(`^/api/agent-room/workspaces/${UUID}/control-center$`)],
];

/** @param {string} token */
export function hashMobileToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

/** @param {string | undefined} address */
function isPrivateAddress(address) {
  const value = String(address ?? '').replace(/^::ffff:/, '');
  if (value === '127.0.0.1' || value === '::1') return true;
  const parts = value.split('.').map(Number);
  if (parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    const [a, b] = parts;
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254);
  }
  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10).
  return /^f[cd][0-9a-f]{2}:/i.test(value) || /^fe[89ab][0-9a-f]:/i.test(value);
}

/**
 * @param {string} method
 * @param {string} pathname
 * @returns {'public' | 'api' | null}
 */
export function mobileRequestAllowed(method, pathname) {
  if ((method === 'GET' || method === 'HEAD') && PUBLIC_PATHS.some((pattern) => pattern.test(pathname))) return 'public';
  if (API_RULES.some(([allowed, pattern]) => allowed === method && pattern.test(pathname))) return 'api';
  return null;
}

export function lanAddresses() {
  const addresses = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal && isPrivateAddress(entry.address)) addresses.push(entry.address);
    }
  }
  return [...new Set(addresses)];
}

/**
 * @param {{ handler: (req: http.IncomingMessage, res: http.ServerResponse) => void, loopbackHost: string, extraHeaders?: Record<string, string> }} options
 */
export function createMobileGateway({ handler, loopbackHost, extraHeaders = {} }) {
  /** @type {http.Server | null} */
  let server = null;
  /** @type {{ port: number | null, tokenHash: string | null }} */
  let state = { port: null, tokenHash: null };

  /** @param {http.ServerResponse} response @param {number} status */
  function deny(response, status) {
    response.statusCode = status;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ error: status === 401 ? 'Pair this phone again from Orkestrai.' : 'Not available from the phone.' }));
  }

  /** @param {http.IncomingMessage} request */
  function authorized(request) {
    const supplied = request.headers[TOKEN_HEADER];
    if (typeof supplied !== 'string' || !supplied || !state.tokenHash) return false;
    const expected = Buffer.from(state.tokenHash, 'hex');
    const actual = Buffer.from(hashMobileToken(supplied), 'hex');
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  /** @param {http.IncomingMessage} request @param {http.ServerResponse} response */
  function handle(request, response) {
    if (!isPrivateAddress(request.socket.remoteAddress)) return deny(response, 403);
    const url = new URL(request.url ?? '/', 'http://phone.invalid');
    const kind = mobileRequestAllowed(request.method ?? 'GET', url.pathname);
    if (!kind) return deny(response, 404);
    if (kind === 'api' && !authorized(request)) return deny(response, 401);
    // The app checks same-origin requests against its loopback origin; the gateway
    // has authenticated the phone, so it speaks to the app as a loopback client.
    delete request.headers[TOKEN_HEADER];
    delete request.headers.cookie;
    request.headers.host = loopbackHost;
    if (request.headers.origin) request.headers.origin = `http://${loopbackHost}`;
    if (request.headers.referer) request.headers.referer = `http://${loopbackHost}/m`;
    for (const [header, value] of Object.entries(extraHeaders)) response.setHeader(header, value);
    response.setHeader('cache-control', kind === 'api' ? 'no-store' : response.getHeader('cache-control') ?? 'no-cache');
    handler(request, response);
  }

  return {
    status() {
      return { running: Boolean(server), port: state.port, addresses: server ? lanAddresses() : [] };
    },
    /** @param {{ port: number, tokenHash: string }} options */
    async start({ port, tokenHash }) {
      state = { port, tokenHash };
      const address = server?.address();
      if (server && typeof address === 'object' && address?.port === port) return this.status();
      await this.stop();
      const next = http.createServer(handle);
      await new Promise((resolve, reject) => {
        next.once('error', reject);
        next.listen(port, '0.0.0.0', () => resolve(undefined));
      });
      server = next;
      return this.status();
    },
    async stop() {
      const current = server;
      server = null;
      if (current) await new Promise((resolve) => current.close(() => resolve(undefined)));
      return this.status();
    },
  };
}
