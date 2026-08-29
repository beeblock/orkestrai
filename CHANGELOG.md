# Orkestrai Changelog

All notable changes to Orkestrai are documented here in English, from newest to
oldest. Public GitHub Release notes are generated directly from the matching
version section in this file. In-app and website changelogs provide equivalent
pt-BR, English, and Spanish translations.

## 0.22.0 - 2026-08-28

### Added

- Native Image Generation nodes combine a written prompt with connected Note
  context, ordered Image references, and a connected live Codex executor in the
  same canvas graph. The same workflow opens in Workbench; generated files stay
  inside a chosen workspace folder and return as connected Image nodes that can
  feed the next branch.
- A live Codex connected to the workflow executes its authenticated built-in
  `image_gen.imagegen` tool. Prompt-only generation and up to five ordered
  PNG/JPEG/WebP references are supported for one to ten requested PNG outputs;
  each result is generated independently and may receive bounded corrective
  edits when server-side validation rejects its alpha channel.
- Every run records bounded history and provenance, including the exact context,
  references, assigned Codex executor, prompt, input hash, output paths, and
  duration. Completion validates the exact preallocated workspace paths before
  materializing any Image node; cancellation invalidates the active run.
- Connected Codex agents have full typed control over the same visible workflow:
  create and configure drafts without running them, attach, remove, or reorder
  Notes and Image references, claim execution, generate up to ten outputs,
  complete, cancel, or delete the flow. CLI, MCP, the guided use case, Canvas,
  and Workbench operate one persisted graph rather than parallel automation state.
- The guided creative use case now proves the complete chain instead of stopping
  at a sample node: it creates one Codex Creative Director, reusable character
  and campaign briefs, a real sample-logo PNG, and sequential Character, Brand,
  and Carousel workflows. Each step waits for validated Image outputs and wires
  the selected result into the next stage automatically.
- The workflow states in the UI that an authenticated Codex account or plan
  with ImageGen access is required, while no OpenAI API key is needed.

### Fixed

- Transparent image workflows now enforce one canonical RGBA/alpha contract from
  the node toggle, validate decoded PNG pixels server-side, and automatically
  correct an opaque or fake-checkerboard output up to three times before giving
  up. Background correction is another native `image_gen.imagegen` edit using
  only the rejected output as reference; Python, Pillow, ImageMagick, ffmpeg,
  remove-bg, generated masks, and local pixel manipulation are forbidden. The
  validator explicitly identifies a baked checkerboard as opaque pixels and
  escalates the native cutout prompt after another failed alpha check instead
  of repeating the same ambiguous edit. Transparent workflows with multiple
  image references first compose the requested foreground on a uniform white
  matte, then pass that result alone to a second native ImageGen background-removal
  edit before alpha validation. Each
  output is validated independently through the typed bridge, completed
  runs cannot materialize fake transparency, and abandoned executions have a
  bounded timeout instead of leaving the guided use case waiting indefinitely.
- Packaged macOS startup restores the executable bit on node-pty's extracted
  spawn helper, so dependency installation or archive metadata cannot leave
  every terminal unable to launch.
- Codex terminals created interactively from Canvas now receive the current
  packaged Orkestrai MCP as an ephemeral launch override before any `resume`
  subcommand. A valid but stale global Codex MCP entry can no longer hide new
  tools such as `image_workflow_*`; native and WSL sessions remain isolated and
  user-owned `config.toml` files stay untouched.
- Packaged builds now retain the complete WebADB runtime dependency closure.
  Loading the shared Bridge controller for image workflows can no longer fail
  with a missing `@yume-chan/struct` module before generation starts.
- An unavailable Portal retries with bounded exponential backoff and exposes a
  visible manual Retry action instead of calling Electron every three seconds
  indefinitely and flooding the desktop log.
- Stale task-column requests made while a workspace is being removed now return
  a stable not-found response instead of racing default-column insertion into a
  deleted workspace and producing a SQLite foreign-key error.
- Windows PTY cleanup now handles the expected race where a ConPTY shell exits
  before `AttachConsole`, avoiding repeated helper stacks without switching to
  the slower experimental bundled ConPTY DLL.
- The desktop server exposes a minimal `/health` response for local diagnostics
  and health probes instead of recording a noisy not-found error.
- Desktop diagnostics no longer record expected Portal availability or page-script
  outcomes as internal failures. Portal evaluation errors return bounded structured
  results, PCM capture uses `AudioWorkletNode`, Electron uses the current console
  event contract, the updater disables the unused web installer explicitly, and inert
  Svelte derivations were removed.
- A newly created or recovered agent terminal no longer falls back to
  provider-wide shortcuts such as `resume --last` or `--continue`. It resumes
  only the exact conversation already attributed to that canvas node; without
  a confirmed ID, it starts a clean conversation so agents sharing a workspace
  cannot inherit one another's context.

### Security

- Orkestrai never requests, receives, stores, or logs an image API key and does
  not call an image provider endpoint directly. Image generation access belongs
  to the authenticated Codex session. Only the connected live Codex can claim
  and complete its run; reference files, exact output paths, file signatures,
  sizes, and public error values are validated and bounded before persistence.

## 0.21.2 - 2026-08-27

### Fixed

- `Ctrl+V` in Windows terminals now pastes native clipboard text into xterm
  instead of forwarding the control character to agent CLIs, where Codex and
  other tools could misinterpret it as an image-paste request. When the
  clipboard has no text, the original control character is preserved so CLI
  image paste remains available.

## 0.21.1 - 2026-08-26

### Fixed

- Unloading a workspace now persists a suspended state, clears its live PTYs,
  stops task-driven session creation and background automation enqueueing, and
  leaves it idle across navigation and app restarts. Only explicitly opening
  that workspace resumes it.
- Internal CLI or server child invocations that reach Electron's Windows
  single-instance handler no longer restore or focus the Orkestrai window.
  Normal app launches, tray actions, menu actions, notification clicks, and
  collaboration links keep their existing foreground behavior.

## 0.21.0 - 2026-08-26

### Added

- Roles can now be discovered from any folder, not only the workspace's own
  working directory: a new "Discover from another folder..." button next to
  the existing repository discovery opens a native folder picker and imports
  any `role.json` found under `.orkestrai/roles/` there, so a role built in
  one project can be reused from an unrelated one without copying files by
  hand.
- Imported role files are bounded and validated before persistence, stay inside
  the selected project, and never overwrite an existing workspace role.
- The "New agent" dialog now has a Profile field for providers with
  multi-account Provider Profiles configured, so a specific account can be
  chosen right when the agent is created instead of switching it afterward
  from the terminal's context menu.
- Profile references are validated against the selected provider before a
  terminal is persisted, while credential values remain in secure storage and
  enter only the spawned process environment.
- The "New workspace" dialog now has a Folder field, so a workspace can be
  filed into an existing sidebar folder right when it's created instead of
  dragging it there afterward. A plus icon on each folder's header also
  opens the dialog with that folder already selected as the destination.
- Regular and preset-based workspaces are persisted directly in the validated
  destination folder, so a failed move can no longer leave a partially filed
  workspace at the sidebar root.

### Fixed

- Switching only a terminal's Provider Profile now shows a profile-specific
  confirmation instead of claiming the provider changed. The focused terminal
  view also sends the selected profile to the backend instead of dropping it.
- Usage panels no longer crash from duplicate Svelte keys when a provider has
  multiple profiles. Rows use the unique routing id and display the profile
  name so accounts remain distinguishable.
- Installing an update on Windows and Linux now runs silently after the user
  confirms the restart, then relaunches the updated app without exposing the
  installer wizard.

- Side panels such as the Attention Center no longer open underneath the
  Windows title bar's minimize, maximize, and close buttons. They now start
  below that 36px strip instead of the very top of the window, matching
  where the rest of the app's content already begins.
- The terminal theme submenu now scrolls inside its own height limit instead
  of overflowing past the bottom of the screen.
- Interactive native buttons and role-based controls now use a pointer cursor,
  while disabled controls retain their non-interactive cursor.

## 0.20.1 - 2026-08-25

### Fixed

- Codex agents now receive the Orkestrai and official Figma MCP definitions as
  ephemeral launch overrides on native and WSL runtimes. Orkestrai no longer
  rewrites the user's global `~/.codex/config.toml` during workspace
  provisioning.
- Config files corrupted by Orkestrai 0.20.0 or earlier are repaired only when
  they match the exact orphaned multiline `args` and duplicate inline `env`
  signature. The original is backed up, the repaired TOML is validated, and the
  replacement is serialized and atomic; unrelated malformed TOML is never
  modified.
- Workspace provisioning no longer hides user-owned `AGENTS.md`, MCP files, or
  `opencode.json` through `.git/info/exclude`. Existing exact legacy exclude
  blocks are narrowed to Orkestrai-owned runtime and skill directories, and
  provisioning failures are recorded in desktop diagnostics instead of being
  silently discarded.

## 0.20.0 - 2026-08-25

### Added

- Workspaces can explicitly authorize sibling repositories with safe aliases.
  Agents can now import, edit, synchronize, and export Bruno, OpenCollection,
  and Postman collections through paths such as `@api-tests/bruno`, while
  absolute paths, unregistered parent directories, and symlink escapes remain
  blocked.
- Manually added MCP servers and installed skills now propagate to every
  provider's native config format (Cursor, Cline, Devin, Antigravity, and
  OpenCode), not just the Claude/Kimi `.mcp.json` file, so a server or skill
  added to a workspace actually reaches whichever provider that workspace is
  configured to run. The MCP sections in Provider Center and the Skills page
  now use the official Model Context Protocol mark instead of a generic icon.
- The Skills marketplace now opens with a curated catalog and merges it with
  live search results instead of issuing a fake default search.
- Settings now previews terminal colors, font, and padding, shows OS-specific
  shortcut modifiers, and includes Monokai, Ayu Dark, Rosé Pine, and Solarized
  Light, bringing the terminal theme total to 15.
- Workspaces can now be organized into persistent nested folders in the Canvas
  sidebar. Drag workspaces or folders to reorganize them, create subfolders,
  rename or collapse them, and delete folders without deleting their contents.
- Portal now has a real responsive-device viewport with presets, custom
  dimensions, orientation rotation, and contained scrolling without scaling
  or distorting the embedded page.

### Fixed

- Workspace creation remains compatible with callers that omit the new optional
  additional-repository list, treating it as empty instead of interrupting
  provisioning.
- `orkestrai list` now applies the terminal's automatic agent identity and
  inventories every workspace Portal with an explicit connection state. Portal
  names are visible and editable in the Canvas, automation accepts a unique
  name or node id, repeated URLs reuse the existing node, and creating an
  additional Portal requires explicit intent. The Portal address bar and its
  surrounding rail now use the active app theme instead of conflicting fixed
  dark and white surfaces.
- Installed desktop builds expose Developer Tools again and add a direct Help
  action for the rotating local diagnostics folder. Renderer errors, internal
  server failures, and unexpected exits are captured with bounded retention and
  common credentials redacted, while normal agent output is not persisted.
- Portal responsive mode now keeps its controls in a dedicated toolbar instead
  of placing them beneath the embedded page, uses a searchable portaled device
  selector plus exact-size controls, and scrolls oversized viewports without
  clipping their top or left edges.
- Canvas agent/provider and toolbar icons now use the shared provider registry,
  consistent interaction states, and correct light-theme contrast.
- Terminal click-and-drag selection now maps to the correct characters at any
  Canvas zoom while retaining native word/line selection and mouse tracking.
- Provider Profile Usage now resolves non-default Claude credentials from the
  config-specific macOS Keychain entry.
- MCP fan-out preserves malformed provider files and aborts without partial
  writes, while skill registry results and downloads are bounded and validated
  before reaching the UI or filesystem.
- Workbench file-loading placeholders now expose valid status semantics to
  assistive technologies.
- Deleting the active workspace now switches to a valid remaining workspace
  route after terminating its PTYs instead of leaving the desktop window on a
  stale workspace and node URL.

## 0.19.0 - 2026-08-24

### Added

- Added GitHub Copilot as an agent provider, provider-specific marks on Canvas
  agent nodes, named multi-account Provider Profiles with profile-aware usage
  routing, live public provider status in Provider Center, and the Obsidian
  terminal theme.

### Fixed

- Provider Profile credentials are no longer serialized into terminal canvas
  payloads. Only the profile id and non-secret paths are persisted; credentials
  are resolved server-side at PTY spawn time, secure-store writes are verified,
  profiles in use cannot be deleted, and unsupported Devin API keys are no
  longer presented as interactive CLI account profiles.
- Provider Profile names are unique case-insensitively at the database layer,
  legacy name collisions migrate deterministically, routing preserves full UUID
  profile ids, profile validation uses stable localized errors, and unavailable
  public status checks are shown as unknown instead of falsely operational.
- The PTY WebSocket now accepts browser connections only from the Orkestrai
  server's exact port, including equivalent localhost loopback spellings. A
  different local web service can no longer open or control terminal sessions.
- The Usage and routing node now opens at a useful default size, keeps Leader
  routing above provider details, adapts its policy fields to narrow widths,
  and provides contained mouse, trackpad, touch, and keyboard scrolling for
  both new and previously saved small nodes.

## 0.18.1 - 2026-08-24

### Fixed

- Shells and agent terminals no longer inherit the Orkestrai server's
  `APP_KEY` or other private Svelar runtime variables. Project `.env` files
  remain authoritative, preventing Laravel encrypted records, cookies, and
  sessions from failing with `The MAC is invalid` while user-owned system
  variables and the Orkestrai bridge remain available.
- Portal links that open a new window now stay inside a sandboxed Orkestrai
  Portal window instead of escaping to the system browser. Pop-ups share the
  persistent Portal session, cookies and web storage are flushed to disk, and
  the main Portal restores its last navigated URL after restarting the app.
- Dictation now captures raw PCM from the selected input through the same Web
  Audio path as the live meter, avoiding silent MediaRecorder files on macOS
  and other Electron/device combinations. Quiet speech is normalized locally,
  and a microphone that opens without producing signal gets a specific error.
- Remounting the Canvas after visiting Settings no longer leaves the xterm
  cursor blinking at a stale position. Terminal font and geometry now settle
  before PTY attachment, and ANSI scrollback completes before the final redraw.

## 0.18.0 - 2026-08-23

### Added

- Added canonical, content-hashed message envelopes alongside the append-only
  delivery trail. Duplicate state transitions are idempotent, attempts and
  delivery timestamps survive restarts, and recipient/content mismatches are
  rejected before corrupting an existing message record.
- Added a semantic activity timeline to Control Center with category, action,
  object, outcome, severity, correlation, source, and expandable technical
  context. Tasks, agent handoffs, notifications, and Council runs now publish
  meaningful outcomes instead of relying only on raw terminal state.
- Added a global Attention Center to Canvas and Workbench. Questions, blocked
  agents, permissions, and failures appear across workspaces with unread state,
  snooze, resolve, live WebSocket updates, and direct navigation to the source.
- Universal Search now indexes activity, durable messages, and attention items
  and accepts `type:`, `agent:`, `workspace:`, `status:`, `has:error`, `before:`,
  and `after:` operators.
- Added Workstreams as a first-class Workbench view. Each Kanban task now
  projects its assignee, active Floor and branch, semantic timeline, Councils,
  reviews, exact Git revision, evidence, tests, risks, and linked paths into one
  traceable delivery flow without duplicating the underlying records.
- Added sourced Workspace Memory in Canvas, Workbench, CLI, and MCP. Durable
  decisions, facts, preferences, constraints, references, and lessons now keep
  explicit provenance, content fingerprints, search, immutable revisions,
  optimistic conflict protection, and archive history without injecting the
  whole memory into every agent prompt.
- Added an Annotation Center in Canvas, Workbench, and Universal Search. It
  projects code-review and native Design comments from their canonical sources
  with author, target, captured revision, resolution state, and stale-code
  detection instead of creating a parallel feedback store.
- Turned custom team presets into portable Team Packs with semantic versions,
  release notes, immutable local revision history, SHA-256 integrity checks,
  bounded import validation, and runtime-state stripping. Existing and built-in
  presets remain compatible.
- Added persistent Huddles across Canvas, Workbench, global search, the native
  desktop menu, CLI/MCP, and encrypted remote collaboration. A workspace can
  keep one active voice-assisted room with a facilitator, selected agents,
  targeted turns, dictation, optional local TTS, bounded transcript recovery,
  explicit remote scopes, and linked Kanban/Workstream evidence.
- Connected agents can now import existing Bruno, OpenCollection, and Postman
  collections from workspace-relative repository paths. The same files open in
  the Canvas/Workbench API Client, linked edits write back atomically by
  default, watch mode detects external changes, and explicit pull/push
  resolution prevents silent conflict overwrites.

### Fixed

- Attention Center cards now expand in place to show the complete failure and
  original agent message. Source navigation is a separate action and is clearly
  disabled when its agent or task has already been removed.
- Agent replies are now correlated to the exact historical provider turn rather
  than only the latest prompt. Codex completion events, delayed session discovery,
  long transcript windows, and concurrent messages to one terminal no longer
  produce false "structured transcript could not be confirmed" failures or raw
  TUI output as a reply.
- Maestro recruitment now inherits the leader's active Floor and confirms success
  only after the new provider has a functional PTY, including inside the selected
  WSL distribution. Failed launches remove the incomplete node and connection;
  Kanban assignments start or restore an offline agent before delivery and only
  enter progress after the complete task prompt reaches that terminal.
- Long task briefings sent to Codex through Windows ConPTY and WSL now wait for
  the composer to render, verify activity after submission, and retry only the
  Enter key when the TUI did not acknowledge it.
- Team Pack import, export, and version-publishing failures now stay localized
  in the selected UI language instead of exposing internal server copy.
- Huddles now use the available desktop viewport, preserve separate scrolling
  for history and transcript, adapt to narrow windows, and expose an explicit
  localized close action instead of clipping the room controls.
- The Canvas `Command/Ctrl+P` palette now participates in the shared dialog
  focus stack, so Escape and outside clicks close it reliably even after a
  Huddle or another modal has been open.
- Windows terminals now copy a real selection with `Ctrl+C` or right-click via
  Electron's native clipboard while preserving `Ctrl+C` as process interrupt
  when no text is selected.

## 0.17.0 - 2026-08-22

### Added

- Added a dedicated JavaScript test editor alongside structured assertions in
  the API Client. Bruno `test` blocks, Postman `pm.test` scripts, and native
  `test`/`expect` aliases persist independently from post-response automation,
  execute in the selected runtime, and round-trip through Bruno and Postman.
- Added context-aware CodeMirror completion for the supported `bru`, `req`,
  `res`, `test`, `expect`, and `pm` APIs. Script editors now fill the available
  panel instead of leaving unused space below a fixed-height editor.
- Added typed `api_client_reference`, create, read, replace, export, and execute
  MCP/CLI workflows. Connected agents can author complete folders, requests,
  environments, runners, scripts, and tests; fingerprint conflicts protect
  concurrent human edits, redacted values preserve local secrets, and exports
  are confined to the workspace.

### Fixed

- Centralized Postman serialization so UI, bridge, CLI, and MCP exports use the
  same collection v2.1 representation and preserve test events consistently.

## 0.16.0 - 2026-08-22

### Added

- Added source-compatible API scripting through the official Postman Runtime
  and Bruno's official safe QuickJS runtime. Imported scripts now execute with
  separate global, collection, environment, runtime, iteration, and vault
  scopes; request and response helpers; nested request callbacks; cookies;
  collection flow; visualizers; legacy Postman globals; bundled libraries via
  `pm.require`/Bruno `require`; and complete bundled Chai assertions. Collection
  runners accept a JSON data row per iteration.
- Imported Bruno request and folder variables, post-response variable blocks,
  declarative assertions, and `tests {}` blocks now execute through Bruno's
  official Vars, Assert, and Test runtimes. Postman runner scripts receive the
  actual `pm.info.iteration` and `pm.info.iterationCount` for each Orkestrai row.
- Added an operating-system-encrypted API vault. Only secret names enter the
  workspace payload; values remain in Electron safe storage and are available
  to `pm.vault` and Bruno secret-variable APIs.

### Documentation

- Updated the complete API Client scripting reference with separate, copyable
  examples for Postman Runtime, Bruno QuickJS, and Orkestrai's native
  declarative tests. It now documents folder script order, scope precedence,
  iteration data, encrypted secrets, collection flow, and the explicit boundary
  around Postman services that require its hosted backend and Bruno's unsafe
  NodeVM access, which remains disabled in favor of the official safe runtime.

## 0.15.0 - 2026-08-20

### Added

- Added reusable saved commands to every terminal. Commands can belong to one
  terminal or be global, are searchable and manually executable in shells and
  agent terminals, and can optionally run once whenever a pure shell is created
  or restored. Automatic execution is deliberately disabled for agent TUIs so
  saved text is never submitted to a conversation without confirmation. The
  terminal menu now lists local and global commands for one-click execution and
  provides an explicit entry point to create or manage them.
- Expanded the native API Client into a collection workspace with nested
  folders, node-safe drag-and-drop, right-click actions, query parameters,
  URL-encoded and multipart fields, API key authentication, environments,
  bounded request and collection scripts, response assertions, execution
  history, cURL copy, and Postman export. Collections can now persist multiple
  runners with independent request selection and order, environment, iterations,
  delay, and stop-on-failure behavior; script variables chain into every next
  request in the run.
- Added versioned `.orkestrai-api.json` import/export for lossless native
  collection backups, including folders, runners, environments, scripts, and
  history. Bruno collections now export through Bruno's official serializer,
  including `collection.bru`, environments, requests, and folder metadata.
- Preserved non-editable Postman and Bruno REST metadata across import/export,
  including Postman examples and folder configuration plus Bruno request,
  collection, environment, and `folder.bru` settings.
- Added Swagger 2.0 and OpenAPI 3.x import with bounded local `$ref` resolution,
  generated request examples, authentication mapping, and localized fidelity
  notes. The API Client now exports OpenAPI 3.1 JSON/YAML and OpenCollection
  YAML, and imports or exports Postman environments independently without
  replacing the active collection.
- Added executable GraphQL, WebSocket, and gRPC requests. GraphQL includes query,
  variables, and operation name; WebSocket includes subprotocols, message queues,
  reconnect, keepalive, and a bidirectional transcript; gRPC loads local proto
  files and supports unary, client-streaming, server-streaming, and bidirectional
  methods.
- Added assisted OAuth 2.0 authorization code with state and PKCE, direct client
  credentials/password/refresh grants, shared HTTP/WebSocket cookies, proxy,
  custom CA, PEM and PKCS#12 client certificates, and TLS verification controls.
- Added guarded file synchronization for linked Bruno and OpenCollection sources
  with pull, push, five-second watch mode, fingerprints, stale-file cleanup, and
  explicit conflict resolution. Postman and OpenAPI sources remain pull-only.
- Added syntax-aware JSON, JavaScript, GraphQL, and XML editors with search,
  wrapping, and formatting, plus expandable JSON/XML response trees and clear
  active states for request, script, and response views.

### Fixed

- API request failures caused by invalid pre-request or post-response scripts
  now identify the exact request or collection script and source line. QuickJS
  errors are normalized across runtime boundaries instead of collapsing into a
  generic execution message.
- Kept the API collection runner footer fully inside its dialog at shorter
  viewport heights, with responsive button wrapping and a separately scrollable
  configuration body.
- Added precise before/after insertion indicators while reordering API requests
  and folders, with a distinct inside-folder target state that matches the
  persisted result.
- Fixed root-level Bruno/OpenCollection exports creating an artificial `Folder`
  directory, and blocked OpenAPI references from escaping the selected contract
  directory or fetching remote URLs during import.
- Made the active local/global scope unmistakable in the saved terminal command
  manager, deduplicated identical resume commands across both scopes, and keyed
  auto-run protection to the command set instead of a transient PTY session id
  so a shell respawn cannot submit the same startup command twice.

- Made English the true startup default, including the Electron splash shown
  before persisted settings load, while keeping the saved language authoritative
  as soon as the application is ready.
- Replaced Portuguese Usage backend errors with stable error codes translated
  in pt-BR, English, and Spanish across the panel and Canvas routing node.
- Prevented focused controls inside an overlapping Canvas node from raising its
  entire hit area above explicitly higher neighbors. Creating an API request no
  longer leaves an invisible layer that blocks terminal menus or Canvas tools.
- Hardened Canvas and Design Studio keyboard handling so browser events whose
  target is `Window`, a text node, or another non-element target cannot crash
  global shortcuts with `closest is not a function`.
- Made the production E2E suite establish and restore an explicit locale,
  keeping translated selectors deterministic regardless of the app default or
  settings left by another test.
- Fixed Automation forms rejecting every create, edit, enable, or GitHub
  integration request because route parameters were treated as unknown fields.
- Kept onboarding open on the welcome step after changing its language, even
  when the locale switch remounts the application tree.
- Workspace deletion now stops its live terminal processes before removing
  their persisted nodes, preventing late activity events and orphaned PTYs.
- Switching back to Workbench from a Canvas deep link now preserves the exact
  selected node in its existing pane instead of dropping the split layout.
- Agent creation now reuses the provider status already verified for the
  workspace runtime, avoiding a redundant full CLI scan and disabled submit.
- Canvas and Workbench nodes now render without waiting for the slower provider inventory;
  newly created selected terminals recover focus after session persistence,
  and Canvas/Workbench links retain their node during asynchronous loading.
- Terminal input typed during the PTY handshake is now buffered and delivered
  to the created session, while xterm stays mounted as its ID is persisted.
- The guided UI exploration tour now creates its brief, task board, and three
  editable directions through "Do it for me" instead of stopping behind an
  unsubmitted setup dialog.

### Security

- Updated DOMPurify to 3.4.14 and enforced the patched version inside Monaco's
  transitive dependency tree. `npm audit` now reports zero known
  vulnerabilities without downgrading or replacing the editor.

## 0.14.0 - 2026-08-19

### Added

- Added RPM packaging for Linux (Fedora, RHEL, CentOS, and compatible
  distributions). The release pipeline now publishes `.rpm` alongside the
  existing AppImage, includes the required public maintainer metadata, and
  uses the same stable `Orkestrai-<version>.<arch>.rpm` naming as the other
  installers. It validates both the RPM and its entry in `latest-linux.yml`
  before publication (thanks to @rlevidev).

## 0.13.0 - 2026-08-18

### Added

- Added reusable Canvas annotations. Selected shapes expose a visible duplicate
  action and support Cmd/Ctrl+D; Cmd/Ctrl+C and Cmd/Ctrl+V copy and paste one
  shape or a complete multi-selection while preserving size, text, styling,
  editable arrow geometry, and relative spacing.
- Added a native API Client node shared by Canvas and Workbench. It creates and
  executes HTTP requests with methods, headers, Bearer/Basic authentication,
  JSON/text/XML or URL-encoded form bodies, variables,
  response timing, size, status, and formatted previews; imports Bruno folders
  through Bruno's official parser and Postman Collection v2.1 JSON; and can
  reopen an imported source in its installed desktop application. Connected
  agents can list and execute saved requests through typed Orkestrai MCP tools
  without receiving stored authentication secrets in the inventory response.
- Added an explicit agent-facing Design contract and high-throughput batch
  tools. `design_reference` provides exact schemas and examples on demand,
  `design_create_elements` creates complete screens in one revision, and
  `design_apply_blueprint` atomically combines layers, tokens, bindings,
  components, prototypes, and motion. Provisioned skills and guided UI
  exploration briefs now require the read-once, batch, verify workflow and
  prohibit schema probes, installation inspection, and scratch discovery
  scripts.
- Added a guided three-direction UI exploration to the Canvas Design menu. One
  transaction creates a linked specification, eight progressive Kanban tasks,
  and native Clarity, Expressive, and Efficient Design documents. Each designer
  first produces one representative desktop screen and one mobile screen with a
  five-minute first-revision target, preferably through semantic HTML/CSS import.
  Canvas nodes now expose waiting, working, stalled, ready, and reviewed states;
  the Quality panel adds revision-aware human approval and traceable change
  requests. Only an approved direction expands into responsive states, typed
  tokens, reusable components, prototype, and framework code. The structural
  audit is explicitly separated from visual quality review, and existing guided
  exploration nodes remain compatible with the new progress and review flow.
- Indexed Canvas nodes and edge adjacency once per immutable graph snapshot so
  floating handles and connection geometry no longer scan the complete graph
  for every rendered edge in dense workspaces. Canvas graph updates now replace
  raw immutable arrays and refresh nodes, edges, and floors without rechecking
  every provider, keeping agent-driven changes and new UI explorations responsive.
- Added application-wide audio device controls under Settings → Voice. Users
  can select and test the microphone used by every local dictation surface and
  the speaker used by previews and spoken replies. Device removal falls back
  to the system default, while permission, missing-device, interrupted-capture,
  and likely single-microphone contention failures now have distinct guidance.
- Made canvas connections adaptive to workspace density and visibility. Small
  canvases keep the full Verlet rope physics, medium canvases reduce simulation
  work, and dense or offscreen connections use static curves or lines while
  preserving activity colors and animation on emphasized conversations. Hidden
  windows and reduced-motion environments stop edge animation entirely.
- Completed the quality, scale, and recovery phase of native Design Mode. A
  live audit reports naming, clipping, overlap, WCAG contrast, and accessibility
  issues and selects the affected layer. Four complete native templates create
  editable product, marketing, mobile, or design-system foundations through the
  revision-safe command bus. Automatic backups, corruption recovery, schema
  migration, bounded history, explicit restore, and viewport-based incremental
  rendering protect large documents. Connected agents use the same audit and
  template operations through typed Orkestrai CLI and MCP commands.
- Expanded provider Usage into one capability-driven inventory for all eight
  supported agent CLIs. Claude, Codex, and Kimi retain verified automatic quota
  windows and routing. Antigravity, Cursor, Devin, OpenCode, and Cline now show
  their documented interactive CLI, administrative API, or underlying model-
  provider limitations with official links instead of fabricated percentages.
- Added live human-agent collaboration to native Design documents. The Design
  editor now shows participant presence, cursors, selections, short layer
  leases, follow mode, anchored comment threads with replies and resolution,
  and revisioned visual proposals with structural diffs and explicit human
  approval or rejection. Approved proposals apply atomically; conflicting
  edits are blocked before mutation. Proposals can open an existing Council or
  create a parallel Git Floor without creating a second design system. The
  encrypted Remote Companion exposes only sanitized page, activity, comment,
  and proposal summaries, with independent per-device View, Comment, Propose,
  Edit, and Decide permissions. Connected agents use the same versioned
  comments and proposals through typed Orkestrai MCP tools.
- Added native interactive prototyping and motion to Design Studio. Designers
  and agents can define multiple starting flows, attach click, press, hover, or
  timed interactions to any layer, navigate frames, open or close overlays,
  return through history, scroll to content, and switch variable modes. The
  focused player supports transitions, hotspots, fixed layers, overflow,
  device framing, fullscreen, and self-contained read-only HTML sharing.
  Reusable motion tokens, per-layer timelines, keyframes, easing, CSS keyframe
  export, and Motion.dev output live in the same revision-safe Design document
  and are indexed by universal search and available through the Orkestrai MCP.
- Completed the native Design delivery phase with safe code-to-design import
  for HTML/Tailwind, Svelte, React/JSX, and Vue; design-to-code adapters for
  Svelar/Svelte 5, React, Next.js, Vue 3, and HTML/Tailwind; and preview-before-
  write generation protected against concurrent design/file changes and
  symlink escapes outside the workspace. Generated code
  prioritizes existing Code Connect component mappings, records the linked
  artifact on the Design document, and opens directly in the Workbench Monaco
  editor. Visual validation captures a live Portal or attached iOS/Android
  device, compares it with the selected frame through normalized pixel diff
  and an adjustable overlay, and converts the evidence into a traceable Kanban
  task or a Review Center entry tied to the real Git change. Agents use the
  same import, preview, and protected-write flow through typed Orkestrai MCP
  tools or the bundled CLI, with revision and task attribution preserved.
- Added first-party Figma interoperability to native Design Mode. Orkestrai now
  provisions the official remote Figma MCP for compatible providers, stores the
  optional read-only REST credential in the operating-system vault, inspects
  file, page, and frame links, and imports native layers, editable vectors,
  raster assets, published styles, variables, components, variants, local
  instances, and published identities from external libraries. Persistent
  Figma node mappings and separate remote/local hashes
  power a selective synchronization preview that distinguishes incoming
  changes, local edits, removals, and conflicts. Figma sources are searchable,
  preserve existing Code Connect links, and are exposed to agents through typed
  inspect, import, preview, and sync tools in the Orkestrai MCP. The bundled
  loopback-only Orkestrai Design Bridge plugin transfers live Figma selections,
  copies editable SVG or structural JSON, creates a new Figma page with native
  assets, variables, styles, components, and variants from an Orkestrai
  document, and sends only reviewed linked changes back to the current Figma
  file without third-party editor code.
- Completed the Design Systems phase of native Design Mode. Designers can start
  from product, marketing, or mobile token presets; import DTCG JSON or CSS
  variables; export DTCG, CSS, or Tailwind tokens; and audit duplicate, unused,
  and repeated hardcoded values plus repeated component candidates. Frames and
  groups can become reusable components with linked instances, text, boolean,
  and slot properties, local overrides, whole-instance or variant swapping, and
  safe detaching. Versioned local libraries publish to explicitly authorized
  workspaces, preserve local placement while synchronizing, and can be detached
  into local copies. A read-only codebase scan extracts CSS variables, static
  Tailwind tokens, and Svelte, React, or Vue component contracts without
  executing project code, then maintains source hashes and visual-to-code
  links. Tokens and components are also available through universal search,
  Canvas summaries, and the revision-safe MCP command bus.
- Native Design documents now include typed design variables organized into
  collections and modes. Designers can create color, spacing, radius,
  typography, opacity, effect, breakpoint, string, and boolean tokens, reuse
  values through aliases, bind compatible layer properties, and switch the
  active mode with an immediate canvas preview. The same revision-safe command
  bus is exposed to agents through `design_apply_operations` in the Orkestrai
  MCP, including variable, mode, alias, and binding operations.
- SVG files copied, pasted, dropped, or chosen in Design Mode are now parsed
  into editable native vector layers, including paths, primitive shapes,
  nested transforms and group hierarchy, inline and class styles, reusable
  gradients, and `use` references. Designers can group and ungroup layers,
  move or resize a group with its descendants, select or list every layer that
  uses a fill or stroke color, apply one color to the current selection, and
  replace matching solid or gradient-stop colors across the page. A selection
  can be copied as SVG or PNG and exports crop to the selected artwork when a
  selection exists.
- Expanded native Design Mode with Pen paths and editable points, boolean
  operations, masks, multiple solid or gradient fills and strokes, visual
  effects, blend modes, rulers, persistent guides, snapping, alignment and
  distribution. Frames now support horizontal, vertical, wrapping, and grid
  auto layout plus responsive child constraints. Images and SVGs can be
  imported by picker, paste, or drag and drop, reused from the document asset
  library, and exported with the design to SVG, PNG, JPEG, WebP, or PDF.
  Revision-bound raster thumbnails keep large Design nodes inexpensive on the
  Canvas while preserving the live vector renderer as a fallback.
- Added the first phase of Orkestrai's native Design Mode. A persistent Design
  node now opens the same structured visual document in Canvas and Workbench,
  with frames, rectangles, ellipses, text, layers, property editing, zoom,
  undo/redo, revision history, and live refresh when an agent changes it.
  Connected agents use typed CLI/MCP operations with optimistic revision
  checks instead of rewriting project JSON directly.

### Fixed

- Kept terminal keyboard input isolated from Canvas accessibility shortcuts.
  Escape now reaches Vim, merge/rebase editors, pagers, and other terminal TUIs
  without deselecting the node or blurring xterm, while terminal search and
  dictation shortcuts remain local to the terminal.
- Prevented wheel events over terminals and other Canvas nodes from falling
  through to the viewport at their scroll limits and unexpectedly zooming the
  complete Canvas. Canvas zoom now remains restricted to the actual pane.
- Preserved the current directory of native shell terminals across app restarts
  by tracking OSC 7 and the live PTY process directory, without changing the
  working directory of agent terminals or provider resume behavior.
- Added explicit note discovery to the Orkestrai CLI and MCP so Cursor and other
  providers can list existing workspace notes before reading, editing, or
  appending instead of treating an empty connected-node list as an empty
  workspace.
- Restored documentation content to the universal Command/Ctrl+K search after
  the workspace index had reduced it to an "Open documentation" command.
  Localized topics, use cases, and changelog entries now appear alongside
  workspace results with accent-insensitive matching and direct anchors, even
  when the workspace search request fails.
- Fixed Design documents clipping frames placed outside the nominal page.
  The editor now derives a stable expandable scene from the actual artwork,
  fits every frame, exports the complete content, and supports native
  trackpad/scroll navigation plus Hand (`H`), Space-drag, and middle-button
  panning at zoom levels down to 2%.
- Fixed finished Git Floors accumulating their cloned or recruited nodes in the
  Workbench and Control Center. Nodes from landed or deleted floors are now
  archived, their obsolete edges are removed, and legacy records are repaired
  during migration. Active floor agents show their floor name, cloned terminals
  never inherit PTY or provider conversation ids, and bridge recruitment now
  honors and validates its existing floor target instead of silently placing
  the agent elsewhere.
- Fixed WSL terminal creation and restoration on Windows by preflighting the
  exact distribution, Linux directory, login PATH, and CLI before PTY spawn,
  then tracking provider transcripts inside that distribution's Linux home.
  Only confirmed conversation ids are persisted or resumed; missing or invalid
  ids start clean instead of invoking a speculative latest conversation.
  Missing distributions, paths, and commands now produce distinct actionable
  errors without falling back silently to native Windows.
- Rebuilt Design Mode interaction around explicit layer and vector-edit states.
  Pen now previews its next segment and close target, continues existing open
  paths, bends segments directly, splits curves without changing their shape,
  and supports multi-point box selection, group transforms, keyboard nudging,
  and corner, mirrored, asymmetric, or disconnected handles. Selected layers
  have eight direct resize handles with Shift/Option modifiers, path geometry
  scales with its bounds, rotated paths edit in place, and text can be edited
  directly on the canvas. Editing overlays no longer leak into exports or
  thumbnails, selection contrast stays legible across themes, and multiline
  text wraps consistently while inline editing grows the layer to keep every
  line visible.
- Design shapes now draw by dragging in any direction, with a live preview and
  the exact released size; a simple click still creates the useful default.
- Isolated Design Mode keyboard shortcuts from the underlying Canvas so Delete
  removes only the selected layer instead of also deleting its Design node,
  and replaced invalid cloning of Svelte state proxies that froze deletion.
- Exposed rotation and text alignment in the property inspector, matching
  capabilities already supported by the native document and renderer.

## 0.12.0 - 2026-08-15

### Added

- Added mixed Windows and WSL execution inside the same workspace. The
  workspace runtime remains the default, while every terminal can inherit it,
  force native Windows, or target an exact installed WSL distribution and Linux
  project path. Provider detection and models, PTY sessions, generic resume,
  Council runs, recruited agents, and the Orkestrai bridge follow the terminal's
  effective runtime. Changing an override restarts only that terminal, and
  invalid paths or missing distributions fail clearly without a silent fallback.

### Fixed

- Included the WSL runtime modules in the packaged desktop server so installed
  Windows builds can create, restore, and run WSL-backed workspaces.
- Derived the Windows host folder of a WSL workspace from its Linux project
  path so creating or editing one no longer required a second matching path and
  no longer failed with a spurious "Linux path does not match the workspace
  folder" error. The working directory field is now filled and locked
  automatically whenever the WSL runtime is selected.

## 0.11.0 - 2026-08-15

### Added

- Added experimental end-to-end encrypted workspace sharing with one-time link
  and QR invites for either a browser/mobile companion or another installed
  Orkestrai app, explicit device fingerprint approval, Viewer, Collaborator,
  Operator, and Administrator roles, immediate revocation, command audit, and a
  bounded remote PWA for live team state, tasks, reviews, activity, provider
  usage, and leader messages. The browser stores its pairing key as a
  non-extractable WebCrypto key and removes the invitation secret from the URL
  before connecting.
  A versioned HKDF/AES-GCM protocol protects against replay and tampering; the
  opaque rate-limited WebSocket relay cannot decrypt content. Operators can
  hold traceable, structured conversations with an agent, and Administrators
  can start or restore one. Raw terminal control is a separate per-device
  Administrator permission that is disabled by default, rate-limited, audited,
  and limited to one terminal at a time. Files, notes, portals, credentials,
  tokens, private URLs, and local paths remain on the host.
  Operator and Administrator devices can also dictate leader messages through
  the host's local STT model without sending plaintext audio to the relay.
- Evolved legacy Routines into traceable Automations with manual, schedule,
  task, message, Git commit, GitHub pull request, webhook, file-change, and
  provider-usage triggers; agent prompt, task creation, and desktop notification
  actions; development, design, marketing, research, and operations recipes;
  idempotent Svelar jobs; bounded retries; and detailed execution history.
- Added Automations to Canvas, Workbench, universal search, documentation, and
  onboarding. GitHub credentials are encrypted with Electron `safeStorage`,
  requested from the server process over IPC, and never persisted in SQLite.
- Evolved the focused workspace view into Workbench with persistent open items,
  vertical tabs by default, optional horizontal tabs, and up to eight recursive
  right/down resizable panes for live canvas artifacts.
- Added explicit open-right/open-below actions, tab movement between panes,
  active-pane feedback, safe recovery when persisted nodes no longer exist,
  and keyboard navigation between open items and panes.
- Added a global `Cmd/Ctrl+K` search for workspaces, agents, tasks, notes,
  artifacts, roles, skills, workspace files, settings, and commands, with
  previews, recent items, favorites, and direct pane placement.
- Added workspace-confined ripgrep file search and virtualized result rendering
  for large result sets.
- Added a single workspace attachment pipeline for files up to 10 MB and
  HTTP/HTTPS links, with upload, paste, and drag-and-drop support across agent
  prompts, tasks, notes, and composers. Files are stored under
  `.orkestrai/attachments/` and complete references are delivered to agents.
- Added a compact provider usage footer to the Workbench with every reported
  5-hour, weekly, or monthly quota window and severity-matched percentages.
- Added a lazy-loaded Monaco editor to Workbench files with persistent models,
  undo and view state, find/replace, symbol navigation, formatting, configurable
  minimap and wrapping, optional autosave, and explicit dirty-buffer protection.
- Added offline Markdown, PDF, and image previews with source switching, page
  and zoom controls, image pan and dimensions, plus safe metadata and a system
  application action for binary files.
- Added a Workbench Control Center with append-only agent activity history,
  current tasks, state duration, provider usage, and a verified communications
  inbox that survives view changes and restarts without waking idle terminals.
- Added persistent message delivery tracking under one message id across
  queued, sent, delivered, acknowledged, replied, and failed transitions.
- Added Council decisions from task cards and leader menus: two to five real
  agents run independent, budget-limited perspectives against one structured
  evidence, risk, test, divergence, recommendation, and confidence contract.
  Partial provider failures preserve successful answers, optional leader
  synthesis remains advisory, and the final selection, consensus request, or
  rejection is always human and persisted. Implementation runs use isolated
  Git floors and can land only the selected committed result after a fresh
  clean-target and conflict preview; Council never pushes or merges by itself.
- Made phase 0–8 features discoverable as one product surface: Council now has
  visible entry points in the Canvas toolbar, Workbench explorer, and global
  search; guided tours persist across Canvas/Workbench navigation; every
  documented use case links to its tour; and the tour catalog now includes
  search plus a dedicated reference-attachment workflow.
- Added a Workbench Review Center with structured staged/unstaged Git status,
  branch synchronization, bounded Monaco diffs, persisted file/line comments,
  stale-context detection, task and agent context, and approve, request changes,
  or reject decisions. Requested changes are handed directly to the responsible
  agent when its terminal is available.
- Added Portal Design Mode to the installed desktop app: inspect and highlight
  a real page element, review a cropped screenshot and bounded safe context,
  then create a traceable Kanban task for leader triage, assign a new task to an
  agent, or append it to an existing task. Cookies, headers, tokens, storage,
  query strings, and hidden state are excluded from the captured context.
  Workspace and portal route parameters are validated explicitly so strict
  request validation does not block delivery.
- Added a persistent workspace-scoped Mobile Device node shared by Canvas and
  Workbench. On Apple Silicon Macs it controls local iOS Simulators; on macOS,
  Windows, and Linux it discovers Android Studio SDK tools, starts or attaches
  to local AVDs, and can attach to authorized USB or network Android devices
  after an explicit physical-device confirmation. Android video uses the
  bundled scrcpy 3.1 server with hardware-accelerated WebCodecs decoding and
  supports touch, swipe, pinch, rotation, Back, Home, Recents, text input, APK
  installation, package/activity launch, screenshots, bounded logcat output,
  UIAutomator trees, and runtime permissions. Matching `orkestrai device` CLI
  and MCP tools use the same workspace session. Orkestrai owns at most one
  session per workspace and stops only helpers and emulators it started.

### Changed

- Stabilized the workspace-sharing dialog dimensions across Invitation, Access,
  and Audit, added an unmistakable active-tab treatment, and kept each tab's
  content independently scrollable.
- Made the Canvas tool strip icon-first with accessible tooltips, kept the
  documentation header available while scrolling, reorganized changelog
  releases into collapsible numbered changes, aligned sharing form controls,
  and added explicit Canvas and native Workspace menu entry points for joining
  a remote workspace.
- Rebuilt the application visual system around semantic theme tokens. The
  default dark palette now pairs graphite surfaces with the Orkestrai gold,
  the light palette has deliberate contrast, and Canvas, Workbench, Settings,
  documentation, Provider Center, side panels, dialogs, menus, fields, and
  voice-orb docking now share one compact responsive hierarchy.
- Protected workspace folders on macOS now declare localized Downloads,
  Documents, and Desktop access reasons. Canvas and Workbench replace raw
  `EPERM`/`EACCES` errors with a recovery panel that can reauthorize the exact
  project folder and retry without restarting the app.
- Workspace sharing now defaults to the production
  `wss://relay.orkestrai.app/v1/connect` endpoint. The containerized relay
  accepts the installed app's dynamic loopback origins and the official website
  and Remote PWA origins, while rejecting unrelated browser origins. The web
  companion reconnects with bounded exponential backoff when its host is away.
- Recreated the production relay with the official Remote PWA origin enabled,
  fixing browser and mobile invitations that remained stuck reconnecting before
  their device-approval request reached the host.
- Restarting an Android stream now reopens its stable AVD definition instead
  of trying to boot the expired temporary `emulator-*` serial.
- Mobile Device streams now fit the complete device screen inside both the
  Canvas node and Workbench pane by default. Independent viewport controls add
  stable zoom steps, actual-size mode, automatic refitting after pane resize or
  rotation, and two-axis scrolling without changing device touch coordinates.
- Moved workspace files into a native Workbench explorer and local editor tabs.
  Opening a file from the explorer, Canvas file tree, or global search now goes
  directly to the Workbench instead of creating a disconnected Editor node on
  the canvas.
- Renamed the user-facing Terminals mode to Workbench while preserving the
  existing `/terminal` route and live PTY sessions for compatibility.
- Bundled the variable Inter, Sora, and JetBrains Mono fonts locally so the
  desktop interface no longer depends on Google Fonts or network availability.
- Grouped the Workbench explorer into agents, work, content, and tools, and
  migrated old two-pane layouts automatically to the recursive v2 format.
- Consolidated the Usage panel, Usage node, and Workbench footer onto one
  shared five-minute snapshot and refresh timer to avoid duplicate provider
  requests.
- Limited large text reads at the filesystem boundary and opens the first
  512 KB read-only instead of loading or accidentally overwriting the full file.
- Replaced ten-second activity polling in Canvas and Workbench with WebSocket
  updates from confirmed PTY, task, and bridge events. Informational events stay
  in Control Center; native notifications are reserved for attention and
  completion transitions.
- Made `orkestrai ask` and its MCP tool return the persistent message id and
  succeed only after the response is confirmed and recorded.

### Fixed

- Routed Remote leader messages through the same correlated conversation path
  as direct agent chat, so the overview shows the sent prompt, delivery state,
  and reply. Claude turns that pause for tools now wait for the real `end_turn`
  and combine every assistant text block instead of publishing an interim
  "I will check" message as the final answer.
- Bound remote chat replies to the exact injected prompt for every registered
  provider and repaired stale conversation IDs before publishing a reply,
  preventing output from another CLI session from appearing in the browser.
  Structured transcript completion now also returns without waiting for the
  terminal redraw timeout.
- Made the encrypted remote terminal fit phone, tablet, and desktop viewports,
  recalculate PTY columns on visual viewport changes, and close the agent chat
  dialog before opening the full-screen terminal.
- Let Workbench agent names and roles wrap onto dedicated lines in the explorer,
  and let vertical open-item labels grow to their full name instead of hiding
  distinguishing text behind ellipses.
- Applied cross-origin isolation headers to production static assets so Monaco
  and PDF workers run off the UI thread instead of being blocked after packaging.
- Made note attachment removal delete the inserted Markdown reference and the
  workspace file together instead of hiding only the attachment chip and
  leaving orphaned content under `.orkestrai/attachments/`.
- Docked the pinned voice orb in a dedicated Workbench header slot so it no
  longer covers tabs or contextual actions; unpinned placement remains freely
  movable and keeps the user's saved canvas position.
- Made open-to-the-side switch cleanly to a different workspace before creating
  splits, preventing empty panes and mixed workspace context.
- Removed the slow provider/model diagnostics from the Canvas and Workbench
  startup path, and fixed a command-palette reactive loop that could leave both
  views stuck in their initial loading state despite completed API requests;
  the palette now also keeps its full responsive list-and-preview layout.
- Preserved the visible artifact when closing its active Workbench pane, and
  corrected terminal status semantics and light-theme explorer contrast.
- Deduplicated same-workspace provisioning, isolated checks for different
  workspaces, and made every bridge repair read/write asynchronous, so a pending
  macOS folder prompt cannot block Canvas or Workbench in another workspace.

## 0.10.0 - 2026-08-11

### Added

- Added a focused Terminals workspace view with a searchable cross-workspace
  explorer for live terminals, task boards, notes, portals, files, flows, and
  usage. Switching back to the canvas preserves the active workspace and node.
- Added five terminal palettes for a total of ten named themes, each with a
  complete ANSI color set and a visual swatch selector.

### Changed

- Consolidated provider, role, theme, reload, Maestro Mode, and removal into a
  compact terminal header menu so actions remain usable on narrow nodes.

### Fixed

- Made the global voice orb resolve and open the active workspace leader in
  Terminals mode before starting dictation, instead of reporting that no
  workspace or leader exists.
- Resized existing PTY sessions to the full focused viewport when opening them
  in Terminals mode, preventing agent chats from staying compressed and garbled
  at their smaller canvas dimensions.
- Replaced the overlapping icons in the Terminals header's locate-on-canvas
  action with one clear, optically centered icon.
- Clarified in voice settings that macOS reserves the standalone Fn/Globe key;
  app shortcuts must use a capturable combination or an F1-F12 key.

## 0.9.1 - 2026-08-11

### Fixed

- Generated valid YAML frontmatter for Kimi role agent files and lazily repaired
  legacy or missing instruction files before launching a terminal, preventing
  Kimi from exiting with an `Invalid agent file` error.
- Added a visible, clickable pinned or movable badge to the global voice orb
  and exposed its platform-specific position shortcut in the tooltip instead
  of hiding the controls behind an undocumented modifier click.

## 0.9.0 - 2026-08-11

### Added

- Added an explicit 5-hour, weekly, or monthly window selector to quota-aware
  routing, with a clear unavailable state when a provider does not report the
  selected period.

### Changed

- Installed preset roles through each provider's native instruction mechanism:
  Claude system prompts, Codex developer instructions, and Kimi agent files.
  Other providers now receive a short reference to the versioned role file
  instead of a long terminal paste.

### Fixed

- Parsed Kimi's current remaining-quota response and Codex additional rate
  limits so every reported 5-hour, weekly, or monthly window appears in both
  Usage surfaces without duplicate bars.
- Fixed the generated shadcn switch state selectors so enabled and disabled
  states are visually distinct and accessible.
- Rebuilt the workspace editor with bounded scrolling, responsive fields, a
  stable footer, and CSRF-protected MCP and preset actions.
- Moved the Windows title-bar divider below the native caption overlay so it
  spans the complete window width.

## 0.8.3 - 2026-08-10

### Added

- Added an opt-in voice setting that submits terminal dictation with Enter while
  leaving regular text fields in insert-only mode.

### Fixed

- Rebuilt the searchable provider model selector with the official
  shadcn-svelte combobox composition so its search field remains visible,
  aligned, filterable, and keyboard accessible inside the agent dialog.

## 0.8.2 - 2026-08-10

### Changed

- Made `orkestrai ask` preserve unquoted multi-word messages and require an
  explicitly confirmed provider reply before agents may report a consultation.
- Made `orkestrai task done` hand completion back to the workspace leader
  automatically without colliding with a human draft in the leader terminal.

### Fixed

- Matched Codex rollout sessions by their real workspace directory, preventing
  concurrent Codex terminals in different workspaces from reading each other's
  transcripts or confirming the wrong reply.
- Matched Kimi sessions by the provider's exact workspace-path hash instead of
  a shared final folder name such as `app`.
- Made unconfirmed and timed-out bridge requests fail with a nonzero exit code
  instead of appearing successful to the calling agent.

## 0.8.1 - 2026-08-10

### Added

- Added a searchable, bounded, and scrollable model selector for providers with
  large account catalogs, including Devin.
- Added deterministic canvas organization for either the current node selection
  or the whole workspace through the toolbar, command palette, and shortcut.
- Added a styled Windows desktop title bar with File, Edit, View, Workspace,
  Window, and Help menus while preserving native window controls.

### Changed

- Made the global voice orb pinnable and draggable within the visible canvas and
  kept it clear of open panels such as Presets, Usage, Roles, and Ports.
- Aligned Usage node progress colors with the panel's per-window green, yellow,
  and red thresholds, and loaded an initial Skills search automatically.
- Improved Orkestrai Light contrast across panels, canvas nodes, text, buttons,
  icons, provider marks, hover states, and onboarding surfaces.

### Fixed

- Captured the focused editable field before the global microphone takes focus,
  so dictation works on the first click without incorrectly requiring a leader.
- Validated real provider transcripts before resuming saved conversations,
  clearing stale Claude ids without re-injecting roles or activating idle agents.
- Used Windows command shims instead of launching provider JavaScript files
  directly, preserving CLI startup and workspace session recovery.
- Kept connections behind every canvas node and corrected terminal selection
  coordinates on Windows displays with DPI scaling.

## 0.8.0 - 2026-08-10

### Added

- Added a persistent Usage canvas node for Claude, Codex, and Kimi quotas with
  configurable source provider, fallback provider, and routing threshold.
- Added `orkestrai usage` to the native CLI and MCP bridge so leaders inspect
  the same quota snapshot and recommendation before assigning new work.
- Added three dark application themes, one light theme, and a semantic token
  editor with live preview, duplication, validated JSON import, and export.
- Added localized documentation, use cases, and onboarding tours for quota-aware
  delegation and custom themes in Brazilian Portuguese, English, and Spanish.

### Changed

- Updated the canvas, nodes, Provider Center, Skills, documentation, and Settings
  surfaces to honor the selected global theme tokens.
- Updated leader bridge instructions to route only new work to a healthy fallback
  and never silently move an active task to another provider.

## 0.7.0 - 2026-08-10

### Added

- Added a compact Agents menu to the canvas toolbar that lists every registered
  provider and sends unavailable agents directly to Provider Center.
- Added a global, persistent preference for pinning up to four ready agents as
  direct toolbar buttons in the user's chosen order.
- Added localized documentation, use case, and guided onboarding for the agent
  menu in Brazilian Portuguese, English, and Spanish.

### Changed

- Consolidated the eight provider buttons into the Agents menu while keeping
  Shell directly accessible and preserving the existing agent drawing flow.

## 0.6.0 - 2026-08-10

### Added

- Added Devin as a native provider with official CLI detection, account model
  discovery, autonomous interactive sessions, headless execution, and exact
  conversation resume.
- Added read-only discovery of concurrent Devin sessions by real workspace
  directory and clean agent replies from Devin's ATIF transcripts.
- Added Orkestrai skill and MCP bridge provisioning for Devin through
  `.devin/skills/orkestrai` and `.devin/mcp_config.json`.
- Added a localized Devin use case and guided onboarding tour in Brazilian
  Portuguese, English, and Spanish.

### Fixed

- Started Cursor Agent with workspace trust, MCP approval, and autonomous write
  access so canvas agents do not stop on repeated confirmation prompts.
- Started Antigravity autonomously and exposed its low, medium, and high effort
  controls in the agent configuration.

## 0.5.2 - 2026-08-10

### Fixed

- Raised the packaged server request limit from the adapter's 512 KB default
  so local dictation accepts recordings of approximately 15 minutes instead
  of failing after only a few seconds.
- Added a localized, actionable message when a recording exceeds the bounded
  upload limit in either global or terminal dictation.
- Restored Portal pages automatically when their saved local server starts
  after the canvas, and made automation wait for a real page load instead of
  running against Chromium's empty error document.
- Reserved each new Claude conversation id before spawn, preventing concurrent
  agents in the same workspace from swapping transcript ownership and sending
  corrupted terminal redraws through agent-to-agent replies.
- Preserved actionable Portal failure details through the CLI and rejected raw
  TUI output whenever a structured provider transcript cannot be confirmed.
- Stopped re-injecting roles when provider conversations resume. Restored
  terminals now submit input only to agents with assigned unfinished tasks or
  to the leader when unfinished work still needs an owner, including custom
  Kanban stages.
- Kept the packaged server responsive while macOS waits for workspace-folder
  consent by moving the initial access check off the event loop; a denied or
  interrupted check is retried instead of being cached as provisioned.

## 0.5.1 - 2026-08-10

### Fixed

- Restored every terminal automatically after an application restart by
  discarding process-local PTY identifiers that no longer exist while
  preserving each provider's real conversation identifier.
- Added a stable WebSocket error code and removed the timing window that could
  briefly reattach a recovering terminal to its obsolete PTY identifier.

## 0.5.0 - 2026-08-10

### Added

- Added global local dictation for every editable text field, including task
  titles and descriptions, roles, notes, and forms. When no field is active on
  the canvas, the voice control retains its leader-terminal shortcut.
- Added in-place provider switching for terminal agents. The replacement starts
  a clean provider conversation while preserving the node name, role, Maestro
  status, floor, position, theme, and team connections.
- Added automatic preset-role delivery when a terminal starts and initial
  kanban queue delivery to the leader with complete title, description, images,
  and linked-note context.
- Added task titles, stages, and assignees to the ground and worktree summaries
  in Floors.

### Changed

- Expanded every built-in preset role with a concrete mission, team context,
  operating process, acceptance criteria, handoff requirements, and a
  Kanban-first delegation protocol.
- Classified native notifications as task completion, project completion,
  attention, or information. Completing a task now emits its own explicit task
  notification, while project completion is reserved for the whole project.
- Required leaders to create and assign delegated work on the board before
  sending direct agent messages.

### Fixed

- Matched the shape text editor to the rendered font size, weight, alignment,
  and color so large text remains legible while editing.

## 0.4.0 - 2026-08-09

### Added

- Added native Cursor Agent, Antigravity CLI, and Cline CLI adapters alongside
  Claude Code, Codex CLI, Kimi Code, and OpenCode.
- Added provider-specific model, reasoning-effort, interactive, headless,
  structured-output, and exact-resume contracts where each CLI supports them.
- Added bridge skills and MCP provisioning for Cursor (`.cursor/mcp.json`),
  Cline (`.cline/mcp.json` with workspace-scoped settings), and Antigravity
  (`.agents/mcp_config.json`).
- Added exact session discovery from Cursor transcripts, Antigravity's
  workspace cache, and Cline session manifests, plus clean transcript reads for
  agent-to-agent replies.
- Added localized documentation and onboarding for choosing agents by desired
  outcome, aimed at developers, vibe coders, designers, marketers, creators,
  and product teams.
- Added a localized Provider Center that detects available CLIs, explains each
  provider's capabilities, and provides OS-aware installation and official
  authentication guidance without collecting credentials.
- Added language selection as the first onboarding step, persisted immediately
  for Brazilian Portuguese, English, or Spanish.

### Changed

- Replaced fixed provider enums and effort lists across the canvas, validation,
  tours, recruitment bridge, and PTY transport with adapter registry metadata.
- Prevented ambiguous latest-session fallback for providers whose exact
  conversation ID is not known.
- Changed the default interface language for new installations to English;
  existing saved language preferences remain unchanged.

### Fixed

- Prevented the initial locale request from mixing languages on one screen or
  discarding an early click while the application remounted.
- Ensured preset terminals are materialized through the current provider
  adapter so Claude, Codex, and Kimi start with their autonomous full-access
  flags. Existing provider terminals with empty arguments are repaired lazily,
  while customized arguments remain untouched.

## 0.3.0 - 2026-08-09

### Added

- Added up to ten customizable task-board stages with names, colors, ordering,
  safe deletion, and automatic awareness through the Orkestrai CLI and MCP
  bridge.
- Added Campaign and launch, Brand and design, and Content and SEO teams with
  localized briefs, specialist roles, portable skills, notes, tasks, and canvas
  layouts for marketers, designers, creators, and multidisciplinary teams.
- Added the Orkestrai Contributing preset with a Claude lead, independent Codex
  and Kimi oracles, Svelar, desktop, and QA/release specialists, a six-stage
  board, and a consensus Flow that requires both oracle approvals before task
  creation.

### Changed

- Expanded the product language and documentation beyond software engineering
  so non-programmers can start from familiar goals, briefs, stages, and
  approvals while technical agent controls stay automatic.

## 0.2.0 - 2026-08-09

### Added

- Added a first-class preset library to the canvas with search, category
  filters, create-new and merge-into-current flows, plus ready-made Product,
  React, Next.js, SvelteKit, Svelar, and Laravel teams.
- Added preset format v2 with portable `SKILL.md` files and complete task
  descriptions/status, while preserving compatibility with existing presets
  and never carrying PTY runtime state.
- Added a localized catalog of 12 installable roles covering leadership,
  product, architecture, frontend, backend, Svelar, QA, security,
  accessibility, documentation, release, and performance.
- Added an operational Floors overview that combines active agents, assigned
  tasks, changed files, branch synchronization, and latest commit information
  for ground and every Git worktree.
- Added localized native Electron menus for workspace, editing, view, window,
  documentation, changelog, updates, and issue reporting on macOS, Windows, and
  Linux.

### Changed

- Aligned Settings and Documentation with the website's neutral dark surfaces,
  brand action colors, compact radii, and operational typography.
- Made presets discoverable from the sidebar even before a workspace exists,
  from the bottom canvas toolbar, and from the native desktop menu.

## 0.1.5 - 2026-08-09

### Changed

- Reclassified terminal silence as a neutral idle state, with a green status
  indicator instead of a false attention warning.
- Renamed the terminal navigation shortcut to describe idle agents accurately.

### Fixed

- Stopped ordinary terminal silence and successful unload/reload exits from
  generating native desktop notifications; completion and attention messages
  now require an explicit event, while abnormal exits remain visible.
- Added a per-session composer delivery queue that preserves unfinished human
  drafts, serializes automated agent messages, and prevents concurrent input
  from being combined in the leader terminal.
- Removed the silent 4,000-character truncation from inter-agent messages.
- Corrected missing Brazilian Portuguese accents across the main UI, update,
  voice, workspace, task, terminal, and agent instruction surfaces, with a
  regression test for frequently mistyped words.

## 0.1.4 - 2026-08-08

### Changed

- Required every official macOS release to use Developer ID Application signing
  and Apple notarization; the ad-hoc fallback remains available only for local
  packaging.
- Added a release preflight gate for repository visibility and all five Apple
  signing/notarization secrets.
- Added the one-time dual-feed transition: `0.1.4` is published to both the
  main repository and the legacy public update repository, while future builds
  use the main repository feed.

### Fixed

- Prevented the release workflow from silently publishing an unsigned macOS
  package when a signing credential is missing.
- Added CI verification for the signing authority, Team ID, Hardened Runtime,
  Gatekeeper acceptance, and stapled notarization ticket on Apple Silicon and
  Intel app bundles.

### Notes

- macOS users on an unsigned or ad-hoc-signed build need one manual installation
  of `0.1.4`. This signed and notarized build opens normally and enables trusted
  in-place updates for subsequent releases.

## 0.1.3 - 2026-08-07

### Fixed

- Fixed the partial ad-hoc signature in the macOS `0.1.2` packages, which
  Gatekeeper reported as a damaged application.
- Applied complete ad-hoc signing to unsigned macOS bundles and added deep
  signature, DMG, and ZIP validation before publication.
- Disabled in-place replacement for unsigned macOS builds so the current
  installation is preserved and the app offers a manual download instead.

### Notes

- On first launch of an unsigned macOS package, try opening the app, dismiss the
  warning, then use **System Settings > Privacy & Security > Security > Open
  Anyway**. Automatic replacement without this warning requires Apple Developer
  ID signing and notarization.
- Windows packages were not affected by the macOS signing issue.

## 0.1.2 - 2026-08-07

### Changed

- Increased the automatic Usage refresh interval from 60 seconds to 5 minutes.
- Aligned the server cache with the same interval to prevent duplicate provider
  requests when the panel is reopened or the app returns to the foreground.
- Kept manual refresh as an explicit cache bypass.

### Fixed

- Reduced the risk of Claude HTTP 429 responses during long Usage sessions.

## 0.1.1 - 2026-08-07

### Fixed

- Moved `electron-updater` into production dependencies so installed apps
  contain the updater module.
- Replaced the incorrect "installed app only" diagnosis with a real package
  error when the updater module is unavailable.
- Ensured user-created Kanban tasks reach the leader with the complete title,
  Markdown description, and every attached image.
- Added regression coverage for complete task briefings and packaged updater
  availability.

### Notes

- Installations on `0.0.1` and `0.1.0` must install `0.1.1` manually once.

## 0.1.0 - 2026-08-07

### Added

- Added the first public cross-platform release pipeline for macOS Apple
  Silicon and Intel, Windows x64, and Linux x64.
- Added atomic draft publication with installer, blockmap, manifest, size, and
  SHA-512 validation.
- Added reliable update state reporting between Electron and the renderer.

### Fixed

- Prevented the manual-install fallback from opening on ordinary network or
  GitHub availability errors when no update was found.
- Matched Windows installer names to the assets referenced by `latest.yml`.

## Earlier Development - 2026-08-01 to 2026-08-06

Before the first public release, Orkestrai was rebuilt as a local-first visual
orchestrator with:

- a persistent multi-agent canvas, PTY sessions, Maestro orchestration, Git
  floors, task boards, notes, portals, flows, routines, roles, and presets;
- the native `orkestrai` CLI and MCP bridge for Claude Code, Codex, Kimi Code,
  and OpenCode;
- complete pt-BR, English, and Spanish UI, documentation, onboarding, and tours;
- local multilingual dictation and speech, provider Usage monitoring, managed
  portal ports, session resume, desktop notifications, and automatic updates;
- Electron packaging for macOS, Windows, and Linux with persistent user data.
