# Canvas return and prompt preservation — issue #73

Issue: https://github.com/beeblock/orkestrai/issues/73

## Reproduction and cause

The relevant Canvas route and composer source were unchanged between v0.49.1
(the reported version) and the pending 0.50.0 baseline.

Two failures were reproduced against that baseline production build:

- Type a prompt, open a blank native Design, close the editor, switch to Chat,
  and return to Canvas: the prompt becomes empty. The text existed only in the
  composer component, which navigation destroys.
- Open a blank Design and use browser Back: navigation leaves the board rather
  than dismissing the focused editor. The baseline reproduction returned to the
  previous browser entry. Focused Design had no shallow history entry.

Opening and closing the editor with its own Back to Canvas button preserved all
four agent nodes in both the API and the DOM. No deletion of stored agents was
observed. The navigation fix prevents the reproduced route departure; it is not
evidence of an additional database-deletion bug.

## Correction

- Give focused Design a SvelteKit shallow-history entry. Browser Back dismisses
  the editor without unmounting the board. Direct `design=1` links retain their
  original startup behavior rather than adding another entry during boot.
- Retain unsent Canvas prompt text per workspace in this tab's session storage,
  capped at 20 persisted drafts and 200,000 characters per draft. Save after
  typing settles and flush on view departure/pagehide. Unavailable/full storage
  does not prevent editing or sending.
- Share current draft state across component remounts so a pending send cannot
  be submitted twice through a fresh composer. A revision marker lets a stored
  send clear only the draft it captured, including when the owner changes and
  then restores the same text while that request is in flight.
- Keep each send tied to its original workspace. A delayed acknowledgement does
  not clear another workspace's draft. Only stored messages accept the draft;
  failed storage leaves it available.
- Preserve existing unsent-attachment ownership and cleanup rules. This fix
  retains prompt text; it does not persist staged files across route changes.
- No provider credentials are read by this path. No background task sends the
  saved text, and no new timer polls the server.

## Validation

- Focused unit tests: 28 passed (drafts, attachment ownership, docs and tours).
- Website content integrity: 9 passed; all three 0.50.0 catalogs include the fix.
- Both changed Svelte components and the rune module compile independently.
- Full unit/feature suite: 2,843 passed, 18 skipped, no failures.
- Production Vite compilation completed (18m 5s). The initial single-process
  command exhausted its 12 GiB Node heap during adapter-node bundling. Finished
  that adapter's exact installed Rollup stage in a fresh process using its
  already-generated entries/manifest and unchanged Vite output; normal npm
  postbuild passed. No compiled application code was patched.
- Production browser regressions: 12 passed (3 new navigation/acknowledgement
  cases plus 7 native Design and 2 composer/navigation tests).
- Full type check: no new diagnostics relative to the existing baseline
  (1,789 errors/warnings combined). The pre-existing diagnostics remain.
- Website build and full suite: passed, 42 tests.
- Browser platform variants exercise shared UI logic for Win32, Linux and Mac;
  these are not native Windows/Linux hardware tests.

## Release handling

The correction is intended for the pending 0.50.0 release. Keep issue #73 open
until that release is published, as explicitly requested by the owner. Commits
must use `Refs #73`, not an automatic issue-closing keyword.
