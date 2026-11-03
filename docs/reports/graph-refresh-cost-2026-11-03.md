# Graph refresh cost and project source exclusions

## Observed evidence

- Read-only inspection of the installed Mac graph on November 3: 2,201,677,824 bytes (2.05 GiB).
- Superapp revision 1148 recorded 11,279 files, 190,918 symbols and 834,813 relationships. Its recorded duration was 40,378 ms, including 32,665 ms in persistence, with four changed files. This is a historical measurement, not a new end-to-end benchmark.
- The incremental affected-edge query selected a revision-leading index. Both the combined file/null query and the null-only query exceeded a 2-second read-only measurement budget and were interrupted. Looking up four actual file IDs through the file index returned 85 relationships in approximately 1–3 ms. These timings describe this query only.
- The owner reproduced the Windows problem with Code Intelligence disabled on **0.49.1**, not the newly published 0.51.1. The owner subsequently found about 59.9 GB under the game's `.orkestrai/floors`. Neither finding proves that this graph query caused the Windows Core stalls.

## Correction

SQLite selected an index starting with `revision_id` and then examined the entire revision to filter by `site_file_id`. Use SQLite's documented unary-plus exclusion on the UUID-text revision term so the existing file index drives the bounded lookup. The revision equality remains mandatory for fileless relationships. Subsequent batches contain only their actual file predicates: a constant `0 OR ...` would prevent the desired index access.

The existing production index is reused. No migration, database copy, index deletion or new runtime is required. Stored history, investigations and annotations remain intact.

Both scanner and watcher now recognize Unity through `ProjectSettings/ProjectVersion.txt` and exclude only generated root directories: Library, Temp, obj, Logs and UserSettings. Authored Assets/Packages, nested source folders with those names, non-Unity repositories and explicitly approved Floor roots retain their existing behavior. This does not add C# parsing.

## Verification

- Before the query correction, both new SQLite query-plan regressions failed on the actual access-path assertion. They now pass and also check cross-workspace/fileless-edge preservation, stable symbol identities and more than 400 rebound callers across batches.
- Before the Unity correction, both new scanner/watcher reproductions failed. They now pass, including real watcher readiness and a subsequent authored-source edit.
- Windows/POSIX path-policy tests cover separators, casing and preservation of similarly named authored directories.
- Focused graph, actual worker/storage-isolation, SQLite transaction and documentation/tour suites: 83 passed, 1 skipped.
- Full production verification is recorded separately before handoff. No new full-index speed claim or Windows recovery claim follows from the bounded query measurement.

## References

- [SQLite query-plan controls and unary plus](https://www.sqlite.org/lang_indexedby.html)
- [Unity default project directories](https://docs.unity.com/en-us/engine/6000.5/manual/get-started/project-configuration/default-directories)

## Remaining investigation

Measure the released app against the owner's Windows project and identify the contents and tracking/ignore state of the accumulated Floors. Disabling Code Intelligence does not disable other workspace provisioning, file access or Git operations. Never delete `.orkestrai` wholesale or treat its user artifacts as a disposable graph cache.
