# Windows Codex delivery after redraws — 2026-11-08

## Owner report and scope

The owner confirms native Windows, Codex CLI 0.167.0 and Orkestrai 0.52.5.
The paste still remains unsent while staying in Canvas for the entire session.
The owner also reports terminal/cursor blinking near the failures. Whether the
whole terminal or only the cursor blinks has not yet been confirmed.
The affected remote installation is not accessible from this Mac.

## Native reproduction missing from the previous release

The earlier normal-TUI tests lost the first Enter while keeping the terminal
geometry fixed. The expanded fixture also loses Enter on a later message and
resizes the native ConPTY from 40x12 to 72x20 while that paste is being consumed.
It uses the normal Codex TUI, real shell-tool execution, local Responses data,
isolated account homes and no paid model traffic.

Baseline source: `af81b37b`, runtime identical to 0.52.5.
Run: https://github.com/beeblock/orkestrai/actions/runs/42449665555

Both 0.166.0 and 0.167.0 fail. On 0.167.0, the third message stays as
`[Pasted Content 9018 chars]`. The native composer reports idle, the owner draft
length is zero, input revisions match and no recovery Enter is attempted.
The old unresized backend fixture passes in that same run.

After resizing, the TUI paints the composer on row 17, the model/path on row 19
and a warning on row 20, then restores the cursor to row 17. The raw-output
matcher flattens all these rows into one draft and rejects its footer text.
The correction checks the freshly painted composer row and cursor return,
excluding only cursor-proven footer work. Erases/edits in the composer,
unproven dialogs, unknown controls, owner edits, busy states and exact receipt
requirements remain guarded. Recovery sends Enter only, never message text.

This deliberately loses Enter to prove a recovery gap. It does not establish
the cause of every initial Enter loss on the remote machine.

The footer-only candidate (`3a4223f1`) still fails in
https://github.com/beeblock/orkestrai/actions/runs/42450507256.
The next captured redraw paints `› [Pasted Content 9018 chars]` followed by
`CSI K`, clearing the blank cells to its right. The original final erase guard
rejects all EL/ECH controls, including this one that leaves the badge intact.
The follow-up permits only an immediate right-side clear after a freshly
painted prompt/badge, with no intervening cursor movement. Left/full erases,
unlocated clears and further draft text still reject recovery.

The right-clear candidate (`2df7b9e0`) passes the native 0.167.0 job in
https://github.com/beeblock/orkestrai/actions/runs/42451186195:
12 exact receipts, six missed Enters recovered and no duplicate primary
requests across Canvas, Conversation and backend checks. Its 0.166.0 job
exposes a further variation: ConPTY redraws rows with CRLF, then restores the
cursor, instead of positioning every row absolutely. A captured 1 KiB fixture
covers that stream. A freshly painted prompt line can identify this composer;
explicitly positioned prompts must still match the cursor-return row.

## Cursor styling

The pinned 0.167.0 TUI output contains DECSCUSR (`CSI 0 SP q`). Node's
`stripVTControlCharacters` returns ` q` for all supported cursor styles 0–6.
That residual text can also invalidate a pending-paste match. Seven regressions
fail before explicitly excluding this non-text cursor control and pass after.
Cursor visibility controls alone already strip correctly. This establishes a
cursor-style parsing bug, not that the owner's specific blink has been traced.

## Historical cursor queries

A headless xterm regression proves that restoring history sends an old cursor
position request to xterm again. Its unsolicited reply increments the Core's
owner-input revision and prevents pending-paste recovery. Both attach snapshots
and on-demand replay now omit historical CPR queries; live output is unchanged.
The tests verify one live reply, no replay reply, preserved delivery identity
and exactly one copy of the message text.

The separate maintainer review also caught a first-viewer regression before
publication: omitting every request would discard a fresh request that had
not received its first reply yet. Replays retain the latest currently pending
requests within the existing correlation deadline; answered/expired requests
are omitted. Actual xterm tests cover attach and replay in all three states.
These cases also run in the native Windows guard step.

Native ConPTY in the failing resize fixture emits no frontend protocol replies,
so this separate fix is not presented as the cause of that native failure.

## Validation status

- Captured resize regression fails before the correction.
- Cursor-style regressions fail before their correction.
- Historical cursor-query regression fails before its correction.
- Focused transport, owner-input, docs/tours and packaged-import checks pass.
- The first complete local suite passes 3,184 tests, with 24 skipped, before
  the final right-clear and relative-redraw regression additions. Subsequent
  focused checks cover those additions.
- Final compatibility: both 0.166.0 and 0.167.0 pass the short native run
  https://github.com/beeblock/orkestrai/actions/runs/42452047661 on `d3404544`.
  Sustained verification is recorded separately in
  https://github.com/beeblock/orkestrai/actions/runs/42452049682 and must pass
  before tagging. A short pass alone does not establish long-session behavior.
- The production build passes. Eleven production-browser tests pass, including
  Canvas/Conversation lifecycle, dense-Canvas performance, delivery, managed
  Shells and persisted provider model/effort.

## Sustained-test design

The workflow's 65-minute input previously applied independently to all three
serial TUI cases, exceeding its 85-minute job timeout. The workflow now holds
one Canvas session for the full duration and still runs Conversation and the
backend scenario as short checks. During the sustained Canvas session it
alternates geometry, restores viewer history and deliberately loses periodic
Enters. It checks exact prompt receipts and rejects duplicate primary requests.
The short fixture also schedules twelve rapid geometry changes during a paste
without deliberately dropping Enter, then checks its exact receipt as usual.

The owner's active Mac app and agents are not restarted by this investigation.

## First-write readiness

The rapid-resize main CI run
https://github.com/beeblock/orkestrai/actions/runs/42452788128 passes both
Canvas and Conversation cases on 0.167.0, but the independent no-alt-screen
backend case fails on its first ordinary message: part is literal text and
part a smaller paste badge, with no exact receipt. No Enter is deliberately
lost at that point. The source allowed a confirmed write before the initial
input-ready boundary; a unit regression reproduces that early write and fails
before the guard. Confirmed ConPTY writes now reuse native idle or the existing
quiet fallback before writing the body, not just before Enter. Native backend
logs record readiness at each write without exposing message contents.
This is a confirmed readiness gap; the partial-paste failure remains subject
to the next native run and is not attributed to it without that evidence.
