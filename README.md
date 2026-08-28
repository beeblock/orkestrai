<p align="center">
  <img src="orkestrai-branding/logo.svg" alt="Orkestrai" width="360">
</p>

<p align="center">
  <strong>Orchestrate AI teams for building, designing, marketing, and shipping on a visual canvas.</strong>
</p>

<p align="center">
  English · <a href="README.pt-BR.md">Português (Brasil)</a> · <a href="README.es.md">Español</a>
</p>

Orkestrai is a local-first desktop application for macOS, Windows, and Linux. It
brings Claude Code, Codex CLI, Kimi Code, OpenCode, Cursor, Antigravity, Cline,
Devin, shells, tasks, notes,
browsers, and Git worktrees into one persistent canvas where developers, vibe
coders, designers, marketers, and creators can direct an AI team in real time.

Download the latest installers from
[beeblock/orkestrai](https://github.com/beeblock/orkestrai/releases/latest).

For desktop troubleshooting, open **View → Developer tools** and reproduce the
problem with Console visible. **Help → Open logs folder** opens the rotating
`orkestrai.log`, which captures renderer and internal-server failures with
common credentials redacted; normal agent output is not persisted.

## Highlights

- **Live agent canvas:** arrange real PTY terminals, notes, task boards, browser
  portals, file trees, loops, and shapes. Connections show collaboration between
  agents as it happens. Rope physics automatically scales down in dense or
  offscreen graphs while active conversations retain their visual signal.
  Duplicate styled shapes with Cmd/Ctrl+D or copy and paste complete visual
  arrangements while preserving their relative layout.
- **Organized workspace creation:** create a regular or preset-based workspace
  directly inside a validated nested sidebar folder, either from the folder
  header or the New workspace dialog, without an intermediate root-level item.
- **Persistent Portal sessions:** authentication cookies, web storage, and the
  last navigated URL survive app restarts. Login flows opened with `window.open`
  stay in a sandboxed Orkestrai Portal window that shares the same session.
  Every Portal has a persistent, editable name separate from its address, so
  people and agents can target the correct browser by name or node id. The
  bridge inventories all workspace Portals with explicit connection state,
  reuses matching URLs, and requires explicit intent before adding another.
- **Configurable Workbench:** keep open terminals, boards, notes, portals,
  files, flows, and usage in vertical tabs by default or optional horizontal
  tabs, then arrange up to eight live artifacts in resizable right/down splits.
  Tabs move between panes by drag and drop or an accessible menu. The Workbench
  references canvas artifacts without duplicating sessions, while workspace
  files remain local editor tabs. Finished Floors retire their nodes instead of
  inflating the explorer, while active floor agents retain an explicit floor
  label. The global
  voice orb follows its active workspace and leader. Its footer keeps every
  reported Claude, Codex, and Kimi quota window visible without opening a panel.
- **Native API client:** organize HTTP/REST, GraphQL, WebSocket, and gRPC requests
  in nested folders with isolated drag-and-drop and context menus. Configure
  Bearer/Basic/API-key or assisted OAuth 2.0 authentication, cookies, proxy,
  custom CA and client certificates, protocol-specific messages, environments,
  source-compatible pre/post scripts, and assertions. Imported Postman
  JavaScript runs through the official Postman Runtime; Bruno and OpenCollection
  JavaScript runs through Bruno's official safe QuickJS runtime. Their separate
  scopes, sendRequest/runRequest callbacks, cookies, collection flow,
  visualizers, bundled Chai APIs, and legacy helpers remain available, while
  secret values stay in the operating-system-encrypted desktop vault. JSON,
  JavaScript, GraphQL, and XML use syntax-aware editors; structured responses
  are expandable. Persist any number of collection runners with a selected
  request order, environment, iterations with JSON data rows, delay, and
  stop-on-failure policy; variables produced by one response flow directly into
  the next request.
  Copy cURL; import Bruno, OpenCollection YAML, Postman Collection v2.1,
  Swagger 2.0, or OpenAPI 3.x; and export Bruno, OpenCollection, Postman, or
  OpenAPI 3.1 JSON/YAML while preserving unsupported REST metadata and showing
  explicit fidelity notes. Linked Bruno, OpenCollection, and Postman sources
  support guarded pull, atomic push, watch mode, and explicit conflict
  resolution. Agents can import project collections by relative path. For a
  coordinating workspace beside several repositories, explicitly authorize
  those roots in Edit workspace and address them through aliases such as
  `@api-tests/bruno`; typed edits persist in the actual repository files while
  arbitrary parent paths stay blocked. Postman environments
  import and export independently.
  A versioned `.orkestrai-api.json` format backs up the complete
  native collection, including folders, runners, environments, scripts, and
  history. The same node persists in Canvas and Workbench, and
  connected agents use typed MCP/CLI tools to import, fingerprint-read/replace,
  synchronize, execute, and export complete collections without receiving stored secrets in
  plaintext. Format-native requests, folders, scripts, tests, and variables are
  written back; Orkestrai-only runner configuration remains in the node and in
  lossless `.orkestrai-api.json` backups. The JavaScript editor provides runtime-aware completion for
  `bru`, `req`/`res`, `test`/`expect`, and `pm`; scripted tests live beside
  structured assertions and round-trip through Bruno and Postman.
  Bruno/OpenCollection GraphQL, WebSocket, and gRPC requests
  round-trip. Both source runtimes expose their bundled script libraries;
  Postman team Package Library, hosted datasets, mocks, and other
  cloud-owned state still require Postman's backend because they are not stored
  in a portable collection file. Bruno scripts deliberately stay in its official
  safe QuickJS runtime: unsafe NodeVM access to the host filesystem, processes,
  and arbitrary local modules is not enabled.
- **Native image workflows:** connect Notes, ordered PNG/JPEG/WebP Image
  references, and a live Codex agent to a Generate images node on the same
  canvas; the same node opens in Workbench. A connected Codex can create and
  configure the workflow, attach, remove, or reorder context and references,
  request one to ten outputs, run or cancel generation, and remove the workflow
  through the same typed bridge. It uses its authenticated built-in
  `image_gen.imagegen` tool, with one internal call per requested output and true
  PNG alpha requested in the prompt. Orkestrai never asks for or stores an image
  API key. It validates the preallocated workspace destinations before outputs
  return as connected Image nodes with provenance and bounded run history,
  ready to feed another branch. Humans, the bundled CLI, and typed MCP tools
  operate that same visible workflow without a parallel automation state.
  The guided use case can materialize and execute a complete Character → Brand
  → Carousel chain, including reusable briefs, a sample logo, persisted outputs,
  and automatic reference wiring between stages.
  Every interactive Codex terminal receives the MCP launcher from the current
  Orkestrai installation as a session-only override, so stale global Codex
  configuration cannot hide the image workflow tools.
- **Integrated mobile devices:** add a persistent Mobile Device node from the
  Canvas toolbar; Workbench lists and opens that same node and session. Control
  iPhone and iPad Simulators on Apple Silicon Macs, or Android AVDs and explicitly
  authorized physical devices on macOS, Windows, and Linux. Stream the screen,
  send gestures and system buttons, install and launch workspace apps, manage
  permissions, inspect bounded logs and accessibility data, and save screenshots.
  Android uses Android Studio Platform Tools plus the bundled scrcpy server; the
  live screen is decoded with WebCodecs and fits either surface by default.
  Agents run the same workspace-scoped flow through the bundled CLI or MCP tools.
- **Operational Control Center:** inspect every agent's current task, state,
  state duration, provider, role, and usage. Its persistent communications inbox
  projects every handoff into a canonical, idempotent message envelope and proves
  whether it was queued, delivered, acknowledged, replied to, or failed. A
  semantic activity timeline explains messages, tasks, reviews, decisions, Git,
  and system events without waking idle terminals after restart. The global
  Attention Center gathers questions, permission requests, blockers, and failures
  from every workspace, expands the full original message in place, and keeps
  source navigation separate when its agent or task still exists. Command/Ctrl+K
  recovers the same history with structured filters.
  Counts include only the Ground floor and currently active Floors; historical
  floor nodes stay archived for task attribution instead of appearing as agents.
- **Traceable Workstreams:** every active Kanban task becomes a live delivery
  view in Workbench, combining its assignee, Floor and branch, semantic history,
  Council decisions, Review Center evidence, exact Git revision, tests, risks,
  and linked files. It projects the existing records instead of creating a
  second tracker, and explicitly counts work that is not yet linked to a task.
- **Sourced workspace memory:** preserve reusable decisions, facts, preferences,
  constraints, references, and lessons with explicit evidence, immutable
  revisions, conflict protection, search, and archive history. Agents query the
  same memory on demand through typed MCP/CLI tools instead of receiving an
  expensive full-memory prompt on every turn.
- **Traceable annotations:** review code and native Design feedback from one
  Annotation Center in Canvas or Workbench. Every item keeps its canonical
  artifact, author, target, captured revision, resolution state, and stale-code
  warning; opening it returns to the original review or Design document.
- **Versioned Team Packs:** turn a working workspace into a portable team with
  agents, roles, skills, task stages, routines, MCP configuration, and layout.
  Semantic versions, release notes, immutable history, SHA-256 verification,
  bounded imports, and runtime-state stripping make packs safe to evolve and
  share without carrying live sessions or credentials.
- **Persistent agent Huddles:** bring a person and selected agents into one
  voice-assisted room with a facilitator, agenda, targeted turns, dictation,
  optional local TTS, and a durable bounded transcript. Agents contribute through
  typed CLI/MCP tools, remote participants use separate encrypted view/speak/manage
  permissions, and the completed conversation can become linked Kanban and
  Workstream evidence.
- **Encrypted workspace sharing (experimental):** host an end-to-end encrypted
  session, choose a browser/mobile or installed-app invite, approve the device
  fingerprint, and assign a Viewer, Collaborator, Operator, or Administrator
  role. The installable Remote PWA follows sanitized team state, tasks, reviews,
  activity, provider usage, and leader messages; its pairing key stays
  non-extractable in the browser and the invitation secret is removed from the
  URL before connecting. Installed-app invites open Orkestrai automatically;
  guests can also paste one through **Workspace → Join remote workspace**.
  Operators can hold a traceable structured conversation whose reply is bound
  to the exact turn across every registered provider. The overview keeps the
  leader thread visible and waits through intermediate tool use until the
  provider finishes the turn. Dictation is available for leader, agent, and
  terminal input through the host's local STT without exposing plaintext audio
  to the relay; terminal dictation inserts text without submitting it.
  Administrators can start or restore an agent. Raw terminal control is a
  separate Administrator-only switch for each approved device, disabled by
  default, responsive to its viewport, rate-limited, limited to one terminal,
  and audited. Files, notes, portals,
  credentials, private URLs, and local paths stay on the host. Access is
  revocable and every command is audited.
- **Traceable automations:** trigger work manually, on a schedule, from task or
  message events, Git commits, GitHub pull requests, webhooks, file changes, or
  provider usage thresholds. Actions can prompt an agent, create a Kanban task,
  or notify the desktop. Ready recipes, idempotent queued jobs, bounded retries,
  and execution history keep every run visible; GitHub credentials remain
  encrypted in Electron secure storage instead of the workspace database.
- **Git Review Center:** inspect staged and unstaged changes, compare files in a
  Monaco diff, create reviews linked to tasks and assignees, leave persistent
  file and line comments, and approve, reject, or request changes. Feedback is
  routed back to the responsible live agent without losing the review history.
- **Portal Design Mode:** point at the exact interface element that needs work,
  review its cropped screenshot and safe visual context, then track feedback in
  a new leader-triage task, a task assigned to an agent, or an existing task.
  Browser secrets and hidden state stay excluded.
- **Native Design Mode:** create structured interface documents directly on the
  Canvas and open the same artifact in Workbench. Draw vector paths with direct
  anchor, segment, and Bezier-handle editing; box-select and transform vector
  points, continue open paths, resize layers directly, and edit text in place,
  combine shapes, use masks, gradients, effects, snapping, guides, auto layout,
  grids, and responsive constraints; import SVGs as editable hierarchical vector layers,
  group or ungroup them, find and replace matching colors across the design,
  and copy or export a selection as SVG or PNG. Create typed design tokens in
  collections with multiple modes, aliases, presets, DTCG/CSS import, and
  DTCG/CSS/Tailwind export; audit repetition and bind compatible properties.
  Turn frames into reusable components with linked instances, properties,
  variants, slots, and local overrides. Publish versioned libraries only to
  authorized workspaces, and statically extract CSS variables, Tailwind tokens,
  and Svelte, React, or Vue component contracts without executing project code.
  Switching a mode updates every bound layer immediately, components and tokens
  are searchable, and agents use the same revision-safe operations through MCP.
  Raster images remain reusable
  assets, while full documents export to SVG, PNG, JPEG, WebP, or PDF. A designer or leader
  can edit the exact same revision through typed Orkestrai tools while the UI
  updates live. Documents, assets, thumbnails, and history stay under
  `.orkestrai/designs` in the workspace.
- **Guided UI exploration:** start from one objective and create a linked spec,
  eight progressive Kanban tasks, and three native directions: Clarity,
  Expressive, and Efficient. Each agent first renders one desktop and one mobile
  concept through compact semantic composition; the Canvas shows waiting,
  working, stalled, and ready states. A revision-aware visual review gate accepts
  or returns each concept with traceable feedback, while the automatic audit is
  kept explicitly structural. Only the approved direction expands into states,
  tokens, components, prototype, and framework code. Large directions remain
  navigable by trackpad, Hand tool, Space-drag, fit-all, and zoom down to 2%.
- **Live Design collaboration:** see human and agent presence, cursors, and
  selections; follow another participant; discuss a page or layer in anchored
  comment threads; and review visual proposals as structural diffs before an
  explicit approval applies them atomically. Short layer leases prevent
  conflicting edits. Proposals can move into Council or an isolated Git Floor,
  while the encrypted Remote Companion receives only sanitized summaries and
  separately granted View, Comment, Propose, Edit, and Decide permissions.
- **Official Figma interoperability:** the managed official Figma MCP gives
  compatible agents direct design context, while the native Figma tab inspects
  links and imports selected pages or frames, vectors, assets, styles,
  variables, components, variants, instances, and external-library identities
  into the same Orkestrai document. Linked
  sources compare remote and local hashes before selective synchronization, and
  existing Code Connect mappings form a Figma node → Orkestrai layer → code
  relationship. A bundled first-party, loopback-only plugin transfers live
  selections, editable SVG or structural JSON, opens an Orkestrai document on a
  new Figma page with native design resources, and sends only linked local
  changes reviewed in Orkestrai back to the current file.
  REST credentials stay encrypted in the operating-system vault.
- **Design delivery and visual validation:** import HTML/Tailwind, Svelte,
  React/JSX, or Vue structure as editable native layers, then generate
  Svelar/Svelte 5, React, Next.js, Vue 3, or HTML/Tailwind from a selected frame
  with a complete preview before writing. Existing component mappings are
  reused first, generated files open in Monaco, and the live implementation can
  be captured from a Portal or attached iOS/Android device. Pixel diff and an
  adjustable overlay link the visual result to a Kanban feedback task or the
  Review Center Git diff. Claude, Codex, Kimi, and other connected agents use
  the same revision-safe import, preview, and protected-write flow through the
  bundled CLI or typed MCP tools.
- **Interactive prototypes and native motion:** connect any layer to another
  frame, overlay, scroll target, history action, or variable mode using click,
  press, hover, and timed triggers. Preview flows in a focused player with
  transitions, fixed layers, overflow, hotspots, and device framing, then
  share a self-contained read-only HTML prototype. Reusable motion tokens,
  per-layer tracks, keyframes, easing, CSS keyframes, and Motion.dev output all
  remain inside the same revisioned Design document, editable by people and
  connected agents without a parallel prototype file.
- **Council decisions:** open Council from the Canvas toolbar, the workspace in
  Workbench, or `Cmd/Ctrl+K`, then ask two to five real agents for independent,
  budget-limited perspectives on one task or objective, compare the same
  evidence, risk, test, disagreement, and confidence contract, then record the
  human selection, consensus request, or rejection. Implementation prototypes
  stay in isolated Git floors and land only after an explicit safe preview.
- **Universal search:** press `Cmd/Ctrl+K` to find workspaces, agents, tasks,
  notes, roles, skills, files, settings, and commands, with recent and favorite
  items plus direct actions to open in the current pane, right, or below.
- **Rich local editor and previews:** browse the workspace's native file tree
  and open files directly in local Workbench tabs, without creating canvas
  nodes. The lazy-loaded Monaco editor keeps undo, cursor, dirty state, find/replace,
  formatting, outline, minimap, wrapping, and optional autosave. Preview
  Markdown, PDFs, and images offline; binary files show safe metadata and open
  through the system application.
- **Shared reference material:** drop, paste, or select images, PDFs, files, and
  HTTP/HTTPS links in agent prompts, task cards, notes, and composers. Files up
  to 10 MB stay inside the workspace under `.orkestrai/attachments/`, and agents
  receive the complete relative path or URL.
- **Maestro mode:** assign a leader that can propose a team, recruit agents,
  delegate complete task briefings, coordinate work, and dismiss agents when the
  work is done. Recruitment inherits the leader's active Floor and is confirmed
  only after the provider terminal starts; task assignment restores an offline
  agent and moves to progress only after the briefing is delivered.
- **Ready-made teams:** start or expand a workspace with complete Product,
  Campaign and launch, Brand and design, Content and SEO, React, Next.js,
  SvelteKit, Svelar, Laravel, and Orkestrai Contributing presets. Their agents
  start with autonomous full access and native system/developer-level roles,
  with validated Kimi agent-file frontmatter and without long instructions
  blocking the terminal as pasted text. The lead receives and assigns the
  complete initial task without repeated prompts.
- **Workflows that fit the work:** name, color, and reorder up to ten board
  stages. Leads and agents discover and update the same stages automatically.
- **Operational team views:** install specialized roles from a 12-role catalog
  or discover reusable `.orkestrai/roles/` definitions from another selected
  project folder, then inspect each task title, stage, assignee, and Git state
  across every floor. Imported roles stay bounded, validated, and confined to
  the selected project.
- **Native agent bridge:** the bundled `orkestrai` CLI and MCP server expose
  typed commands for messages, tasks, notes, portals, mobile devices, floors,
  roles, and desktop notifications. Codex receives the Orkestrai and official
  Figma MCP definitions as ephemeral launch overrides, so workspace
  provisioning never rewrites the user's global `~/.codex/config.toml`.
- **Parallel workspaces:** agents continue running when you switch to another
  workspace, with activity indicators and native notifications.
- **Mixed Windows and WSL runtimes:** choose a default runtime per workspace,
  then let each terminal inherit it, use native Windows, or target an exact WSL
  distribution and Linux project path. Provider discovery, sessions, resume,
  Council, recruited agents, and the bridge follow each terminal, so one team
  can combine tools installed across Windows, Ubuntu, Debian, or other distros.
  Orkestrai validates the selected Linux environment before spawn and restores
  only a conversation confirmed inside that distribution's own home. Maestro
  recruitment validates and starts the PTY in that same environment instead of
  leaving a hidden or non-running agent record behind.
- **Git floors:** isolate work in Git worktrees, inspect conflicts, and land
  completed changes from the canvas.
- **Local voice:** dictate into any text field or use the no-focus workspace
  shortcut for the leader, then listen to replies in Brazilian Portuguese, US
  English, or Latin American Spanish. Terminal dictation can optionally submit
  with Enter; regular text fields remain insert-only. Choose and test the input
  and output devices under Settings → Voice; every dictation surface, preview,
  and spoken reply follows that preference and falls back safely if the device
  is removed. Dictation records direct PCM through the same path as the live
  input meter, normalizes quiet speech, and distinguishes an input with no
  signal from speech that could not be recognized. The voice orb's pin badge
  opens its position controls directly, while the tooltip also reveals the
  platform shortcut. STT and TTS run locally.
- **Quota-aware delegation:** pin Claude, Codex, and Kimi usage to the canvas,
  configure a source, fallback, 5-hour/weekly/monthly window, and threshold,
  and let the leader consult the same recommendation through the CLI or MCP
  before assigning new work. The same panel inventories Antigravity, Cursor,
  Devin, OpenCode, and Cline and explains their documented CLI, admin-API, or
  model-provider usage source without inventing a percentage. Leader routing
  stays at the top of the node, while provider details scroll independently in
  compact nodes without zooming the canvas.
- **Production Design quality:** audit naming, clipping, overlap, WCAG contrast,
  and accessibility, jump to the affected layer, start from complete editable
  product, marketing, mobile, and design-system templates, and rely on automatic
  backups, recovery, schema migration, bounded history, and incremental rendering
  for large documents. Agents use the same typed audit and template commands.
- **Custom appearance:** start from a coherent graphite-and-gold dark system or
  a high-contrast light palette, choose the other built-in themes, or duplicate
  one and edit semantic tokens with live preview and JSON import/export.
- **Readable terminals:** choose 1 of 11 complete ANSI palettes from the compact
  terminal options menu, alongside provider, role, reload, and Maestro controls.
  Font metrics settle before PTY reattachment so the cursor remains aligned
  after switching between Canvas, Workbench, Settings, and documentation.
- **Reusable terminal commands:** save searchable commands for one terminal or
  globally, execute them manually in any terminal, or opt pure shells into a
  once-per-session startup command. Agent conversations never auto-run saved
  text, and the UI warns against storing credentials in plain-text commands.
- **Project-isolated environments:** shells retain the user's operating-system
  environment and the Orkestrai bridge without inheriting the desktop server's
  private configuration. Framework `.env` files stay authoritative, including
  Laravel's `APP_KEY` for encrypted application data.
- **Operational controls:** manage local portal ports, configure recurring
  routines, and install skills from the marketplace.
- **Provider Center:** detect all nine supported CLIs locally, follow OS-aware
  installation and official sign-in guidance, inspect public service status,
  and route named account profiles without persisting credentials in canvas
  data.
- **Personal agent toolbar:** choose any service from one compact Agents menu
  and pin up to four ready favorites globally across workspaces and restarts.
- **Replaceable providers:** switch a team member from Claude to Codex, Kimi, or
  another installed provider while preserving its role, floor, and connections.
- **Session continuity:** each terminal resumes its own provider conversation
  after the application is closed and reopened.

## Supported Platforms

| Platform | Architectures | Package |
| --- | --- | --- |
| macOS | Apple Silicon and Intel | DMG and update ZIP |
| Windows | x64 | NSIS installer |
| Linux | x64 | AppImage and RPM |

The desktop application uses your locally installed agent CLIs. Install and
authenticate only the providers you plan to use:

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- [Codex CLI](https://github.com/openai/codex)
- [Kimi Code](https://www.kimi.com/code)
- [OpenCode](https://opencode.ai/)
- [Cursor Agent CLI](https://docs.cursor.com/en/cli/overview)
- [Antigravity CLI](https://antigravity.google/docs/cli/getting-started)
- [Cline CLI](https://docs.cline.bot/cli/cli-reference)
- [Devin CLI](https://docs.devin.ai/cli)
- [GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli)

You do not need every provider or terminal expertise. Orkestrai enables the CLIs
it detects, keeps their conversations separate, and lets you organize agents by
outcome: research, design, content, marketing, product, engineering, or review.
Open Provider Center from the canvas cable icon, `Cmd/Ctrl+2`, or the native
Workspace menu to prepare a provider and check it again after installation.
New installations start in English and ask for the preferred interface language
as the first onboarding step.

## Development

Requirements:

- Node.js 24 or newer
- npm 11 or newer
- Git

```bash
git clone https://github.com/beeblock/orkestrai.git
cd orkestrai
npm ci

npm run dev            # SvelteKit at http://localhost:5173
npm run electron:dev   # production build followed by Electron
```

Voice works without Docker or Python. On first use, Orkestrai asks before
downloading the embedded runtime and local models. An OpenAI-compatible voice
sidecar remains available as an optional backend.

## Architecture

Orkestrai is built with Svelte 5, SvelteKit, Electron, Svelar, SQLite,
`node-pty`, and `@xyflow/svelte`.

- `src/lib/modules/agent-room/` contains the application, domain, persistence,
  PTY, bridge, voice, and provider adapter layers.
- `src/lib/modules/collaboration/` owns host sessions, sanitized projections,
  role policies, commands, device approval, revocation, and audit records.
- `src/routes/canvas/`, `src/routes/terminal/`, and
  `src/lib/components/agent-room/canvas/` implement the two desktop workspace
  views.
- `packages/orkestrai-cli/` provides the agent-facing CLI and MCP bridge.
- `packages/orkestrai-collaboration-protocol/` defines the versioned encrypted
  envelope for Node and browser WebCrypto clients;
  `packages/orkestrai-relay/` is an opaque WebSocket
  transport that cannot decrypt workspace content. The production service is
  available at `wss://relay.orkestrai.app/v1/connect`.
- `electron/` owns the desktop lifecycle, native notifications, and updates.
- `docs/` contains build and release documentation.

Read [AGENTS.md](AGENTS.md) before changing the architecture. It documents the
required Svelar flow, i18n rules, release discipline, and platform constraints.

## Quality Checks

```bash
npm test
npm run build
npm run test:e2e
```

End-to-end tests run serially against the production build. Follow the cleanup
rules in [AGENTS.md](AGENTS.md) after packaging or E2E runs.

## Contributing

Contributions are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md) and use
GitHub Issues for reproducible bugs and focused proposals. Report security
problems privately as described in [SECURITY.md](SECURITY.md).

## Releases

Tags follow Semantic Versioning. The `Release Desktop` workflow builds all
platforms, validates update manifests, and publishes verified artifacts as
[GitHub Releases](https://github.com/beeblock/orkestrai/releases).
See [docs/releases.md](docs/releases.md) for the complete process.

## License

Orkestrai is licensed under the [Apache License 2.0](LICENSE). Third-party
components and downloaded models remain subject to the licenses listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
