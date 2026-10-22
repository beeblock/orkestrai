# Follow-up review: Chat, Needs you and attachments

Date: 2026-10-22

> Final verification at `e7722d36`: the three findings below are closed in the reviewed source and independent regression checks. No new blocking finding was confirmed. See **Final verification — e7722d36** at the end; the original findings are retained as historical evidence for `3c357c14`.

- Branch: `fix/conversa-needs-you-attachments`, local only.
- Previous reviewed head: `6d59594f`.
- Follow-up head: `3c357c14`.
- Scope: all five new commits, 35 changed files, and their integration with the original branch changes.
- Decision: **changes requested; three remaining findings (one P1, two P2)**.
- No production source was modified. No merge, push, tag, build, installation or app restart was performed.

## R1. [P1] Screenshot retention can still delete files outside the workspace after a parent-directory exchange

Location: `src/lib/modules/agent-room/application/services/ManagedPortalService.ts:117-131`.

The exclusive create and random filename correctly fix the final-filename symlink and collision cases. The new parent `realpath` check also catches a directory exchange made before that check. However, the subsequent retention cleanup uses the pathname again: it lists every PNG in that directory, takes their ages, and deletes all but 40 without retaining a safe directory identity.

A directory can be exchanged immediately after the check returns and before `prunePortalScreenshots` uses it. If `.orkestrai/portal/screenshots` now points to an outside directory with 41 owner PNGs, retention deletes an unrelated owner image outside the workspace, and `savePortalScreenshot` returns success. `lstat` on each filename does not protect against links in its parent components.

Independent reproduction: actual temporary workspace/outside directories and files, with an intercepted `realpath` to force precisely that legal interleaving. The check reads the genuine directory; it is then renamed and replaced by a symlink before cleanup. The outside directory shrinks from 41 unrelated PNGs to 40. No owner's real files were used.

Required direction: make destructive retention use a directory identity that cannot be redirected between checking and deletion, and limit deletion to app-owned capture entries. If that guarantee cannot be provided by the current filesystem abstraction, fail closed or disable that unsafe automatic deletion path. Merely adding another pathname `realpath` before an unlink leaves the same check/use race.

Regression: exchange an ancestor after the final validation and during enumeration/deletion; no outside file may be written or deleted, and an invalidated capture must not be reported as successful.

## R2. [P2] Failed delivery turns an already-persisted message attachment back into a deletable draft

Locations: `src/lib/components/agent-room/composer-attachments.svelte.ts:157-179`; `src/lib/components/agent-room/canvas/CanvasComposer.svelte:13-23,255-269`; related persistence in `src/lib/modules/agent-room/application/services/ChannelService.ts:210-227`.

The new reservation protects a file while the HTTP request is in flight, but a file's ownership is still decided exclusively by the client's delivery-success check. `ChannelService.postOwner` persists the conversation message, including attachment metadata, before trying to enqueue it. If enqueue fails, the response still includes a saved message and `delivered: [{ ok: false }]`.

`sendToAgent` treats that response as failure. The composer releases the reservation, and a later conversation change, workspace change, field unmount, or Remove deletes the file as an unsent upload. The already-persisted conversation now contains a broken attachment. AgentChatFace follows the same delivery-failure decision. A lost HTTP response after successful server persistence creates the corresponding uncertain-result problem; the server delete operation currently does not check message references either.

Independent reproduction: real isolated Svelar SQLite persistence and real attachment/deletion services; only the inbox enqueue and browser upload transport are stubbed. Save succeeds, enqueue rejects with `database is locked`, the message remains in SQLite, then `release()` plus `reset()` deletes its actual PNG. The saved message still references that missing file.

Required direction: distinguish message persistence/attachment ownership from agent delivery. Once a message owns an attachment, client draft cleanup must not delete it. Protect that invariant on the server too, including concurrent save/delete and lost-response paths; a UI-only success check cannot safely resolve an uncertain request. Keep retryable drafts without deleting files already referenced by another persisted result.

Regression: save succeeds but enqueue fails; save succeeds but the response is lost; cleanup after a failed/uncertain send; concurrent save/delete. The saved message's attachment remains readable and a retry does not corrupt its history.

## R3. [P2] Buffered terminal input drops the image-paste marker on reattachment

Location: `src/lib/components/agent-room/TerminalNode.svelte:563-590`.

`forwardInput` correctly asks whether an image is present and sends `imagePaste: true` on the direct path. But when the terminal is not attached or its socket is unavailable, `sendTerminalInput` stores only `data` in `pendingInput: string[]`. `flushPendingInput` later replays the bytes without the marker.

Thus a confirmed image paste buffered while a terminal is opening or reconnecting reaches the CLI as Ctrl+V, but reaches the PTY draft counter as an unconfirmed paste. An automatic message can then be typed into that real image draft, recreating the original interference/unconfirmed-delivery problem. The new PTY test covers direct calls with the marker, not this actual renderer buffer path.

Independent reproduction executes the real TypeScript declarations of `sendTerminalInput`, `forwardInput` and `flushPendingInput`, with a successful image-presence check and `attached = false`. After reattachment the emitted frame is:

```json
{"type":"input","sessionId":"session","data":"\u0016"}
```

The required `imagePaste: true` was lost.

Required direction: buffer structured input entries containing their data and metadata; preserve both the marker and ordering through initial attach, disconnect/reconnect and flushing. Bound the buffer by data length without stripping metadata.

Regression: image paste before attach and during reconnect, followed by typing/Enter; the replayed frame retains its marker, and the backend keeps automatic messages behind a genuine draft until submission/cancellation.

## Verification

- **14 changed Svelte components and 3 changed rune modules compile** with the installed Svelte compiler. The original Focus build blocker is fixed at the parse/compile level. This was not a production bundle build.
- **70 focused unit/feature tests passed**, 11 files, two workers, 20-second test timeout, including all new regression files, screenshot/runtime/attention cases, relevant feature contracts, docs and tours.
- **Two independent service/filesystem reproductions confirm R1 and R2** with isolated temporary files; R2 uses the real test database and file deletion service.
- The independent renderer-logic reproduction confirms R3. It exercises actual extracted source with a mocked socket and clipboard predicate, not a browser/OS click-through.
- `git diff --check 6d59594f...HEAD`: passed.
- The reported full-suite result of **2,431 passing tests** was not rerun in this follow-up; targeted checks were used to avoid repeating the full machine load. Passing the full suite would not negate these independently reproduced cases.
- No Windows hardware, packaged Electron, production build or installed-app acceptance was claimed.

The direct fixes for the original eight findings are present, including exclusive final-file creation, draft generations/pending counters, send reservations, per-terminal runtime paths, free-text question routing and direct empty-clipboard handling. The remaining findings concern boundary/lifecycle cases those fixes do not yet cover.

## Reproduction files

Outside the worktree:

```text
/tmp/orkestrai-review-followup-5UPW4m/review.config.ts
/tmp/orkestrai-review-followup-5UPW4m/screenshot-race.test.ts
/tmp/orkestrai-review-followup-5UPW4m/delivery-files.test.ts
/tmp/orkestrai-review-followup-5UPW4m/ui-review.cjs
```

From the repository:

```bash
node node_modules/vitest/vitest.mjs run --config /tmp/orkestrai-review-followup-5UPW4m/review.config.ts
node /tmp/orkestrai-review-followup-5UPW4m/ui-review.cjs
```

These independent reproductions **assert the observed defects**, so their current passes confirm the defects rather than approve the branch. In permanent regression tests, assert the corrected behavior instead.

## Final verification — e7722d36

Reviewed commits, without rewriting earlier history:

- `751afe4b`: retain only current-process captures identified by name, device and inode; no directory enumeration for deletion.
- `76e7dc78`: distinguish a stored message from delivery success, protect attachments referenced by persisted message metadata on the server, and serialize ownership changes per workspace.
- `e7722d36`: retain the image-paste flag in structured buffered terminal input and replay through the same frame builder as direct input.

Result: **R1, R2 and R3 closed; no new blocking finding confirmed in this review.** This is source/review approval, not a claim that production packaging or every platform has been validated.

Independent checks rerun against this head with assertions of the correct behavior:

1. After 40 owned captures, force a directory exchange immediately after validation during the next capture. Preserve all outside owner PNGs, including a different file under the exact name of the oldest owned capture. Passed.
2. Persist a message with attachment metadata, fail enqueue, then request draft cleanup through the real deletion service. The real file remains and the SQLite message still references it. Passed.
3. Discard the successful post result to model a lost response, then clean up the caller's draft. The persisted message retains its real file. Passed.
4. Start deletion before the competing post. Deletion wins; the post fails before saving any message with a missing attachment. Passed.
5. Execute the actual renderer's input forwarding/flushing declarations with an image-paste check and text/Enter buffered before attach. Replay preserves data, `imagePaste: true`, and key order. Passed.

Verification performed in this final round:

- **77 focused unit/feature tests passed**, 13 files, two workers, 20-second test timeout.
- **tour-engine passed in isolation**: 1 test, one worker. This checks the test reported as failing on import under machine load; it does not independently prove the cause of that earlier timeout.
- **4 independent filesystem/SQLite tests passed**, plus the independent renderer input check above.
- **14 changed Svelte components and 3 changed rune modules compile** with the installed compiler.
- `git diff --check 3c357c14...HEAD`: passed.
- The full reported 2,437-test run was not repeated in this round. No production build, browser click-through, Windows hardware QA, installation, push, merge or tag was performed.

Final verification scripts are outside the worktree:

```bash
node node_modules/vitest/vitest.mjs run --config /tmp/orkestrai-review-final-XJiCzU/review.config.ts
node /tmp/orkestrai-review-final-XJiCzU/ui-review.cjs
```

Unlike the earlier defect reproductions, these final scripts **assert the corrected behavior**.

Known limitations, not represented as fixed by the checks above:

- Screenshot retention is bounded to the most recent 40 captures **of the current process/session**, per directory. Captures left by earlier app runs are not automatically removed, so total retained disk usage can exceed 40 files across restarts. The root changelog now qualifies that limit by session.
- The documented Node check/unlink window still exists. Cleanup is now restricted to app-recorded random names and matching file identities, rather than arbitrary directory contents. This is not a descriptor-anchored filesystem sandbox guarantee.
- A production build and relevant isolated UI/Electron acceptance tests remain required before treating the branch as ready to ship. No app restart, low-CPU claim or release completion is implied by this review.

## Local release verification — 0.44.0

The owner subsequently authorized integration, website publication and release. Local shipping gates completed on October 22:

- Full unit/feature suite: **2,438 passed, 13 skipped, zero failures**, two workers, 197.80 seconds.
- Focused collaboration/projection/release integrity checks: **59 passed**. Legacy conversation chronology now uses distinct fixture timestamps instead of assuming creation order for same-instant UUIDs.
- Production build, including the native Computer host and desktop message bundle: passed.
- Production-browser acceptance: **15 passed** across Chat, Focus, attachments, bridge, terminal/chat synchronization and Canvas performance. The quick-message attachment assertion checks a real staged chip/path rather than the obsolete path-in-input behavior.
- Dense Canvas case: 399 nodes, 727 edges, 208 decoded images and three Portals; largest sampled frame gap **267 ms**, below the existing 500 ms limit. This bounded run does not establish long-running memory/CPU behavior.
- Real Electron Portal regression: passed, including detached and never-mounted screenshots, protected-field masking and preservation of page/WebContents identity.
- Website: **42 tests passed** and production build passed; the three localized release entries match the app exactly.
- Updated DOMPurify 3.4.17, Electron 42.11.9, Vitest 4.1.12 and ip-address 10.7.4 after the release audit found newly reported advisories. `npm audit --audit-level=moderate` reports zero vulnerabilities; Electron remains ABI 146.
- Gitleaks found no secrets in the 15 reviewed commits or staged release changes.

The first browser attempt could not launch because the expected Playwright headless Chromium executable was absent. After installing that exact test browser without garbage-collecting other browser versions, all 15 browser tests passed. No installed Orkestrai restart or local installation was performed by this release preparation. CI, official signing/notarization and public artifact validation are separate subsequent gates; the local checks above do not claim their completion.
