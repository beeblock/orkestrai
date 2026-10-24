# Desktop stability investigation — October 24, 2026

## Repeated Portal screenshots

The native Electron reproduction failed on the second offscreen screenshot with
saved Canvas geometry: the first capture used a cached frame, and the second
timed out after 5,005 ms. A detached WebContentsView had no live compositor.

Full screenshots now always use a hidden live capture host. Its surface is
serialized across Portals; capture does not open, focus, reload or replace the
page. Existing grants, pauses, navigation checks and protected-field masking
remain in force. Lightweight movement previews retain their separate path.

`scripts/test-portal-capture-lifecycle.cjs` validates 32 real PNG captures across
never-mounted, mounted, offscreen, moving and detached states, plus concurrent
Portals. It changes the DOM and checks both image freshness and masked pixels.
The original code fails this reproduction; the correction passes. The existing
native Portal privacy fixture and 56 focused tests also passed.

## Terminal backpressure and Canvas navigation

Retained histories bypassed paint eligibility and entered xterm's asynchronous
parser without acknowledgements. Invisible terminals also periodically flushed
their queues. The baseline Electron reproduction accumulated 10,100,792 parser
characters while hidden; its assertion fails before showing any terminal.

The viewer now bounds pending output to 524,288 UTF-16 code units and 2,048 chunks.
Parser writes are at most 32,768 code units, one per terminal at a time, with two writes admitted per
animation frame across all terminal views. Output for hidden or covered views
stops at the server while PTYs continue running. Showing a view restores the
current retained PTY snapshot. A slow socket is disconnected at a 4 MiB buffered
output limit without killing its agent. Hidden views no longer resize PTYs.

Warm Canvas navigation also waited for unrelated workspace-list and settings
requests before using its cached board. Cached boards now paint while the normal
server load and identity checks continue. Late work from an unmounted page cannot
overwrite the new selection.

The production SPA test passed 36 Chat/Canvas switches with eight busy PTYs and a
deliberate three-second workspace-list delay. Maximum first paint was 1,599 ms;
keyboard responses stayed within two seconds and all session ids were preserved.
GC-collected heaps at rounds 12/24/36 were 83,153,764 / 80,085,448 / 74,566,908
bytes. A separate 205-node, 601-edge test measured keyboard latency of 69–171 ms;
the 50-reopen test preserved state and input, including stale PTY-id recovery.

The native terminal fixture passed 168 mounts with 206 MB of synthetic output,
zero hidden DOM writes and maximum first paint of 283 ms. GC-collected heap after
disposing terminals changed from 3,351,344 to 3,848,380 bytes.

## Retained graphs and shutdown notices

The global anchor cache retained node arrays and callbacks from closed Canvases.
It now uses weak references while preserving its four-snapshot bound. Workspace snapshots have a four-entry LRU bound and expired
entries are removed on access or insertion. The real-Node GC fixture proves
release of cyclic Canvas callbacks, edges and an expired workspace snapshot.

Intentional PTY shutdown is recorded as a disconnect and carries that distinction
to native notifications. Unexpected nonzero exits still report failures.

## Limits of this evidence

These accelerated fixtures establish bounds and collection for the reproduced
paths. They do not establish that every source of memory growth is eliminated,
nor replace a 24-hour run of the complete installed app. The installed bundle
was verified as 0.44.1, with production provenance pointing to
`91b3af3a75d7486dc89ce7c56906a0e681f47c2c`; the earlier 0.44.0 reference was
inaccurate. These tests did not replace or restart that app, and its current
memory is not evidence that a long-running leak has been fixed.
