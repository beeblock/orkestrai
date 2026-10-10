# Orchestration throughput fix — report for validation (2026-10-09)

Scope: why a 5-agent Moedex team delivered no integrated product task in ~3 h, and the
changes applied in this working tree. Nothing is committed or released; the version
stays 0.39.3 (`## Unreleased` in `CHANGELOG.md`). The working tree also contains the
earlier, uncommitted Codex work (`HumanComposerInput.ts`, `edge-activity.ts`,
`edge-performance.ts`, `GlobalDictation.svelte`, `TerminalNode.svelte` compositor layer,
`PtySessionManager.ts`); it was kept and built on, not reverted.

## 1. Diagnosis (measured on the live Moedex workspace, 15:00–19:00 local)

| # | Problem | Evidence | Root cause |
| --- | --- | --- | --- |
| 1 | Answers did not come back | 90 asks: 25 replied (28%), 15 failed, 50 delivered without reply | `ask` blocked ≤180 s; Codex reads a typed prompt only at the end of 34–36 min turns |
| 2 | Duplicate replies | 22 of 112 messages were re-injected replies | `BridgeService.ask` accepted a reverse ask as the reply AND delivered it again (no early return after `reverse[0].accept`) |
| 3 | Leader unreachable | 8 of the first 12 messages to the leader failed; others waited 4–7 min | Per-session delivery barrier (`awaitingDeliveryIdle`) stays closed until the transcript shows the prompt, so every other message to that agent expired behind it |
| 4 | Late confirmation reported as failure | Currency → leader failed at 18:54:13, appeared in the leader transcript at 18:54:30 | No reconciliation after the confirmation window (Codex's finding, confirmed) |
| 5 | Assignment blocked or reverted | `TaskBoardService.create/update` awaited `dispatch`; on timeout the task returned to todo/unassigned | Synchronous delivery to a busy assignee |
| 6 | Nothing could land | 0 commits on main and on 8 floors; ~96 changed files in floors | Floors created from HEAD (02/10) ignoring 91 uncommitted main files (since 04/10); `land` refused a dirty main and dirty floors |
| 7 | Manual integration protocol | "freeze", "hashes", "compose hunks", "GO tokens" in agent statuses | Consequence of #6, plus negotiated "exclusive windows" for heavy QA |
| 8 | Serialized QA | Codex Cliente Web waited >1 h40 for a "window" | 3.4 GB free disk; no system queue for builds/E2E |
| 9 | Supervision suspended | A failed message wrote `error` activity on the RECIPIENT; `superviseLeader` skips error states; one-shot fingerprint never re-nudged unchanged boards | `ControlCenterService.recordDelivery` + `AgentRuntimeService.superviseLeader` (Codex's finding, confirmed) |
| 10 | Mac saturated | Renderer+GPU ≈ 1.8 cores constantly (205% renderer at one point), swap 11.7/13.3 GB | Canvas with 545 nodes; off-screen terminals and simulator kept painting |
| 11 | Context bloat | Leader Codex rollout 1.0 GB since 16/09, 12 compactions in 4 h; ~26 KB AGENTS.md bridge block on every Codex turn | Infinite resume; monolithic instructions |
| 12 | Disk | DB 1.9 GB with 84% free pages + 1.5 GB WAL + 7.2 GB backups | No WAL limit/truncation, backup API copies free pages |

Ruled out by measurement: API ~1 ms, `orkestrai task list` 0.16–0.26 s, one code-graph
reindex of 1 s that day (floors are not indexed).

## 2. Changes

### Messaging (new `AgentInboxService`)
- Persistent per-agent inbox on top of `agent_message_envelopes` (metadata `inbox: true`).
- Delivery only at a turn boundary: `canAcceptAutomaticMessage` AND `latestTurnComplete !== false`.
  Everything pending is sent as ONE prompt (≤8 items / 20k chars), with
  `[orkestrai:message:<id>]` markers; a batch prompt is persisted on the lead envelope.
- Mid-turn hand-off: `hooks.server.ts` adds `x-orkestrai-inbox: <n>` to bridge responses for an
  authenticated agent PTY; CLI/MCP claim `GET /bridge/inbox` and print/append the digest
  (CLI → stderr, MCP → extra text content). Claimed items are `delivered` and never typed later.
- `ask` to an agent (`BridgeService.askAgent`): enqueue; wait ≤120 s if the recipient is free,
  return `deliveryState: 'queued'` after 4 s if it is busy. A reply that arrives after the
  wait is routed to the asker's inbox (`kind: 'reply'`). Plain shells keep the old
  synchronous path (`askTerminal`).
- Reverse ask while the original asker is blocked: answers the waiter, is recorded as a
  delivered envelope (answerable with `reply`), and is NOT typed into the asker terminal.
- `POST /bridge/messages/:id/reply` / `orkestrai reply` / MCP `reply`: recipient-only, once.
- Uncertain submission (`Transcript confirmation timed out`) stays `sent` + `unconfirmed` and is
  reconciled with `findPromptInTranscript`; unsubmitted attempts requeue (≤5 attempts).
  Providers without transcript storage are marked delivered instead of being resent.
- Reply capture: after a batch with agent asks, the sweep waits for the turn to complete and
  routes `findReplyToPrompt` text to each asker; replies/notices never trigger capture
  (no ping-pong).
- Task dispatch, new-task notice, completion notice, recovery prompt and leader supervision
  use the inbox for agent PTYs (`wake: false` for notices: never wakes an offline agent).
- `ControlCenterService`: message failures no longer write `error` on the recipient; they
  annotate the sender (state preserved) and raise an attention item via
  `AttentionService.raise` (no activity event on the recipient).

### Floors (`FloorService`)
- New migration `agent_floors.base_commit/base_kind/landed_head` (generated with `npx svelar make:migration`).
- Create: base = working-tree snapshot when main is dirty (private `GIT_INDEX_FILE`: `read-tree HEAD`,
  `add -u`, untracked ≤50 MB, `write-tree`, `commit-tree`); disk guard 3 GB; dependency link farm
  (`node_modules/<entry>` symlinks/junctions, caches such as `.vite` excluded, marker file ignored by audit).
- `commitPending` + automatic commit on `task done` for floor agents (`BoardTask.completionFloor`, leader notice includes the land command).
- `land`: commits pending floor work (opt-out `commitPending: false`); clean main + head base → `merge --no-ff`;
  dirty main or snapshot base → per-file three-way merge of `base..head` onto the working tree
  (`git merge-file`), binaries/symlinks/submodules conflict, any conflict aborts before writing,
  disk check before writing, no commit, `landed_head` recorded so audit reports `patch_applied`.
- Cleanup failure after a successful integration returns `cleanup: 'pending'` instead of throwing.
- Preview returns `mode`, `files`, `pendingInFloor`; FloorPanel/Council no longer disable landing on a dirty target.

### Heavy runs, disk, database
- `HeavyRunService` + `POST/GET /bridge/heavy`, heartbeat, release; CLI `orkestrai heavy [--label] [--task] -- <cmd>`.
  Slots = min(4, cpus/4, totalmem/6 GB) (env `ORKESTRAI_HEAVY_SLOTS`), FIFO, 90 s lease TTL, pauses below 2 GB free.
- `database-maintenance.ts`: `journal_size_limit = 64 MB`, `wal_checkpoint(TRUNCATE)` every 10 min.
- `run-startup-migrations.mjs`: backups via `VACUUM INTO` (live pages only); `compactStartupDatabase` runs
  `VACUUM` at boot when ≥256 MB and ≥25% free pages and the disk has 2× live size.

### Canvas CPU
- `TerminalNode.svelte`: off-screen output is buffered (IntersectionObserver) and written on return,
  with a bounded flush (15 s / 1 MB); replay clears the buffer.
- `DeviceWorkbenchPanel.svelte`: stream URL only while visible and the document is visible.
- `NoteCanvasNode.svelte`: `deferOffscreen` (content-visibility) like images/documents.

### Coordination
- Skill: new "Entrega contínua (leia primeiro)" section; `ask/reply/inbox/heavy/stats` commands; floor
  behaviour; task done auto-commit; Maestro steps 4 and 7 updated.
- `LEADER_EXECUTION_CONTRACT`: complete work packages, specialists close their own loop, approvals only
  for irreversible/out-of-scope, no windows/freezes/GO/hash protocols, asynchronous messages.
- AGENTS.md bridge block: ~26 KB → ~8 KB (capability details remain in the skill).
- Supervision: skips when the leader inbox is non-empty; re-nudges on card changes or new teammate
  semantic statuses; unchanged boards get ≤3 stall reminders 30 min apart, only while a worker has
  waited >10 min (listing who waits).
- `AgentSessionRotationService` (boot): stopped agents whose transcript exceeds 256 MB
  (`ORKESTRAI_SESSION_ROTATE_MB`) lose `agentSessionId` (kept in `sessionHandoff.previousAgentSessionId`)
  and get a handoff inbox item with open tasks and recent statuses.

### Metrics
- `OrchestrationStatsService` + `GET /bridge/stats`, CLI `orkestrai stats`, MCP `stats`.

## 3. Contract changes to review
- `ask` for agent targets no longer blocks for busy recipients and exits 0 when the inbox owns delivery
  (`inbox: true`, `deliveryState: 'queued'|'delivered'`). Shell targets unchanged.
- `tests/unit/bridge-concurrency.test.ts` was removed; its provider-agent scenarios are covered by
  `tests/feature/agent-inbox.test.ts` under the new contract.
- Task dispatch to agent PTYs is asynchronous; `assignmentDelivery.reason` stays `assigned_and_submitted`
  meaning "queued for delivery".
- `floor land` with a dirty main succeeds (patch mode) instead of throwing.

## 4. Verification run
- New/updated tests: `agent-inbox` (11), `floor-service` (+6, 2 updated), `heavy-run-service` (5),
  `orkestrai-cli-inbox` (6), `session-rotation-and-stats` (3), `task-board`/`bridge-service` (updated).
- Full `vitest run`: 2089 passed, 14 skipped; `tour-engine` hook timed out only under full load
  (passes alone). `floor-service` "audits 24 worktrees" timed out at 30 s while machine load average was 36–42.
- `npm run build`: exit 0.
- Live install results: see section 5.

## 5. Live validation (installed ad-hoc build, Moedex team)

Install: ad-hoc signature (`identity=-`, no notarization, no Keychain), `codesign --verify --deep --strict`
on the staged and installed bundle, arm64 verified, previous bundle kept in `~/OrkestraiBackups/`.

Boot effects measured on the owner's data:
- `database.db` 1.9 GB → 301 MB (startup VACUUM), WAL 1.5 GB → 0.6 MB, migration backup 301 MB
  (`VACUUM INTO`) instead of 1.9 GB; disk free 3.4 GB → 14 GB overall (with the backup/package cleanup).
- Leader (1045 MB) and Creative Director (997 MB) transcripts rotated with handoffs; both handoffs
  delivered within 20–38 s of boot.
- Renderer CPU with the same 545-node Moedex canvas: 518% average before → 26–55% after.

First 25 minutes (before the second install):
- 0 message failures; deliveries p50 3 s; task briefing to a busy agent delivered in 2 s; completion
  notices to the leader in 1 s.
- 3 product tasks completed and 1 floor landed (patch mode on the dirty main: pending floor work
  auto-committed, delta applied, cleanup `pending` because the floor holds ignored files). In the
  5 h before the fix: 0 product tasks reached main.
- Agents used `orkestrai heavy` for full test runs; the leader received progress-based supervision
  listing the specialists waiting on it and unblocked them.

Problems found live and fixed (each rebuilt, reinstalled and retested):
1. Two Codex terminals starting together in the same cwd were bound to the SAME conversation
   (discovery took the oldest unclaimed transcript). Fix: `AgentSessionTracker` no longer guesses
   between ambiguous launches; an exact prompt confirmation (`AgentTerminalDeliveryService`,
   `BridgeService.transcriptReply`) binds the conversation and ends the guess. The corrupted Director
   binding was repaired from transcript evidence (its handoff lives in rollout `…dfc6…`).
2. An untouched floor created from a snapshot could not be removed (its HEAD is never an ancestor
   of main). Fix: audit reports `integration: 'unchanged'` when HEAD equals the base commit;
   branch deletion uses `-D` only in that case. Caught by `tests/e2e/floors.spec.ts`.
3. A prompt submitted to a live terminal whose provider records the turn late was requeued after
   the confirmation window (duplicate prompt risk). Fix: it is marked delivered with
   `confirmation: 'unverified'`; only a terminal that died before recording it is retried.
4. Agents inherited the environment of the outer Claude Code session that launched the app
   (`CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_CHILD_SESSION=1`, messaging socket/token…). Claude agents
   then ran as children of that session and wrote no transcript. Fix: `sanitizeAgentEnvironment`
   strips outer agent-session variables (user configuration such as `CLAUDE_CODE_USE_BEDROCK`,
   `CODEX_HOME` kept). This also affects anyone launching Orkestrai from an agent terminal.

5. An explicit `reply` to a message that was itself a reply was recorded but routed nowhere (routing
   only handled `ask`), and the CLI still printed "na caixa de entrada dele". Fix: any message from
   an agent routes its answer to the sender; the CLI reports when nothing could be forwarded.
6. Specialists sent checkpoint reports as `reply` to the task briefing, which had no sender, so they
   reached nobody. Fix: briefings carry their coordinator (the agent who created the task, else the
   workspace leader) as `fromNodeId`, so replies reach that coordinator.
7. Asks to two restored Codex agents stayed `queued` for 13–22 minutes. Their rollouts ended in a
   turn cut off when the old app was quit (no `task_complete`/`turn_aborted`); the resumed CLI only
   appends `thread_settings_applied` and sits idle, so `latestTurnComplete` returned `false` forever
   and the inbox never delivered. Fix: `parseLatestTurnComplete` receives the live PTY's start time;
   a turn whose recorded activity (prompts, tools, answers; not resume/settings records) all predates
   the live process is treated as closed. Without timestamps nothing changes. Applies to inbox
   delivery, reply capture and leader supervision.
8. An `ask` to an agent with no saved conversation failed with "não tem uma sessão PTY ativa", while
   a task assignment to the same agent 45 s later started it normally (its transcript was born at that
   moment). `messageTarget` required a resumable conversation. Fix: without a saved conversation the
   agent starts fresh, exactly like task dispatch; with one, resume stays mandatory. Raw terminal
   bytes (`askRaw`) still never restart a TUI.
9. Found while analysing 7: after any restart, agents that were `working` on a card came back idle
   and stayed idle until someone messaged them (task recovery only covered `blocked`/`error`/
   `waiting_permission`). Fix: a `starting` lifecycle event after `working` also offers recovery, and
   `TaskBoardService.recoverBlockedTask` sends it only when `AgentInboxService.interruptedTurn` proves
   the transcript's last turn is open without the live process start and closed with it; an agent
   that finished its turn idle is left alone. The prompt says the session ended mid-task and to
   continue from the working tree. The canvas resume prompt (`RoleService.applyToTerminal('resume')`)
   also tells a restored agent to continue its cards; whichever reaches the session first covers the
   card: resume skips cards whose recovery was already delivered and withdraws queued ones
   (`cancelReason: 'superseded'`, no attention item).
10. Found during the reinstall: quitting the app left an `orkestrai heavy -- <full Playwright QA>`
   started by Codex Web running orphaned (ppid 1). Its lease lived only in the old server's memory,
   so the run continued outside the queue and the resumed agent would start a second one. Fix: the
   heavy wrapper records its caller and checks every 5 s (reparented on POSIX, or `kill(pid, 0)` =
   ESRCH); when the caller is gone it terminates the command tree (process group on POSIX,
   `taskkill /T` on Windows), escalates to SIGKILL after 10 s and releases the slot. Verified with a
   real process tree: 3 processes gone within 5 s of the caller dying, lease released.
11. Found 60 min after the final install: Claude Web UX ended its turn (`end_turn`) after a teammate's
   reply with two cards still `doing`, without closing them or reporting a blocker, and nothing nudged
   it (supervision only targets the leader; its "waiting" list only holds reported waiting states).
   Fix: `AgentRuntimeService.nudgeIdleAssignee` (supervisor tick) enqueues a bounded `task_recovery`
   reminder (`metadata.idleNudge`) to a non-leader agent idle >= 10 min whose transcript turn really
   ended, with a `doing` card, no queued inbox items, no unanswered outgoing ask in the last hour and no
   human-attention state. Keys `idle-card:<task>:<session>:<n>`, max 2 per card and session, the
   second only after activity later than the first delivery + 10 s. Respects emergency stop, quiet
   hours and usage caps.

12. Root cause behind 8, found 85 min after the final install: Claude Web UX lost its conversation id
   again at boot. `WorkspaceService` (workspace open) checked Claude resumability with
   `trackingCwd = workspace.workingDir` on native runtimes, while Claude stores a Floor agent's
   transcript under the Floor folder (the WSL branch already used the Floor path). Every app start
   therefore deleted `agentSessionId` for native Claude agents in Floors. Fix: use the Floor path for
   both runtimes; regression test fails without the fix. The live node was repaired from transcript
   evidence (`8228f350…`, written until the quit) while the app was closed.
13. Found 2 h after the final install: free disk fell from 12 GB to 2.1 GB (team floors, review
   artifacts and per-run QA Docker containers; Docker.raw at 40 GB) and this pipeline failed with
   ENOSPC. The queue only gated new heavy runs (< 2 GB); running ones could still fill the disk, which
   previously crashed this machine. Fix: `HeavyRunService.renew` (heartbeat) returns `stop` below
   `DISK_LIMITS.critical` (1 GiB) and raises the disk attention item; the CLI ends the command tree
   on that heartbeat. Verified with a real process tree (stopped at the first heartbeat, lease
   released). Space freed tonight only from my own artifacts (partial zip, test temp dirs, the
   install backup — 0.39.3 remains on GitHub); project data and Docker volumes were not touched.
14. Owner review the next morning ("2.5 tasks/h is slow, why no commits, the leader must deliver
   integrated on main without waiting for me"). Measured: unblocked tasks took 6–36 min; the long ones
   (9–12 h) waited on integration. Moedex main had no commit since 10-02 and 235 uncommitted files;
   patch landing never committed and nothing told the leader to. The leader parked in
   waiting_permission/waiting_input (visual Portal review, OS grants, "remote URL" although origin
   exists, disk) and supervision skips parked leaders. Its floor audit found 0/18 removable floors
   (ignored test reports/logs, never-landed work), so disk fell below the 3 GB floor minimum and the
   team stopped. Fixes: (a) `floor land` commits exactly the landed paths (`git commit --only`,
   pathspec file; other local changes untouched; optional `--message`); merge mode reports its commit;
   (b) ignored build output/caches/test reports/logs no longer block retiring an integrated floor,
   while other ignored files (e.g. `.env`), live terminals, pending cards and processes whose cwd is in
   the floor (`lsof`/`/proc`, new `running_process` blocker) still do; (c) floor creation below the
   disk minimum first retires integrated idle floors; (d) leader contract: delivery = landed and
   committed on main, never wait on the owner to commit/land/review visually/free disk, owner-only
   checks are non-blocking follow-ups; (e) a parked leader is supervised again when cards finished
   after its wait, and the reminder lists them with "floor land".
15. Codex review of 196663f2 (eight findings, all confirmed and fixed) plus owner reports:
   - P1 symlink escape: `planDelta`/`applyDelta` refuse any delta path whose existing component in
     the main checkout is a symbolic link (`reachesThroughLink`, re-checked before the first write).
   - P1 disposable artifacts: allowlist reduced to test reports and tool caches (test-results,
     playwright-report, blob-report, coverage, .nyc_output, .svelte-kit, .vite, .turbo, .parcel-cache,
     Python caches) plus `*.log`; folders are walked (bounded, 10k entries) and any secret/data-like
     name (.env*, keys, certificates, sqlite/db, credentials, secrets) or symlink keeps the floor;
     `node_modules` only next to a lockfile. build/dist/out/target are never disposable.
   - P1 heavy process group: `stopHeavyTree` signals only the command's own descendants (one
     `ps -A -o pid=,ppid=` snapshot, deepest first), escalates to SIGKILL, reaps survivors after
     exit. No `process.kill(0)`.
   - P1 lost reservation: heartbeat carries label/task; `HeavyRunService.renew` reinstates an
     unknown lease only when a slot is free, otherwise returns `{alive:false, stop}`; the CLI stops
     the run on `stop` or `alive:false`.
   - P1 failed landing commit: the floor is kept (`merged:false`, `cleanupReason:'commit_failed'`,
     `landed_head` not recorded, audit keeps it unmerged); landing again commits every delta path
     (`plan.paths`), treating "nothing to commit" as already recorded. FloorPanel shows
     `commitError` / kept-floor reasons (new i18n keys, 3 languages).
   - P1 sequential sweep: drains are scheduled per agent without awaiting each other, bounded by
     6 delivery slots; confirmations and reply checks run concurrently; `sweepNow` awaits drains.
   - P2 duplicate replies: `routeReply` is serialized per message (`withLock('reply:<id>')`), the
     DB transition is conditional (`fromStates`), and the forward has `dedupKey reply-forward:<id>`.
   - P2 reply capture after restart: `restorePending` rebuilds reply watches from delivered,
     unanswered asks (`awaitingReplies`); `checkReply` follows the node's current terminal or reads
     the saved conversation without one.
   - Canvas pan/zoom CPU (552 nodes, 876 edges): edges no longer subscribe to the live viewport
     (settled snapshot after 150 ms, published by ZoomBridge); the code graph re-syncs once per
     settle; terminals flush only after 200 ms visible; Portal nodes skip occlusion/IPC while moving
     (native view is hidden behind its preview during motion anyway).
   - Kanban: leader contract says a card whose work is landed and committed is closed at once,
     coordination cards included; owner-only checks go on a separate card.
Test evidence for the final build (installed 2026-10-10 04:51 UTC): full `vitest run` 2106 passed /
0 failed / 13 skipped (run with `--maxWorkers=2`: at load average 11–17 from the team's own suites,
the default worker count timed out three timing-sensitive tests and lost a worker; each passes alone); type-check clean for the changed services; `npm run build` ok; Playwright on the
production build in CI mode for bridge, tasks, floors and control-center specs: 8/8. The full Playwright
suite (226 passed, 1 flaky onboarding tour that passed on retry, 1 skipped) ran before fixes 7–13; those
fixes are covered by the targeted specs above and new unit/feature tests (`agent-transcript`,
`agent-inbox`, `bridge-service`, `control-center`, `agent-runtime-service`, `workspace-reload`,
`heavy-run-service`, `orkestrai-cli-inbox`). Package: arm64 DMG, ad-hoc
signature, `codesign --verify --deep --strict` on the staged and installed bundle.

Throughput on the live Moedex team (same workspace, UTC; "after" = 23:48–06:18, 6.5 h, with nine
app restarts for testing, each interrupting every agent):
- Tasks marked done: 6 in the 5 h before the first install (1.2/h) vs 16 after (2.5/h).
- Floors landed on main: 0 before (dirty main made landing impossible) vs 9 after (patch mode).
- Message failures: 12 of 154 before (terminal queue/confirmation timeouts); 4 of 267 after, all the
  same `ask` to an agent without a saved conversation (fixes 8 and 12), none since 01:30.
- Inbox delivery p50 15 s; senders are no longer blocked while waiting (before, the median ask held
  its sender ~69 s and timeouts failed the message).
- Orkestrai CPU 9–55% (518% before); load average fell to ~4 once the team's suites finished.
- The leader still waits on the owner for visible Portal reviews and the git remote URL for push.

## 6. Known limitations / for the validator to scrutinize
- Agents in Floors are not restarted automatically after an app restart unless their runtime mode is
  `persistent` (renderer does not mount off-screen Floors). They resume when a message, task dispatch
  or the leader wakes them; interrupted turns then get a recovery and idle cards a bounded reminder.
- Turn-boundary detection relies on `latestTurnComplete` (Claude/Codex/Kimi); other providers fall back to PTY idleness.
- Mid-turn delivery depends on the agent calling the bridge; an agent that never calls it receives items at its next turn boundary.
- Batch replies captured from the transcript are routed to every asker in the batch (`metadata.batchReply`).
- Patch landing commits exactly the Floor's paths with `git commit --only` (pathspec file); a failing repository hook leaves the files landed and reports `commitError`.
- The dependency link farm is native-only (skipped for WSL workspaces) and is created once at floor creation.
- Session rotation drops long context on purpose; the previous conversation id is kept for manual resume.
