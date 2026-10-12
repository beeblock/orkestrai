# Portal background autonomy and grant persistence

## Confirmed failures

- The exact leader transcript contained native tool errors at 10:08:14 and 10:22:19 UTC on October 12: `Open this Portal or explicitly enable background control.` These were real tool refusals, not inferred model excuses.
- Unconfigured Portals inherited `allowBackground: false` independently in the shared schema, Electron surface broker, settings UI and agent inventory. The same condition remained in published 0.41.0; the local installed test build still identified itself as 0.40.0. Updating alone was not proof of resolving this failure.
- An owner-authorized change enabled background operation on three existing Moedex Portals without changing their other settings. One normal, confirmed human delivery told the leader to resume its existing card. Its resumed tools exposed a second failure: after navigation, two Portal records lost the background field. Canvas browser-state events were replacing complete payloads from a stale renderer snapshot.

## Implemented fix

- Unconfigured Portals default to background control in every workspace, for both leaders and specialists. Explicit `false`, pause, read/manual-only control, selected agents, host restrictions, protected fields and enabled Security gates remain authoritative.
- UI and CLI/MCP inventory use the effective shared profile. The Electron surface broker uses the same default and native execution accepts background operation only for a boolean `true`. Settings follow live grants while the dialog is closed without overwriting an open draft.
- Canvas Portal saves send only changed fields. Optimistic overrides also merge only those fields into fresh server records, including connected-node context. Native browser-state persistence uses the same partial-write contract.
- Portal read/merge/write is serialized by node id in a process-wide map shared by SSR/Core module copies. The ORM merges against the latest record. Explicit internal full replacement remains the default repository contract; only browser-state/owner Portal patches opt into merging. Other node replacement semantics are unchanged. The new merge path rejects malformed persisted JSON with a generic error instead of coercing it to an empty object or echoing its content.
- Updated root changelog, all three app catalogs, the existing browser use case/tour, README and provisioned bridge instructions. Local verification/install uses pending patch version 0.41.1, not a mutation of public 0.41.0.

## Verification

- Before the production change, four new regressions failed: the default profile and actual native executor calls with an offscreen, minimized or detached surface. Afterward, 80 focused tests passed; adding state persistence/concurrency increased the focused set to 88 passing tests.
- The real Electron regression passed against an isolated synthetic site and provider homes: typed actions, authorized write-only login, same page/WebContents, detached control, protected snapshots/captures and pause overriding stale grants. No owner browser session or paid model was used for this regression.
- The first full run found an overly broad initial merge implementation incompatible with intentional internal profile replacement. It was corrected with an explicit merge option rather than weakening the existing authorization tests. The same run observed the installed renderer at approximately 616% CPU, three 5-second Git/Floor timeouts and a tour import-hook timeout. With the old app gracefully closed, all 56 Portal-security/Floor/tour tests passed at their original limits.
- The long-design-brief fixture printed its readiness marker before entering raw mode and relied on fixed sleeps. It now enters raw mode first and waits for readiness/content while preserving every content assertion, matching real agent TUIs without increasing timeouts.
- The final complete suite passed **2,178 tests, 13 skipped, zero failures**, across 260 passing and three skipped files, in 172.21 seconds after the old renderer was closed. No production permission/uncertain-delivery guard was relaxed and no test timeout was raised.
- Production build and both native host postbuilds passed. All **15 relevant production-browser tests passed with retries disabled in 53.0 seconds**, including the background switch's effective default and a real Canvas URL edit that preserves a newer owner grant/pause and sends only changed fields. The synthetic 290-node/727-edge fixture measured a 50 ms maximum frame gap; this is not a claim of sustained installed-app CPU stability. Generated E2E results were removed.

## Local installation and live verification

- Packaged arm64 version **0.41.1** with ad-hoc signing, with certificate/Apple-signing environment variables cleared and no Keychain access, CI, push or public release. The package wrapper rebuilt the production app and native hosts successfully.
- Copied the complete app into a fresh staging directory and waited for successful copy, deep/strict signature verification and the macOS permission/entitlement validator before replacing `/Applications/Orkestrai.app`. Verified the installed bundle again before opening it. The previous installed bundle is recoverable at `/Applications/.orkestrai-install-7ruNnJ/previous-0.40.0.app`; user data was not replaced or deleted.
- Reopened the app at **11:50:09 UTC**. The running Core reported version **0.41.1**, PID 92068, and `/canvas` returned HTTP 200. The agent inventory confirmed effective `allowBackground: true`, `control: interact` and `paused: false` for all three Moedex Portals, including the two without a stored background field.
- The actual leader resumed the existing task. Its saved conversation recorded successful native **Portal navigation at 11:56:33 UTC**, **snapshots at 11:56:58 UTC**, and **extraction at 11:57:47 UTC**. None returned the previous visibility/background refusal. The live control center reported the leader working with its session alive; the financial-journey task remained `doing`, not falsely completed.
- Removed the verified package's approximately **1.1 GB** unpacked intermediate and generated E2E results. The installed app and recoverable previous bundle remain. Available disk space was approximately **3.7 GiB** after cleanup. No project worktree, database, simulator or project server was removed.

## Boundaries

This fixes Portal visibility and grant-loss blockers; it is not proof that financial journeys have passed, every native control is supported, or sustained high renderer CPU has been resolved. The project card must retain its real acceptance status. Actual OS permissions, explicit owner restrictions and authentication challenges are separate. The Core must remain running and the computer awake. No repeated supervision prompt loop was added.
