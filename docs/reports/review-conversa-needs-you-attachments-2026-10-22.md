# Local branch review: Chat, Needs you and attachments

Date: 2026-10-22

> Historical findings for `6d59594f`, not the release decision for the final branch. All eight were corrected in subsequent commits; the follow-up report records final approval at `e7722d36`.

- Branch: `fix/conversa-needs-you-attachments` (local only).
- Base: `b879fd5d` (`main`).
- Reviewed head: `6d59594f`.
- Scope: all seven commits, 53 changed files, and the surrounding delivery, runtime, attachment and attention contracts.
- Decision: **changes requested; do not merge or release this head**.
- Production source was not modified. This report is the only added repository file. No commit, push, merge, tag, build, installation or app restart was performed for this review.

## Findings

### 1. [P1] Duplicate import prevents Focus from compiling

Location: `src/routes/terminal/+page.svelte:116-118`.

`agentStatus` is imported twice into the same instance script. Compiling the changed Svelte components directly with the installed `svelte/compiler` rejects this page with:

```text
js_parse_error: Identifier 'agentStatus' has already been declared
src/routes/terminal/+page.svelte:118
```

This is a build blocker, not a potential visual defect. Remove the duplicate import and compile the actual routes in verification; the service unit tests do not parse this page.

Regression: compile the changed Svelte components, then run the production build after the fixes. Do not treat a passing unit suite as a replacement for this gate.

### 2. [P1] Saving a Portal screenshot follows an existing filename symlink outside the workspace

Location: `src/lib/modules/agent-room/application/services/ManagedPortalService.ts:110-111`.

The directory is checked with `realpath`, but the final file is opened with ordinary `writeFile` and a predictable timestamp-only name. A preexisting symlink at that filename is followed, truncating and replacing its target even when the target is outside the workspace. The reproduced fixture put the workspace and the outside target in separate temporary directories: `keep.txt` became the PNG bytes.

The same naming rule also gives two captures the same path when their sanitized Portal titles and millisecond coincide; the second replaces the first screenshot. The name must identify a capture, not just its Portal and clock instant.

Use a genuinely unique filename and exclusive, no-overwrite creation; fail closed on symlinks and retain the directory confinement checks. Account for ancestor replacement races as appropriate to the existing filesystem confinement contract. Directory-only validation is not sufficient.

Regression: existing final-path symlink leaves its outside target unchanged; concurrent captures with equal titles and timestamps produce separate, intact files.

### 3. [P2] Attachment staging outlives its workspace or conversation

Locations: `src/lib/components/agent-room/composer-attachments.svelte.ts:31-44,105-107`; `src/routes/chat/+page.svelte:336-345`.

An upload captures the workspace id at its start, but unconditionally appends its result to the current `items` after it finishes. `clear()` neither invalidates pending work nor checks a generation. Starting an upload, changing conversation (which calls `clear()`), and finishing the upload repopulates the new conversation with the old draft's attachment. The workspace switch callback does not even clear existing staged attachments.

In another conversation of the same workspace this can send the file to the wrong agent. In another workspace the new send usually fails because that workspace does not contain the file. `remove()` then uses the new workspace id rather than the id that owns the upload. Abandoned uploaded files can also accumulate on disk.

Bind staged items and pending operations to a workspace/conversation draft identity. Invalidate or cancel old operations on a scope change, dispose their unconsumed uploads safely, and always remove files through their owning workspace. Do not delete attachments already owned by a sent message.

Regression: both already-uploaded and pending attachments across workspace/channel switches, including upload completion after `clear()` or unmount.

### 4. [P2] Concurrent uploads clear `busy` while another upload is still pending

Location: `src/lib/components/agent-room/composer-attachments.svelte.ts:34-48`.

Paste and drop can start another staging operation even while the paperclip is disabled. Each operation independently assigns `busy = false` in its `finally`. When upload A finishes before upload B, send becomes available although B is still uploading. The independent reproduction resolves only A and observes `busy === false` with B unresolved.

Serialize upload operations or track the number of pending operations per draft, with cancellation/generation handling. Keep send blocked until all uploads belonging to that draft have settled.

Regression: two overlapping pastes/drops, with one finishing or failing before the other; `busy` must remain true until the last pending upload settles.

### 5. [P2] A successful send clears newer attachments, and an in-flight attachment can be deleted

Locations: `src/routes/chat/+page.svelte:273-281,615-641`; `src/lib/components/agent-room/composer-attachments.svelte.ts:98-107`. The same send-and-clear pattern appears in CanvasComposer, OrchestratorCanvasNode, TerminalCanvasNode and AgentChatFace.

Sending snapshots the current attachments, but success clears the entire live list. Picking/pasting/dropping another attachment is still possible while the request is in flight. If that upload finishes before the request returns, success removes the new chip although that file was never submitted. The reproduction executes Chat's actual `send()` function with a delayed `post`: only `outgoing.png` is submitted, then `next-draft.png` is cleared too.

The remove controls also remain active during send. Removing a snapshotted attachment calls the delete endpoint, so a message being accepted can retain the path of a file that the UI just deleted.

Give submission its own attachment ownership/reservation: consume only the submitted ids on success and protect those files against deletion until the request settles. Alternatively freeze all attachment mutation for that submission, including paste, drop and remove, not only the send button. Preserve a genuine next draft and its files.

Regression: delayed send followed by adding a new attachment; delayed send followed by removing a submitted attachment; failed send preserves its files and retry state. Cover the shared contract in every composer.

### 6. [P2] File paths are selected for the workspace, not the receiving agent's runtime

Locations: `src/lib/modules/agent-room/application/services/ChannelService.ts:60-70,195,217`; `src/lib/modules/agent-room/interface/http/controllers/BridgeController.ts:1727-1729`; `packages/orkestrai-cli/src/portal-reference.js:10`.

`attachmentNote` chooses a Linux path solely from `workspace.wslWorkingDir`, once before the recipients are selected. It ignores each terminal's supported `executionRuntime` override. A native terminal in a WSL workspace therefore receives a Linux path; a WSL terminal in a native workspace receives the host path. One team post addressing native and WSL agents cannot be rendered correctly for both by this single shared note. The service reproduction confirms the native-in-WSL case.

Portal screenshots have the corresponding missing translation: the controller returns the host filesystem path from `savePortalScreenshot` without considering the authenticated actor's runtime. On Windows, a WSL agent receives a Windows/UNC absolute path. The relative-path alternative is insufficient for an agent whose cwd is a Floor, because the screenshot lives in the original workspace. This part is established by the return-path flow, not by running Windows on this Mac.

Resolve the actual receiving terminal's runtime and translate the saved file's canonical host path accordingly. Format attachment references per recipient, and format screenshot results for the authenticated actor while keeping the stored file and scope in the original workspace. Reuse the existing terminal/runtime resolution rules rather than infer runtime from the workspace alone.

Regression: native, default WSL, native-in-WSL, WSL-in-native, mixed recipients, alternate distributions, and Floors for both message attachments and screenshots.

### 7. [P2] A real owner question without preset choices is treated as a dismissible notice

Location: `src/lib/components/agent-room/NeedsYouList.svelte:69-77`.

The new fallback assumes that an item with no decision kind and no preset options has nothing to decide. A valid `owner_question` with a free-text answer satisfies exactly that condition (`attentionDecisionKind` returns null; `ownerQuestionOptions` returns an empty array). It receives Dismiss.

Dismiss only changes the attention item's status. It does not answer or withdraw the question, enqueue a reply, or clear the conversation's open-question count. The request disappears from Needs you while its underlying question remains unanswered. This is not equivalent to dismissing an informational delivery notice.

Classify the source explicitly: offer Dismiss only for informational notices, and direct free-text questions to their answer UI. If withdrawing a question is desired, implement a separate explicit operation with consistent question, attention and delivery state.

Regression: a free-text question remains actionable and cannot be silently resolved as a notice; a genuine delivery notice remains dismissible.

### 8. [P2] An unsuccessful Ctrl+V creates a phantom draft that blocks automatic delivery

Location: `src/lib/modules/agent-room/infrastructure/pty/PtySessionManager.ts:1297-1301`; related existing fallback in `src/lib/components/agent-room/TerminalNode.svelte:380-401`.

The new counter increments `humanComposerLength` for every Ctrl+V, treating the key as proof that an image chip was pasted. The terminal's existing Windows paste fallback sends that key whenever text paste returns false, including an empty clipboard. A key request is not proof that the CLI accepted an image: it may reject the paste without creating any draft.

The counter is never reconciled with a rejected paste. `drainDeliveryQueue` and `canAcceptAutomaticMessage` keep refusing work because `humanComposerLength > 0`, even after the terminal reports idle again. There is no idle timeout that clears it; only another human editing/submission/cancellation key changes it.

The independent PTY reproduction starts an isolated Node-based CLI fixture, waits for idle, sends Ctrl+V, and has the fixture report that its clipboard is empty while its composer stays empty. After idle returns, automatic delivery is still blocked. Ctrl+U clears the phantom count and restores eligibility. No real provider account or owner's terminal was used.

Track a real pasted attachment or reject an empty-image paste in the renderer before forwarding the key, and reconcile rejection/cancellation without erasing a genuine human draft. Do not solve this with a blind timeout that can type over an actual image chip.

Regression: successful image paste protects the draft; empty clipboard, failed paste and unsupported image paste leave an empty prompt eligible for delivery; cancellation releases the queue.

## Verification performed

- Focused tests: **57 passed**, including attention, channels, timeline, human composer input, screenshot persistence, PTY activity, usage routing, docs and tour integrity.
- Changed Svelte components: one rejected component, the Focus page identified in finding 1.
- Independent service/PTY reproductions: **4 confirmed** (outside-target overwrite, capture filename collision, wrong attachment runtime, phantom Ctrl+V draft).
- Independent UI-logic reproductions: confirmed pending upload crossing a cleared draft, premature `busy = false`, deletion of a snapshotted file, clearing a next-draft attachment by the actual Chat `send()`, and the free-text question's Dismiss branch.
- The UI-logic harness uses the real TypeScript source with dependency stubs and identity `$state` for Promise/ownership checks. It is **not** a browser/DOM acceptance test.
- Full unit/feature suite: **2,413 passed, 13 skipped; no failures** (304 files passed, 3 skipped), two workers, 296.61 seconds. This confirms the reported suite result, but does not negate the independent findings or compile the Focus route.
- `git diff --check main...HEAD`: passed.
- No production build, browser click-through, Windows hardware test, installation, or app restart performed. The previously reported Electron test was reviewed in source, not rerun as part of this review.

Reproduction files (outside the worktree):

```text
/tmp/orkestrai-review-20261022-Am6b4v/findings.test.ts
/tmp/orkestrai-review-20261022-Am6b4v/review.config.ts
/tmp/orkestrai-review-20261022-Am6b4v/ui-reproductions.cjs
```

Run from the repository:

```bash
node node_modules/vitest/vitest.mjs run --config /tmp/orkestrai-review-20261022-Am6b4v/review.config.ts
node /tmp/orkestrai-review-20261022-Am6b4v/ui-reproductions.cjs
```

The independent reproductions currently **assert the observed defects**, so passing means the defect was reproduced. Convert them to assertions of the correct behavior when adding permanent regression tests; do not interpret these passes as approval.

## Release gate after correction

1. Review the new commits against this pinned head, without reverting unrelated work.
2. Add regressions for the cases above and test all composer surfaces and runtime dimensions.
3. Run the full suite with bounded concurrency, compile/build the actual UI, then run relevant UI/Electron tests against an isolated production build.
4. Only after those gates pass, prepare merge and the release under the repository's release procedure. No release version or tag was created in this review.
