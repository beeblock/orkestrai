# Canvas navigation throughput — 2026-10-13

## Evidence before changing the installed application

The owner repeated a canvas drag during an eight-second native capture at
16:44:18 -0300. In the overlapping CPU window, the canonical 0.42.0 renderer
peaked at 162.6% and its GPU process at 78.4% CPU (per logical core, not GPU
utilization). Official Electron 42.11.8 arm64 symbols matched both Framework
UUIDs and the published archive checksum; 2,223 of 2,229 sampled Framework
instruction offsets were resolved. The renderer was painting and layerizing;
the GPU process was subdividing dashed paths through SkDashPath and
SkContourMeasure. The unconditional connection dash pattern remained expensive
even with activity animation and rope physics disabled.

Later, the same renderer sustained roughly 480–630% CPU after gestures. Its
cumulative CPU time also grew by about six CPU seconds per wall-clock second.
The subsequent short native sample mostly showed waits plus incremental
marking/sweeping; sampling and timing differences prevent using it to identify
the entire prolonged episode's retained JavaScript graph. No heap snapshot,
private Portal content or owner transcript was exported. Do not conflate this
episode with the specifically measured rasterization cost below.

The actual owner canvas had 408 nodes and 236 connections, with **189 edges
sharing one floating anchor**. A low-degree chain is not a faithful anchor
computation regression for this workspace.

## Changes

- One canvas-level navigation signal, including small canvases, changes only
  decorative connection dashes to solid geometry during navigation/overview.
  Identity, hit paths, activity colors, selected/pinned controls and agent
  relationships remain. Readable idle zoom restores the original dash pattern.
- Settled offscreen connection paint is culled, without deleting wrappers or
  persisted edges. Selected/pinned controls are exempt; their labels use the
  existing EdgeLabel portal rather than living inside the SVG wrapper.
  The final maintainer review changed group unmounting to path-only visibility,
  preserving existing label/control DOM and focus during viewport changes.
- Shared anchor calculations use the immutable node/edge snapshots published by
  XYFlow for position, size and selection updates. Retention is bounded to four
  snapshots. A 189-link hub's nearest-neighbor scan happens once, not once per
  incident edge. The existing uncached helper still supports mutable callers.
- Terminal output buffering now also honors deferred body paint and document
  visibility. Observers listen only to motion/overview boundary attributes,
  not viewport transforms. Ordered output and existing 15-second/one-million
  UTF-16-character bounds remain; focus flushes immediately, stable visibility
  reveals after 200 ms, and authoritative reattach snapshots supersede pending
  output. PTYs, provider settings and agent execution are unchanged.

## Controlled and exploratory comparisons

`scripts/test-canvas-raster.cjs` compiles the actual connection CSS into an
isolated Electron 42.11.8 fixture with 408 synthetic cards and 236 long curves.
Two warmups precede six alternating paired trials, retaining the same DOM.
Mean GPU-process SDK CPU samples were approximately 12.7 with legacy dashes
and 5.1 with solid navigation connections (about 60% lower in this isolated
fixture). Renderer task duration only improved modestly; frame p95 was 22 ms
in both variants. This is not a claim of 60% lower whole-app or whole-Mac CPU.

A separate transient-CSS comparison in the **same actual owner renderer**
retained all 408 nodes and 236 connections. Four legacy/solid/solid/legacy
trials recorded frame p95 around 99–102 ms versus 39–40 ms. Worst gaps still
ranged from 221–520 ms with legacy dashes and 240–280 ms with solid paths.
Renderer CPU-time results were variable. Concurrent system/browser work and
unequal gesture durations make this exploratory evidence, not a universal
percentage benchmark. The temporary CSS, frame loop and DOM references were
removed; the owner graph/layout was not edited.

## Regression design

- The new navigation signal assertion fails against the previous production
  build. Small-canvas restoration, overview dashes, offscreen culling and
  selected controls are checked in production-browser tests.
- A native visibility observation after restart reported hidden terminal boxes
  as non-intersecting in that session. Therefore it did **not** reproduce stale
  positive intersections naturally. The deterministic regression explicitly
  forces positive intersection reports for both our controller and xterm,
  proving that our output policy independently refuses hidden DOM redraws.
  It fails against the old buffer and still requires live Shell file progress,
  ordered output and retained terminal identity after visibility returns.
- The loaded fixture retains 208 distinct 1024-pixel images, 188 long notes,
  three Portal surfaces and 727 relationships. It now also includes a
  236-connection hub drag, rather than only low-degree node chains.
- Unit tests check snapshot invalidation/retention, bounded output, focus,
  interrupted reveal, disposal and authoritative replay superseding queued
  output. Docs and tour catalog parity remain mandatory.

## Acceptance boundaries

Keep native raster results separate from whole-app measurements. Low CPU after
restarting alone does not prove the prolonged multi-core episode resolved.
Verify repeated gestures and post-gesture settling on the installed candidate,
preserve residual frame-gap observations, and do not disable tools, provider
processes, Portal grants or task supervision to obtain better CPU numbers.

## Verification

- 38 focused unit/catalog tests passed, including the hub snapshot and terminal
  buffer/replay regressions. No failures.
- Final production build and native Computer/message host postbuild succeeded.
- 19 production-browser tests passed with zero retries: bridge, tasks, Floors,
  Control Center, Portal SPA/responsive behavior, native Canvas delivery, cold
  model/effort restore and the dense/high-degree/terminal-paint cases. The final
  loaded-fixture maximum observed frame gap was 150 ms. That remains above a
  uniform 60-FPS frame budget; do not claim all jank eliminated.
- The arm64 candidate passed complete ad-hoc signature and microphone/automation
  entitlement checks on the main app and four helpers. The verified installer
  awaited copying, signature checks, canonical Core/API health and compact
  rollback verification before completing. No certificate or Keychain access.
- On the actual installed owner canvas, six empty-pane pans and six zoom-in/out
  pairs retained all 408 nodes and 236 connections. A bounded 640-frame sample
  recorded approximately **22 ms p95 and 60 ms maximum frame gaps**, with JS
  heap estimates **297 -> 286 MiB**. This is a short hardware sample, not proof
  of uniform 60 FPS or all prolonged-session failure modes.
- During that gesture window, renderer CPU peaked at **122.1% of one logical
  core's scale**, then returned mostly to **0.6–4.4%**, with a later **1.2%**
  snapshot and Core at **3.0%**. The prior sustained 480–630% episode was not
  reproduced in this bounded check. Concurrent unrelated processes still drove
  whole-Mac CPU to 100% at times; do not attribute that total to this renderer.
- Local version remains 0.42.0 (Unreleased). No public release, tag or push.
  Loopback debugging is removed before handoff. Regenerable unpacked package
  and test intermediates are removed; app data, projects, assets and one compact
  rollback are retained.
