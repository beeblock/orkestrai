# Codex inbox stall and terminal cursor recovery — November 5, 2026

## Observed incident

In the owner's Superapp workspace, messages sent at 07:39 and 08:32 BRT remained queued with zero delivery attempts. The installed app was 0.51.2. The same turn-boundary defect was present in the current source; merely updating the version was insufficient.

The Core remained responsive during diagnosis: health took 27 ms and the workspace Control Center took 111 ms. The queued messages were not waiting for a general SQLite lock.

The leader's native Codex turn had already ended with a model-access/stream error the previous evening. Three background command completions arrived later, carrying that same closed turn's identity. The boundary parser treated structured work after a completion marker as a newly open turn. Consequently the leader appeared busy and the inbox kept waiting even though the CLI was idle.

At 11:24 BRT, reloading only the leader's PTY resumed its exact saved conversation. Both original messages were delivered at 11:24:37, followed by actual replies and tool execution. No replacement owner messages were submitted. By 11:49, nine leader posts had been recorded after recovery; these are communication evidence, not nine accepted project deliveries.

## Changes

- `AgentTranscript.parseLatestTurnBoundary` recognizes late Codex `item_completed` events from an exactly identified completed or aborted turn. Such receipts cannot reopen that turn. The closed-turn lookup includes the whole existing bounded snapshot, including records preceding a newer prompt. Unknown identities, genuine newer work and new turn starts remain conservative. Transcript reads remain bounded and asynchronous.
- `TerminalCanvasNode.persistCreatedSession` checks focus when its delayed animation frames actually execute. A selected terminal completing startup or recovery can focus an unclaimed Canvas frame, but cannot take the cursor from another terminal, composer, dialog or application. There is no repeating refocus timer.
- The local preview also includes the already tested Space-and-drag Canvas navigation change. It pans over grouped images without moving their nodes.

## Regression evidence

- The pre-fix Codex boundary reproduction fails on the incorrect busy state. Tests cover completion with an error, abortion, a truncated tail, newer prompts, unknown turn identities and a genuinely new turn.
- A real PTY and isolated SQLite inbox test includes a late completion from the previous turn. Disabling the closed-turn guard makes the next message stall again; restoring it delivers that message without duplicating the first prompt.
- The new browser regression holds one selected terminal's startup receipt while typing in another selected terminal. The old implementation loses focus; the fixed implementation retains both the cursor and subsequent input.
- A separate browser scenario retains the same terminal input element through real Canvas update notifications and a WebSocket reconnect, then verifies that an intentional switch to the composer is respected.
- Final focused suite: **119 tests passed**. A preceding broader run passed 160 focused tests; these overlap and are not additive.
- Final production browser suite: **7 tests passed**, covering the two focus scenarios, Space navigation in both themes and editing contexts, repeated dictation, and Escape delivery.
- Production build passed. Ad-hoc arm64 package signature and microphone/automation entitlements passed for the app and all four helpers. Packaged voice loaded its native runtime successfully.
- Isolated packaged startup passed: 405 JavaScript assets served correctly over HTTP, 152 migrations, legacy-row preservation, graph isolation, native PTY input and seven viewer reattachments. Its measured 1,544 ms startup is an isolated fixture result, not the owner's cold-boot timing.

## Local installation and follow-up

The verified **0.52.1 local preview** was installed in `/Applications/Orkestrai.app` with ad-hoc signing. There was no push, public release or certificate/Keychain operation.

After replacement, all nine Superapp terminals retained their saved conversation identities. The leader resumed its original conversation, its native transcript continued receiving new work, and the Control Center reported it working. The final inbox check found **zero pending owner messages** for that leader. Warm health samples were 16/1/0 ms and Settings samples were 1/0/0 ms.

The installer verified the replacement before compacting the previous app. Only the latest verified rollback ZIP remains outside Applications. Removing this run's dependencies, build output, test runtime, unpacked app and private npm cache reclaimed **3.49 GiB**, leaving **12.25 GiB** available at the final measurement. Workspace files, generated assets, provider conversations and owner databases were retained.

These observations establish recovery of communication and native execution for this incident. They do not establish completion or acceptance of the Superapp's remaining project tasks, nor do they substitute for a long-running performance measurement.
