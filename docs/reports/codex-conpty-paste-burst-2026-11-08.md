# Codex `[Pasted Content]` on Windows: root cause and fix — 2026-11-08

Branch `fix/codex-conpty-ordered-submit`, from `fix/terminal-delivery-review-20261108`
(`eebd0918`). Not pushed, released, tagged or installed.

## Root cause

Codex 0.167.0 (`codex-rs/tui/src/bottom_pane/paste_burst.rs` at tag
`rust-v0.167.0`) documents that on Windows "pastes often arrive as a rapid stream
of `KeyCode::Char`, `KeyCode::Enter`" rather than a paste event. Its `PasteBurst`
heuristic then treats Enter as a newline inside the paste while a burst is active
or within `PASTE_ENTER_SUPPRESS_WINDOW` (120 ms) of its last character. The window
is measured with `Instant::now()` when the TUI *reads* each key.

Orkestrai writes the paste, waits (at least `250 + length/8` ms, up to 2 s; for
pastes over 1,000 characters it waits for the badge, capped at 5 s) and then
writes Enter. When the machine is loaded, Codex reads its console input late and
finds the paste and Enter queued together. It processes them back to back, so
Enter lands inside the burst however long Orkestrai waited. The composer keeps
`[Pasted Content N+1 chars]` (the extra character is the swallowed Enter), no turn
starts, and the exact-receipt barrier keeps every later message for that agent
queued behind it. This matches the reports:

- It happens on Windows only. On macOS, Codex receives a real bracketed paste
  (`Event::Paste`), which clears the burst state, so no read timing applies.
- It appears only as the workspace and machine get heavy. A new or light machine
  reads keys promptly.
- The existing `extraEnters` badge tolerance was an empirical sign of the same
  absorption.

## Reproduction with the real Codex 0.167.0 (macOS, isolated HOME, loopback model)

The paste is sent as plain keys, as ConPTY does. A starved TUI is simulated by
stopping the Codex process group (`SIGSTOP`) before the paste and resuming it 1–3 s
after Enter.

| Scenario | First Enter |
| --- | --- |
| Bracketed paste, responsive | submitted |
| Key stream, responsive | submitted |
| Key stream, TUI starved 1 s or 3 s | **absorbed**: `[Pasted Content 2020 chars]` for 2019 characters; a later Enter submits |
| Bracketed paste, TUI starved 3 s | submitted |

## Fix

Codex flushes the burst (`flush_before_modified_input`) and clears the Enter window
(`clear_window_after_non_char`) on any non-text key. Before every Enter that
submits an owned automatic Codex paste on ConPTY (native Windows and WSL),
Orkestrai now writes End (`ESC [ F`). That covers the first Enter, evidence-based
retries and the manual Enter helping a held paste. The cursor is already at the end
of the paste, so End only moves the cursor and Codex closes the paste before it
reads Enter. Input order decides instead of read timing.

The change is limited to `automaticSubmitPrefix` (adapter) and
`PtySessionManager.writeAutomaticSubmit`. Other providers, shells and macOS
bracketed paste write exactly the same bytes as before. The waits, the badge
recognition, exact transcript receipts and owner-input custody are unchanged.

Same scenarios, End then Enter:

| Scenario | First Enter |
| --- | --- |
| Key stream, starved 1 s or 3 s | submitted |
| Key stream in three pieces, responsive or starved 3 s | submitted |
| Bracketed paste, starved 3 s | submitted |

## Verification

- New gated test, `tests/feature/codex-tui-paste-burst.test.ts`. It drives the real
  Codex through `PtySessionManager.writeWithConfirmedSubmit`, with ConPTY-style key
  input and a starved TUI, and accepts only the exact transcript receipt, with no
  Enter recovery.
  - Control (End dropped): one Enter, nothing submitted, badge 2016 for 2015
    characters, "não confirmou".
  - Fix: one Enter, submitted, exact receipt.
- Unit tests assert End precedes the first Enter and both retries, and the WSL
  expectations were updated.
- Combined local run: 255 passed. It covered the PTY, ownership, delivery, inbox,
  the packaged/type-stripped PTY import, docs and real Codex 0.167 (delivery and
  burst). The Canvas and Conversation real-Codex cases passed separately (2/2).
  The changelog and the docs and tours catalogs passed (38/38).
- **Not yet run:** native Windows CI with real ConPTY and Codex 0.166/0.167 on this
  commit. It is the evidence that conhost turns `ESC [ F` into End there (expected,
  since it is the End sequence Windows Terminal sends). The owner's affected
  workspace was not accessed.

## Remaining risks (not changed here)

- If an automatic paste stays unsubmitted for another reason, the receipt barrier
  still blocks that agent's queue indefinitely. Recovery still depends on the strict
  screen recognizer, two retries and turn-boundary reads. A visible "message waiting
  in the composer" state with an explicit owner action would be safer than any
  timeout.
- `findFileTurn` falls back to walking the Codex sessions tree. On every
  confirmation poll it then re-reads 4 MiB tails of every active teammate's rollout
  in the same cwd.
  - On this Mac that costs about 13 ms per tail. The rollouts reach 0.29–3.7 GB.
  - On a slow Windows machine this adds CPU load to the same machine that starves
    Codex. It is a load amplifier, not the cause.

## Queue latency on macOS (owner report, measured read-only)

The super app workspace, 2026-10-30 to 11-04, counting messages delivered more than
2 minutes after they were created:

| Cause | Messages |
| --- | ---: |
| Target agent busy in a turn for the whole wait | 706 (55%) |
| Target terminal closed / no activity | 412 (32%) |
| Target idle at least 1 minute while the message waited | 158 (12%) |

The inbox types a message only between turns (`canAcceptAutomaticMessage`). PTY
lifecycle events show turns in this workspace with p90 25–60 minutes for the main
agents (the Codex leader: median 4.1, p90 43.9 minutes), and each agent was busy
about 50–63 hours over five days. In a plain terminal the person types while Codex
works, because its composer accepts Enter (submit) and Tab (queue) during a running
turn (`handle_key_event_without_popup` at 0.167.0). Orkestrai waits for the end of
the turn instead.

Changing that is a product decision, not part of this fix: delivering to a working
Codex changes when agents see messages. Before choosing it, verify how the running
turn consumes a submitted or queued prompt and how it is persisted for the exact
receipt. The 12%
idle-target waits have no inbox trace in the app log and need instrumentation
before anyone names a cause. The 2026-11-02 throughput audit already listed the
context amplifiers that lengthen turns: the unbounded `task_list`, supervision
notices and stale doing cards.
