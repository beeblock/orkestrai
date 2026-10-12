# Runtime resources and Portal host configuration — 2026-10-12

## Observed failures

The owner reported CPU saturation, repeated low disk space and a leader unable
to configure the Portal hosts required for local journeys.

The active GUI was **0.40.0**, launched from
`/Applications/.orkestrai-install-7ruNnJ/previous-0.40.0.app`, although the
canonical `/Applications/Orkestrai.app` was **0.41.1**. The runtime discovery
file confirmed the old Core version. The old renderer consumed **257–596% CPU**
and about **2.1 GiB** native memory (2.3 GiB peak); the machine had roughly
**6.9 GiB swap** and no idle CPU. Agent providers were not the main measured
CPU consumer. The exact original launch mechanism is not established.

After stopping the old GUI/Core and launching the canonical current app,
renderer snapshots were **1.2–10.9% CPU**, with the Core **2.7–4.9%**. Around
25 minutes after launch, renderer/Core were **1.2%/2.7%**. The real owner canvas
contained **411 nodes and 357 edges**. A main-canvas Chrome CPU trace recorded
520.6 seconds idle, 9.6 seconds program time, 0.55 seconds GC and no sustained
hot JavaScript loop in that observation. The trace was reduced to aggregates
and removed (175 MB); no Portal DOM, credentials or transcript was collected.
A first zoom-in/out interaction was exercised. These observations do **not**
prove a renderer leak after hours of use has been fixed.

The bridge genuinely lacked a native Portal host-configuration operation.
Navigation and control were available, but localhost, IPv4 loopback and IPv6
loopback are distinct exact hostnames. The three local project Portals had
different incomplete lists. The owner's explicit fix request authorized adding
`localhost`, `127.0.0.1` and `[::1]` to those records. Only the host field changed;
pauses, access grants and browser state were preserved. This is not functional
acceptance of the project's financial journeys.

## Permanent changes

- `portal_configure_hosts` MCP and `orkestrai canvas portal-hosts` CLI use the
  existing FormRequest → DTO → Canvas service → ORM repository path. They are
  available to leaders and specialists in every workspace, without Computer
  or macOS input permission dependencies.
- `canvas_list` exposes `portal.revision` and exact allowed hosts, not raw
  payloads or credentials. Configuration validates bounded nonempty exact
  hostname lists; URLs, ports, wildcards and malformed entries are rejected.
- Changes require a live authenticated terminal and an active assigned card.
  The latest Portal profile is checked inside the same serialized write used
  by owner edits. Stale revisions, cross-workspace targets, paused/read-only
  Portals and excluded agents cannot change it. Browser workspace policies
  remain authoritative. Only host settings are patched, never agent grants,
  control, background visibility or tabs.
- Provisioned skill/AGENTS context documents the new operation and CLI fallback
  for older MCP connections. Missing capability on one card must not pause
  independent executable cards. Use cases and tours are translated together.
- `scripts/install-local-macos.mjs` verifies the bundle identity, architecture,
  completed copy, deep/strict signature and main/helper entitlements before
  replacing the installed app. A live app/Core/helper blocks replacement.
  Startup must report the expected canonical executable, version and healthy
  API before the previous bundle is archived. A failed/uncertain startup
  preserves recoverable rollback data and never touches app/project data.
- Rollback retention is one CRC-verified ZIP in the owner's local-install cache,
  outside Applications. A launchable previous app is not left next to the
  canonical installation. The canonical bundle is registered with LaunchServices.
- Targeted SIGTERM now uses normal Electron Quit cleanup of Portals and Core.

## Cleanup and guardrails

Previously removed two unused ~1.1 GiB application backups and ten obsolete
0.39.3/0.40.0 installer/blockmap artifacts (~3.9 GiB total). After confirming
the current Core was healthy and no process referenced it, unregistered and
removed the additional unused 0.40.0 backup (~1.1 GiB), the obsolete Downloads
0.39.0 DMG (~379 MiB) and ~2.5 GiB of npm download cache after confirming no npm
installation was active. The npm implementation was checked: this operation
removes `_cacache`, not the active Expo `_npx` package installation. All targets were exact,
validated build artifacts. Never delete user databases, projects, active Floors,
provider histories, swap files, Docker volumes or unrelated application caches.
Old official installers can be downloaded again; local builds are reproducible
from source. Keep rollback compact, delete packaging intermediates after verified
handoff and clean only this run's E2E traces.

## Verification

- Full Vitest: **2,195 passed, 13 skipped, 0 failed**.
- Focused CLI/MCP, authentication, concurrent Portal profile checks and local
  installer tests cover both leaders and specialists, malformed hostnames,
  stale revisions, explicit access denials and copy/signature/startup failures.
- Latest local installer regressions: **7 passed**, including refusal below
  3 GiB free before copying or replacing any app.
- Production build: **passed**, including native Computer host and desktop
  messages. Existing Svelte/dependency warnings remain.
- Production Playwright: **15/15 passed, 0 retries** (native Canvas delivery,
  authenticated CLI host configuration, bridge, tasks, Floors, Control Center,
  canvas idle/motion). Dense motion fixture: **290 nodes, 727 edges**, maximum
  observed frame gap **67 ms**.
- Local **0.42.0 arm64 ad-hoc** package installed with the new helper. Main and
  four helper entitlements, architecture, deep/strict codesign, canonical Core
  version and healthy API were verified. Installed MCP metadata contains
  `portal_configure_hosts`. No Developer ID or Keychain was used.
- Unpacked packaging intermediate removed after successful handoff (1.1 GiB);
  previous installed app retained as one verified **385 MiB rollback ZIP**.
  The temporary profiling/debug listener is not retained in the final launch.
- Final early installed snapshots: renderer **1.6%**, Core **3.4%**. A concurrent
  machine spike was in Warp/FSEvents/metadata indexing after bulk file changes,
  not the Orkestrai renderer. This remains an observation, not an hours-long
  performance guarantee.

## Other storage pressure observed

Moedex `.orkestrai/reviews` contains about **14 GiB**, including copied payloads
and previous QA outputs. Floors grew from about **5.4 to 6.6 GiB** during this
work; the whole project's `.orkestrai` directory is about **21 GiB**. These are
not automatically created by the native Review Center service: its snapshot is
an ORM/Git projection, not a recursive directory copy. Some agent-produced
archives contain nested `.orkestrai` QA trees and generated assets. Their
evidence and project data were **not deleted**. Avoid recursive workspace
archival; retain source/commit references and bounded review evidence instead.
Global available space fluctuates while other project work and swap continue;
about **5 GiB** was available after installed-app and intermediate verification.

## Release status

0.41.1 is already public and immutable. These compatible new capabilities are
prepared locally as **0.42.0**, not publicly released. No new tag or push is
authorized by this resource/permission-fix request. Synchronize the sibling site
and run the release workflow before a future public tag.
