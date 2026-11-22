# Native phone commands and bot media — local preview beta.8

## Reported failure

The owner's `#jarvis` image request was stored and delivered to the Codex bot,
but its turn failed with `BOT_PUBLIC_OUTPUT_BLOCKED`. The public worker had no
native Canvas/image/delegation tools. The UI collapsed that protection failure
into an account/connection error. The retained error code does not prove which
individual review criterion failed; rejected drafts are not persisted.

A separate earlier delay was caused by the selected Claude account being at 97%
of its weekly allowance while the bot's automatic cap was 95%. Messages were
preserved, but the bot looked asleep instead of explaining the quota block.

## Changes

- Authenticate human commands sent by the linked WhatsApp account using server
  HMAC proofs bound to workspace, connection, binding, bot, sender, chat and exact
  external message. The key stays in protected desktop storage. Customer text,
  display names and workspace-token-only requests cannot mint a proof.
- Permit explicitly selected verified contacts to act as owner through a simple
  contact checklist. The native CLI/MCP use the same versioned safety settings
  and expose `owner_senders`; no model-facing proof-issuing operation exists.
- Use the existing native owner driver for authenticated requests, preserving
  workspace tools, account scope and the binding's separate conversation. Check
  current route, connection, owner controls and workspace policy again before
  publishing. Revocation cannot silently downgrade an owner command into a
  public worker.
- Allow a live authenticated personal bot to recruit a specialist or create a
  Portal without changing leadership. Other role-protected operations retain
  their checks. Image generation still uses the native Codex workflow.
- Bind owner output approval to the exact message, turn, body and file hashes;
  the existing outbox delivers only to its originating authorized binding.
- Allow native public web search when enabled, while retaining isolated public
  context, no shell/private bridge, scoped attachments and a tool-free reviewer.
  Codex `supports_search_tool` describes dynamic MCP discovery, not web search;
  web availability is controlled by `web_search` instead.
- Decode WhatsApp voice notes in a bounded, disposable process (10 MB / five
  minutes), then transcribe with the existing speech service. Check sender and
  download origin before decoding. Match a leading spoken bot name against the
  configured literal prefix and never fan out ambiguous spoken names.
- Serialize speech inference across chats so first-use model initialization cannot
  stampede; keep unrelated text/chat delivery independent. Serialize owner proof
  initialization across its first secret read to preserve concurrent messages.
- Show the exact selected account quota/cap and distinguish protection failures
  from connection failures in the conversation. Cached quota projection adds no
  provider request per UI poll.

## Verification

- 259 focused unit/feature/installed-CLI tests passed, covering actual PNG decoding, actual PDF
  extraction, OGG/Opus and MP3 decode, voice routing, identity/scope revocation,
  native recruitment, persistence and runtime quota behavior.
- Eight installed-Claude/Codex contract cases passed against local fake inference,
  with web on/off and attempted shell access. No paid provider inference or real
  external chat was used for these tests.
- The 48-test bridge suite passed separately, including the personal-bot
  recruitment contract. Output approval covers exact source and artifact hashes.
- Production build, browser and packaged-native results are recorded in the local
  QA completion manifest after packaging; this report does not stand in for them.
- Full svelte-check is not a clean repository gate: it reports existing errors
  across legacy scripts, generated files and older tests. Newly introduced
  diagnostics were reviewed and corrected; build/browser verification is separate.

## Remaining physical validation

The owner must send a fresh WhatsApp request after installation to validate the
actual selected model, native image generation and delivery on their account.
Previously delivered failed turns are not blindly replayed. Other phone numbers
require explicit selection in the contact checklist; they are not assumed to be
owner identities. Ordinary contacts keep the public boundary.

Audio supports OGG/Opus, MP3 and WAV. AAC/M4A is not supported in this preview.
Missing local speech models raise an explicit notice and require the existing
Voice settings setup. No extra models are downloaded automatically. Native image
creation and recurring tasks still honor existing workspace rules, integration
configuration, pauses and gates. Local mock tests do not prove real model choices
or every physical phone/media format.

## Beta.9 follow-up: credential unlock blocked startup

The beta.8 installation passed health checks but the owner then saw a startup
error. A read-only sample of the Electron main process showed it waiting in
`SecItemCopyMatching` / `SecKeychainItemCopyContent`. The synchronous safeStorage
call blocked main's health-check callbacks; once released, the elapsed startup
deadline produced a false failure and the Core recovered. The WhatsApp account
subsequently reconnected, retaining its binding and credentials.

Move macOS/Windows availability, encryption and decryption to Electron's async
safeStorage API. Await the existing private IPC response and native UI status;
keep encrypted values outside renderer output and logs. Re-read the vault after
awaiting encryption, cancel an older write on deletion/replacement, and reject a
credential changed while decryption awaited unlock. Linux retains its existing
backend and `basic_text`/unknown denial contract. No Keychain rules, signing
identity, passwords or plaintext fallback are changed.

Primary contract: https://www.electronjs.org/docs/latest/api/safe-storage and the
pinned Electron 42 safe-storage spec (sync/async ciphertext interoperability):
https://github.com/electron/electron/blob/v42.0.0/spec/api-safe-storage-spec.ts

The native vault/startup tests include delayed unlock with a responsive health
check, concurrent account writes, cancelled encryption after delete, and revoked
WhatsApp reads. They use fake OS crypto, not the owner's Keychain.

### Specialist completion follows the authenticated phone request

Delivery reconstructs the exact external origin from the persisted source when
resuming a specialist's reply, including existing queued envelopes. A return
address alone does not prove owner identity; the bot driver revalidates the
original sender and current grants. Replies belonging to another bot are never
adopted. Store/check each result's own body/artifact approval, so an initial
answer and a later completion can both wait in the outbox without invalidating
each other. The original connection/revocation checks still apply.
