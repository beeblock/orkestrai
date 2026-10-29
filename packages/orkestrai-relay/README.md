# Orkestrai Collaboration Relay

The collaboration relay forwards opaque, end-to-end encrypted WebSocket
envelopes between a workspace host and approved guests. It cannot decrypt or
persist workspace content and does not expose the local PTY WebSocket.

## Endpoints

- `GET /health` and `GET /ready`: process health and protocol version.
- `GET /metrics`: aggregate connection and forwarding counters only.
- `WS /v1/connect`: versioned collaboration transport.
- `WS /v1/inference`: inference-only `orkestrai-inference.v1` transport, in separate rooms even when identifiers match. It never accepts workspace/terminal frames. Deploy this relay version before enabling delegated access in a desktop release.

## Production deployment

Run the relay as a separate container from the website. Bind it to the
droplet's private network address so only the reverse proxy network can reach
the origin port:

```bash
cd packages/orkestrai-relay
RELAY_BIND_IP=10.0.0.10 docker compose -f docker-compose.prod.yml up -d --build
```

Configure the public reverse proxy with WebSocket support:

```text
relay.orkestrai.app -> http://DROPLET_PRIVATE_IP:8787
```

Terminate TLS at the reverse proxy and verify
`https://relay.orkestrai.app/health` before enabling the default relay in an
app release. The installed app's dynamic loopback origins are accepted;
non-local browser origins are rejected unless explicitly listed in
`ORKESTRAI_RELAY_ALLOWED_ORIGINS`.

The service is stateless. It requires no database, volume, provider token, or
workspace credential.
