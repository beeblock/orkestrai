# External replies and Codex pending pastes — 2026-11-07

## Confirmed causes

External MCP clients without `ORKESTRAI_NODE_ID` sent `from: null`. Agent asks returned after eight seconds but had no return inbox. Reply instructions, transcript watches and restart restoration previously required a Canvas sender. The external client therefore had no way to retrieve a late reply. This is distinct from message submission.

Codex paste recovery refused any change in the owner-input revision. xterm cursor-position reports (`CSI row;column R`, answering `CSI 6 n`) incorrectly increased that revision. A valid automatic response could therefore permanently disarm Enter recovery for that submission. The previous real-TUI fixture wrote protocol replies directly to the child and bypassed the app's inbound path, missing this condition.

## Changes

- Cursor reports are recognized only against fresh pending queries, with a bounded count and expiry. Split queries and batched reports are covered. Unsolicited reports, expired replies, mixed owner input, drafts, working turns and exact receipt checks remain protected. Text is never retyped.
- The real Codex TUI fixture now routes terminal replies through `writeHumanInput`, matching the renderer path.
- External asks carry a private return credential. The envelope stores its SHA-256 verifier and an indexed correlation; no extra database or Canvas node is created. A short transaction deduplicates concurrent retries. PTY restoration and waits run outside that transaction.
- Existing transcript capture and explicit replies persist answers for external callers. Reading a saved result restores its capture after Core restart without replaying the prompt.
- `message_read` / `message_wait` and CLI `message read|wait` expose the saved result. Native agents can read only messages they sent, with their live PTY identity. External calls require the exact workspace and private receipt. The receipt never grants a Canvas role.
- Return keys are private files outside the project, bounded to 4,096 entries per workspace scope. Files contain no prompts or workspace/provider tokens. Symbolic links and non-private files/directories are rejected. Completed keys remain available for explicit rereads; none are automatically deleted while pending.
- An interrupted HTTP wait does not withdraw an external ask. Retrying uses the original receiptId and unchanged content. No automatic new message is created. Plain Shell output retains its synchronous contract.

## Verification and limits

The added cursor-report reproduction failed on 0.52.3 and passed with the fix. Focused coverage includes genuine owner edits, query expiry, batched/split reports, native working states and bounded Enter recovery.

A real Codex CLI 0.166.0 on this Mac completed four exact receipts, recovered one deliberately dropped Enter, and made four primary inference requests against a loopback fixture (eight including title requests). No owner credentials or paid inference were used. This is not a new native Windows soak result.

The previous 65-minute native Windows result did not exercise the corrected inbound protocol path. The updated fixture passed on native Windows in run 42397910577 (commit 661b1f72, pinned Codex 0.167.0, 75-second sustained loop plus startup/recovery). This validates ConPTY with the corrected input path; it is not a new 65-minute soak. The affected owner confirmed the problem still occurs on 0.52.3 after restarting.

External reply tests cover SQLite persistence, concurrent retries, wrong receipts/workspaces, disconnected readers, structured capture after recreating the Core monitor, private storage, a restarted MCP process, and real stdio/HTTP transport. A pending result is never a confirmed answer.

MCP cannot wake a provider after a completed tool call. External callers must use the bounded wait/read operation or receive a saved result on a subsequent tool call. The protocol does not promise unsolicited model execution.

No owner app restart or installation was performed. Changes are prepared after immutable public release 0.52.3; they are not part of that published installer.
