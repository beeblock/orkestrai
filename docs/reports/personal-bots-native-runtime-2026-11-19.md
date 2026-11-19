# Personal bots: native runtime preview

## Scope and isolation

- Branch: `feat/personal-bot-runtime`, based on `8962c747` (0.54.0).
- Worktree: `/private/tmp/orkestrai-personal-bots-20261119`.
- Local preview version: `0.55.0-beta.1`. No push, tag or public release.
- The owner's original checkout and dirty files are preserved.
- Bots is a separate workspace mode. Existing Conversation/Canvas agents default to their existing terminal transport; no existing agent is migrated automatically.

## Implementation

Personal bots reuse workspace persistence, identity, bridge tools, memory, routines, attachments, profiles and policy checks. Groups have scoped membership, a coordinator, revision guards and exact return channels. Unmentioned requests reach the coordinator; explicit mentions select members. Removing a bot repairs coordinator/membership or archives an empty group.

Opt-in native transports use Codex App Server JSON-RPC or the official Claude Agent SDK against unchanged installed CLIs. No second bundled Claude CLI is shipped. Native messages do not use terminal paste/Enter. Acceptance and completion are separate, outputs and process lifetime are bounded, shutdown waits for process exit and a native viewer reattaches through the server-owned transport instead of starting a TUI. Owner, peer, external binding, delegation and group contexts remain separate. Delegated replies retain their original return address. Native bots consume queued conversations in separate turns rather than injecting another chat into an MCP response header.

Native finals are persisted before forwarding. A durable outbox retains the exact external binding and stable per-part idempotency keys. Telegram/Slack send native photos/documents; Slack uses its official external-upload sequence. Explicit workspace artifact links are confined, hashed and verified before publication. Long replies retain their full text as an owned attachment. Terminal-fallback personal bots use the same outbox for cited external replies. Failed earlier pages do not starve later replies. Uncertain WhatsApp sends are exposed and never blindly replayed.

WhatsApp uses Baileys linked-device QR. The existing desktop secure store encrypts credentials, signal keys and a bounded incoming queue; these never enter project files or SQLite. Socket generations prevent stale key writes. Human messages from the linked phone, including self-chat, are accepted only for bound chats/senders; reserved output identities suppress reply loops. Media requests validate the initial URL and every redirect, limit decoded input to 10 MB and impose a 30-second total download budget. Permanently invalid media does not trap later messages. Independent inbound chats use up to three active deliveries with FIFO inside each chat. A stalled download, failed chat or later incoming message cannot strand unrelated chats behind it. Workspace removal disconnects sockets and removes their protected credentials.

The native provider shell has the account's existing local access. Bridge policy is not a sandbox for that shell. Trusted senders, appropriate workspace scope and explicit configured gates remain necessary. No credentials were copied or collected for provider authentication.

## Verification evidence

- Full unit/feature suite before the final review hardening: 3,355 passed, 30 skipped, zero failures.
- Native and legacy inbox/bridge regression run after delegation corrections: 127 passed.
- Transport/media/bot focused run after native viewer routing: 58 passed.
- Production browser tests: separate Bots UI, direct native reply, group creation/reply, persisted history without duplication, existing Conversation isolation, PDF attachment ownership and separate microphone/Send controls. These use an isolated local JSON-RPC provider fixture, not provider inference.
- Installed real Codex CLI 0.169.0: exact native prompt/receipt/final smoke passed in about 4.9 seconds.
- Installed real Claude Code 2.1.328 through the official SDK: exact prompt/receipt/final smoke passed in about 13.4 seconds; repeated without the optional 338 MB SDK CLI binary in about 13.7 seconds.
- Real-provider smoke reads provider-owned authentication through unchanged CLIs only. General tests, bridge provisioning, browser data and all other provider homes are isolated from the owner.
- Full type checking has existing repository errors. New-file diagnostics and changed-line diagnostics must be checked separately; build and runtime/browser tests are required as well.

### Additional completed checks

- Second full unit/feature run: **3,365 passed, 30 skipped, zero failures**, two workers, 312.95 seconds.
- Production browser regression run: **41 passed**, no retries, 2.5 minutes. Includes Bots, Conversation, bridge, tasks, control center, Canvas, 399-node performance fixture and terminal input focus.
- After the final reply-lookup change, scoped channel/attachment/bot tests: **59 passed**. Native idempotency now uses the fixed UUID v7 reply primary key, never a JSON/history LIKE scan.
- Real provider smoke repeated with a non-secret MCP authentication sentinel: **2 passed** (Codex 5.14 s, Claude 13.66 s). The exact saved transcripts were read after process exit and contained no sentinel value.
- Svelte checking still reports pre-existing errors; diagnostics in newly added files/changed lines were zero before the last visual-only adjustments. This is not a claim that the repository-wide type check is green.
- Worker and scheduler booted against an isolated disposable Redis and migrated SQLite database. `dispatch-due-automations` completed in 262 ms. The worker, scheduler and Redis container were stopped/removed afterwards.
- npm production audit: seven advisories, all in unchanged pre-existing dependency entries. The two added libraries were not flagged. The existing 0.54.0 reviewed-audit authorization was not extended to this preview.
- Manual Chrome inspection covered dark/light themes and bot configuration. It caught a shrinking instruction panel, duplicate close/connect controls and a sleeping bot labelled disconnected; the final UI corrects these within Bots only.

Final focused run after linked-chat scheduling and UI refinements: **76 passed**. The slow-chat regression proves another chat and a new arrival advance before the slow download finishes, while the same chat retains its original order.

- Final rebuilt application: build passed, including Computer host and desktop message bundles.
- Repeated production UI verification after the final changes: **8 passed**, no retries, 25.3 seconds (Bots, existing Conversation and terminal input focus).
- Electron 42.11.18 / ABI 146 dependency smoke: official Agent SDK import and WhatsApp authentication-key initialization passed without network pairing or credential access.

### Installed preview

- Built and installed **0.55.0-beta.1**, arm64, with an ad-hoc signature. No certificate, Keychain signing identity, push, tag or public release was used.
- The packaged app passed deep/strict signature verification and microphone/automation entitlement checks for the app and all four helpers. A standalone copy outside the repository loaded the Agent SDK, initialized WhatsApp authentication keys, queried SQLite and spawned/killed a real PTY under Electron ABI 146; the development checkout was not a dependency.
- The verified installer waited for the complete copy, signature and entitlement checks before replacing the app. The installed Core reports the expected executable/version; Settings, Bots, Conversation and Canvas return HTTP 200. The workspace Bots API returns the registered Claude/Codex native providers.
- The previous installed **0.53.1** bundle is retained in the single verified rollback ZIP under `~/Library/Caches/Orkestrai/local-install/`. No backup application remains under Applications.
- Fresh paired application/code-graph backups dated `2026-11-19T21-59-49-379Z` both passed SQLite `quick_check`. Only after that verification was the redundant older compressed data backup removed.
- Removed this worktree's generated package, build, dependencies and isolated test homes/databases after verification. Source, lockfile, test logs and screenshots remain. Final measured free space: **6.55 GiB** (about 7.0 GB); live workspace data and Docker volumes were preserved.
- The owner's original checkout remains on `feat/subscription-lending` at `8ef46f7c`, with its existing dirty files unchanged. Continuing development in this worktree requires reinstalling dependencies from the lockfile.

## Local validation limits

- WhatsApp pairing and actual Telegram/Slack/WhatsApp delivery with the owner's accounts still require the owner's interactive test. Automated tests cover parsing, confinement, sender checks, credentials, outbox behavior and native file payload construction; they do not prove external account authorization.
- Windows native and WSL launch paths reuse the existing runtime helpers, but have not been exercised on Windows hardware for this feature.
- No 24-hour or long-duration soak has been completed.
- Closing the app interrupts active native turns. Persisted final results recover, but an interrupted model turn is not automatically replayed: repeating side-effecting work without evidence is unsafe. This preview does not claim uninterrupted in-flight work across an app restart.
- Native bots do not steer a busy provider turn; each queued conversation begins after the current native turn completes. Existing terminal mid-turn behavior is preserved.
- Used native bots cannot silently change account/provider in this editor. Create a separate bot for a different identity; existing app profile-switch behavior is not expanded to every native conversation by this preview.
- Openbot commit `05b86fd1ddb271485850e6438e2cc935d116ef08` was an architectural reference only. Its PolyForm Noncommercial code was not copied. Third-party notices identify the actual SDK and Baileys licenses.

## Owner test

1. Open **Bots**, choose a workspace and create a Codex or Claude personal bot with the intended account/model/effort. Confirm a direct response.
2. Create a group with two bots. Address a member with `@Name`; ask the coordinator to consult the other bot and verify replies stay in the group.
3. In the bot profile, connect an explicitly authorized Telegram/Slack chat or pair WhatsApp by QR. For WhatsApp, bind a contact/group or your own number for self-chat and select sender IDs.
4. From the phone, send a short request and then a PDF/image. Ask for a report or an image through the existing creative workflow and confirm that the file arrives as a native document/image.
5. Reopen the existing **Conversation** and **Canvas** and verify normal development agents remain separate and responsive.
