# Adventure endgame and storage — October 30, 2026

## Scope and local installation

The owner requested installing the latest prepared preview before changing the
Adventure, then fixing Torment progression, opening the existing boss-chest
backlog, and transferring the bag/stash in bulk before publication.

The existing 0.50.0 preview (`5bc1d8fb`) was packaged with ad-hoc signing, installed
with the verified local installer, and opened successfully. The first boot backed
up the original database and moved code-graph storage to its private database.
The primary database decreased from about 3.9 GiB to 0.5 GiB; the separate graph
was about 3.26 GiB. The latest verified rollback ZIP remains outside Applications.
No provider credentials, workspace files or game saves were edited manually.

## Findings and changes

### Torment and Paragon

`advancePosition` explicitly returned `null` after Torment 5-10. Consequently,
`finishWave` left an advancing party on the Kraken forever. Paragon itself was
already implemented in `addXp`: heroes reach level 100, then earn endless Paragon
levels worth +1% attack and life each. Read-only inspection found the strongest
heroes at level 84, with Torment cleared; no hero had reached 100. The owner
confirmed keeping the existing level-100 prerequisite.

After the final Torment boss, auto-advance now restarts Torment at 1-1. Clears,
levels, equipment and XP remain intact. Disabling auto-advance still intentionally
farms the selected stage. The strip announces the circuit and the Camp map
explains the level-100 Paragon prerequisite. This adds no separate Paragon map,
forced level changes or altered XP multipliers. Existing stuck parties move on
after the next credited clear.

### Boss keys and the existing backlog

Soulstones previously came only from random chest contents. Repeat red chests
needed a soulstone, so the item needed to open the chest depended on opening
other chests. Read-only inspection confirmed 34 red chests and no soulstones.

Every credited act-boss kill now grants a soulstone directly for that difficulty,
including when bag/chest storage is full. Report deduplication covers this reward.
Existing same-or-harder key selection remains unchanged.

A one-time save upgrade calculates the keys needed to open all saved red chests,
subtracting existing compatible keys and first-free chests. Harder requirements
are budgeted first. It credits only the shortage and persists the recovery version
in the same transaction. Repeated reads, concurrent requests and reloads cannot
repeat the credit. New saves start with recovery already complete. The recovery
neither opens/discards chests nor rewrites the owner's game data outside the
normal repository transaction; ordinary auto-open still respects bag capacity.

### Bulk storage

The shared `move-all` action accepts destination `inventory` or `stash`. It moves
unworn items from the opposite container up to the available capacity in one save
transaction, returns `moved` and `remaining`, preserves item identity and locks,
and leaves equipped gear and overflow in place. UI filters do not limit the action.

Camp buttons, native HTTP, CLI and MCP use the same schema and service dispatch.
Existing actor identity checks remain: the leader manages shared guild storage;
specialists manage only their own heroes. No Computer permission is required.

Examples:

```sh
orkestrai adventure act '{"type":"move-all","location":"stash"}'
orkestrai adventure act '{"type":"move-all","location":"inventory"}'
```

### Loot capacity found during review

Opening previously reserved four slots regardless of chest type. Hell/Torment
boss chests can contain five items with a unique; small chests needed fewer slots.
Reservation now follows the maximum loot count of each chest, including rune
bonuses and the optional unique. An oversized chest remains unopened with its key
intact, while a smaller chest can still use the remaining room.

## Verification

- Full unit/feature suite: 2,839 passed, 18 intentionally skipped, no failures or
  unhandled errors (two workers, isolated test home/data).
- All three changed Svelte components compile. Svelte-check adds no diagnostics
  compared with the preceding preview; existing repository diagnostics remain.
- Website: 42 tests passed and production build passed.
- Tests cover Torment advancement on/off, XP/Paragon persistence, missing-key
  recovery for 34 old chests including four first-free chests, existing harder
  keys, concurrent save recovery, full bags, report retries, maximum chest loot,
  overflow, locked/equipped gear, concurrent bulk calls, and CLI/MCP contracts.
- The initial full run exposed a test environment pinned to one Codex directory;
  provider fixtures pass when that default follows each fixture's isolated HOME.
  It also exposed a genuine unhandled relay socket error. Commit `418ba0a2` fixes
  that separately; both new relay regressions failed before the fix and pass after,
  along with the received-access tests. No unexpected socket errors are suppressed
  by the test runner.
- Production-browser checks, final desktop build and the updated RPG preview
  installation are pending. They must pass before declaring the work ready.

## Disk hygiene

The packaging staging directory and unpacked intermediate were removed after the
first verified handoff. Regenerable npm/Go caches were cleared. The newest complete
startup backup was compressed with restricted permissions and its decompressed
SHA-256 checked against the original before removing the uncompressed duplicate:
4,015,505,408 bytes became 2,708,565,497 bytes, saving 1,306,939,911 bytes. It remains
at `<userData>/database.db.bak-2026-10-30T20-39-40-051Z.gz`; decompress to a separate
file for any future recovery. The live database/WAL, owner projects, volumes,
provider credentials and unique models were preserved.

## Documentation and publication

Root changelog, all three app catalogs, Adventure use case/tour, README, bridge
instructions and the three local website release catalogs are updated together.
Version remains the prepared minor release 0.50.0. No push, tag, publication or
website deployment is performed by this change.
