# Delegated model access

Status: implementation in `feat/subscription-lending`; not released.

## Accepted product contract

An owner lends selected Claude/Codex account profiles to explicitly approved people for a bounded time. The guest uses their own Orkestrai, workspace, files, tools and integrations. The owner machine supplies model inference and streamed results. This is independent of workspace collaboration: no owner Canvas snapshot, terminal, filesystem tool, bridge token or provider credential is exposed to the guest.

The owner selects account profiles, all or selected models, all or selected reasoning efforts, expiry and concurrency. Approval is once per guest identity; ordinary turns and guest-side tools do not ask the owner again. Revocation/expiry cancels active inference and prevents queued/new requests. Owner restrictions remain authoritative.

## Implementation sequence

1. Add independent grant/connection persistence through Svelar models, repositories, migrations, validated requests and DTOs. Authentication material belongs only in the desktop secure store. Persist policy, public identity and bounded audit metadata, never provider credentials, invitation secrets, prompts or replies.
2. Add an inference-only encrypted relay namespace. Pin the owner identity in the invite, prove the guest device identity, require owner approval of its fingerprint, derive per-session directional keys and reject replay/cross-session/cross-protocol frames. Each grant approves one device; additional people receive separate grants.
3. Run providers in isolated, ephemeral inference workers with built-in owner tools, settings, hooks, skills, plugins and ambient MCP disabled. An explicit MCP proxy forwards only the guest tool manifest/calls. Fail closed on unsupported CLI versions/capabilities. A prompt is never a filesystem/command permission.
4. Integrate a managed guest agent with resumable guest-side history, streamed replies, native tools and local/WSL execution. Reuse the native CLI/MCP tool registry, so new Orkestrai operations become available automatically. Route image inference through a separately validated Codex image capability; paid video and other guest integrations retain their existing account/permission requirements.
5. Add Provider Center controls for creating, inspecting, approving and revoking grants and joining/using connections. Expose applicable operations to agents through native bridge, CLI and MCP; owner approval cannot be silently replaced by an agent operation. Add translated docs, changelog, a use case and a guided tour.
6. Verify two isolated app instances through a real relay, providers and guest tool execution. Use fixture provider processes for adversarial and recovery tests, then a bounded real-provider smoke test where possible. Keep the existing installed app/data and remove generated test/packaging intermediates.

## Boundaries and lifecycle

- An invitation authorizes a pairing request, not model use. Approval binds a cryptographic guest identity rather than trusting a display name.
- Owner and guest channels use a separate protocol and room namespace from workspace sharing. No inference message can become a workspace/terminal command.
- Model and effort constraints are checked by the owner on every request. A guest cannot select a hidden profile, command, environment or host session.
- Tools run on the guest. Host proxy schemas/results carry no guest bridge credentials. The 246-operation registry is discovered on demand through a compact search/call gateway, rather than consuming roughly 224 KB of tool definitions in every model turn; search and execution use the same native MCP dispatcher, so new operations appear automatically. Tool names are bound to the request manifest; native host tool execution is an error.
- The guest must understand that selected prompts and tool results transit the owner's computer and the model provider. They are not retained in owner audit logs.
- Payloads, frame sizes, schema depth, buffered output, outstanding calls, request rate, concurrency and worker lifetime are bounded. A slow/offline peer cannot accumulate an unlimited stream or create an automatic inference retry.
- A request has a stable id. Unknown completion is reported as unconfirmed, not replayed. Disconnect, revocation and expiry release resources only after the worker stops.
- Persisted guest conversation state remains on the guest machine. Host temporary inputs/results are private, scoped to one request and removed on completion/cancellation.
- A paired desktop identity is not a verified email/account claim. The current desktop has device pairing, not a global user directory; the approval UI must say what identity is being verified.

## Required evidence before shipping

- Grant proposal, approval, expiry, revocation, model/effort rejection and races.
- Invitation-holder without the approved private key cannot reconnect or run inference.
- Captured frames cannot be replayed or used in a workspace collaboration room.
- Malicious model/guest requests cannot invoke host shell/files/MCP or reveal owner profile secrets.
- Distinct guest conversations, accounts and tools cannot cross-route replies.
- All native tool definitions remain available through the same guest registry.
- Images and workflow outputs are returned to the guest with hashes/bounds; no host path is accepted as a reference.
- Native/WSL execution, all UI languages, cancellation, reconnection and managed history resume.
- Focused tests, complete suite and stable production build/e2e, sequentially with limited workers and disk cleanup.

## Primary contracts inspected

- Codex non-interactive mode: https://learn.chatgpt.com/docs/non-interactive-mode
- Codex app-server and client-executed tools: https://learn.chatgpt.com/docs/app-server
- Codex permissions and environment-backed file reads: https://learn.chatgpt.com/docs/permissions
- Codex image generation: https://learn.chatgpt.com/docs/image-generation
- Claude programmatic CLI: https://code.claude.com/docs/en/headless
- Claude CLI flags: https://code.claude.com/docs/en/cli-reference

The existing restricted Codex companion is pinned to 0.154.x; the installed CLI is 0.165.0. Its isolation cannot be assumed to work unchanged. `codex app-server` does not accept `--ignore-user-config` on this version, while `codex exec` does. The implementation must prove its actual launch contract rather than expose an unrestricted app-server as a shortcut.

## Verified native contracts (2026-10-28)

- Claude Code 2.1.312: a restricted, nonpersistent headless turn with built-in tools disabled, empty setting sources, disabled hooks/plugins/memory and only the guest MCP. `--bare` was tested and rejected: this version requires API authentication in bare mode and does not use the personal subscription. Managed policies that cannot be excluded cause an explicit refusal. Guest content is excluded from native debug logs.
- Codex 0.165.0: ephemeral `exec`, ignored user configuration/rules, a private model catalog with host shell/patch/search/repl/subagents disabled, private state/log directories and only the guest MCP. `use_responses_lite` must be false; otherwise this native client omits MCP tools. Approval applies only to the private guest proxy; guest-side policy/identity checks still run.
- Image inference: one direct, non-retried request to the official Codex subscription image endpoint (`/backend-api/codex/images/generations` or `/edits`), using only the selected native account. No API key or API billing fallback. Authentication refresh remains native to the selected provider profile. File-based Codex authentication is required for images; unavailable/unsupported authentication fails explicitly.
- Native CLI compatibility is deliberately bounded (Codex 0.165.x; Claude 2.1.312–399). A new CLI contract must pass the wire/isolation tests before expanding these bounds. Existing grants also fail closed if the CLI is replaced with an unverified version.

## Image workflow evidence

One actual subscription edit used a guest PNG reference and returned a visually inspected 1254 × 1254 PNG (1,017,671 bytes; SHA-256 `3033037007b08e8d42a69c33a8c2ec9f31f054f95868f393eaa46181b1cecb4a`). The immutable smoke manifest records the endpoint, exact prompt, reference hash, parameters and one-generation reservation. Provider completion and file validity do not replace visual acceptance for production artwork.

The repeatable integration test uses a deterministic image fixture to avoid consuming subscription quota in CI. It exercises the same native image interceptor through a real encrypted relay: guest reference → owner inference → chunked PNG return → guest hash verification and exclusive file creation → `copy_file` → native `image_workflow_validate` → `image_workflow_complete` → Canvas image. A repeated id pays once, a changed prompt with the same id is rejected, and an access without images exposes no image generation tool. The main turn and generation share the durable request quota and one concurrency lease.

References and outputs use the authenticated guest repositories/Floor. Absolute image workflow paths and `copy_file` avoid confusing Windows/WSL paths or writing into a different checkout. Manifests with exact prompts, reference hashes and authorization remain only on the guest. The owner persists operation metadata and request identities, never the image, prompt, output path or tool result.

## Operational limits

- Both computers and the relay must be online. This is a managed Orkestrai agent, not a remotely exposed provider terminal. Owner terminals/workspaces and credentials are not shared.
- Guest history and initial role survive a restart. Large histories are compacted through the same approved model and count toward its quota. Fresh managed conversations accept their first inbox message. Failed/interrupted turns close in the transcript so the inbox does not remain blocked. An uncertain inference or image request is not automatically replayed.
- Existing guest integrations, explicit restrictions, pauses, OS grants and their own billing still apply. Lending Claude/Codex inference does not lend unrelated video-service credentials.
- Network/tool payloads and image sizes are bounded; large images are paced against the relay's combined upload/download budget and assembly deadlines scale with payload size. Codex output streams according to its native exec events, which may arrive per message rather than per token. Claude supports partial text deltas.
- Personal subscription usage meters remain the provider's own limits. The app enforces configured request/rate/concurrency limits, not a fabricated token balance.
- Node path confinement checks registered canonical roots and rejects escaping symlinks. As with the existing filesystem service, Node cannot make all parent-directory checks and writes one atomic filesystem operation against a hostile concurrent local directory replacement.
- Native provider smoke tests ran on macOS. Windows/WSL/Linux paths use the existing runtime adapters; physical native-provider QA on those systems is still required before claiming identical platform coverage.
- Deploy the relay's new inference namespace before publishing a desktop release. No production relay, installed app, owner workspace or website was changed during implementation.
