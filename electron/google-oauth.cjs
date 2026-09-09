const http = require('node:http');
const crypto = require('node:crypto');

const GOOGLE_AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GMAIL_PROFILE = 'https://gmail.googleapis.com/gmail/v1/users/me/profile';
const PERMISSION_SCOPES = {
  'gmail.list_messages': 'https://www.googleapis.com/auth/gmail.readonly',
  'gmail.read_message': 'https://www.googleapis.com/auth/gmail.readonly',
  'gmail.send_email': 'https://www.googleapis.com/auth/gmail.send',
  'gmail.create_draft': 'https://www.googleapis.com/auth/gmail.compose',
  'gmail.modify_labels': 'https://www.googleapis.com/auth/gmail.modify',
};

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function html(message, ok) {
  const color = ok ? '#16a34a' : '#dc2626';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Orkestrai</title></head><body style="margin:0;background:#111318;color:#f7f7f8;font:15px system-ui;display:grid;min-height:100vh;place-items:center"><main style="max-width:420px;padding:32px"><div style="width:12px;height:12px;border-radius:50%;background:${color};margin-bottom:18px"></div><h1 style="font-size:20px;margin:0 0 10px">${ok ? 'Account connected' : 'Connection failed'}</h1><p style="color:#a9abb3;line-height:1.5;margin:0">${message}</p></main></body></html>`;
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });
}

async function jsonResponse(response, provider) {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > 1_048_576) throw new Error(`${provider} returned an oversized response.`);
  const text = await response.text();
  if (Buffer.byteLength(text) > 1_048_576) throw new Error(`${provider} returned an oversized response.`);
  try {
    return JSON.parse(text || '{}');
  } catch {
    throw new Error(`${provider} returned an invalid response.`);
  }
}

async function performGoogleDesktopOauth(options) {
  const {
    clientId,
    permissions,
    storageKey,
    openExternal,
    saveSecret,
    fetchFn = fetch,
    timeoutMs = 180_000,
  } = options;
  if (typeof clientId !== 'string' || clientId.length < 20 || clientId.length > 500 || /[\r\n]/.test(clientId)) {
    throw new Error('Invalid Google OAuth client ID.');
  }
  const scopes = [...new Set((Array.isArray(permissions) ? permissions : []).map((permission) => PERMISSION_SCOPES[permission]).filter(Boolean))];
  if (!scopes.length) throw new Error('Select at least one Gmail permission.');
  const state = base64url(crypto.randomBytes(32));
  const verifier = base64url(crypto.randomBytes(64));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());

  let settle;
  const callback = new Promise((resolve, reject) => { settle = { resolve, reject }; });
  const server = http.createServer((request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (request.method !== 'GET' || url.pathname !== '/oauth/google') {
        response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
        response.end('Not found');
        return;
      }
      const returnedState = url.searchParams.get('state') ?? '';
      if (!safeEqual(returnedState, state)) {
        response.writeHead(400, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        response.end(html('The authorization state was invalid. Return to Orkestrai and try again.', false));
        settle.reject(new Error('Google OAuth state validation failed.'));
        return;
      }
      const error = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      if (error || !code) {
        response.writeHead(400, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        response.end(html('Authorization was cancelled. You can close this tab.', false));
        settle.reject(new Error('Google authorization was cancelled.'));
        return;
      }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end(html('Return to Orkestrai. This tab can be closed.', true));
      settle.resolve(code);
    } catch {
      response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      response.end('Invalid callback');
      settle.reject(new Error('Google OAuth callback was invalid.'));
    }
  });

  const timer = setTimeout(() => settle.reject(new Error('Google authorization timed out.')), timeoutMs);
  try {
    const port = await listen(server);
    const redirectUri = `http://127.0.0.1:${port}/oauth/google`;
    const authorize = new URL(GOOGLE_AUTHORIZE);
    authorize.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: scopes.join(' '),
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      access_type: 'offline',
      prompt: 'consent',
    }).toString();
    await openExternal(authorize.toString());
    const code = await callback;
    const tokenResponse = await fetchFn(GOOGLE_TOKEN, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ client_id: clientId, code, code_verifier: verifier, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
      signal: AbortSignal.timeout(30_000),
    });
    const token = await jsonResponse(tokenResponse, 'Google OAuth');
    if (!tokenResponse.ok || typeof token.access_token !== 'string' || !token.access_token) {
      throw new Error('Google OAuth token exchange failed.');
    }
    const credential = {
      accessToken: token.access_token,
      ...(typeof token.refresh_token === 'string' ? { refreshToken: token.refresh_token } : {}),
      expiresAt: Date.now() + Number(token.expires_in ?? 3_600) * 1_000,
      tokenType: String(token.token_type ?? 'Bearer'),
      scope: String(token.scope ?? scopes.join(' ')),
    };
    await saveSecret(storageKey, JSON.stringify(credential));
    const profileResponse = await fetchFn(GMAIL_PROFILE, {
      redirect: 'manual', headers: { authorization: `Bearer ${credential.accessToken}`, accept: 'application/json' }, signal: AbortSignal.timeout(15_000),
    });
    const profile = await jsonResponse(profileResponse, 'Gmail');
    return {
      stored: true,
      accountEmail: profileResponse.ok && typeof profile.emailAddress === 'string' ? profile.emailAddress.slice(0, 320) : null,
      scopes,
      hasRefreshToken: Boolean(credential.refreshToken),
    };
  } finally {
    clearTimeout(timer);
    await new Promise((resolve) => server.close(() => resolve()));
  }
}

module.exports = { PERMISSION_SCOPES, performGoogleDesktopOauth };
