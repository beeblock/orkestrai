# Windows workspace and Conversation availability — 2026-11-03

## Evidence and limits

The supplied Windows log records version 0.51.0 starting at 14:17:55 UTC.
Subsequent inbox timer delays range from 54,569 to 65,142 ms, with five
pending recipients and a maximum observed drain age of 176,150 ms. The timer
is independent of awaited sweep work: these are Core scheduling delays,
not measured provider inference time. The log does not identify the blocked
operation's stack. Earlier Portal connection errors and an older ConPTY
AttachConsole error do not prove the cause of the current failure.

On the Mac, two owner messages stored at 14:45 UTC reached the exact leader
conversation at 14:47:15 UTC. The channel history includes agent posts in that
same direct channel at 14:47, 15:01 and 15:08. A report or unrelated status is
not proof that the owner's question was answered. These records also do not
prove which posts appeared on the owner's screen. Do not diagnose this from
the envelope's delivery flag alone or export message bodies/credentials.

## Corrected blocking paths

- Role discovery, validation and instruction materialization used synchronous
  filesystem calls. Concurrent lookups now share the directory probes and
  bounded four-reader catalog scan. Roles stay bounded regular files, and
  atomic writes avoid partially published role instructions.
- Every Canvas node poll reopened roles and rematerialized launch arguments,
  even for live terminals. Live conversations now retain their launch settings;
  a stopped/new session still receives the normal preparation.
- Terminal cwd validation, Windows PATH/registry preparation and native Codex
  trust canonicalization now use asynchronous I/O. Guest paths stay in the
  WSL namespace. Session/profile ownership is rechecked after preflight and
  immediately before spawning. Resolved native commands remain internal;
  logical command identity and sanitized account environments are preserved.

## Conversation availability

Conversation previously waited for the full Canvas node endpoint and then
optional routines/bindings before loading messages. It now uses a read-only
terminal projection from the channel endpoint, preserves leadership projection
and omits launch instructions, environment and conversation ids. Optional
metadata loads in the background, and message history loads independently.

The dedicated chat socket previously had no heartbeat or silent-connection
repair. It now pings, reconnects silent connections and reconciles stored
messages on reconnect, foreground return and a bounded 30-second fallback.
Reads have a ten-second deadline; failures preserve history and offer retry.
This fallback does not fetch or prepare the Canvas.

Owner queue priority was applied after a limited page of non-task messages.
Fifty older colleague messages could therefore hide a newer owner message
before sorting. Owner input is now queried separately before the claim limit.
Owner prompts and mixed inbox batches explicitly prioritize a direct answer
before continuing coordination. No reminder turns or forced model changes
were added; an instruction is not an enforced model latency guarantee.

## Verification scope

Regression tests reproduce synchronous role/cwd access, unnecessary live role
preparation, the owner page-limit defect, slow filesystem independence,
native/WSL trust paths, command and account preservation, and secret-free chat
projections. Browser tests cover blocked Canvas/optional endpoints and a silent
chat socket while status updates remain healthy. Windows CI and release jobs
must execute the focused native filesystem/PTY cases before publishing.

Synthetic filesystem delay and successful native runner tests do not prove
that the affected Unity workspace is healthy. Verify the installed candidate
and actual message/connection behavior before declaring that incident resolved.

### Local candidate results

- Clean lockfile install, isolated from the owner's checkout: 2,959 tests passed,
  18 skipped, no failures (366 files; 260 seconds, two workers).
- Production build and native Computer host build completed successfully.
- Release/docs/tour integrity: 35 tests passed after version/date synchronization.
- Production browser tests: 16 passed without retries (26 seconds), including
  both new availability cases, conversation isolation and Control Center.
- Mutating the owner candidate query back to the previous implementation made
  the 55-colleague-message regression fail; restoring the fix made it pass.
- These tests use isolated databases, home directories and fake providers. They
  do not send messages, change models or restart agents in the owner's workspace.

Queue delivery, the first subsequent agent post and a relevant answer are
different milestones. Neither a delivery flag nor an unrelated report proves
that the owner's request has been answered. No provider response-time guarantee
is claimed by the activity or message-feed fixes.
