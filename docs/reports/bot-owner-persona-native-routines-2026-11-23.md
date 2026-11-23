# Owner bot persona and native chat schedules — 2026-11-23

Local preview: 0.55.0-beta.12. No public release or push.

## Reproduced causes

The reported WhatsApp request was authenticated as an owner command. Its stored metadata carried an owner proof, owner intent and a reviewed owner reply. Enabling Computer was not the missing authorization.

The owner structured driver received the private preset instructions but omitted the public conversational role and approved factual reference information. The user’s Jarvis persona was saved in the latter role. Public customers saw that role, while the owner could receive the default personal-assistant style.

The existing agent-authored schedule contract required a live assigned task for its entire lifetime and dispatched a prompt without a native return route. A bot asked to send an hourly result could therefore choose the unrelated Computer companion route and report its missing proactive-send grant.

## Changes

- Resolve the current private restrictions, conversational role/personality, factual reference information and native protocol before every owner turn. Recreate the driver only when these instructions change; retain the provider’s exact saved conversation callback. Public isolated workers never load private owner instructions.
- Treat voice transcription as ordinary input. Explicitly direct concise answers in the configured style, without an unsolicited transcription preface or a repetition of the request. This is model guidance, not a guarantee of subjective persona fidelity.
- Clarify both fields in all three UI languages. Reference information means business facts such as hours, products and FAQ; it is neither an authorization switch nor automatic memory.
- Extend the existing automation CLI/MCP contract with optional `sourceMessageId` and `definition.delivery: current_chat | none`. Ordinary Canvas agents retain their active assigned-task requirement. Only a personal bot handling an authenticated owner/trusted source can create the native chat variant without a setup card.
- Reuse the durable routine runner, inbox and native external outbox. Fix the destination to the verified original source/binding, use the run ID for the ask and final output, and preserve results across worker recovery without starting the model or sending twice.
- Validate workspace state, bot identity, current source authorization, routine revision and cancellation before execution and publication. Pause/re-enable invalidates old occurrences. A scheduled occurrence cannot recursively create new routines. Uncertain WhatsApp delivery remains uncertain rather than being blindly resent.
- Keep configured gates, pauses and revoked sender access binding. Native WhatsApp scheduling requires no Computer or desktop-input grant. The host must be awake with Orkestrai, the provider account and connection available.

## Verification

The focused feature/contract tests use isolated SQLite, actual owner HMAC verification, the existing inbox/routine/outbox services, and a fake native WhatsApp socket. They cover concurrent saves, single delivery and worker recovery, revoked phone control, paused output, stale occurrence revisions, UI interval edits, forged proofs, recursive authoring and ordinary-agent task requirements. Driver tests cover Claude/Codex instruction refresh with session preservation and public/private isolation. CLI and MCP tests preserve exact source identity and the optional-task contract.

Full suite, production browser checks and packaged validation are recorded in the local QA handoff after execution. The actual configured bot and a future real hourly WhatsApp delivery require owner verification after installing; automated tests do not prove a provider’s subjective tone or an external phone receipt.
