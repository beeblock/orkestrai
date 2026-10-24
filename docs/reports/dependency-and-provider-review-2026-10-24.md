# Dependency and provider review — October 24, 2026

## Contributor PR #63: Pi and Oh My Pi

Reviewed head: `db64a107c88ee9945496b6632491970585efb4f9`.
The local merge preserves the contributor's commit and ports the work onto the
current registry, documentation, tours and asynchronous inbox contracts.

Corrections made during porting:

- Implement `runMetadata`, required by the current headless executor.
- Select native read tools for requests without write authorization; keep
  interactive OMP autonomous through its documented approval mode.
- Use ephemeral headless sessions and never resume the latest session by cwd.
  Exact transcript readers are not implemented for these two providers, so
  automatic restoration and Chat mirroring remain disabled and documented.
- Parse completed assistant messages rather than unfinished `message_start`
  events; retain OMP's plain-text fallback.
- Provide Windows installation guidance, shared provider marks, Pi's documented
  profile directory, and use cases/tours in all three languages.

The 126 focused adapter, registry, inbox, environment, profile, documentation and
tour tests passed before dependency updates. No paid provider runs were started.

Official contracts consulted:
[Pi CLI](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/cli.md),
[Pi environment](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/environment-variables.md),
[OMP CLI](https://github.com/can1357/oh-my-pi/blob/main/docs/cli-reference.md).

## Dependabot PR #70: development dependencies

Reviewed head: `e4c886dd682df676d64de1df113a36e103c0668d`.
Dependabot closed and superseded #67 during this review.

Integrate its nine updates, including Electron 42.11.18, electron-builder 26.18.0,
Playwright 1.64.1, Svelte 5.57.2 and Paraglide 2.29.1. The actual Electron executable
reports ABI 146. All 19 checksum-pinned dependency patches still verify unchanged.
The updated Electron passed the 32-capture Portal fixture and 168-mount terminal
renderer fixture; 47 focused compatibility tests passed.

## Dependabot PR #69: production dependencies

Reviewed head: `3a26d60f01b34bcbd5ac96f3dea8d89eb5bbccce`.
Integrate 33 of its 34 requested updates, including XYFlow 1.7.0, Monaco 0.57.0,
PDF.js 6.4.299, canvas 1.0.12, Bruno and Computer SDK 0.37.0. Relay WebSocket
dependencies use the same updated release.

Two compatibility corrections are required:

- The SDK now prefers CuaDriver.app on macOS. Both the actual Electron-owned host
  and native smoke fixture explicitly pass `{ embedded: true }`, preserving the
  existing host permission identity without another app or daemon. A unit
  regression checks the default loader, not only injected test drivers.
- Retain **Svelar 0.7.9**. Published 0.8.0 changes validation to `zod/v4`, while
  the app and its verified framework patches preserve v3 schema contracts.
  The original PR already fails Windows installation at the patch version guard.
  Migrating those schemas is separate work; this merge does not disable the guard
  or attempt an imports-only rewrite of a changed validation API. Dependabot
  ignores exactly 0.8.0 until that migration is reviewed.

## Security resolutions

Dependabot opened #72 during integration. Its two updates are included too:
Drizzle ORM 0.45.4 changes explicitly named postgres-js prepared queries; SQLite
behavior is unchanged. Superforms 2.31.0 adds optional action-result transports;
the published runtime diff leaves the client and Zod adapters unchanged. The
24 focused SQLite transaction, schema, validation, patch and catalog tests pass.
The same package lock retains all security overrides and verified patch guards.

Primary release contracts: [Drizzle 0.45.4](https://github.com/drizzle-team/drizzle-orm/releases/tag/0.45.4)
and [Superforms 2.31.0](https://github.com/ciscoheat/sveltekit-superforms/releases/tag/v2.31.0).

During final verification Dependabot superseded #69 with #71
(`6ae30f88e73cdc1f33d0efa1cb831f3474776c4b`). Its additional native canvas
1.0.13 and electron-updater 6.8.11 patches are reviewed separately; the sampler
minimum is aligned with the already-tested 1.7.9 lockfile. Svelar remains held.
The updater's changes preserve the public download array contract, reject invalid
cached names and discard stale blockmaps. The app continues disabling differential
downloads and enforcing its own macOS trust policy.
The 67 focused checks passed, including actual offline OCR under Electron with
canvas 1.0.13, updater-cache traversal/malformed-name rejection and actual SHA-512
validation. All 19 dependency patches still verify and the complete audit remains
below its moderate threshold.

Keep the complete audit enabled. Additional reviewed resolutions:

- Undici 7.30.1 and 6.29.1 address EventSource retained-state exhaustion,
  excessive content-encoding crashes and integrity verification advisories.
- fast-uri 3.1.9 fixes the URI normalization advisories without a major upgrade.
- Pin Bruno's Azure Identity to 4.13.0, which uses unaffected MSAL 3.x. Newer Azure
  Identity releases currently use affected MSAL 5/6; do not force incompatible
  MSAL 7 into them. This preserves the existing Azure Identity API.
- Bruno's new filestore and scripting packages pin vulnerable YAML 2.3.4.
  Resolve their YAML through the app's patched 2.x dependency instead.

After production resolution, `npm audit --audit-level=moderate` succeeds with no
moderate, high or critical findings. Eight low records remain through the existing
SvelteKit dependency graph. They are reported, not excluded from the audit; their
upstream fixes require a separate SvelteKit major migration.

Primary advisories:
[Undici memory](https://github.com/advisories/GHSA-4qv8-2p9j-2685),
[Undici response crash](https://github.com/advisories/GHSA-xjj6-f33q-929c),
[fast-uri](https://github.com/advisories/GHSA-w74x-v6f9-j3xg),
[MSAL](https://github.com/advisories/GHSA-xcx6-jx8p-x3h5),
[YAML](https://github.com/advisories/GHSA-48c2-rrv3-qjmp),
[SvelteKit actions](https://github.com/advisories/GHSA-pfhg-q3qv-9q6r),
[SvelteKit prerendering](https://github.com/advisories/GHSA-27mw-82g8-phjj).

## Verification discipline

Local tests use two workers; production builds and browser tests run separately.
Browser tests isolate database, user home, provider configuration and runtime
discovery. The existing two-second UI/keyboard assertions are unchanged. Local
Git integration tests may use a 20-second test deadline under host load; this is
not a product latency budget. The tour state-machine unit test mocks the message
module rather than importing thousands of generated translations; catalog parity
remains independently tested.

The owner's installed app and active agents are not replaced by this source
integration. Final integrated test/build/native/CI results are recorded with the
corresponding commits rather than inferred from earlier-version checks.

Integrated local verification: 2,504 unit/feature tests passed, 13 skipped, no
failures, with two workers and a 20-second local test deadline. The production
build completed. Native SDK 0.37.0 under Electron 42.11.18 reports `embedded: true`,
host permission attribution and `directRuntime: true` without requesting consent.

Of 45 selected production-browser scenarios, 40 initially passed. Five exposed
old button-role selectors and a test-locale leak after timeout. Portal selectors
now have explicit translated accessible names; tests use combobox roles and
restore settings in an afterEach hook with its own cleanup budget. All five
repaired cases then passed together in 19.5 seconds. The 36-switch/eight-PTY case
passed with maximum first paint 1,927 ms and GC-collected heaps declining from
70,519,336 to 60,391,292 bytes across its sampled rounds.

Disk cleanup removed approximately 900 MB of npm/Go caches and 4.46 GiB from 11
inactive generated Svelar test applications' node_modules directories. Each had a
package manifest and lockfile, no open files under the test-app root were found,
and the cleanup audit records their lock hashes. Source, databases and training
artifacts were not cleanup targets. Available disk space fluctuates with other
work and macOS swap; the latter occupied roughly 10.6 GiB before the final build.

The first two Linux CI attempts passed 2,505 tests but hit the actual OCR test's
25-second deadline. Windows passed that same native OCR test and both desktop
lifecycle fixtures. The Linux workflow now runs actual OCR separately from the
other test workers, then runs the remaining suite with two workers. Its deadline
and offline assertions are unchanged. Bounded child diagnostics and the last
extraction progress are retained on timeout to distinguish resource contention
from a native-runtime failure; a successful final CI is still required.

Isolation still timed out with no progress or child output, ruling out competing
test workers as a sufficient explanation. The extraction protocol now waits for
an IPC ready message emitted after the parser's listener is registered, rather
than sending bytes during asynchronous module startup. The real offline Electron
test deliberately delays parser import by 200 ms and waits for that readiness.
All 17 focused extraction/runtime tests pass locally, including cancellation,
scanned/rotated/mixed PDFs and spreadsheet parsing. The Linux result remains the
required check; this hardening alone is not yet evidence of its root cause.
