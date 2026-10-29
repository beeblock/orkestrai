# Delegated subscription access verification

Branch: `feat/subscription-lending`, based on `2631c283`. Implementation only; no push, production relay deployment, installer replacement or release.

## Delivered behavior

- Owner grants and guest connections are separate from workspace collaboration. One approved cryptographic device per grant; expiry, revisions, revocation, profile/model/effort/image scopes and durable request/rate limits.
- Credentials stay in the selected native profile. Pairing/session identities use desktop secure storage; the relay carries encrypted, replay-protected inference frames in an independent namespace.
- Claude/Codex run in private, ephemeral inference workers with host tools/configuration excluded. Native MCP forwards guest operations; it never exposes the owner terminal, workspace or filesystem.
- The guest creates an Orkestrai agent with the received model. Its own managed history, initial role, tools, files and native/WSL runtime remain local. Model/effort selection is pinned; a disconnected selected account is not silently replaced.
- All 246 current native MCP operations, and future registry additions, are discoverable through a compact search/call gateway. Core coding/image tools remain directly available. The gateway avoids inserting approximately 224 KB of schemas into every model turn.
- Codex images are an explicit per-account capability. References, immutable input manifests and generated PNGs remain guest artifacts; hash verification, exact-byte copy and native workflow validation/completion remain in force. Image inference shares the request quota and parent concurrency lease.
- Global inference concurrency is capped at two workers. Buffered bodies are capped at 128 MiB globally and accepted/queued request bodies at 64 MiB, with per-request/peer limits and paced image transfer.

## Verification

1. Complete Vitest suite with two workers and a 20-second test timeout: **2,771 passed, 17 intentionally skipped**, before the final targeted corrections.
2. Final focused service/protocol/repository/HTTP/transcript/worker/filesystem/image/docs/tour checks and the native Codex wire test: **76 passed, 3 native quota-consuming opt-in tests skipped**.
3. Real Claude Code 2.1.312 and Codex 0.165.0 subscription inference: guest tool execution passed with the compact full-registry discovery path. The Codex native wire test confirmed no host shell/patch/search/image-file tool was exposed.
4. One real Codex subscription image edit returned a visually inspected **1254 × 1254 PNG**, 1,017,671 bytes. SHA-256: `3033037007b08e8d42a69c33a8c2ec9f31f054f95868f393eaa46181b1cecb4a`.
5. Repeatable image workflow integration uses a deterministic image fixture and a real encrypted relay: reference upload, the production native image interceptor, chunked return, guest file/hash verification, `copy_file`, native validation/completion and Canvas output creation. Repeating an id does not regenerate; changing its prompt is refused; images are unavailable without the grant.
6. Production Provider Center inspected using agent-browser on an isolated database/home: clear/dark themes, English/Portuguese, a 390-pixel viewport, independent per-account model/effort/image form values, and no JavaScript errors or horizontal overflow. Creation-response fixtures were used for the browser form; actual approval/inference use the separate live desktop smoke.
7. `npm run build`, including both native Computer/desktop-message postbuild bundles, passed during implementation. Low heap caps of 4 and 6 GiB were insufficient; a later minified attempt reached approximately 14 GiB and was stopped during garbage collection. The final complete end-to-end QA build used `vite build --minify=false` plus the same postbuild bundles. Two subsequent CLI-only isolation overrides (clear ambient MCP servers/developer instructions) were validated separately by the native wire test. No release installer was produced. Builds and end-to-end servers ran sequentially.

8. Two independent **production Cores on the same test Mac**, with separate databases/homes/secure-store test identities and a real relay: **passed**. A message sent through the app Conversation reached a real managed PTY, wrote the guest file, preserved context into the second native Codex turn, posted the answer into the Conversation and observed revocation. Exactly two inference requests were charged to the configured counter; guest connection state exposed neither the owner profile id nor its configuration path. This verifies routing and lifecycle, not two separate physical operating-system sandboxes.
9. Final global type-check output reports **1,754 errors and 43 warnings outside the new/changed feature implementation and tests**. The repository is not globally type-clean; this verification does not claim that every unrelated diagnostic is unchanged.

## Findings fixed before delivery

- Codex's Responses Lite path omitted MCP tools; the inference-only catalog disables it. Guest MCP approval is limited to the private proxy.
- Claude bare mode did not use personal subscription authentication. The verified restricted headless contract replaces it; unsupported managed policy files fail explicitly.
- Native provider/guest commands use a worker broker that kills only its own descendants after cancellation/Core loss. Cleanup of private temporary inputs is explicit; guest working trees are never treated as disposable.
- Image idempotency binds the input fingerprint; internal image storage is not exposed as a model-callable MCP operation. Uncertain results are never automatically regenerated.
- Model selection and initial role survive managed-agent restart. Transcript paths use the same canonical working-directory identity as inbox/reply/resume readers, including symlinked native working directories.
- A fresh managed transcript containing only its validated header/role is initially idle. It must not be mistaken for an unfinished Claude turn and block the first Conversation/inbox message. Actual user/assistant work still blocks delivery until complete.
- Duplex image traffic respects the relay's shared bandwidth budget; assembly deadlines scale with paced payload size instead of expiring a permitted large image during normal transfer.
- Context compaction failures close the current transcript turn and release the per-node reservation. Simultaneous turns are rejected before asynchronous identity checks.
- Closing an obsolete relay peer cannot delete a replacement peer/room. Host stop waits for its socket to close before restart. Reconnection preserves approved identity and never replays completed inference.
- Policy edits preserve offering identities, so extending/restricting an existing account does not invalidate every saved model selector.
- Svelar FormRequest merges route parameters into validated input. Invite/approval/revision actions now explicitly validate and remove the route id before passing the shared strict body schema to the service; the real HTTP smoke caught this after service-level tests passed.
- Agent grant mutations and guest shell commands honor the existing autonomy execution policy. Initial device approval remains an explicit owner action; ordinary turns/tools do not add new permission prompts.

## Reproducing native smoke tests

Use Node 24 and explicitly selected existing personal-subscription profile directories. These tests consume a small amount of subscription quota and are excluded from ordinary CI:

```sh
ORKESTRAI_MODEL_ACCESS_LIVE=1 \
ORKESTRAI_MODEL_ACCESS_TEST_CLAUDE_PROFILE=/absolute/claude/profile \
ORKESTRAI_MODEL_ACCESS_TEST_CODEX_PROFILE=/absolute/codex/profile \
node node_modules/vitest/vitest.mjs run tests/unit/model-access-native.test.ts --maxWorkers=1

ORKESTRAI_MODEL_ACCESS_DESKTOP_LIVE=1 \
ORKESTRAI_MODEL_ACCESS_TEST_CODEX_PROFILE=/absolute/codex/profile \
node tests/smoke/model-access-desktops.mjs
```

The desktop smoke starts two production Cores with separate databases and all home/config/runtime discovery paths isolated. It exercises the existing Electron secret-storage IPC contract with memory-only **test pairing identities**, not a production fallback secret store. It never copies provider credentials. A live guest PTY writes a guest-only file, retains context between two native Codex turns and observes revocation. Test auth/config/workspace data are removed at the end; bounded evidence/logs remain outside the repository.

## Shipping limits

- The compatible inference relay must be deployed before publishing desktop access. Both computers must remain online.
- Native provider/image verification ran on macOS. Physical Windows/Linux/WSL provider QA remains distinct from using the existing runtime adapters and path-contract tests.
- Codex image authentication currently requires the selected native profile's file-based login. Unsupported native CLI versions, managed Claude restrictions and unavailable subscriptions report explicit failures; no API billing account is substituted.
- Codex text arrives according to native exec events and may stream per message rather than per token. Other paid integrations retain the guest's existing credentials, billing and gates.
- The repository has pre-existing global type-check errors. New/changed implementation diagnostics are checked separately; this report does not claim a globally clean type check.
- Only regenerable cache/test/build files are eligible for cleanup. Owner workspaces, active agent files, Docker volumes, installed voice models and the installed app remain untouched.
