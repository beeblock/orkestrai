# Windows task delivery and Canvas navigation — 2026-11-07

## Reported behavior and scope

The owner reports native Windows Codex prompts remaining as `[Pasted Content]`,
requiring manual Enter. Other assignments never reach the terminal at all.
The affected workspace has hundreds of generated images; a new Windows
workspace and the owner's Mac work normally. These are distinct failure paths.
No remote Windows installation or workspace database was available locally.
The Mac owner's running agents and installed app were not restarted.

## Reproduced failures and fixes

### Pending Codex paste recovery

The old real-TUI fixture forced `--no-alt-screen` and omitted a mounted xterm.
The new fixture uses the app's launch arguments, the normal alternate screen,
a 40 × 12 terminal, xterm 6, and an actual shell tool invocation between turns.
It deliberately loses the first Enter, exercising recovery rather than
assuming the initial Enter always reaches Codex.

Native Windows with Codex 0.166 failed this fixture before the fix:
the paste badge stayed visible and no exact prompt receipt appeared.
The captured output includes a blank footer erase (`CSI 9 X`) followed by a
cursor return to the composer. Node's `stripVTControlCharacters` leaves an
`X` for this sequence, so the strict ownership matcher refused recovery.
The fix disregards only the cursor-bounded blank footer cleanup. Unknown
clears, edits, working turns and real human input still refuse automatic Enter.
Message text is never retyped by this recovery.

Evidence:
- Before: https://github.com/beeblock/orkestrai/actions/runs/42411176486
- After: https://github.com/beeblock/orkestrai/actions/runs/42412168517
- Repeated Canvas and Conversation runs, both Codex 0.166 and 0.167:
  https://github.com/beeblock/orkestrai/actions/runs/42412446732
- The latter confirmed 42 exact messages across both versions and three
  scenarios, with six deliberately lost Enters recovered and no duplicate
  primary requests. Each repeated scenario ran for about 134 seconds after
  initial delivery; this is not a one-hour soak or a remote-user confirmation.
- Conversation mode supplies no frontend terminal-query responses.
- Model Responses traffic is loopback-only, with isolated homes, no account
  credentials and no paid inference.

This proves the recovery gap and its correction. It does not establish why
an initial Enter is lost in every remote environment.

### Work saved but not dispatched

`taskBrief` awaited optional learning context without a deadline before
creating the inbox envelope. A stalled lookup leaves a saved assigned task
outside the delivery queue. The new regression reproduces that stall before
the fix. Optional delivery recall now has a 400 ms budget. Pending reads are
shared per workspace/agent and capped at four globally, so timeouts do not
multiply abandoned reads. Mandatory task instructions and referenced notes
are still included; optional historical context never authorizes work.

Inbox name resolution also loaded and deserialized every Canvas node,
including unrelated image payloads. Board title lookup and leader selection
repeated that work. A real isolated SQLite fixture with 3,000 image nodes
observed 12,000 image-payload parses in assignment/inbox/board operations
before the fix and zero afterward. Identities now use column projections;
leader lookups load terminals only, retaining leadership projection and scope.

The automatic-dispatch regression also verifies an assigned task reaches the
real inbox dispatcher and becomes `running` only after its delivery adapter
accepts it, without a manual inbox claim or an owner terminal message. That
adapter is mocked in this service test; the native TUI tests above exercise
actual ConPTY separately. The tests do not establish that these are the only
causes in the owner's heavy Windows workspace.

### Canvas surfaces disappearing on pan

Dense-Canvas CSS hid node bodies during movement. Terminal paint visibility
also detached the output stream and requested a full retained-history replay,
resetting xterm after a normal camera move. Navigation now pauses parsing
while retaining the painted surface and stream. Deltas stay bounded at
512 KiB; overflow or a real visibility change can still request a snapshot.

Production-browser verification covers 150 real nodes, an unchanged terminal
DOM/session, no attach/replay frames during pan, and new output afterward.
The 399-node image/note/Portal navigation test and terminal overview test
also pass. A temporary test failure hit the minimap instead of empty canvas;
the fixture now verifies the actual hit target.

## Regression checks

- Captured native footer redraw; erases in/above a composer and unknown clears.
- Exact receipt identity, no message replay, owner edits and native busy states.
- Real Windows CLI in Canvas and without any mounted terminal.
- Stalled optional learning, bounded pending reads and workspace isolation.
- Heavy image workspace assignment and automatic dispatcher progression.
- Archived title lookup and active-Floor scoping.
- Navigation pause/backlog limits, retained node bodies and terminal output.
