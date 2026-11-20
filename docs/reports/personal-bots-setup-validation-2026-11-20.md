# Personal bots: setup fixes and installed validation

Date: 2026-11-20. Local preview: `0.55.0-beta.2`.
Branch: `feat/personal-bot-runtime`, based on `8962c747`.
This preview replaces `/Applications/Orkestrai.app` with an ad-hoc arm64 package;
it is not a public release. The owner's separate checkout remains untouched.

## Why the reported bot did not start

The failed owner message to **Teste**, at `12:44:32.243Z`, was persisted, but
Claude Code **2.1.325**, resolved by the installed app, rejected the SDK's
initialize-request MCP configuration. The SDK ended the process before sending
the prompt. The bot never had a model response to deliver. An earlier smoke
test used a different CLI version and missed this compatibility failure.

The driver now sends a secret-free MCP command/argument configuration through
the compatible argv mechanism. The existing authenticated environment is
inherited by the CLI and MCP child; bridge credentials are not serialized into
the command line. Tests check this distinction. Startup and turn failures now
mark the saved bot message and appear in the Bots conversation.

There was a separate reason a new diagnostic did not wake **Teste** after
installation: its selected **Claude bee** profile reported **99% weekly usage**,
above its configured **95% automatic-work limit**. The usage gate raised an
attention item. No profile, quota limit, or credential was changed to bypass it.
The original failed message was not silently replayed.

## Setup and interface changes

- Bound the automation modal to the viewport, with a fixed heading and a
  full-width, independently scrolling body. Verify small and large windows.
- Telegram and Slack buttons now open the existing secure integration setup
  directly. Show provider instructions, required read/reply permissions and
  conversation selection. Slack offers a public app manifest for download.
  A failed connection probe does not become a successful bot connection.
- Conversation discovery respects the integration's scope and permissions.
  Telegram discovery does not acknowledge updates or compete with a live reader.
- Explicit WhatsApp linking allows up to 120 seconds for secure-store unlock;
  ordinary background secret requests keep their five-second timeout. Missing
  keys and decryption/unlock failures remain distinct, so a failed unlock cannot
  replace a linked account's identity.
- Import available WhatsApp contact/group metadata, bounded to 1,000 entries per
  connection. Do not import historical messages. Display a searchable selector
  and retain manual chat-id entry when metadata is unavailable.
- Configure up to ten literal, case-sensitive leading commands per binding,
  such as `@Support` and `#Support`. New Bots forms suggest a bot-name prefix;
  existing bindings without prefixes retain their behavior. Check sender and
  prefix before attachment download and model dispatch.
- Expose discovery, the public Slack manifest and binding prefixes through the
  shared validated CLI/MCP contract. Update README, all three manuals,
  changelogs and onboarding tours.

## Verification

| Check | Result |
| --- | --- |
| Full unit/feature suite, two workers | 3,375 passed; 30 skipped; no failures |
| Final focused setup/contract tests | 64 passed |
| Final CLI and native vault tests | 14 passed |
| Production build | Passed, including Computer host and desktop messages |
| Changed-code type comparison | No errors in added files or changed lines; repository-wide pre-existing errors remain |
| Production browser tests, one worker, no retries | 10 passed: Bots, Conversation, terminal focus, external-channel integration |
| Actual installed Claude Code 2.1.325 SDK smoke | Exact receipt/final response in 11.645 seconds; no secret sentinel in transcript |
| Live unpaired WhatsApp handshake | QR generated in 846 ms; memory-only credentials, socket closed, no phone paired |
| Standalone packaged runtime outside the source tree | SDK, WhatsApp crypto, SQLite and a real PTY load successfully under Electron ABI 146 |
| Ad-hoc signature and entitlements | Validated in the app and all four Electron helpers |
| Installed Core and version | HTTP 200; `0.55.0-beta.2` |
| New application and code-graph backup pair | Read-only `PRAGMA quick_check`: both `ok` |

The first browser run caught a Cancel/reopen defect in guided setup. It was
fixed, rebuilt, and included in the successful final browser run.

### Real installed bot with MCP tools

After installation, create a temporary personal bot on the unchanged default
Claude profile, whose usage was below the configured gate. Send one read-only
request through the actual Bots conversation to call `mcp__orkestrai__bot_list`.

- Owner message persisted: `14:00:46.412Z`.
- Provider delivery receipt persisted: `14:00:51.197Z`.
- Final agent answer persisted and visible in the interface: `14:00:56.203Z`.
- End-to-end time: **9.791 seconds**.
- Provider transcript: `4ff83b96-4cfc-44ac-b544-d467cdfdee8d`.
- Transcript contains the actual `mcp__orkestrai__bot_list` call and a successful
  result containing both bot names. This is not a model-only greeting test.
- Remove the temporary bot through the application API and close the isolated
  browser after capturing evidence. Leave the owner's bot/account intact.

## Evidence and limits

Local evidence is under
`/private/tmp/orkestrai-bots-qa-20261119.noindex/`: test/build/package logs,
`installed-real-bot-tools-beta2.json`, `installed-bot-real-reply.png`,
`backup-verification-beta2.json`, and cleanup manifests. No credentials, QR
contents or linked-account keys are included in the report.

Telegram setup browser tests simulate the external provider and secure desktop
bridge. They do not prove a real Telegram or Slack account's permissions or
delivery. WhatsApp QR transport succeeded, but the owner's phone has not been
paired and actual phone-to-bot-to-phone delivery remains to be tested. Native
Windows/WSL hardware, a long-running soak and every provider tool were not
validated by these local macOS checks. A successful list tool is evidence for
authenticated MCP connectivity, not every Canvas operation.

## Disk hygiene

Remove verified, reproducible Superapp Git archives (4.42 GB), download/build
caches, the inactive re-downloadable OmniVoice cache (3.27 GB), and the redundant
951 MB old data-backup archive only after verifying the fresh paired backups.
Keep the new data/graph backups and the latest application rollback ZIP.
Remove packaging intermediates, temporary browser/test state and this
worktree's generated dependencies/build output after verification. Do not
remove owner projects, generated assets, Docker volumes, live databases,
provider profiles or the installed app's embedded voice models.

## Follow-up: editing an idle bot

The reported bot had an open native session with no active routine. Its saved
runtime configuration was `persistent`, the default Claude account and a 100%
usage limit at inspection time. These settings were preserved. New bots are
created in `on_demand` mode; WhatsApp does not require persistent mode.

Two service defects were confirmed: the update command required every live
session to end even for a display-name change, and execution edits reapplied
the creation defaults for runtime mode and limits. Display-name-only updates
now write only the title, retaining sessions and concurrent runtime state.
Execution edits still require sleep and preserve the selected mode, idle
timeout, concurrency and usage limit. The existing validated CLI/MCP update
command uses the same service.

The production browser test exposed a third defect: Superforms publishes a
whole form store when text changes, which restarted provider metadata reads and
could disable Save during the click. The editor now depends on a derived scalar
provider id, so changing a name does not refetch accounts/models. The browser
test checks an actual Save click after a native fixture response, unchanged
session/conversation payload and unchanged metadata-request count.

Focused verification: **96 tests passed**, including live native and terminal
renaming, execution-change rejection and runtime preservation. An initial
4 GiB heap-limited build exhausted that limit; the regular project build passed.
The browser diagnostic confirmed the metadata fix before the final source
build. Disposable bundle instrumentation was restored before that build.
The final standard production build passed, including the Computer host and
desktop messages. All **3 Bots browser tests passed in 7.9 seconds**, with no
retries. The **18 documentation/tour tests** passed after the final text edits.
The full type check still reports the existing 1,818 errors; none are in the
new or changed lines of this follow-up.
Results are recorded in the local `rename-*` QA logs.

This follow-up is source work and does **not** replace the installed app or
restart the owner's running sessions. The installed preview remains the build
from `24646910` until another local replacement.

For disk hygiene, the latest verified database/graph backup pair was compressed
into `~/Library/Caches/Orkestrai/data-rollback/before-bot-rename-20261120.zip`.
The archive includes both original filenames and a SHA-256 manifest. Verify ZIP
CRCs, file sizes and unchanged source identities before removing the raw copies:
2,764,300,288 bytes became 951,166,486 bytes. The backups are preserved.
