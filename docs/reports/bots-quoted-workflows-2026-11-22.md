# Bot request continuity and Canvas stages

## Contract

A human request retains its exact origin, quoted content, supplied files and return destination across bot execution and delegation. A reply acknowledgment is not delivery of the requested work. A configured sequence advances only after the current card passes the existing completion checks and its exact final answer is recorded.

The new sequence is opt-in for the owner and explicitly trusted senders. Public bot customers retain isolated workers and their pinned, bounded published actions; a message, quote, display name or claimed agent title cannot grant workspace control. Existing Canvas Telegram/Slack integrations retain their separate explicit configuration and exact-source reply behavior.

## Quoted messages and native output

- Parse one bounded quote from the triggering WhatsApp message. The outer sender, chat and prefix determine routing and authority. Quoted senders do not authenticate the caller.
- Preserve quoted text, image/PDF bytes and voice-note transcripts with the exact request. Check media hosts, redirects, byte limits and durations before storage. Store only allowlisted quote metadata in the conversation; media credentials remain in the existing encrypted transport state.
- An expired, missing or unreadable quote is explicit input. Do not silently substitute a generated image or claim to have read a missing file.
- Text, images and documents use a native reply to the triggering message in its original chat. Full bounded WhatsApp keys remain available for owner proofs and replies while preserving legacy deduplication identities.
- Convert emphasis and web links to WhatsApp formatting while preserving code. Native file delivery keeps realpath, policy, size, hash and exact-chat approval checks.

The owner already confirmed that the original generated portrait arrived as an image on beta.10. This change does not regenerate or resend that image. Quoted inputs and native text/image/PDF replies are additionally exercised through Zapo's local protocol server, without a paid model.

## References

`BotRequestContextService` resolves only a received request under the live terminal identity. Terminal delegates and multi-request native batches must pass the exact `sourceMessageId`; a claimed sender title cannot borrow another bot's files. Accepted requests retain their owned references after local history cleanup.

Delegation carries paths for the receiving runtime, including native/WSL overrides and Floors. `image_workflow_create` connects the actual supplied images, records their source and SHA-256 hashes, and blocks missing, changed or disconnected references. The native execution contract contains these paths in `referenced_image_paths`; it also uses the executor's runtime for outputs. This verifies the input contract, not subjective visual fidelity. No paid reference-generation experiment was performed for this fix.

## Durable sequence

In Edit bot → Advanced → Work sequence, choose a slash command, one acknowledgment and up to eight agents with stage-specific work and acceptance criteria. The ordinary bot remains available for other conversation.

The source message and run are stored together. Each stage creates a card and one fixed inbox identity atomically; it does not also dispatch a duplicate task prompt. The existing execution admission limits remain authoritative. A reply before card acceptance cannot close the stage. Restart recovery observes the saved card and receipt instead of typing the request again.

Stage failures and removed cards are reported rather than silently advancing. Definitively unaccepted failed/cancelled work releases its execution custody so another independent request can proceed. Stop remaining stages does not use Ctrl+C, undo accepted effects or commandeer owner typing. Local history cleanup withdraws a request before receipt; already accepted work can retain its references and finish.

Progress uses the existing live channel event contract. Idle receipt checks read indexed local state; secure owner grants are rechecked at side effects instead of polling Keychain while waiting. The Core supervisor starts after database preparation. Settings and stop operations use the same validated bot command through UI, CLI and MCP.

## Failure notices

Only fixed localized operational messages may bypass a model output review. They are bound to the persisted source, current binding scope, destination, bot and notice identity. Diagnostic text is classified locally and never copied into the outgoing body. Recovery creates at most one notice for the failed request. Revoking a route prevents its queued notice from being sent to another recipient.

## Compatibility and verification

The complete regression run exposed two older paths on this development branch that the focused bot tests did not exercise: legacy Canvas chat replies were being subjected to personal-bot-only approval, and eager inference imports re-entered the provider registry before its adapters initialized. The final implementation keeps those paths separate and loads inference-only helpers lazily. The closed-Canvas GC fixture now tests explicit unload while preserving the intentionally warm, bounded workspace cache.

Verification logs are retained outside the repository in the isolated QA directory. They include source contracts, actual SQLite/file transactions, native/WSL path cases, Zapo wire replies, bot/public separation, ordinary Conversation compatibility, two-tab production-browser history/progress checks and packaged native-dependency checks. Final results and installation evidence are recorded after those checks finish. macOS testing uses local ad-hoc signing; it does not establish release-signing or Windows/Linux hardware QA.

### Source validation

- Full unit/feature suite: 3,564 passed, 38 conditionally skipped, no failures (two workers).
- Final live-frame/supervisor/security/catalog regression selection: 57 passed, including final-answer recovery before/after persistence and explicit missing-input/output failures.
- Changed Svelte components compile and all 91 referenced translated labels exist in all three catalogs. The repository-wide type check retains pre-existing shared/UI errors; the newly introduced diagnostics were corrected, and the workflow service's final TypeScript check reports zero errors.
- Isolated Redis worker exited successfully with no jobs; the scheduler completed its due-automation ticks against a migrated disposable database. The disposable Redis container was removed.

Production-browser and packaged-install evidence follows in the local handoff report after completion; the source checks above do not claim Windows/Linux hardware testing or paid model/image quality validation.

### Production-browser findings before installation

The initial production run passed 13 existing scenarios and exposed a new editor defect: nested sequence field edits did not update Superforms before validation. The editor now publishes immutable updates for command, acknowledgment, agent selection and stage criteria. The short-window test closes the overlapping profile panel first and verifies the persisted fields. The new native worker fixture now launches the CLI executable and pins its isolated server URL; invoking the library entrypoint performed no command, and the fallback URL could not authenticate its test token. No model or owner credentials were used. The final browser run is recorded separately after rebuilding this correction.

A full-browser repetition exposed a second pre-installation defect: the selected-bot summary is replaced on live workspace refresh, so lifecycle effects tracking its ID getter reset route drafts even when the ID string was unchanged. Both WhatsApp and the Telegram/Slack setup panel now use an equality-checked primitive workspace/node scope; runtime display updates remain separate. Regression tests explicitly create independent Canvas updates while editing a route or after connecting Telegram.
