# Disk pressure investigation — October 22, 2026

## Measurements

- Before the release preparation: 7.8 GiB available on the APFS Data volume.
- A later reading fell to 316 MiB. The machine subsequently restarted while verification was pending; that test process did not finish.
- After the restart: 34 GiB available and zero swap allocated, versus 15 GiB of swap allocated (about 13.4 GiB used) beforehand.
- After the additional inactive-cache cleanup: about 35 GiB available. These readings are snapshots, not a guarantee that background work will not consume space again.
- The Docker Desktop sparse disk occupied about 40 GiB of physical storage. Docker reported 7.4 GB of images and 8.6 GB of volumes; these figures do not fully explain the sparse disk's allocation. Do not treat the difference as proven orphan data.
- Super App occupied about 9.9 GiB. Its `.orkestrai` directory used about 8.2 GiB: roughly 7.3 GiB in Floors and 0.9 GiB in artifacts. Four Floors each exceeded 1 GiB. These are active project data, not automatically disposable caches.
- No Time Machine local snapshot was listed by `tmutil listlocalsnapshots /`.

There is no before/after inventory for the owner's deleted 15 GB project. The measurements cannot establish the exact destination of all space reported missing since that deletion. APFS shared-container accounting and swap also make a simple Data-volume subtraction insufficient.

## Cleanup performed in this release preparation

- Docker's supported cache collector removed 206.2 MB of unused build cache and 12.22 MB of old dangling image content. No volumes, containers or running services were removed.
- Ran the pinned official Docker Desktop reclaim-space helper to trim already-free filesystem blocks. This is not evidence that all apparently unexplained Docker allocation can be reclaimed.
- Verified the npm cache; no forced deletion of active `npx` installations.
- Removed 964,512 KiB (about 942 MiB) of regenerable caches: Firefox's `cache2`, Opera's Cache/System Cache/Code Cache, and electron-builder's DMG tooling/download cache. The owner processes were not running, each exact directory resolved without a symlink, and `lsof` found no open files before deletion.

The small collector totals and the much larger increase in available space must not be conflated. The restart cleared the previous swap allocation; no swap file was manually deleted, and the release agent did not initiate a restart.

## Preserved

All browser profiles/history/cookies, databases, Docker volumes, agent sessions, creative assets, simulator data, Floor changes and installed apps were retained. The website release worktree shares dependencies through a symlink instead of duplicating `node_modules`.

## Follow-up boundaries

- Do not prune Docker volumes even when Docker labels them reclaimable: they may contain project databases.
- Do not remove Floors merely because they are large. Verify integration, uncommitted/untracked files and running processes first, through the normal Floor lifecycle.
- Do not remove `Docker.raw`, swap files or active provider sessions to produce a larger free-space number.
- Current screenshot retention covers app-owned captures from the current process only. Previous-session captures are intentionally not deleted automatically; a global retention guarantee is not implemented.
- Keep release builds and tests sequential, remove their generated trace/unpacked intermediates after verification, and remeasure available space at handoff.
