# Conversation isolation after leadership transfer

## Finding

The report is reproducible in 0.50.0 (`77468d31`). A send started in the new
leader's direct conversation can appear as an owner message in the former
leader's conversation if the owner switches conversations before the HTTP
receipt arrives. `post()` appended that receipt to the current `messages`
array without checking the original workspace/channel. Its caller could also
clear a newly written draft. A failed history request could clear another
conversation, and an old send error could appear under the wrong composer.

A read-only inspection of the reported workspace found the recent owner
messages stored in the new Codex leader's direct channel with that agent as
their recipient. No owner data was changed. The reproduced fault concerns
the rendered conversation; changing delivery routing or moving historical
messages would have been inappropriate.

Separately, Chat did not subscribe to `workspaceChanged`. Its agent list,
default leader profile and team-composer labels could retain the previous
leader until a remount, even though server-side leadership was correct.

## Correction

- Capture the workspace, channel and view generation for sends, history and
  pending-question reads. Only that view may receive their UI updates.
- Change the generation on workspace/channel switches and unmount, including
  leaving and returning to the same channel. Preserve a newer identical draft.
- Keep successful sends committed to their original recipient, with their
  attachments, even if their receipt no longer belongs to the displayed view.
- Refresh agent metadata after structural/leadership events and reconnects;
  debounce these updates. Ordinary message/status events do not reload Canvas
  node payloads. Do not redirect an explicitly selected direct conversation.
- Ignore superseded node snapshots without discarding the initial routines
  and external-channel details still being fetched.

The change is confined to Conversation UI state. It does not change bridge
identity, routing, provider sessions, accounts, tasks or database schemas.

## Verification

`tests/e2e/chat-conversation-isolation.spec.ts` adds production-browser coverage:

| Scenario | Unmodified 0.50.0 |
| --- | --- |
| Codex receipt arrives while the former leader is selected | Wrong owner message rendered |
| Leave and return; type an identical new draft | New draft erased |
| Old send fails after switching conversations | Error rendered in the current conversation |
| Old history read fails after opening the successor | Successor history cleared |
| Transfer leadership while Chat remains mounted | Previous leader profile retained |
| Switch workspace during a send | New workspace draft erased |

All six were run against a copy of the installed, unmodified production build
and failed at the corresponding behavioral assertion. The additional seventh
test checks an out-of-order metadata snapshot, preservation of pending channel
details, and no Canvas node reload for ordinary incoming messages.

Local focused verification: 58 tests passed across channel delivery, timeline,
leadership, navigation and the three-language documentation/tour catalogs.
The modified Svelte component also compiled directly with zero warnings.

The complete local build was intentionally stopped by the disk/memory guard;
it did not fail on a compiler diagnostic. Full production build and browser
validation run in the draft PR's CI, avoiding more memory/swap pressure on the
owner's Mac. The checks attached to the fix commit record that final result.

## Delivery boundary

The owner explicitly requested **no local installation and no release** for
this change. The installed 0.50.0 application and its running agents are left
in place. No restart, package, release tag, website deployment or production
database mutation is part of this fix. A separate decision is required before
installing or publishing it.
