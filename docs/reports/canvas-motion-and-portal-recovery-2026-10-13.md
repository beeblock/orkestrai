# Canvas motion and Portal recovery — 2026-10-13

## Reproduction and evidence

The owner reported CPU saturation while moving the canvas to a Portal, followed
by an unresponsive Portal while the rest of the canvas still accepted input.
This is not a new permission failure, and the current incident cannot be
explained by the old rollback bundle diagnosed on October 12.

The canonical installed **0.42.0** main renderer (PID 63138) was repeatedly at
**535–625% CPU**, roughly six logical cores, after about 17 hours of runtime.
The Core and providers were not the dominant consumers. Its native footprint
was approximately **1.0 GiB**, peak **1.1 GiB**; those measurements do not prove
an unbounded memory leak or that physical memory pressure caused the incident.

A native sample was retained before any restart. Official Electron 42.11.8
arm64 Breakpad symbols were checked against the published SHA-256 and the
installed Framework UUID, then streamed rather than extracting 719 MB of text.
1,931 of 1,938 sampled addresses were resolved. The main thread was running
Blink paint lifecycle / PaintController allocation; seven foreground workers
were doing V8 concurrent major marking. Stripped nearest-symbol names are not
valid evidence of the actual functions. This establishes sustained painting
and GC, not a particular JavaScript component's heap ownership.

The owner workspace contained 208 image nodes, 188 notes and three Portals.
202 available PNG files implied roughly **777 MiB** of decoded RGBA pixels;
the notes contained about one million characters. The prior dense regression
used empty image nodes and short notes, so it did not cover this workload.

## Confirmed defects and scoped changes

- `managedPortalSurface` previously started an independent RAF loop on **every
  document pointer-down**, including unrelated inputs. It depended on a
  pointer-up/cancel/blur receipt to stop. A missed release left `interacting`
  true, so the settle callback could refuse to restore the native Portal.
- Each Portal still read transformed geometry every animation frame despite
  suppressing most native IPC. Remove the RAF loops and interaction latch.
  Observe actual ancestor transforms/resizes, publish one hidden presentation
  using cached geometry, and recompute clipping only after 120 ms of quiet.
  Quiet geometry restores the same page even with no pointer-up event.
- Dense-canvas movement still repainted loaded images, long note bodies and
  thousands of secondary header icons.
  The sole viewport subscriber now signals movement boundaries once each.
  At 150 or more nodes, CSS temporarily skips unfocused node body paint and
  secondary header controls. Titles, dimensions and DOM remain; focused editors
  stay painted. Motion paint is restored after 150 ms of quiet or disposal.
  No terminal is unmounted and no agent is stopped by this optimization.
- The installed canvas had **11,618 header descendants** and five terminal
  bodies fully painted at zoom 0.05. Transiently deferring only those unreadable
  bodies reduced renderer samples from **45.2%** to **8.9–12.1% CPU** with the
  live Core and PTYs retained. The settled viewport now signals overview below
  zoom 0.2, deferring unfocused terminal paint, not output, identity or activity.
- Private Portal gesture previews previously detached/captured/reconfigured
  native pages at both ends of repeated gestures. A one-second cache now bounds
  that work; document changes invalidate it and revision guards discard stale
  async decode results. Motion previews are bounded to 640 pixels; full agent
  screenshots retain logical size, masking and the native command contract.
- A cold diagnostic browser of the owner canvas showed lower compositor cost
  with temporary body paint suppression (observed maximum ~9 ms vs ~63 ms in
  one motion trace). These unequal short traces are exploratory evidence,
  **not a controlled benchmark or a claim of a fixed percentage improvement**.
  A permanent `will-change: transform` hint was tested and rejected.

## Regression verification

- Native Electron regression, isolated profile/local fixture: the previous
  committed Portal implementation fails the per-frame DOM-read assertion.
  The changed implementation passes real native clipping, zooms 0.05–4,
  responsive sizing, lost-pointer-up recovery, stable document/draft, native
  input, overlays, same-origin isolation, no idle recapture, and zero exposed
  oversized screenshot frames. Process exited successfully.
- Viewport unit tests verify one motion-start/end per 120 frames, restoration
  without pointer-up, a gesture ending at its original coordinates, cancellation
  and unchanged-frame suppression. Focused Portal/viewport tests: 33 passed.
- The production-browser dense fixture now loads 208 distinct 1024×1024 PNG
  URLs (**832 MiB decoded**), 188 long notes, three Portal actions and 727 edges.
  It asserts retained node/image/note identity, draft content, body paint
  suspension/restoration and real pan/zoom. Baseline run against the old bundle
  exceeded its 90-second total timeout; that alone is not a root-cause proof.
- Complete unit/feature run with two workers: **2,197 passed, 13 skipped,
  zero failed**, 175.74 seconds. Focused UI/Portal/catalog tests: 72 passed.
  Production build and native Computer/message host postbuild completed.
- The corrected production dense fixture passed in 11.1 seconds with a maximum
  measured frame gap of **133 ms** across real control zooms and canvas pan.
  Image and note DOM identity and an edited draft survived. Three initial
  fixture errors were real 404s from fake Portal IDs; their persistence writes
  are now explicitly mocked, not filtered out of the error assertion.
- Clean production-browser rerun: **13/13 passed with no retries**, approximately
  one minute, including bridge, tasks, Floors, Control Center, Portal SPA,
  responsive overlays and dense motion. Maximum measured dense-fixture frame
  gap in the combined run: **150 ms**. Timing samples are not long-session proof.
- Additional overview/full-screenshot regressions: **2,199 passed, 13 skipped,
  zero failed**, 181.89 seconds. Production suite expanded to **19 tests**,
  including native Canvas delivery, cold model/effort restoration, offscreen
  managed startup and a real Shell making file progress while its body paint
  is deferred. The Shell and renderer retain their identities across zooms.
- Maintainer/accessibility self-review caught a secondary connections badge
  lacking the header's focus exception. Both secondary controls and badge now
  honor `:focus-within`, with a dedicated production DOM regression. No body,
  editor, provider subscription or background permission is discarded.
- Reducing build V8 heap to 6 or 8 GiB was tested and failed during client
  compilation. These limits were **not** shipped; the existing 12 GiB build
  completed successfully (approximately three minutes in the final warm run).
  Keep builds sequential with browser tests and provision disk for swap. No
  compiler-memory regression is claimed resolved.

## Remaining acceptance gate

The first verified local installation contained 408 real nodes and 396 deferred
image/note bodies. Initial renderer idle CPU was **1.9%**, not a sustained claim.
Repeated real zooms/pans still produced **440 ms** worst frame gaps and about
**111–222% CPU** during activity, followed by around **40–45%** in later idle
snapshots. This prompted the additional overview/header/preview changes.

The installed trace showed **138 ms** worst compositor artifact update, **445 ms**
worst FunctionCall and **18 ms** worst major-GC pause. JS heap was approximately
**254–310 MB** while native residency fluctuated more widely. The original hot
process has no JS heap snapshot; its native footprint does not prove a JS leak.
Exploratory header/body suppression reduced one repeated-zoom worst gap to
261 ms; unequal short samples are not a controlled percentage benchmark.

The additional native regression passes with **8 previews** instead of 20,
preserving page/input/session/scroll and exposing zero oversized native frames.
A unit regression proves that private 640×480 previews do not reduce the same
page's full 800×600 CSS / 1600×1200 pixel agent screenshot contract.

Do not declare the entire prolonged-session painting/major-GC incident fixed
solely because a restart has low CPU or because the native fixture passes.
Verify the corrected installed build during repeated owner-canvas gestures and
idle periods, and retain aggregate CPU/heap/paint evidence. If saturation
reappears, use a renderer heap/CPU trace to identify its retained graph rather
than weakening agent tools, permissions or task supervision.

## Final local installation and measurement

- Final production build completed in approximately three minutes with the
  original build heap setting. The focus-adjusted bundle passed **19/19 browser
  tests without retries**, including the real PTY progress test and focused
  connections-badge regression. Dense-fixture worst observed gap in this run:
  **200 ms**. Full unit/feature suite: **2,199 passed, 13 skipped, zero failures**.
- The final arm64 package was created through the macOS wrapper, ad-hoc signed
  with certificate/Apple signing variables cleared, and had microphone and
  automation entitlements checked on the app and four helpers. The verified
  local installer awaited copy, deep signature checks, canonical Core health
  and the new compact rollback before completing. No Keychain access was used.
- Verified the actual installed main canvas, not a Portal tab: **408 nodes**, five
  terminal bodies deferred in overview, no CSS animations, roughly **280–289 MB
  JS heap** during the bounded gesture sample. Four zoom-in/out pairs and an
  empty-pane pan retained all nodes. Renderer CPU samples during activity were
  **43–151%**, then **9.1%** after two seconds and **3.5%** in a later snapshot;
  the former sustained 535–625% saturation was not reproduced in this session.
- Active-motion samples still included an isolated **380 ms** gap and about
  **100 ms** p95. This is **not** proof of uniform 60 FPS or completion of all
  long-session performance work. Preserve this remaining investigation instead
  of presenting the restart or synthetic suite as universal fluency evidence.
- Temporary debugging was bound to loopback for local inspection and is removed
  before handoff by restarting normally. Unpacked package and browser test
  intermediates are removed; only the installed app and one compact rollback
  remain. Persistent data and agent/native access contracts are unchanged.

No owner notes, transcripts, Portal forms, credentials or master images were
modified or exported. The 123 MB symbol archive and 106 MB cold-browser trace
were removed after analysis; the small native hot sample and resolved stacks
were retained locally. These temporary diagnostics are reproducible; project
and persistent app data were not deleted. Regenerable npm, obsolete test-browser,
HTTP and compiled-code caches were cleaned after explicit disk hygiene requests;
cookies, logins, profiles, database, worktrees and master assets were preserved.
The older 0.41.1 rollback archive was removed after validating the candidate,
while the installed bundle remained recoverable. Local installs retain one
new verified compact rollback. No public release, tag or push was performed.
