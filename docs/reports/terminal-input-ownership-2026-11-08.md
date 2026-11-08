# Terminal input ownership review — 2026-11-08

## Scope and failure

This is an unpublished follow-up to v0.52.6 (`0b4b1ace`). It does not replace
the transport with a provider SDK. Bridge messages already use the persistent
inbox and tool results; waking an idle interactive CLI still uses its PTY.

The previous input guard ended when Orkestrai emitted Enter. Enter emission is
not proof that the CLI accepted the prompt. If Enter was ignored, releasing
owner keys appended them to the automatic paste. Increasing the Enter delay
did not make these two writers independent.

The initial reproduction against v0.52.6 failed six of seven checks, including
typing during a missed automatic submit. The follow-up tests retain separate
assertions for prompt identity, physical writes, owner input and receipt.

The real persisted-inbox fixture reproduced an additional gap: short messages
can be painted literally, without a `[Pasted Content]` badge. Missing Enter
there remained unrecoverable despite the long-paste tests passing. Recognition
now requires the complete fresh owned literal body and refuses destructive or
unknown controls. Existing identity/revision/idle guards remain mandatory.

## State contract

1. Before automatic paste bytes are written, an owner draft wins. An async
   relevance check must revalidate the owner revision before it writes.
2. Once the paste starts, owner keys remain in memory until the exact prompt
   receipt. Emitting Enter, repainting the screen, timing out, cancelling the
   caller or finishing another turn cannot authorize releasing these keys.
3. A verified receipt releases owner input before another automatic delivery.
   A receipt for an older delivery cannot release a newer delivery's input.
4. Terminal protocol replies remain immediate. They are not owner edits and
   must not deadlock the CLI's own terminal initialization.
5. A standalone manual Enter can help the visible pending paste without
   changing its message identity. Ctrl+C explicitly discards staged owner keys,
   disables automatic recovery of that paste and takes over the terminal.
   Neither action invents a delivery receipt.
6. An I/O exception after attempting the paste is uncertain delivery, not proof
   that no bytes arrived. Keep custody; do not authorize replaying the body.
7. A newer completed turn can report uncertainty to the caller but does not
   free the unconfirmed composer. Continue checking for a late exact receipt.
8. Viewer detachment/reconnection preserves input custody in the Core process.
   Report only a boolean waiting status to the renderer, never staged text.
   A replacement PTY must not inherit keys from the previous process.
9. Raw bridge controls fail immediately with `PTY_INPUT_BUSY` / HTTP 409 if
   the input is occupied. Do not queue arbitrary controls into a future UI or
   record a successful delivery after refusing the write.

## Agents launched manually inside Shells

A verified foreground CLI with supported session storage supplies its own
exact receipt checker. This does not mutate the Shell node's provider, account,
saved conversation or launch command. The context remains private to the call.

There are separate physical-submit and acceptance notifications. Physical
submit starts reply waiters and the requested reply deadline. An authenticated
explicit bridge reply is authoritative even before a transcript exists, so it
can return to the caller promptly. It does not release staged terminal input;
the PTY still requires the exact prompt receipt or explicit owner takeover.

If no receipt or explicit answer exists at the deadline, return
`PTY_DELIVERY_UNCONFIRMED`, never raw TUI redraws or a false delivery success.

## Verification

- Ownership tests: native and WSL contexts, Codex and Claude, missed Enter,
  typing before/after Enter, preflight races, protocol responses, ordered
  handoff, Ctrl+C, manual Enter, caller cancellation, late receipts, newer
  completed turns before/after owner typing, viewer reconnection, process
  replacement, raw controls, independent terminals and uncertain I/O.
- Manual Shell integration: real PTY child process, exact saved answer,
  explicit bridge `reply` and reverse `ask` without a transcript, bounded
  uncertainty, child exit and cross-workspace/node identity.
- Inbox turn-boundary integration retains the next-message liveness check,
  but requires the delayed exact receipt. Its former expectation that a
  normalized/unrelated completed turn frees the input was unsafe for an owner
  who starts typing afterwards. Assert that no second body is written before
  proof, then that it advances promptly after the late receipt, without
  retyping the first body.
- Production browser regression: actual xterm typing during a deliberately
  missed Enter; assert separate saved prompts, waiting status, retained focus
  and no duplicate automatic body.
- Native Windows regression: pinned official Codex 0.166.0 and 0.167.0, native
  ConPTY, loopback-only model endpoint, owner typing plus missed Enter plus
  resize, exact automatic/owner receipts and no mixed model input.

Local ownership verification: 3,226 tests passed, 24 skipped; production build
passed; 11 production browser tests passed. These runs preceded the additional
short-message recognizer, whose 53 focused Codex tests and actual Codex 0.166
persisted-inbox fixture then passed. The latter used 300 image rows, no Canvas
viewer, no agent inbox polling, two external questions and one Kanban assignment.
It deliberately dropped the first Enter; the next external answer arrived in
1.96 seconds, all three primary requests were distinct, and the assignment had
an accepted receipt. Codex also made three separate title-generation requests.

The final combined suite/build and native Windows results remain to be recorded.
This report does not claim a new installation or release.

## Limits

- This remains an interactive PTY transport. A provider SDK/session protocol
  migration would be a separate architectural change.
- Exact receipt custody requires a supported transcript reader. Providers
  without one retain their existing legacy submission contract; do not infer
  parity from Codex/Claude test results.
- Unsent raw terminal keys are not durable Conversation messages. They do not
  survive Core/PTY termination and are never persisted as a new secret-bearing
  draft. Explicit Ctrl+C intentionally discards staged keys.
- The owner's remote Windows workspace is not accessed by these fixtures.
  Passing an official CLI fixture does not establish that every remote failure
  has been reproduced.

## Native Windows follow-up

The first combined Windows run (42471774882) intentionally remains failed.
Codex 0.167 could not download because GitHub returned HTTP 504; Codex 0.166
reproduced two remaining cases that direct-write fixtures had not covered:
restored owner text plus Enter arrived as one burst, and a short literal prompt
was followed by an erase confined to the footer.

The follow-up separates a restored owner Enter from its body, keeps subsequent
keys ordered, and cancels the delayed Enter on Ctrl+C or PTY replacement. It
also reuses the existing cursor-proven footer parser for a complete literal
prompt; owner edits, unknown controls and erases reaching the input still
refuse recovery. The owned-input suite now has 22 cases. Actual Codex 0.166 on
macOS passed the combined owner typing/lost Enter/resize scenarios with one
separate owner receipt per view and no mixed model input. Both native Windows
CLI versions must still pass a new run before the change is considered verified
on Windows.
