# Quiet provider turns and owner reply latency — 2026-11-03

## Live evidence

Investigation used read-only database queries, the control-center endpoint and
bounded transcript tails. No agent messages, terminal input, configuration
changes or process restarts were issued during measurement.

- At 11:04 BRT, the board still had 35 doing and 86 todo cards. The project
  was not complete. Two cards had closed at 11:02 and main had a commit at 11:00;
  neither establishes functional delivery to the demo.
- The leader's status said idle while its exact Codex transcript continued
  recording tool and inference activity, including at 11:05–11:08.
- An owner message was stored at **11:08:35.317**, attached to a bridge result
  in the exact conversation at **11:09:12.289**, and answered through
  `channel_post` at **11:12:43.221**. Queue-to-context latency was **36.972 s**;
  context-to-publication latency was **210.932 s**. The message was not lost.
- Additional tools and inference events continued afterwards. Restarting or
  sending a wake-up would have interrupted active work rather than resumed
  an idle leader. The two specialists that resumed did so without this
  investigator sending prompts or restarting anything.

## Cause and correction

The PTY's `waiting` flag means output has been quiet for 2.5 seconds. It is
one composer safety gate, not proof of model turn completion. Lifecycle
reporting nevertheless emitted idle from this flag, and all three views
correctly rendered that incorrect server state.

Lifecycle idle reporting now consults the exact provider transcript, using
the existing native/WSL and account storage context. A running turn remains
working. The runtime also schedules background reconciliation every 15 s,
so a transcript completion without a terminal redraw can transition to idle.
The status endpoint performs no transcript I/O.

Reads share a five-second cache, at most four real outstanding transcript
lookups, 128 cached entries and 128 queued checks. A stalled read is reused
even after its caller times out (1.5 s); timeouts do not release the real I/O
slot or launch overlapping reads. Existing revision caches avoid reparsing
unchanged tails, bounded at 512 KiB. Explicit blockers and replacement PTYs
are not overwritten. Composer readiness and safe delivery gates are unchanged.

Codex turn boundaries also recognize structured reasoning/tool work when
the original prompt and start record have left the bounded tail. Settings
and usage records do not constitute new work; activity from a prior process
does not keep a resumed terminal busy.

## Scope and remaining validation

This fixes misleading idle reporting. It does **not** establish that the
remaining response latency or overall throughput is solved. Provider inference,
tool time, integration and functional delivery must be measured separately.
No model or effort selection was changed. A local restart alone cannot prove
the previous long-running memory issues fixed.

Automated verification covers the reproduced idle transition, completion
without redraw, exact native/WSL lookup, stale PTYs, explicit blockers,
fair background draining, bounded concurrency, stalled-read reuse and status
requests that do not wait for transcript storage. Final verification results
are recorded with the commit/handoff rather than inferred from this scope.
