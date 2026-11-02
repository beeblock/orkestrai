# Large-team dispatch and supervision stalls

## Report and evidence limits

The reported Windows team has one leader and 29 specialists. The supplied desktop log spans several months; its latest session starts Orkestrai 0.50.0 on Windows x64 on November 1. That session records refused connections to a local Portal and later connection resets, but no inbox state, supervisor timing, memory samples or CPU profile. Those Portal errors alone do not establish the cause of every agent pause or prove a CPU bottleneck.

Source review found independent, reproducible orchestration bottlenecks that affect a team of this size. Tests cover Claude and Codex transcripts with native and WSL lookup options. Physical WSL filesystem behavior and the reported remote machine still require validation; local fixtures do not claim to reproduce that machine's complete state.

## Confirmed defects and corrections

1. **Submitted messages monopolized all six writers.** A dispatcher slot remained held through transcript readiness checks and up to minutes of exact prompt confirmation. With six slow confirmations, only six of 30 recipients could receive input. Release each writer at the existing `onSubmitted` callback after Enter; continue confirmation independently without marking an unconfirmed message delivered. Keep per-agent serialization, six concurrent submissions and protection against retyping uncertain prompts.
2. **Readiness checks reserved writers before any input.** Six stalled readiness reads prevented all other 24 recipients from receiving. Prepare each recipient outside the shared submission limit so its slow read does not own a writer.
3. **Transcript caching thrashed above a small team.** The previous 16-entry prompt/reply cache could not retain 60 lookups for 30 agents: every unchanged sweep reread all 60 files. Turn-boundary checks added 30 unchanged reads per sweep. Retain revision-validated parsed results with LRU limits of 128 entries and 16 MiB of estimated key/result data per cache. Do not retain raw transcript tails. A changed inode, size, mtime or ctime invalidates the result; the boundary key includes process start time. Concurrent readers share an in-flight result, and large replies evict older results rather than growing memory without a bound.
4. **A temporary read failure became a durable missing receipt.** A null tail read was cached under the unchanged file revision, so subsequent confirmation attempts could remain null until the file changed. Do not retain failed reads; retry the same file without retyping the prompt.
5. **One persistent startup blocked the supervisor loop.** The heartbeat awaited each provider startup before reaching leader supervision or the remaining workspaces. Schedule a separate queue of four concurrent starts, prefer queued leaders, and deduplicate each node across heartbeats. Recheck the current workspace, node, persistent mode and live session before starting. Stop clears queued starts; later pauses and mode changes remain authoritative. Existing running starts are not killed.

6. **The framework queue health task called a nonexistent API.** The isolated Redis worker/scheduler smoke test reproduced `Queue.stats is not a function` in the five-minute task. Use the existing Svelar `JobMonitor.getCounts` aggregate API instead, without loading failed-job payloads. Three tests reproduced this failure before correction. This framework scheduler task is separate from the desktop agent supervisor; the supplied log does not prove that it caused the reported pauses.

## Diagnostics

During a drain older than 30 seconds or a timer delay above one second, emit at most one numeric health sample per minute. Desktop logs retain pending-recipient/drain/writer/watch counts, oldest-drain age, timer delay and RSS. The Electron receiver allowlists and bounds the numeric fields before persistence. No prompts, reply text, node/workspace identities, filesystem paths or credentials are included. A sample is evidence of timing and capacity, not a diagnosis that all long turns are defective.

## Regression evidence

Before the fixes, seven reproductions failed at their intended assertions: only six of 30 submissions, zero of 24 independent deliveries past stalled readiness, 60 unchanged prompt/reply reads per native/WSL sweep, 30 unchanged boundary reads per native/WSL sweep, and an unchanged file staying unread after a temporary failure. A separate supervisor reproduction failed because the leader check behind a stalled startup never ran.

After correction, focused tests verify delivery to all 30 recipients while six confirmations remain pending, progress for the other 24 while six readiness reads remain stalled, a six-writer ceiling, single release per writer, zero tail reads on unchanged 30-agent sweeps, file-revision invalidation, retry after a transient read failure, one shared read for concurrent lookups, bounded retention of large replies, at most four persistent startups, deduplication across ticks, and queued cancellation after stop, pause or mode changes. Existing transcript, turn-boundary, suspension and delivery tests remain part of verification.

Local verification passed 283 tests across 24 focused files, plus four additional Codex lookup cases and three queue-health regressions (290 distinct tests). Strict checking reported zero diagnostics in the changed TypeScript files; dependency diagnostics outside those files remain. Electron entry/filter syntax checks and documentation/tour parity checks passed. An isolated Redis worker started successfully; after migrating its disposable database, the real scheduler completed the corrected five-minute queue health task in 18 ms and dispatched due automations. No owner queues or databases were used.

Full production build, unit/feature and browser checks, including the actual Windows runner's transcript tests, are recorded on the fix PR's CI checks. No successful physical WSL or remote-desktop measurement is implied by those checks.

## Delivery boundary

This branch is based on the published 0.50.0 source. The separate Conversation leadership fix in draft PR #76 remains separate; a future release should integrate both changes. This task does not install or restart the owner's application, merge main, create a release tag, publish installers or deploy the website. The owner previously requested review before installation or release.
