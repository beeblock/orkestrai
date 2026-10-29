import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import {
  COLLABORATION_PROTOCOL,
  MAX_ENCRYPTED_FRAME_BYTES,
  collaborationEnvelopeSchema,
} from '@orkestrai/collaboration-protocol';

import { INFERENCE_PROTOCOL, inferenceEnvelopeSchema } from '@orkestrai/collaboration-protocol/inference';

const ROOM_IDLE_MS = 15 * 60_000;
const ATTEMPT_WINDOW_MS = 60_000;
const MAX_ATTEMPTS_PER_IP = 30;
const MAX_ROOM_BYTES_PER_SECOND = 1024 * 1024;
const OPAQUE_ID = /^[a-zA-Z0-9_-]{8,128}$/;

/**
 * @typedef {{ allowedOrigins?: string, maxPeers?: number }} RelayOptions
 * @typedef {{ shareId: string, peerId: string, role: 'host' | 'guest', protocol: string, roomKey: string }} RelayRegistration
 * @typedef {{ id: string, role: 'host' | 'guest', websocket: WebSocket, alive: boolean }} RelayPeer
 * @typedef {{
 *   host: RelayPeer | null,
 *   guests: Map<string, RelayPeer>,
 *   maxPeers: number,
 *   lastActivityAt: number,
 *   byteWindowStartedAt: number,
 *   bytesInWindow: number,
 * }} RelayRoom
 */

/** @param {unknown} raw */
function parseAllowedOrigins(raw) {
  return new Set(String(raw ?? '').split(',').map((value) => value.trim()).filter(Boolean));
}

/** @param {string | undefined} origin @param {Set<string>} allowedOrigins */
function isOriginAllowed(origin, allowedOrigins) {
  if (!origin) return true;
  if (allowedOrigins.has('*') || allowedOrigins.has(origin)) return true;

  try {
    const url = new URL(origin);
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]');
  } catch {
    return false;
  }
}

/** @param {RelayOptions} [options] */
export function createRelayServer(options = {}) {
  /** @type {Map<string, RelayRoom>} */
  const rooms = new Map();
  /** @type {Map<string, { startedAt: number, count: number }>} */
  const attempts = new Map();
  const allowedOrigins = parseAllowedOrigins(options.allowedOrigins ?? process.env.ORKESTRAI_RELAY_ALLOWED_ORIGINS);
  const metrics = {
    connectionsAccepted: 0,
    connectionsRejected: 0,
    framesForwarded: 0,
    bytesForwarded: 0,
    rateLimited: 0,
    protocolErrors: 0,
  };

  const server = http.createServer((request, response) => {
    let pathname;
    try { pathname = new URL(request.url ?? '/', 'http://relay.local').pathname; }
    catch { response.writeHead(400); response.end(); return; }
    if (pathname === '/health' || pathname === '/ready') {
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ ok: true, protocol: COLLABORATION_PROTOCOL, protocols: [COLLABORATION_PROTOCOL, INFERENCE_PROTOCOL] }));
      return;
    }
    if (pathname === '/metrics') {
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ ...metrics, activeRooms: rooms.size, activeConnections: activeConnectionCount(rooms) }));
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'Not found.' }));
  });

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_ENCRYPTED_FRAME_BYTES,
    perMessageDeflate: false,
    handleProtocols(protocols) {
      return protocols.has(INFERENCE_PROTOCOL) ? INFERENCE_PROTOCOL : protocols.has(COLLABORATION_PROTOCOL) ? COLLABORATION_PROTOCOL : false;
    },
  });

  /**
   * @param {import('node:stream').Duplex} socket
   * @param {string} status
   * @param {string} message
   */
  function rejectUpgrade(socket, status, message) {
    metrics.connectionsRejected += 1;
    socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`);
  }

  server.on('upgrade', (request, socket, head) => {
    let url;
    try { url = new URL(request.url ?? '/', 'http://relay.local'); }
    catch { return rejectUpgrade(socket, '400 Bad Request', 'Invalid URL.'); }
    if (!['/v1/connect', '/v1/inference'].includes(url.pathname)) return rejectUpgrade(socket, '404 Not Found', 'Not found.');
    const protocol = url.pathname === '/v1/inference' ? INFERENCE_PROTOCOL : COLLABORATION_PROTOCOL;
    const origin = request.headers.origin;
    if (!isOriginAllowed(origin, allowedOrigins)) return rejectUpgrade(socket, '403 Forbidden', 'Origin is not allowed.');
    const ip = request.socket.remoteAddress ?? 'unknown';
    if (!consumeAttempt(attempts, ip)) {
      metrics.rateLimited += 1;
      return rejectUpgrade(socket, '429 Too Many Requests', 'Rate limit exceeded.');
    }
    const shareId = url.searchParams.get('share') ?? '';
    const peerId = url.searchParams.get('peer') ?? '';
    const role = url.searchParams.get('role');
    if (!OPAQUE_ID.test(shareId) || !OPAQUE_ID.test(peerId) || (role !== 'host' && role !== 'guest')) {
      return rejectUpgrade(socket, '400 Bad Request', 'Invalid relay registration.');
    }
    const offered = String(request.headers['sec-websocket-protocol'] ?? '').split(',').map((value) => value.trim());
    if (offered.length !== 1 || offered[0] !== protocol) return rejectUpgrade(socket, '426 Upgrade Required', 'Unsupported protocol.');
    const roomKey = protocol === INFERENCE_PROTOCOL ? `inference:${shareId}` : shareId;
    const room = rooms.get(roomKey);
    if (role === 'guest' && room?.guests.has(peerId)) return rejectUpgrade(socket, '409 Conflict', 'Peer already connected.');
    if (role === 'host' && room?.host) return rejectUpgrade(socket, '409 Conflict', 'A host is already connected.');
    if (role === 'guest' && (!room?.host || room.guests.size >= room.maxPeers)) {
      return rejectUpgrade(socket, room?.host ? '409 Conflict' : '404 Not Found', room?.host ? 'Room is full.' : 'Host is offline.');
    }
    wss.handleUpgrade(request, socket, head, (websocket) => {
      wss.emit('connection', websocket, request, { shareId, peerId, role, protocol, roomKey });
    });
  });

  wss.on('connection', (
    /** @type {WebSocket} */ websocket,
    /** @type {import('node:http').IncomingMessage} */ _request,
    /** @type {RelayRegistration} */ registration,
  ) => {
    const { shareId, peerId, role, protocol, roomKey } = registration;
    const room = rooms.get(roomKey) ?? {
      host: null,
      guests: new Map(),
      maxPeers: Math.min(5, Math.max(1, Number(options.maxPeers ?? 5))),
      lastActivityAt: Date.now(),
      byteWindowStartedAt: Date.now(),
      bytesInWindow: 0,
    };
    rooms.set(roomKey, room);
    /** @type {RelayPeer} */
    const peer = { id: peerId, role, websocket, alive: true };
    if (role === 'host') room.host = peer;
    else room.guests.set(peerId, peer);
    metrics.connectionsAccepted += 1;
    room.lastActivityAt = Date.now();

    websocket.on('pong', () => { peer.alive = true; });
    websocket.on('message', (data, isBinary) => {
      const payload = rawDataToBuffer(data);
      const bytes = payload.byteLength;
      if (!consumeRoomBytes(room, bytes)) {
        metrics.rateLimited += 1;
        websocket.close(1008, 'Room bandwidth limit exceeded.');
        return;
      }
      let envelope;
      try {
        envelope = (protocol === INFERENCE_PROTOCOL ? inferenceEnvelopeSchema : collaborationEnvelopeSchema).parse(JSON.parse(payload.toString('utf8')));
      } catch {
        metrics.protocolErrors += 1;
        websocket.close(1008, 'Invalid collaboration envelope.');
        return;
      }
      if (envelope.shareId !== shareId || envelope.senderDeviceId !== peerId) {
        metrics.protocolErrors += 1;
        websocket.close(1008, 'Envelope registration mismatch.');
        return;
      }
      room.lastActivityAt = Date.now();
      const targets = role === 'host'
        ? envelope.recipientPeerId
          ? [room.guests.get(envelope.recipientPeerId)]
          : [...room.guests.values()]
        : [room.host];
      for (const target of targets) {
        if (!target || target.websocket.readyState !== WebSocket.OPEN) continue;
        if (target.websocket.bufferedAmount > 1024 * 1024) {
          target.websocket.close(1008, 'Slow recipient.');
          continue;
        }
        target.websocket.send(data, { binary: isBinary, compress: false });
        metrics.framesForwarded += 1;
        metrics.bytesForwarded += bytes;
      }
    });
    websocket.on('close', () => {
      if (role === 'host' && room.host === peer) {
        room.host = null;
        for (const guest of room.guests.values()) guest.websocket.close(1012, 'Host disconnected.');
        room.guests.clear();
      } else if (room.guests.get(peerId) === peer) {
        room.guests.delete(peerId);
      }
      if (!room.host && room.guests.size === 0 && rooms.get(roomKey) === room) rooms.delete(roomKey);
    });
  });

  const maintenance = setInterval(() => {
    const now = Date.now();
    for (const [shareId, room] of rooms) {
      if (now - room.lastActivityAt > ROOM_IDLE_MS) {
        room.host?.websocket.close(1001, 'Room expired.');
        for (const guest of room.guests.values()) guest.websocket.close(1001, 'Room expired.');
        rooms.delete(shareId);
        continue;
      }
      for (const peer of [room.host, ...room.guests.values()]) {
        if (!peer) continue;
        if (!peer.alive) peer.websocket.terminate();
        else {
          peer.alive = false;
          peer.websocket.ping();
        }
      }
    }
    for (const [ip, entry] of attempts) if (now - entry.startedAt > ATTEMPT_WINDOW_MS) attempts.delete(ip);
  }, 30_000);
  maintenance.unref();

  return {
    server,
    rooms,
    metrics,
    async listen(port = 8787, host = '127.0.0.1') {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => { server.off('error', reject); resolve(undefined); });
      });
      return server.address();
    },
    async close() {
      clearInterval(maintenance);
      for (const room of rooms.values()) {
        room.host?.websocket.close(1012, 'Relay shutting down.');
        for (const guest of room.guests.values()) guest.websocket.close(1012, 'Relay shutting down.');
      }
      await new Promise((resolve) => server.close(resolve));
      wss.close();
    },
  };
}

/** @param {import('ws').RawData} data */
function rawDataToBuffer(data) {
  if (Array.isArray(data)) return Buffer.concat(data);
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
}

/** @param {Map<string, RelayRoom>} rooms */
function activeConnectionCount(rooms) {
  let count = 0;
  for (const room of rooms.values()) count += (room.host ? 1 : 0) + room.guests.size;
  return count;
}

/** @param {Map<string, { startedAt: number, count: number }>} attempts @param {string} ip */
function consumeAttempt(attempts, ip) {
  const now = Date.now();
  const existing = attempts.get(ip);
  if (!existing || now - existing.startedAt > ATTEMPT_WINDOW_MS) {
    attempts.set(ip, { startedAt: now, count: 1 });
    return true;
  }
  existing.count += 1;
  return existing.count <= MAX_ATTEMPTS_PER_IP;
}

/** @param {RelayRoom} room @param {number} bytes */
function consumeRoomBytes(room, bytes) {
  const now = Date.now();
  if (now - room.byteWindowStartedAt >= 1_000) {
    room.byteWindowStartedAt = now;
    room.bytesInWindow = 0;
  }
  room.bytesInWindow += bytes;
  return room.bytesInWindow <= MAX_ROOM_BYTES_PER_SECOND;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const relay = createRelayServer();
  const port = Number(process.env.PORT ?? 8787);
  const host = process.env.HOST ?? '0.0.0.0';
  await relay.listen(port, host);
  console.log(`Orkestrai relay listening on ${host}:${port}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => relay.close().finally(() => process.exit(0)));
}
