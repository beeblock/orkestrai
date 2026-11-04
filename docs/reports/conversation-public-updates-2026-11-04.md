# Conversation delivery and public terminal updates — 2026-11-04

## Measured failure

The live Superapp Core answered health checks in 21 ms. Four owner messages
were stored and claimed by the exact Codex leader. Their delivery delays were
15.3 s, 0.8 s, 53.8 s and 50.0 s. The provider transcript itself contained both
claimed inbox batches, ruling out a false database-only receipt for this case.

Between 13:50 and 14:22 UTC the provider wrote eight public commentary messages
while continuing the same long deployment turn. They did not appear in
Conversation. ChannelService only marked owner delivery; subsequent display
required an explicit `orkestrai post`. TerminalMirrorService followed lines
typed directly into a terminal and waited for a complete reply; it did not
project these mid-turn inbox receipts or public progress.

Earlier queue/PTY fixes therefore did not cover this distinct return path.
No installation rollback or SQLite corruption was established by this evidence.

## Runtime correction

- Follow the receiving node's exact provider conversation, profile and native/WSL
  storage roots. Export only timestamped public assistant text, including current
  Codex `phase: commentary` and `phase: final_answer` records.
- Start after an owner receipt, without another model prompt. Project updates
  every two seconds and broadcast the same stored message to live subscribers.
- Recover when Conversation is reopened. Persist transcript identities and
  serialize deduplication in the existing SQLite transaction infrastructure.
- Keep team receipts per recipient, including each recipient's own delivery
  timestamp. Never infer one agent's receipt from a colleague's receipt.
- Recheck active node, provider, profile and conversation after asynchronous
  filesystem reads; never redirect output when leadership changes.
- Keep stored history independent of a slow/unavailable transcript. Bound reads
  to 4 MiB and parsed-cache retention to 16 MiB/128 entries. Coalesce followers
  and avoid repeated database writes for unchanged updates. Stop completed and
  unavailable watches; use a bounded watch registry and unreferenced timer.
- Never export private reasoning, tool results, sidechains or authentication
  configuration. Failures have a rate-limited diagnostic without raw payloads.

## Regression coverage

The focused gate passed 80 tests. New coverage includes active-turn commentary,
recovery after restart, concurrent readers, explicit posts already present,
unchanged-update write suppression, queued messages, leadership replacement,
profile/session changes during I/O, archived nodes, independent team receipts,
stalled recovery and exact account/WSL transcript lookup. The Windows native CI
job includes both new test files. A production-browser regression sends a real
owner message through Chat to a fake CLI and expects visible progress before
that CLI closes its turn, without any bridge post.

Full-suite, production-build and browser results are recorded with the release
verification. This does not prove the external Windows Unity project is repaired;
its large-Git/filesystem fix is separately measured and ships in the same patch.

## Final local verification

- Full suite: 3,048 passed, 18 skipped, zero failures (265.60 s; two workers).
- Standard production build and native host postbuild: passed.
- Production Playwright: 3/3 passed in 25.0 s, no retries. The regression uses
  the official CLI `inbox --json` to claim owner input during a still-open turn;
  public commentary reaches an already-open Conversation before completion and
  survives a reload exactly once. Direct terminal exchanges remain covered.
- Test homes, provider configuration, runtime discovery and database are isolated.
- Companion site: 9 catalog tests passed; three-language 0.51.3 changelog deployed.
- No live owner prompt was resent and no live app/agent was restarted for this
  investigation or these tests.
