# Workspace leadership handoff and independent deputy

## Scope

Orkestrai 0.50.0 adds a workspace primary leader and an optional deputy, available
through agent creation, existing-agent menus, the native bridge, CLI and MCP.
A deputy is never required for the existing single-leader flow.

## Context transfer

A role configuration is revision guarded and authoritative independently of
terminal launch payloads. Switching primary retains both provider conversations,
account profiles, model/effort selections and workspace files. Open assignments
of the previous primary transfer to the new one. The primary may become the
deputy or a specialist; existing agents can be promoted.

The durable, bounded handoff contains workspace instructions, an optional owner
note, recent saved public messages, the latest public transcript turn where
supported, open tasks, notes, canonical knowledge/learning references and prior
handoff IDs. Reads are paginated. The previous primary can add a brief from its
own authenticated terminal; the new primary reads/acknowledges the record and
continues without waiting for that brief. Provider credentials, environment,
storage roots, tool-result dumps and private reasoning are not copied. This is
provider-neutral project context, not native cross-provider conversation reuse.
Older source conversations remain available; a bounded handoff does not claim
to reproduce every historical token. Unsupported transcript stores still use
the saved workspace context and previous-primary brief.

Role changes, handoff storage, reassigned tasks and notification envelopes commit
atomically. Notifications are released only after commit. Stale grants are
cancelled; a still-current demotion reaches a busy former primary even after
another transfer. Raw and projected read models retain one primary and deputy.
Late terminal callbacks cannot restore an earlier role. Explicit pauses remain
binding. An agent cannot remove a configured independent review gate.

## Delivery review

With a deputy, completion requests leave a card open and persist its review
pointer. Review artifacts are bounded workspace files (including approved
repository aliases), native Designs, notes, checklists, calendars or managed
Shell configurations. File reads are asynchronous, confined, identity checked
and hashed in bounded chunks; Shell revisions remain opaque. Linked task notes
are included. Active Floor work must be landed before artifact preparation.

The logical card definition, artifact hashes and current reviewer configuration
identify the reviewed revision. Each authenticated live reviewer terminal records
its own decision, evidence and findings. The owner screen cannot cast agent votes.
Both current reviewers must approve that revision without findings. Corrections,
changed criteria/artifacts or a reviewer change require new approvals. Completed
history remains historical; reopening invalidates its approval. Findings belong
to their card and do not disable independent assignments.

The second approval records durable completion intent. Core retries unfinished
finalization after failure/restart without another model call. Task lists expose
only compact summaries in one batch query; detailed evidence loads on demand.
Core maintenance walks bounded pages of active review pointers, ignoring old
rounds, completed/blocked cards and already-submitted votes. One concise idle
review reminder is allowed per round and terminal session, after the normal
runtime/autonomy checks; it adds no polling model loop. Specialists awaiting
review are not asked to redo their finished implementation.

## Inbox hardening

A full-suite race exposed an older issue: a delayed dispatcher receipt could
replace a recorded reply and its forwarding metadata. Inbox transitions now run
atomically, and a receipt never rewinds an envelope in `replied`. A deterministic
regression exercises sent/delivered/acknowledged receipts after a stored answer.

## Verification and limits

Local full suite: 2,863 passed, 18 skipped, no failures. After the final Floor
and runtime checks, 191 focused tests passed. The website suite passed all 42
tests. Production/browser release gates are recorded by CI, not inferred from
these local unit counts.

- Feature regressions cover context handoff and preserved profiles/sessions,
  concurrent approvals, findings/corrections, criteria changes, cross-workspace
  rejection, notification rollback, real SQLite recovery, identity spoofing,
  owner-vote denial, rapid transfers, independent work and explicit pauses.
- CLI contract tests cover status, full commands, handoff helpers, both decisions,
  shared schema command parity and truthful pending-completion output.
- The new production Playwright scenario exercises the actual role-selection UI,
  persisted roles, the review badge/detail and owner-vote rejection.
- The three manuals, use cases, tours and website changelogs are synchronized.
- Production build and browser checks are mandatory release-CI gates. Native
  Windows/WSL/Linux interaction and provider output quality are not proven by
  the Mac unit fixtures or a browser platform override.

The GitHub issue #73 fix is included separately. That issue remains open until
the installers are publicly released and validated.

## Browser contract follow-up

The previous full browser run exposed an obsolete checkbox assertion in the
agent-creation test after role selection became an exclusive segmented control.
The test now checks the default primary, specialist switching and disabled deputy
without an existing primary, before verifying the saved primary and model.
The terminal clipboard scenario uses rendered glyph coordinates for actual
pointer selection instead of force-clicking replaceable xterm decoration spans.
Clipboard and paste assertions remain mandatory. CI executes these scenarios and
the new leadership/review scenario before the full browser suite, retaining
failure artifacts from either stage. This is a fail-fast check, not a replacement
for the complete release gate.
