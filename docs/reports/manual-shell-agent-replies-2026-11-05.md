# Manual Shell agent replies — November 5, 2026

## Confirmed failure

An agent started manually inside a Shell retains a plain-Shell node payload and
PTY provider. `BridgeService.ask` consequently selected `askTerminal`. That path
stripped ANSI codes from raw output and accepted silence as completion. A Claude
screen redraw could therefore return `replyConfirmed: true` without a saved
answer. It also looked for transcripts in the Shell's original directory rather
than the manually launched CLI's current directory.

## Change

- Inspect a Shell only when an ask targets it, with bounded asynchronous process
  reads. On Unix, require ancestry and the owned foreground process group. On
  Windows, use the pinned node-pty console-list helper and CIM identities, requiring
  both console membership and ancestry. On configured WSL Shells, retain the guest
  shell PID across exec and inspect only that distribution and foreground tree.
- Match executable/Node launcher identity through provider adapters. Published
  Claude and Codex Node entrypoints are adapter metadata. Do not scan process
  arguments for a provider name in prompts or tool commands.
- Use the running CLI directory, retained profile storage roots and a unique
  message marker to obtain its exact structured reply. Keep the binding local to
  that request. Do not save a provider or resume conversation on the Shell node.
- An authenticated `orkestrai reply` resolves the original waiting caller through
  the existing inbox waiter. Return that answer, not a subsequent terminal
  acknowledgement, and do not queue a duplicate answer for the sender.
- Never retain or confirm screen output for a recognized agent. For transcript-capable providers, an unavailable
  or incomplete transcript produces a delivered but unconfirmed result, not a screen
  collage or a second automatically typed prompt. Ordinary Shell output still
  uses the existing command/output path.
- Recheck process identity before typing a queued prompt. Owner drafts remain
  protected. Queue checks are limited to one process inspection per second, with
  a fresh check when a writer slot is acquired.
- Workspace Shell launches now receive their own ephemeral bridge credential and
  authoritative node identity, plus the runtime-specific original workspace
  configuration path. Credentials remain private to the live PTY/environment and
  never enter the node payload, public session frames or transcript context.

## Verification

- Real PTY reproducer: start a plain Shell, change directory and launch a fake
  Claude without a provider account. It paints noisy ANSI output, then writes a
  completed structured answer. Only that answer may be returned; reasoning and
  terminal paint are excluded.
- Disabling detection makes this reproducer fail with precisely
  `reply: "RAW_SCREEN_GARBAGE thinking...", replyConfirmed: true`.
- Complete unit/feature suite, two workers: **3,095 passed, 19 skipped,
  zero failures**. After the explicit-reply integration, the three focused
  reply/bridge/terminal-delivery files passed **59 tests**. Node 24 also loads the production PTY transport with type
  stripping and resolves the pinned console-list helper.
- Production `npm run build`, including Computer host and desktop messages,
  completed successfully. The packaged-source smoke plus startup/docs/tour
  integrity checks passed **33 tests**. The smoke copies only manifest-listed
  sources and imports the real type-stripped PTY transport; excluding the new
  working-directory dependency makes it fail with module-not-found.
- Additional checks cover cancellation during asynchronous validation, missing
  transcripts, child exit while delivery waits
  behind an owner draft, node/workspace isolation, Windows executable and Node
  launcher names, detached/sibling console processes, configured WSL paths, and
  private bridge credentials across directory changes.
- The real PTY fixture also supports native Windows CMD. This Mac run validates
  macOS execution and Windows/WSL contracts; it does not claim a physical Windows
  or WSL execution. No real model account, owner work message or installed app is
  used by these tests.

## Boundaries

The detector does not guess a Linux identity when WSL is started ad hoc inside a
native CMD without a configured WSL runtime. That case now fails explicitly rather
than confirming host terminal output. A CLI using an account/root changed inside
its own shell must expose its matching saved conversation; missing proof cannot
fall back to a different account or an old answer. Remote SSH transcripts are not
part of this change.

This is a local source fix. Installation and publication are separate steps.
