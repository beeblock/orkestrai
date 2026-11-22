# WhatsApp QR linking: Zapo local preview

## Scope and evidence

The owner reported that the phone rejected a linked-device QR with “check your connection and try again.” The existing preview used the unmodified Baileys 7.0.0-rc14 package with a silent logger. The available app log did not contain evidence that identifies the phone's rejection cause. An upstream Baileys pairing-refresh proposal was reviewed, but it was not merged at review time and is not proof of this incident's cause.

The owner supplied https://github.com/vinikjkkj/zapo and already uses Zapo in another project. The local Beehub wrapper was inspected read-only for client configuration and official fake-server test patterns. It was not modified. This preview uses the exact published `zapo-js@1.12.0`, `@zapo-js/store-sqlite@1.3.0` APIs, rather than assuming the repository's development API matches npm.

## Implementation

- Fresh and unpaired connections use Zapo. Registered legacy preview sessions retain Baileys and their credentials; there is no forced logout or incompatible key conversion.
- The official SQLite providers run in a bounded in-memory database. A compressed image is written through existing Electron desktop secret encryption. There are no plaintext Signal SQLite/WAL/SHM files, no additional native SQLite module, and no server dependency. Reads are cached; key writes wait for durable encrypted storage. A persistence failure prevents further use of unsaved state.
- Historical conversations and attachments are not downloaded. Contact-name app-state events and current groups populate the existing bounded picker.
- The adapter normalizes text/image/document events and exact outbound acknowledgement IDs into the existing routing and durable external outbox. Sender, prefix, workspace and public-bot safety restrictions remain in effect. Uncertain sends are not blindly retried.
- Retry and New QR operate on the existing connection ID and preserve bot bindings. Connection creation/retry/removal/status acquisition are serialized per account; a replacement cannot start while the previous Signal writer drains. Explicitly revoked sessions get fresh authentication on retry.
- Unsupported additional passkey verification has a specific translated error and stops the connection. It is not represented as a successful QR link.
- Diagnostic lines contain only connection ID, selected engine, allowlisted lifecycle event and optional numeric code. They exclude QR contents, credentials, JIDs, names and message bodies. Repeated library-error diagnostics are throttled.
- Native UI, shared command validation, CLI, MCP, generated agent skill instructions, README, all three app documentation/changelog catalogs and the existing WhatsApp onboarding tour are updated together.

## Validation

All testing isolates HOME, provider configuration, runtime discovery and application storage. No paid model was called and no message was sent to a real WhatsApp contact.

- Focused unit/feature regression run: 133 passing tests in 14 files. The subsequently added failed-credential connection scenario passed in the transport's 3-test rerun, bringing the distinct scenarios to 134.
- Zapo tests use its official local fake protocol server, real Noise/Signal encryption, real provider SQLite state and encrypted-vault fixtures: QR pairing, forced post-pair login, inbound text, exact-ID outbound text/image/PDF acknowledgement, restart without QR, and credential removal. The normal protocol scenario completed in about 0.3 seconds on this machine.
- Storage tests cover binary restoration, concurrent writes, waiting for persistence, unavailable encryption, preservation of corrupt state, failed writes and draining close.
- Service tests cover foreign workspace rejection, serialization against a status poll and deletion, preserving the connection identity, and safe diagnostic output.
- Direct TypeScript check of the new integration modules passed with strict null checks. The changed Svelte component compiled. A whole-app svelte-check attempt exceeded its default heap; no claim of a whole-app type-check pass is made.
- Production build passed. Browser regression tests passed: 6/6, one worker, no retries, including in-place Retry/New QR, shared-group routing, bot creation and public-turn safety.

## Remaining validation

A local fake server proves the client's protocol and persistence integration, not acceptance by WhatsApp's live service. The owner must scan a new QR with the affected physical phone after the preview is installed. The reported real-device rejection remains unconfirmed as resolved until that succeeds. The additional passkey challenge is reported explicitly; this preview does not implement a WebAuthn signer.

No public release, push or other-project change is part of this local preview.
