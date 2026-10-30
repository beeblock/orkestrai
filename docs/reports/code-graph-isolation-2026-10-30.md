# Code graph isolation and delivery latency — 2026-10-30

Status: 0.50.0 prepared locally on `fix/code-graph-message-latency` in an isolated checkout. The owner's running app and active agents have not been replaced or restarted by this work.

## Diagnosis

The production graph and conversations shared the same synchronous SQLite connection and transaction gate. An incremental publication retagged every file, symbol and relationship, even when almost nothing changed. Compression of the entire historical graph also happened inside publication. A measured revision took 342,779 ms, including 338,584 ms of persistence, with zero changed files and 10,198 parser cache hits.

The reported owner message was persisted at 14:41:33.858 UTC and delivered at 14:41:35.098 UTC. Its actual inbox delay was approximately 1.2 seconds. The long wait occurred before persistence, consistent with the shared database/event-loop obstruction; no recent SQLITE_BUSY/FULL/ENOSPC was found in that interval. Standalone read-only metadata queries were fast while the HTTP process stalled.

The source graph also exceeded the previous automatic semantic graph cap of 40,000 symbols. It had over 164,000 symbols and 712,000 relationships. Thirty full historical manifests occupied approximately 2.1 GB for this workspace alone.

## Implementation

- Private worker-thread transport for the existing Svelar graph models, backed by `<database>.code-graph.sqlite`. Conversations retain the primary database. Transaction gates are scoped to their connections.
- Separate interactive reader and analysis workers. Committed graph reads remain available during publication. First-time agent queries return `graph_preparing` promptly; semantic preparation returns `semantic_preparing`. Agents can continue with bounded file/name search.
- Context source excerpts use bounded reads and must match the indexed file hash and logical revision; changed/oversized files are omitted while graph reads remain usable.
- Physical graph rows keep their storage revision across incremental publications. Public DTOs expose the logical published revision. Per-file resolution hashes also detect changed bindings in unchanged source files.
- FTS top-k candidates are scoped before metadata joins. Indexed rowid refresh/deletion avoids scanning the unindexed FTS identity column. Startup verifies/rebuilds this derived mapping after compact backups renumber implicit rowids.
- Persistent parser cache: 128 MiB compressed across workspaces, content/configuration keyed; corrupt entries are reparsed. Runtime parse references and project persistence caches are bounded.
- Paged semantic preparation removes the 40,000-symbol restriction. A compressed search accelerator stores normalized fields, vector norms and vectors; sparse query dot products preserve exhaustive scores. It is bounded to 128 MiB decoded and 64 MiB compressed across workspaces. Eviction/corruption falls back to the authoritative paged embeddings. Completion markers are revision keyed, avoiding a full join/count for every unchanged status poll.
- New revision manifests share unchanged content-addressed chunks. Legacy manifests remain readable through bounded streaming; retained legacy history is not discarded to make the migration appear smaller.
- Superseded snapshots are retired in small batches; graph free pages are reclaimed incrementally. Low disk space pauses new derived data writes. Structural and semantic automatic failures back off rather than immediately retrying; explicit recovery remains available. A committed primary deletion outbox authorizes graph-workspace cleanup; mere absence from a restored primary database does not authorize deleting investigations.
- Startup copies only allowlisted graph tables, verifies counts/references/integrity and primary identity, then retires the old primary graph rows. Source data is preserved on failure and Core can still open conversations. Migration backups include matching primary and graph files before older backups are pruned. Missing/mismatched graph files are preserved for recovery rather than replaced with an empty graph.
- `Usage and performance`, `orkestrai graph metrics`, and MCP `code_graph_metrics` expose actual graph queries by agents/owner, latency buckets, failures, estimated context returned, index duration and shared graph storage size. Counters are best-effort, retain 30 days, and contain no prompts, query text, source bodies or credentials. They are not billing records and do not prove token savings or historical use before this update.
- Agent instructions document preparation/freshness and lexical fallback without requiring extra metrics/status calls for every task. CLI warnings only accompany refreshing/outdated observations; their revision list is observed at request start. Individual result revisions remain authoritative.

## Production-size service benchmark

The harness reads explicitly authorized graph metadata from the real source database, copies it into a private synthetic workspace, mirrors indexed source files read-only, and runs the actual production indexing engine. It uses the real owner-message/channel and durable inbox repositories; only live provider dispatch is withheld. It does not modify the source workspace or open a provider session.

Final measured source: 10,206 files, 164,774 symbols, 712,402 relationships. The synthetic probe and source parsing produced 10,207 files, 164,782 symbols and 712,423 relationships.

| Measurement | Result |
| --- | ---: |
| Name searches during real indexing | 1,530 |
| Search p50 / p95 / maximum | 14.26 / 50.29 / 463.60 ms |
| Durable owner messages during indexing | 380 |
| Message persistence p50 / p95 / maximum | 2.62 / 9.05 / 175.82 ms |
| Cold parser-cache real update | 53.38 s |
| Second real edit with parser cache | 26.96 s |
| Second edit cache hits / misses | 10,206 / 1 |
| Parser cache on disk | 29,185,471 bytes |
| First complete semantic preparation | 106.95 s, in the background worker |
| First intent search after preparation | 469.93 ms |
| Subsequent intent search | 70.46 ms |

The intermediate intent query took 22.71 seconds before the compact accelerator; it was not accepted as a completed optimization. An earlier trial also hit the worker heap limit, and another exposed an unbounded native DELETE. Bounded caches/object reuse and batched retirement corrected those paths before the passing large-data run.

These are isolated service measurements on a busy machine, not GUI delivery receipts, universal latency guarantees or a one-day memory soak. The benchmark asserts p95 name searches below 100 ms and durable message persistence below 200 ms. Maximum latencies are reported separately. Worker V8 heap limits are not total process RSS limits. Background scanning/resolution and the first semantic preparation still take time; they no longer reserve the conversation connection. The benchmark's process-memory snapshot is not a peak or a long-running leak measurement.

Reproduce with `ORKESTRAI_GRAPH_BENCH_SOURCE`, `ORKESTRAI_GRAPH_BENCH_WORKSPACE`, optional `ORKESTRAI_GRAPH_BENCH_RESULT`, then `vitest run --config vitest.graph-runtime.config.ts`. The source is opened read-only and the private database/source mirror is deleted after the run.

## Embedded engine decision

A separate experiment used `@ladybugdb/core` 0.22.1 on the same scale: import completed in about 4.8 seconds with a 512 MiB buffer; a 256 MiB buffer failed. The process used approximately 593 MiB RSS. Simple `CONTAINS` queries took about 1–23 ms, but they are not equivalent to scoped, ranked FTS results and do not establish an apples-to-apples advantage. The local macOS ARM binary added about 21.7 MB before packaging.

The measured delivery problem was process/transaction coupling and unnecessary rewrites. The corrected existing SQLite path meets the concurrent read/message targets without adding another native engine or user-managed service. The worker build adds about 1.3 MB of JavaScript, including parser dependencies needed after development dependencies are pruned.

References: [SQLite VACUUM and rowid behavior](https://www.sqlite.org/lang_vacuum.html), [LadybugDB](https://docs.ladybugdb.com/), [Graphify](https://github.com/Graphify-Labs/graphify). Graphify is a Python analysis tool, not a drop-in storage replacement.

## Verification

- Full unit/feature suite: 2,815 passed, 18 skipped, no failures (two workers).
- Follow-up storage/backup/cache/CLI/docs regressions: 135 passed. Release-specific follow-up: 128 passed, one optional native fixture skipped. Final context/source-integrity group: 60 passed, one optional native fixture skipped.
- Production build and postbuild passed with the project default 12 GiB heap. Attempts with reduced 6/8 GiB heaps ran out of build memory; these were verification builds, not the runtime heap limits.
- Native worker smoke passed using the installed Electron binary as Node without opening or restarting the app: Electron 42.11.18 / Node 24.19.0 / ABI 146, two synthetic files indexed, semantic preparation ready. Dependencies came from the installed production app, not the development checkout.
- Production Playwright: four bridge tests passed; both code-graph UI tests passed, including live counter updates and light/dark screenshots reviewed visually. The initial UI harness looked for a header control inside the body region and timed out; that locator was corrected and the metrics scenario split into its own test without raising timeouts.
- Full type-check comparison: base 1,754 errors, branch 1,746 errors; no file increased its diagnostic count. Existing repository type errors remain, so this is not a clean type-check claim.
- Companion site: 41 unit checks and the production build passed with the 0.50.0 catalogs and updated operational guide in all three languages.
- Dependency gate `npm audit --audit-level=moderate` passed; the registry reported 12 low-severity advisories. Dependency versions were not changed by this work.
- No release, push or owner-app installation is included in this verification status.

## Installed footprint observed (read-only)

The currently installed app has about 274 MiB of Electron frameworks, 84 MiB of compiled application output and 827 MiB of production dependencies. The optional local voice directory uses about 973 MiB outside the app. The largest dependency directories include Monaco (101 MiB), Cua (62 MiB), OCR runtime (43 MiB), Bruno (38 MiB), Azure dependencies (36 MiB), PDF runtime (34 MiB) and the native voice binding (33 MiB). This explains substantial existing size independently of a graph engine. This change does not add another engine/runtime/model download; it does not claim those existing components have been removed or that the current installed app is smaller.

Completed comparison/profile databases, native benchmark dependencies and private source-metadata CSV fixtures (approximately 443 MiB) were removed after their result JSON was retained. Other user workspaces, active volumes, voice models, provider profiles and the latest recoverable backup were preserved.
