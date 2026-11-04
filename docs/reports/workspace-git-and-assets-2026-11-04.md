# Core responsiveness in large asset workspaces

## Report and scope

On published 0.51.2, the owner reports that a Windows Unity workspace still makes Core unavailable and terminals reconnect, after removing 20 Floors and disabling Code Intelligence. The main checkout has about 6 GB of assets/builds/tests and the Git directory itself is about 3 GB. Settings fails with HTTP 500; the visible log contains a failed dynamic UI-module import.

There is no direct access to that Windows machine. A module-download failure does not establish a database corruption or a Core process crash. The previous Windows log predates 0.51.2 and cannot establish the current call stack. The size of `.git` alone does not prove which operation stalled.

## Confirmed source defects and reproductions

1. Canvas Git badges, file-tree nodes and diff nodes poll the full Git status service. The service calculates a content revision by calling `git hash-object` for every modified/untracked working file, or resolving every staged blob. Its `Promise.all` starts all these commands together. Three display consumers can repeat this work concurrently.
2. Git process launch still uses synchronous PATH/registry/filesystem preparation in these paths, although terminal startup already has an asynchronous equivalent.
3. The shared filesystem service synchronously lists/stats directories and reads entire binary assets. HTTP previews copy that buffer again into a Response. These operations run independently of Code Intelligence.
4. If ripgrep fails or times out, filename search can fall back to a synchronous recursive traversal without a time or entry budget. A no-match search is the worst case.

Four feature reproductions failed on unmodified 0.51.2: 80 asset hash commands for a display read; three concurrent status traversals for three display reads; synchronous project I/O; synchronous traversal after a missing search binary. Evidence: `before.log` in the task QA directory. This establishes defects in the shipped code, not an observed Windows CPU profile.

## Correction

- `statusSummary()` returns the same change metadata without a content revision. Canvas display consumers opt into this projection through `git/status?summary=1`; concurrent summary reads share in-flight work. No cached completed result hides new edits.
- Full `status()`, reviews, operation previews and execution guards retain exact content fingerprints. Fingerprinting uses two workers, preserving output order and detecting content edits even when porcelain status is unchanged. A shared four-slot queue bounds GitService/FloorOverview subprocesses across callers.
- GitService and FloorOverview use asynchronous environment/PATH preparation for native and WSL launches.
- Filesystem listing/read/write/delete operations use asynchronous I/O. Directory listing has two metadata workers per request, rather than thousands of simultaneous stats. Canonical-path locks serialize writes/deletes of the same file across service instances/workspace aliases, release after errors and leave independent files usable; creating a previously absent file does not change its lock identity. Empty HTTP assets return an already-closed stream, including when the file grows after its initial size check.
- HTTP asset responses use file streams and byte-based 64 KiB backpressure. Cancellation closes the file. Internal operations that actually need a complete image buffer reject files above 64 MiB; ordinary streamed previews/downloads have no such size cap.
- Missing-ripgrep fallback scans are asynchronous, stop scheduling work after a 2.5-second/20,000-entry budget, and skip symlinks. A timed-out/overflowing search does not initiate a second traversal. Unity-generated root caches and nested runtime worktrees stay outside normal search; authored Assets/Packages remain available. No project files are deleted or rewritten by these changes.
- The production HTTP boundary records slow/failed operation classes, including HTTP 500 UI-module downloads before SvelteKit hooks. It logs no URL, filesystem path, body, header, token or exception text; output is rate-limited. A healthy streaming transfer is not labeled stalled merely because its total duration is long.

## Validation and limits

The regression suite covers display/full-revision separation, shared polls, bounded workers, native/WSL launch construction, asynchronous file operations, Core health while a filesystem operation waits, missing-runtime searches, timeout behavior, Unity cache boundaries, stream bytes/backpressure/cancellation, and diagnostic privacy. Native Windows CI includes the new service regressions.

The production-browser scenario uses 1,010 asset/source files and 50 GiB of sparse asset capacity on APFS/Linux, with Code Intelligence disabled. It polls three Git consumers, lists files, requests Core health and PTY WebSocket heartbeats repeatedly, creates/deletes a Canvas note, begins/cancels an asset download, and navigates to Settings. Windows uses a smaller physical fixture to avoid machine-specific NTFS allocation behavior.

Sparse capacity tests whether the app unnecessarily opens/hashes/buffers file contents. It does not measure a real 50 GiB transfer, a 3 GiB Git object database, Windows antivirus/network-storage latency or the owner's exact failing workspace. Full indexing, diffs and explicit exact-content reviews still scale with the work requested. Large-workspace correctness requires responsiveness of unrelated Core operations rather than a promise of constant-time complete scans.

## Final local verification

- Full suite with two workers and an isolated home: **3,029 passed, 18 skipped, zero failures**, 263.11 seconds, including same-file write/delete serialization and the empty-stream guard. An earlier run set a custom `CODEX_HOME`, changing tracker selection and invalidating seven tests that mock the default tracker; the final run leaves provider overrides unset inside the isolated home. No owner provider configuration is used.
- Standard production build, including Computer/desktop-message postbuild: **passed**. The build had its own process group and a 3 GiB free-space stop guard; it did not run alongside Vitest or browser tests.
- Production-browser tests on the final build: **4/4 passed**, 11.23 seconds (large assets with live PTY WebSocket heartbeats, Canvas deletion consistency, dirty Monaco buffers, Markdown/image/PDF previews).
- Independent `agent-browser` check: Settings rendered, its navigation was available, and the page-error log was empty.
- No installer, app restart, push or release was performed for this correction. Native Windows execution of the new CI gate and the owner's actual workspace remain to be confirmed.

Last controlled 50 GiB run on this Mac, with a new fixture and the production server already started:

| Operation | Samples | Median | p95 | Maximum |
| --- | ---: | ---: | ---: | ---: |
| Core HTTP health | 20 | 5.23 ms | 20.52 ms | 25.48 ms |
| PTY WebSocket ping/pong | 20 | 2.53 ms | 17.61 ms | 19.22 ms |
| Batch of three concurrent Git display reads | 5 | 119.95 ms | 165.16 ms | 165.16 ms |

All health requests returned the same PID; no WebSocket heartbeat timed out. The earlier timing-only run observed a 47.71 ms maximum HTTP health response, illustrating normal sample variation. These are local latency samples, not a Windows benchmark or a long-running memory-leak test.

Evidence is retained in `/private/tmp/orkestrai-filesystem-qa-20261104/`: the before/focused/full-suite/build logs, production browser log and JSON report, raw timing samples, and Settings snapshot/error log. Reproducible dependencies, build outputs, profiles and test databases are removed after review to recover disk space.
