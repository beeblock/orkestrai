# Terminal delivery regression — 2026-11-08

Baseline: published v0.52.7, `e858de939586b3d619b81a536f74ab7dc4bc3941`.

## Report and reproductions

The owner reports native Windows Codex 0.167.0 leaving leader/specialist messages as
`[Pasted Content]`. The new held-input notice also appears without owner typing;
manual Enter stops working, and following the Ctrl+C advice can clear the paste
or expose a missing PTY. These are unresolved production reports, not invalid user input.

Four new tests fail against the baseline ownership logic: SGR mouse press,
release and wheel events create a false deferred draft; a second viewer's cursor
reply does the same. Their presence prevents the standalone manual Enter path.
A separate test covers the existing manual Enter incrementing the human edit
revision: if this Enter is lost too, it disables subsequent recovery of the owned
paste. No transcript receipt is fabricated to resolve these failures.

## Changes

- Preserve xterm `onKey` provenance on its shared `onData` channel, through the
  WebSocket and reconnect buffer. Strictly allowlist complete terminal reports;
  do not accept printable text or bracketed owner pastes merely because the
  client labels them terminal-generated. Distinguish modified F3 from identical
  cursor-position reply bytes. Late and duplicate automatic replies and mouse
  reports never become held owner input.
- Keep manual Enter available for an otherwise empty held-input queue and retain
  evidence-based recovery if it too is lost. Count only the additional Enter
  bytes; never replay the body or accept an unrelated completed turn as receipt.
- Tag missing-session input/resize errors with the exact PTY id. Recover the
  currently displayed session once, including the freshly-created Canvas path
  that previously had no respawn callback. Ignore stale-session failures and
  discard old buffered input instead of retargeting it to a replacement.
- Remove blanket Ctrl+C recovery advice. An interrupt remains an interrupt;
  provider processes can clear their composer or exit in response.
- Reconcile a stored prompt after the PTY disappears, before resending its saved
  envelope. SQLite tests cover both leader-to-specialist and specialist-to-leader
  interruption and restoration, and an already-recorded receipt after removal.
- Include the new shared module in the desktop source manifest and exercise the
  production type-stripped PTY import, not just the bundled SSR copy.

## Verification and limits

- Final combined local run: 196 tests passed, including the real-browser Codex scenario, persisted inbox, ownership, transport, composer, package import and documentation contracts.
- Real Codex 0.167.0 on macOS, private loopback model endpoint, no owner accounts:
  Canvas and Conversation both passed; exact receipts, deliberately missed Enter,
  resize/replay and separate owner prompts were checked.
- Additional real-browser fixture: two actual xterm viewers, the production input
  binding and real Codex. Six exact automatic receipts, three deliberately lost
  Enter writes, a separate owner receipt and no mixed model input. Mouse and
  duplicate cursor events are exercised rather than assumed from headless xterm.
- New production-app browser case checks recovery after a freshly created PTY is
  removed and the next input returns the missing-session error.
- Native Windows checks now also run the browser fixture for pinned Codex
  0.166.0 and 0.167.0, in addition to the existing native ConPTY cases.

Native Windows CI [42506235665](https://github.com/beeblock/orkestrai/actions/runs/42506235665)
passed both official CLI versions, including the new real-browser case. Per
version: 126 recovery guard tests, four real-CLI cases and the additional browser
case passed. The browser case recorded six exact automatic receipts, three
recovered Enter writes, two cursor replies, two mouse reports, a physical key,
a separate owner receipt and no mixed model input. Canvas and Conversation also
passed with 7/6 exact receipts and 4/3 recovered Enter writes respectively.

The local production build reached its deliberately limited 4 GiB heap and
aborted; this is not a successful build. Compilation and full production-app
browser verification run on CI to avoid additional local memory/disk pressure.
Those remaining CI checks are pending at this commit. The owner's remote Windows workspace has not been
accessed. Passing macOS fixtures alone does not prove that workspace is fixed.
No owner app restart or installation was performed for this investigation.

QA outputs: `/private/tmp/orkestrai-delivery-recovery-qa-20261108.noindex`.
Read-only links reuse available dependencies locally to avoid duplicating several
GB; exact-lock native Windows verification uses a clean CI install. All test
homes, runtime discovery files, databases and provider configs are isolated.
