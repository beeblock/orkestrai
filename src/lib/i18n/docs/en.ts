import type { DocsCatalog } from './types.js';

/** /docs page content in English — mirror of pt-BR.js (same ids, order and structure). */
export const DOCS_EN: DocsCatalog = {
  quickstart: [
    'Create a workspace (+ button in the sidebar) pointing to your project folder.',
    'Open Agents in the bottom bar, choose an available service, and drag a rectangle on the canvas — name it, optionally choose model/effort, and check Leader if it will command the team.',
    'Draw more agents and connect them by dragging from one handle dot to the other.',
    'Open the Tasks board (+ Tasks), create cards and assign them — each task lands straight in the agent\'s terminal.',
    'Talk to any agent through its own terminal, or let the leader distribute everything on its own via the orkestrai CLI.',
  ],
  sections: [
    {
      id: 'workspaces',
      title: 'Workspaces',
      body: `A workspace = a team on a project: working directory, icon and canvas layout saved. Create it with the + button in the sidebar. Several workspaces run at the same time — agents stay alive in the background when you switch. Instructions in AGENTS.md/CLAUDE.md are injected into the agents (edit with the pencil next to the name). The ⏻ button (Unload) shuts down its live terminals and keeps the workspace paused across navigation and app restarts, without deleting anything. Open that workspace explicitly to resume its agents and conversations. On macOS, projects in Downloads, Documents, or Desktop require system consent; if access expires, Canvas and Workbench show Authorize folder so you can select the same directory again and continue without restarting the app.`,
    },
    {
      id: 'workspace-folders',
      title: 'Organize workspaces into folders',
      body: `Group workspaces into folders in the sidebar once you have several projects (per client, per team, per environment). Type a name in "New folder" at the bottom of the list to create one at the root; drag a workspace onto a folder's header to file it there, or drag it onto empty space in the list to send it back to the root. A new workspace can start inside a folder right away too: use the plus icon in that folder's header, or pick any folder from the Folder field in the New workspace dialog itself. Folders nest inside other folders the same way, with no depth limit — drag one folder onto another to make it a subfolder, or use the "new subfolder" icon in any folder's header to create one already inside it; a folder can never be dropped into itself or into one of its own subfolders. Double-click a folder's name or use its pencil icon to rename it, and each folder remembers whether it's collapsed across restarts. Deleting a folder (trash icon, with confirmation) is never destructive: every workspace and subfolder inside it moves up to the root instead of being removed.`,
    },
    {
      id: 'wsl-runtime',
      title: 'Windows workspaces with WSL',
      body: `On Windows, the environment selected when creating or editing a workspace is the team default. Each terminal can inherit it or use Execution environment in the creation dialog and compact terminal menu to force native Windows or one specific WSL distribution. Select the exact Ubuntu, Ubuntu-22.04, Ubuntu-24.04, Debian, or other installation and provide the Linux path for the same project folder. A single workspace can therefore combine Windows and WSL agents, including different distributions. A WIN or WSL badge identifies an override. Provider detection and models, PTY, exact conversation resume, Council, recruited agents, and the orkestrai bridge follow each terminal's effective runtime. Maestro recruits inherit the leader's active Floor and are confirmed only after the PTY starts in the correct environment; a failed launch removes the incomplete node. When a task is assigned, Orkestrai starts or resumes an offline agent and moves the card to In progress only after the complete briefing is delivered. Orkestrai validates the CLI in that distribution and confirms the provider transcript inside its own Linux home before persisting or restoring an id; an empty agent starts clean instead of guessing the latest conversation. Changing runtime restarts only that terminal. Missing distributions, directories, or commands produce distinct actionable errors without a silent native-Windows fallback.`,
    },
    {
      id: 'agentes',
      title: 'Agents: create, name, model & effort',
      body: `The Agents menu in the bottom toolbar lists Claude, Codex, Kimi, OpenCode, Cursor, Antigravity, Cline, Devin, and GitHub Copilot without crowding the canvas. Pin up to four favorites to keep them beside the menu; the ordered preference persists across workspaces and restarts, and an unavailable pinned agent stays saved without occupying the toolbar. You do not need terminal expertise or every provider: start with a service you already use, then add another when you want an independent perspective. Agents that need setup lead to Provider Center, also available from the cable icon in the sidebar, Cmd/Ctrl+2, or the native Workspace menu. When you draw an agent, the dialog asks for name, model, and effort only when that provider offers them, plus Leader (Maestro Mode). After creation, the compact header menu holds provider and profile switching, roles, a visual choice of 15 ANSI themes, context-preserving reload, Maestro Mode, and removal; the title remains editable with a double-click. Changing provider preserves connections, role, floor, and position, closes the previous conversation, and starts a clean session.`,
    },
    {
      id: 'provider-center',
      title: 'Provider Center',
      body: `Provider Center checks all nine supported CLIs locally and separates agents that are ready from those that still need setup. Expand a provider to see its official guide, an installation command for your operating system when available, sign-in instructions, detected capabilities, live public status when available, and named Profiles through the CLI's documented account-directory mechanism. Orkestrai never authenticates an agent silently or stores Profile credentials in canvas data; sign-in remains inside the official CLI and profile values are resolved server-side only when a PTY starts. Use Check again after installing, then return to the canvas.`,
    },
    {
      id: 'roles',
      title: 'Roles (team roles)',
      body: `Roles are instruction sets saved in .orkestrai/roles/<slug>/role.json, so they travel with the repository. In the Roles panel, Catalog offers complete functions for leadership, product, architecture, frontend, backend, Svelar, QA, security, accessibility, documentation, release, and performance; install with + and customize under Workspace. In presets, Claude receives the role as a system prompt, Codex as developer instructions, and Kimi through its agent file before the first message; other providers receive only a short reference to the role AGENTS.md instead of a long terminal paste. The leader can also reassign roles with orkestrai reassign. "Discover from another folder..." picks any directory and imports the role.json files found under its .orkestrai/roles/, so a role built in one project can be reused from an unrelated one.`,
    },
    {
      id: 'times',
      title: 'Teams: parallel, leader & Loop',
      body: `All agents run in parallel (independent processes). Coordination happens through connections: agent asks agent with orkestrai ask, or the Leader (★ Maestro) distributes with task/ask and recruits/dismisses with recruit/dismiss. The Loop Ralph node is the sequential mode: leader plans → engineer implements → tester reviews, for up to N rounds. Routines fire scheduled prompts into any terminal.`,
    },
    {
      id: 'council',
      title: 'Council: compare independent perspectives',
      body: `Open Council directly from the Canvas toolbar, at the top of the workspace in Workbench, or through Command/Ctrl+K. Ask perspectives on a task carries its full brief; the leader menu preselects that leader for synthesis. Run two to five real agents against the same objective, choose advisory or implementation mode, give each agent a distinct approach, select the decision criterion, and set a hard execution budget. Every perspective returns the same structured evidence, risks, tests, disagreements, recommendation, and confidence contract; one failed provider does not discard successful answers. An optional leader synthesis consumes one more execution, but the final select, request-consensus, or reject decision is always human and persisted. Council is the decision layer; Floors are the isolation layer. Git implementation perspectives run in separate floors, and only the selected committed result can be landed after a fresh diff, dirty-check, and conflict preview. Nothing merges or pushes automatically.`,
    },
    {
      id: 'control-center',
      title: 'Control Center and verified communications',
      body: `Open Control Center at the top of each expanded workspace in the Workbench explorer. It reconstructs the state of every Ground and currently active Floor agent from an append-only history; agents from finished Floors remain historical but do not enter current counts. Floor badges distinguish active worktrees. States include starting, working, waiting for input or permission, blocked, idle, done, error, or disconnected. Each row shows the current task, latest relevant action, time in state, provider, role, and available usage. Activity presents the same history as a semantic timeline of messages, tasks, reviews, decisions, Git work, and system events; raw metadata stays collapsed for diagnostics. Communications projects every queued, sent, delivered, acknowledged, replied, and failed transition into one durable message envelope with a content fingerprint, correlation id, deduplication key, and attempt history. Repeating the same event is idempotent, while reusing an id for different content or a different recipient is rejected. The global Attention Center, opened from the bell beside Canvas/Workbench, gathers questions, permission requests, blockers, and failures from every workspace, prioritizes the current workspace, and supports read, snooze, resolve, and direct source navigation. Command/Ctrl+K searches this history with filters such as type:, agent:, workspace:, status:, has:error, before:, and after:. These states survive navigation and app restarts without waking idle terminals. Canvas edges remain the visual history of real conversations, while delivery uses the bridge and does not depend on an edge.`,
    },
    {
      id: 'workstreams',
      title: 'Workstreams: one trace from task to delivery',
      body: `Open Workstreams under a workspace in the Workbench explorer or through Command/Ctrl+K. A workstream is not another project tracker: each active Kanban task is the canonical identity, and the view projects its current column, assignee, active Floor and branch, semantic activity, Councils, Review Center records, exact Git revision, evidence, tests, risks, and linked files. Backlog, active, review, blocked, and done stages are derived from those real sources. Starting a Council from the workstream carries the task brief, while opening the board or Review Center returns to the original editable record. Unlinked decisions, reviews, activity, and changed paths remain counted instead of being silently attributed to the wrong task.`,
    },
    {
      id: 'workspace-memory',
      title: 'Workspace memory with evidence',
      body: `Open Workspace memory from Command/Ctrl+K, the Canvas, or the workspace explorer in Workbench. Save only durable decisions, facts, preferences, constraints, references, and lessons; each entry requires one or more explicit sources such as a user statement, note, task, canonical message, workspace file, URL, Git evidence, review, Council, or agent. Sources keep labels, bounded excerpts, links, and content fingerprints. Revisions never overwrite earlier knowledge: they supersede it with optimistic concurrency protection, while archive keeps the audit trail. Agents use memory_search only when context is relevant, then memory_add or memory_revise with evidence; Orkestrai never injects the entire memory into every prompt or treats casual conversation as fact.`,
    },
    {
      id: 'annotation-center',
      title: 'Annotation Center: feedback with its source',
      body: `Open Annotation Center from Canvas, the Workbench workspace explorer, or Command/Ctrl+K. It does not copy comments into another tracker: it projects every Review Center code comment and native Design thread from its canonical artifact. Search open or resolved feedback and inspect its author, exact file, line or layer, captured revision, updated time, and task relationship. A code comment is marked stale when its captured file content no longer matches the current workspace. Open source returns to the original review or Design document, where resolution remains authoritative.`,
    },
    {
      id: 'team-packs',
      title: 'Team Packs: portable, versioned teams',
      body: `Open Team Packs from the Canvas preset library. Existing presets and the built-in catalog remain compatible; a custom workspace snapshot now starts at version 1.0.0 and includes its agents, roles, portable skills, task stages and templates, routines, additional MCP servers, connections, and layout. Publish a larger semantic version with release notes to create an immutable local revision. Export a checksum-protected .orkestrai-team-pack.json file or import one after bounded schema, size, integrity, and content validation. Live sessions, conversation ids, credentials, and other runtime state are stripped. Import creates a new local pack instead of silently replacing one with the same package identity.`,
    },
    {
      id: 'huddles',
      title: 'Huddles: persistent conversations with people and agents',
      body: `Open Huddles from the Canvas toolbar, Workbench explorer, native Workspace menu, Command/Ctrl+K, or Remote PWA. Start one active room per workspace with a topic, optional agenda, one facilitator, and up to eleven agents plus the person who starts it. Dictate or type each turn, address up to five participating agents, and optionally hear new replies through the existing local TTS. The bounded transcript, participant history, pending/failed replies, and lifecycle survive navigation and restart without waking unrelated terminals. An agent can contribute through huddle list/say in the CLI or typed MCP tools without recursively triggering the room. End the huddle explicitly or create a linked Kanban task containing its agenda and transcript; Workstreams displays that session as delivery evidence. Remote collaboration applies separate view, speak, and manage scopes over the existing encrypted transport. This is a structured, voice-assisted conversation, not an always-open audio call.`,
    },
    {
      id: 'review-center',
      title: 'Source Control and Review Center',
      body: `Open Review Center under each workspace in the Workbench explorer to inspect staged and unstaged changes without leaving Orkestrai. The header shows the branch, upstream, and commits ahead or behind; the source list stages, unstages, commits, pulls, pushes, and discards tracked edits only after confirmation. Selecting a file opens a bounded Monaco side-by-side diff; binary and oversized files get explicit safe states. Start a review to link its exact Git revision to a task, responsible agent, summary, evidence, tests, risks, and selected files. Click either side of the diff to attach a file or line comment. When the repository changes, old comments remain visible as outdated context instead of silently pointing at a different line. Approve, request changes, or reject in plain language; requested changes are submitted directly to the responsible agent when its terminal is available, and remain persisted when it is offline.`,
    },
    {
      id: 'portal-design-mode',
      title: 'Portal Design Mode',
      body: `In the installed desktop app, open a Portal and choose Inspect design in its header. Hover highlights the real page element without changing it; click captures a bounded selector, visible text, relevant computed styles, viewport and a cropped PNG. Review that context, describe the expected result, and track it as a new task for leader triage, a new task already assigned to an agent, or an update to an existing task. The screenshot and context stay together on the Kanban board for traceability. Escape cancels inspection. Raw HTML is preview-only and sanitized; query strings, cookies, headers, tokens, storage and hidden page state are never added automatically.`,
    },
    {
      id: 'mobile-device',
      title: 'Mobile Device in Canvas and Workbench',
      body: `Add Mobile Device from the Canvas toolbar. It is one persistent workspace node; Workbench lists and opens the same node and session. On Apple Silicon Macs with Xcode installed, choose an iOS Simulator. On macOS, Windows, or Linux with Android Studio Platform Tools installed, choose a local AVD or an ADB-authorized USB or network device; physical devices require an explicit confirmation before Orkestrai attaches. The panel streams the screen and sends taps, swipes, pinch gestures, rotation, Home, text input, and Android Back and Recents. The complete screen automatically fits Canvas and Workbench; independent controls zoom out, zoom in, restore automatic fit, or use 1:1 with horizontal and vertical scrolling. The tool drawer installs .app/.ipa or .apk builds, launches an iOS bundle id or Android package/activity, saves screenshots under .orkestrai/devices/screenshots, reads bounded logs and the accessibility or UIAutomator tree, and inspects or changes permissions. Agents receive the same workspace-scoped actions through the orkestrai device CLI and MCP tools after the user starts a session. Orkestrai stops only helpers and simulators or emulators it started; one node and session are allowed per workspace and idle sessions are cleaned up.`,
    },
    {
      id: 'api-client',
      title: 'API client for REST contracts and collections',
      body: `Add API Client from the Canvas toolbar to work with HTTP/REST, GraphQL, WebSocket, and gRPC without switching applications. Build nested folders, drag requests by their dedicated handle, and use contextual run actions without moving the Canvas node. Configure query parameters, headers, Bearer, Basic, API-key, or OAuth 2.0 authentication; authorization-code flows open the system browser with state and optional PKCE, while client credentials, password, and refresh-token grants run directly. HTTP and WebSocket connections share a cookie jar, proxy, custom CA, client PEM/key or PKCS#12 certificate, and TLS verification controls. GraphQL has query, variables, and operation editors; WebSocket supports subprotocols, multiple text/JSON/binary messages, keepalive, reconnect, and a bidirectional transcript; gRPC loads local proto files and executes unary, client-streaming, server-streaming, or bidirectional methods with metadata and TLS. JSON, JavaScript, GraphQL, and XML fields use code editors with syntax color, search, wrapping, and formatting. Responses render JSON and XML as expandable trees with copy controls and preserve a text or binary fallback. Choose Native Orkestrai, Postman, or Bruno in Scripts. Postman collections execute with the official Postman Runtime; Bruno and OpenCollection scripts execute with Bruno's official safe QuickJS runtime. Their scope APIs, request helpers, network callbacks, cookies, flow control, tests, Chai assertions, and visualizers run without translating the source script. Vault values are encrypted by the installed desktop app. Saved runners keep their own order, environment, iteration data, delay, and stop policy. Import Bruno, OpenCollection YAML, Postman v2.1, Swagger 2.0, or OpenAPI 3.x; local OpenAPI references stay inside the selected contract directory and remote references are never fetched. Bruno and OpenCollection retain executable GraphQL, WebSocket, and gRPC requests on round trip. Linked Bruno, OpenCollection, and Postman sources can be pulled or pushed, watched every five seconds, and resolved explicitly when disk and Orkestrai both changed; OpenAPI links remain pull-only. Export Bruno, OpenCollection, Postman, OpenAPI 3.1, Postman environments, or a lossless versioned Orkestrai backup. Postman cloud-only services such as team Package Library and hosted datasets still require Postman's backend and are not portable collection behavior. The same node persists in Canvas and Workbench, and connected agents list and execute saved requests through api_client_list and api_client_execute without receiving stored credentials in inventory responses.`,
    },
    {
      id: 'api-client-scripts',
      title: 'API Client scripts and tests',
      body: 'Use this reference in Script editors and in the Tests tab, which separates Assertions from JavaScript. The editor completes bru.*, req/res, test/expect, and pm.* for the selected runtime and fills the available panel. The examples below can be copied directly.',
      bullets: [
        'Execution order is collection pre-request, folder pre-request from root to leaf, request pre-request, network call, request post-response, Tests JavaScript, folder post-response from leaf to root, collection post-response, then native assertions.',
        'Postman scopes remain separate as pm.globals, pm.collectionVariables, pm.environment, pm.iterationData, and pm.variables. Bruno exposes the equivalent environment, global, collection, runtime, secret, and runner iteration APIs. Use {{name}} in every request field.',
        'Postman supports pm.sendRequest, pm.execution.runRequest/setNextRequest/skipRequest, cookies, vault, visualizer, legacy globals, pm.require for bundled libraries, accurate pm.info iteration metadata, and the complete bundled Chai API. Bruno supports bru.sendRequest/runRequest, req/res helpers, request and folder variables, post-response variable blocks, declarative assertions, tests blocks, cookies, runner flow, visualizations, bundled libraries, and global test/expect/assert.',
        'Imported scripts are preserved and executed by their selected source runtime, so no JavaScript transpilation is needed. Postman team Package Library, hosted datasets, mocks, and other cloud-owned state require Postman services; they are not contained in a portable collection file. Bruno stays in its official safe QuickJS runtime: unsafe NodeVM access to the host filesystem, processes, and arbitrary local modules is deliberately disabled. The native .orkestrai-api.json format remains the lossless backup for Orkestrai-only state.',
        'Agents and leads can import an existing Bruno, OpenCollection, or Postman collection with api_client_import and a repository-relative path. For a coordinating workspace beside several repositories, open Edit workspace > Additional repositories, authorize each root, and use its alias such as @api-tests/bruno. api_client_read/replace edits the same node shown in the UI and writes linked sources back by default; sync-status, pull, and push expose conflicts before either side is replaced. Absolute paths, unregistered parent paths, and symlink escapes stay blocked. Format-native requests, folders, scripts, tests, and variables remain ordinary project files ready for git, Bruno, Postman, and CI; Orkestrai-only runner configuration stays in the node and lossless native backup.',
      ],
      examples: [
        {
          id: 'postman',
          title: 'Postman-compatible scripts',
          description: 'Select Postman: Pre-request prepares data, Post-response captures variables, and Tests > JavaScript receives pm.test/pm.expect. Runner rows feed pm.iterationData.',
          snippets: [
            {
              id: 'pre-request',
              title: 'Request · Pre-request',
              code: `const requestId = 'req-' + Date.now();

const tenant = pm.iterationData.get('tenant');

pm.variables.set('requestId', requestId);
pm.globals.set('lastTenant', tenant);
pm.request.headers.upsert({
  key: 'X-Request-Id',
  value: requestId,
});

pm.vault.get('apiKey').then((apiKey) => {
  pm.request.headers.upsert({ key: 'X-API-Key', value: apiKey });
});

console.log('Request prepared:', requestId, tenant);`,
            },
            {
              id: 'post-response',
              title: 'Request · Post-response',
              code: `let body;

pm.test('Status is 200', () => {
  pm.expect(pm.response.code).to.equal(200);
});

pm.test('Body is valid JSON', () => {
  body = pm.response.json();
});

if (body) {
  pm.test('Response contains access_token', () => {
    pm.expect(body).to.have.property('access_token');
  });

  pm.test('Response contains a user id', () => {
    pm.expect(body).to.have.property('user');
    pm.expect(body.user).to.have.property('id');
  });

  if (body.access_token) {
    pm.environment.set('accessToken', body.access_token);
  }

  if (body.user?.id) {
    pm.environment.set('userId', body.user.id);
  }

  pm.execution.setNextRequest('Load user');
  console.log('Authenticated user:', body.user?.id);
}`,
            },
            {
              id: 'javascript-tests',
              title: 'Tests > JavaScript',
              code: `pm.test('Status is 200', () => {
  pm.expect(pm.response.code).to.equal(200);
  pm.expect(pm.response.json()).to.have.property('user');
});`,
            },
            {
              id: 'next-request',
              title: 'Next request · using the variables',
              code: `GET {{baseUrl}}/users/{{userId}}
Authorization: Bearer {{accessToken}}
X-Request-Id: {{requestId}}`,
            },
          ],
        },
        {
          id: 'bruno',
          title: 'Bruno-compatible scripts',
          description: 'Select Bruno: use Pre/Post-response for automation and Tests > JavaScript for the official test(...) body. Export wraps it in tests { } automatically.',
          snippets: [
            {
              id: 'pre-request',
              title: 'Request · Pre-request',
              code: `const login = await bru.runRequest('Auth / Login');
const token = login.data.access_token || bru.getVar('accessToken');

if (!token) {
  throw new Error('The accessToken variable is missing');
}

req.setHeader('Authorization', 'Bearer ' + token);
req.setHeader('Accept', 'application/json');

console.log('Authenticated request');`,
            },
            {
              id: 'post-response',
              title: 'Request · Post-response',
              code: `const body = res.getBody();

test('User was created', () => {
  expect(res.getStatus()).to.equal(201);
  expect(body).to.have.property('id');
});

bru.setVar('createdUserId', body.id);
bru.setVar('lastStatus', res.getStatus());
bru.setNextRequest('Load user');

console.log('Created user:', body.id);`,
            },
            {
              id: 'javascript-tests',
              title: 'Tests > JavaScript',
              code: `test('User was created', () => {
  expect(res.getStatus()).to.equal(201);
  expect(res.getBody()).to.have.property('id');
});`,
            },
          ],
        },
        {
          id: 'orkestrai-native',
          title: 'Native Orkestrai: assertions and JavaScript',
          description: 'In Tests, switch between structured assertions and JavaScript. The native runtime accepts pm.test/pm.expect or test/expect; use assertions for simple checks.',
          snippets: [
            {
              id: 'javascript-tests',
              title: 'Tests > JavaScript',
              code: `test('Status is 200', () => {
  expect(res.getStatus()).to.equal(200);
});

pm.test('Body is JSON', () => {
  pm.expect(pm.response.json()).to.have.property('data');
});`,
            },
            {
              id: 'declarative-tests',
              title: 'Tests tab · assertions',
              code: `Source          Path             Operator       Expected
Status          —                Equals         200
Body            data.user.id     Exists         —
Header          content-type     Contains       application/json
Response time   —                Less than      1000`,
            },
            {
              id: 'variables',
              title: 'Native environment and template',
              code: `Collection variable: baseUrl = https://api.example.com
Environment variable: accessToken = <active environment token>
Script-created variable: userId = 42

URL: {{baseUrl}}/users/{{userId}}
Header: Authorization = Bearer {{accessToken}}`,
            },
          ],
        },
      ],
    },
    {
      id: 'notas',
      title: 'Notes as work channels',
      body: `Notes are living markdown shared with the agents. The convention: connect the note to whoever should read/write it and state the purpose in the title and content. E.g.: a "Backlog (leader writes)" note connected to the leader — you write "break this into tasks for the team" and it reads it with orkestrai note read and distributes it on the board. A "For me (human)" note — ask the leader to log status/decisions there with orkestrai note write/edit, and you follow along formatted (eye icon). Double-click the title to rename the note. Drop, paste, or select images, PDFs, other files, and HTTP/HTTPS links; files up to 10 MB stay in .orkestrai/attachments/ and their markdown reference is inserted at the cursor. Removing an attachment with its X also removes that reference and deletes the stored workspace file.`,
    },
    {
      id: 'tarefas',
      title: 'Tasks (kanban)',
      body: `The Tasks node (+ Tasks in the bottom bar) is the workspace board. Use the columns icon in its header to name, color, reorder, and create up to ten stages that match your process. The lead and team see those stages automatically and keep each delivery's real state current. "Add task" opens a complete composer with title, markdown description, and images, PDFs, files, or links; you can also drop them directly onto a card. Assigning a card dispatches its title, description, and every reference to the agent. At startup, the leader receives every unassigned task with its complete brief and must record/assign work on the board before delegating by message. task done sends a notification labeled Task completed and automatically hands completion back to the leader as soon as its composer is free; Project completed is reserved for the real end of the project. Completed work can be archived without losing history.`,
    },
    {
      id: 'imagens',
      title: 'Image node (visual reference)',
      body: `The Image tool (bottom bar) creates a visual reference node on the canvas: mockup, screenshot, architecture diagram. Paste with Ctrl+V or click to pick the file — the image is saved in the workspace (.orkestrai/images/). Connect the node to the leader (or to a specific agent, like the designer) to make clear who should use that reference, and say in chat what to do with it. Double-click the title to rename; the image icon in the header swaps the file.`,
    },
    {
      id: 'image-workflows',
      title: 'Native image generation workflows',
      body: `Open the Image menu in the Canvas toolbar and choose Generate images. This workflow is part of the existing canvas: connect Notes for palette, character rules, art direction, exclusions, or campaign context; connect up to five ordered PNG, JPEG, or WebP Image references; and connect a live Codex agent as executor. An authenticated Codex account or plan with ImageGen available is required; no OpenAI API key is needed. Numbered thumbnails show the exact reference order. Enter a prompt, choose one to ten outputs, optionally request a genuine transparent PNG background, and set a relative workspace folder (generated/images by default) plus a safe filename prefix. Generate delegates one logical run to that Codex session. The agent produces and validates each output independently; when genuine alpha is required and ImageGen returns an opaque PNG or a rendered checkerboard, it automatically edits that result to remove the background and retries up to three times before stopping. Orkestrai never requests or stores an image API key, never calls an image provider endpoint directly, and does not invent model, quality, size, or format controls that the native tool does not expose. A connected Codex has full typed control over this visible workflow through image_workflow_*: it can create and configure a draft without executing it, connect, disconnect, or reorder Notes and Images, add reference files from the workspace, claim and run generation, validate each output, complete or cancel it, and remove the workflow. The executor copies each native result to its preallocated workspace destination and calls image_workflow_validate before image_workflow_complete. Orkestrai accepts only that connected Codex and those exact paths, decodes every PNG with safe dimension limits, and verifies real transparent pixels when requested before creating connected Image nodes with input hash, source workflow, run id, output index, duration, and bounded history. Outputs can feed another workflow as references. Cancel invalidates the active run so a late completion cannot be materialized; abandoned executions also expire after a bounded time. Canvas, Workbench, CLI, and MCP operate the same persisted graph without parallel automation state.`,
      bullets: [
        'Every Codex terminal started from Canvas receives the MCP launcher from the current Orkestrai installation as a session-only override. An old global Codex configuration cannot hide image_workflow_* tools, and the user-owned config file is never rewritten.',
        'Background removal is always another native image_gen.imagegen edit using only the rejected output as reference and the validator\'s dedicated prompt. Python, Pillow, ImageMagick, ffmpeg, remove-bg, generated masks, and local pixel processing are forbidden.',
      ],
    },
    {
      id: 'visual-annotations',
      title: 'Shapes and visual annotations',
      body: `Use Shapes in the Canvas toolbar to draw rectangles, rounded boxes, ellipses, diamonds, and editable curved arrows around the work. Double-click to edit the text; the style control changes fill, opacity, border, dash, typography, and arrow anchors. Select a shape and use its duplicate action or Cmd/Ctrl+D to preserve its exact size, text, style, and arrow geometry with a small offset. Cmd/Ctrl+C and Cmd/Ctrl+V copy and paste one or several selected shapes while keeping their relative spacing; every copy is a separate persistent node that remains independently editable.`,
    },
    {
      id: 'design-mode',
      title: 'Native Design Mode',
      body: `Add Design from the Canvas toolbar to create a structured visual document stored under .orkestrai/designs in the project. Double-click its preview or use expand to open the same document in full Canvas Design Mode or Workbench. Draw frames, rectangles, ellipses, text, and Pen paths at any size; Shift keeps proportions and Alt/Option draws or resizes from the center. Pen previews the next segment and close target: click for corners, drag for curves, click the first anchor to close, or press Enter/Escape to finish an open path. Select a path and press Enter or double-click it to enter vector editing. Drag anchors and handles, drag a segment to bend it, double-click a segment to split it, and choose Corner, Mirrored, Asymmetric, or Disconnected tangents from the contextual toolbar. Shift-click or box-select multiple points, then move, nudge, delete, or resize them as a group; choose Pen and click an endpoint to continue an open path. Selected layers expose eight resize handles, path geometry scales with its bounds, rotated vectors edit in place, and text supports direct in-canvas editing and multiline wrapping. Shift-select layers to align, distribute, combine with union, subtract, intersect, or exclude, and create or release masks. Group layers with Cmd/Ctrl+G and ungroup with Shift+Cmd/Ctrl+G; moving or resizing a group transforms its descendants, while Alt selects a nested layer directly. Stack solid or linear/radial gradient fills and strokes; add shadows, blur, blend modes, rulers, persistent guides, and snapping. Color tools list and select every layer using the same fill or stroke, apply one color to the selection, or replace matching solids and gradient stops across the page. Frames support horizontal, vertical, wrapping, and grid auto layout, padding and gaps, while child constraints respond when a frame is resized. Paste, drop, or choose an SVG to convert paths, primitive shapes, source group hierarchy, nested transforms, styles, gradients, and references into editable native vector layers; raster PNG, JPEG, WebP, and GIF files remain reusable assets. Copy the current selection as SVG or PNG, or export selected artwork or the full page as SVG, PNG, JPEG, WebP, or PDF; editing controls never appear in exports or thumbnails. Open Variables beside Layers to create typed tokens in collections, add modes such as Light and Dark, reuse a token through an alias, and bind compatible fill, stroke, opacity, radius, typography, spacing, padding, or effect properties from the inspector. Start from product, marketing, or mobile presets, import DTCG JSON or CSS variables, export DTCG, CSS, or Tailwind, and audit duplicate or unused tokens, repeated values, and component candidates. Under Components, turn a frame or group into a reusable source, create linked instances, expose text, visibility, and slot properties, swap an instance or variant, keep local overrides, or detach a copy. Under Libraries, publish a version only to selected workspaces, import and sync it without losing local placement, or detach editable local copies. Under Code, a read-only scan extracts CSS variables, static Tailwind configuration, and Svelte, React, or Vue contracts without executing project files; link visual components and synchronize tokens by source hash. Switching the active mode updates every bound layer immediately. Tokens and components appear in universal search and the Design node summary. Toolbar tooltips include shortcuts, Delete removes the selected points or layers, Escape steps out of point and vector editing, arrow keys nudge by one and Shift by ten, and undo/redo uses typed operations. Every mutation records a revision and bounded history. Connect the Design node to a leader or specialist so they can read and edit the exact scene graph through typed Orkestrai MCP tools, including tokens, components, instances, properties, variants, slots, and library links. Human and agent edits use optimistic revision checks, update open editors live, and never require direct JSON rewriting.`,
    },
    {
      id: 'design-collaboration',
      title: 'Live Design collaboration',
      body: `Open Collaboration in the Design inspector to work on the same native document with people and agents. Live presence shows each participant's page, cursor, and selection; Follow keeps your viewport on one participant until you stop it. Selecting a layer claims a short renewable lease, so another participant receives a clear conflict instead of overwriting the same layer. Add a thread to the page or selected layer, mention teammates, reply, resolve, or reopen it; threads and authorship remain in the revision history even if a layer is removed. A visual proposal previews position, size, opacity, and fill changes without mutating the document, lists its structural diff, and applies all operations atomically only after an explicit approval. Send a proposal to Council for independent perspectives or create a parallel Git Floor for isolated implementation. Connected agents use the same versioned comment, propose, and decide operations through Orkestrai MCP and cannot simulate human approval. In encrypted workspace sharing, Design access is approved separately per device as None, View, Comment, Propose, or Edit and decide. Remote receives sanitized pages, activity, threads, and proposal summaries, never the full scene graph, assets, files, credentials, or local paths.`,
    },
    {
      id: 'design-quality',
      title: 'Design quality and recovery',
      body: `Open Quality in the Design inspector to audit meaningful layer names, clipped text or content, accidental overlap, WCAG text contrast, and accessibility metadata. Selecting an issue focuses its exact layer. The same panel applies complete editable product, marketing, mobile, or design-system templates through the revision-safe command bus. Every valid write keeps an automatic backup; corrupted primary documents recover from it, large histories compact automatically, and manual restore creates a new revision instead of rewriting history. Documents above 500 layers render only the visible region plus selected layers and their hierarchy. Connected agents can run the same audit or apply a template through typed MCP and CLI commands.`,
    },
    {
      id: 'presets',
      title: 'Team presets',
      body: `The Preset library is available from the template icon in the sidebar and Presets in the bottom toolbar. Alongside Product, React, Next.js, SvelteKit, Svelar, and Laravel, it includes Campaign and launch, Brand and design, Content and SEO, and Orkestrai Contributing. Each recipe includes a lead, specialists, extensive operational roles, skills, a brief, board, initial task, and layout; the contributing team also requires Claude, Codex, and Kimi consensus. Preset agents start with autonomous full access and receive roles through the CLI's native instruction mechanism without leaving the terminal blocked by pasted text. The leader receives the complete initial task and must assign it before delegating. Use New workspace for another folder or + to add the team to the current canvas.`,
    },
    {
      id: 'fluxos',
      title: 'Flows (agent pipelines)',
      body: `The Flow node (+ Flow in the bottom bar) is a visual pipeline: steps in sequence, where one agent's output becomes the next one's input via {{input}} in the prompt. An "Agent" step talks to the chosen agent (the edge lights up meanwhile) — if the agent's terminal was never opened, the flow starts its session by itself; an "Approval" step pauses until you click Approve — human in the loop. Repetition with a limit (up to 5 rounds). Two superpowers: the SYNC button creates an Agent step for each agent connected to the flow (in edge order — build the pipeline by drawing); and CHAINED FLOWS — when a Flow finishes successfully, its final output triggers the Flows connected to it (failure does not chain, cycles are blocked). Progress shows live on the node, errors show in a banner at the top of the node (nothing fails silently) and the history of the last 5 runs is stored in it. Use it for chained reviews (writes → reviews → approves), compound pipelines (research → writing → SEO) or fan-out from one flow to many.`,
    },
    {
      id: 'sem-medo',
      title: 'Diff, Loop & Floors — fearlessly (for non-devs)',
      body: `Three buttons that look scary but are friendly: DIFF is just a comparator — it shows side by side what changed in the code between two versions, without touching anything. LOOP (Loop Ralph) is an autopilot: the team repeats the plan → do → review cycle by itself until the number of rounds you picked. FLOORS are safety copies of the project: each team works on a separate copy and nobody messes with the main version — in the end, the app helps merge everything back (and warns about conflicts beforehand). Click away without fear: nothing here deletes your work.`,
    },
    {
      id: 'conexoes',
      title: 'Connections',
      body: `Drag from one node's dot to another — the connection is bidirectional and the dot floats along the edge, always at the closest point to the other node. The dashed rope has physics (swings when you move) and glows animated green while the agents talk. Orkestrai automatically reduces simulation work in large canvases and for offscreen connections, while selected and active conversations retain their visual signal; hidden windows and reduced-motion mode stop animation. Hover shows the remove X; click pins the X. Connecting installs the bridge skill on the agents (they learn the orkestrai CLI on their own).`,
    },
    {
      id: 'andares',
      title: 'Floors (worktrees)',
      body: `A floor is a git worktree of the workspace repository with its own branch. For Ground and every active worktree, the Floors panel shows agents and a list of tasks with title, stage, and assignee, alongside changed files, branch synchronization, and the latest commit. Workbench and Control Center identify the floor of active agents. Landing or deleting automatically archives that floor's terminals, layout copies, and edges: they remain available for historical attribution but do not inflate counts or appear as current agents. Cloning a layout never reuses a PTY session or provider conversation. Create from the panel or CLI with orkestrai floor create/list/preview/land/remove; recruit --floor places a new agent on the selected active floor. Landing merges after a diff and conflict preview. Conflicts are never hidden: the error lists files and resolution becomes an explicit task.`,
    },
    {
      id: 'rotinas',
      title: 'Automations',
      body: `Open Automations from the Canvas toolbar, the Workbench explorer, or Command/Ctrl+K. A trigger can be manual, scheduled, a task change, a confirmed agent message, a Git commit, a GitHub pull request, a webhook, a file or folder change, or a provider usage threshold. Actions send a prompt to one agent, create a traceable Kanban task, or show an explicit desktop notification. Development, design, marketing, research, and operations recipes provide safe starting points. Every run records trigger input, target agent/provider, quota snapshots, output acknowledgement, duration, attempt, and recoverable failure; retries are bounded and duplicate event deliveries are idempotent. GitHub tokens are encrypted by Electron safeStorage and never stored in the workspace database. Legacy scheduled Routines remain compatible and appear here automatically.`,
    },
    {
      id: 'portal',
      title: "Portal (the agents' browser)",
      body: `The Portal node is an embedded browser. Give each Portal a persistent name with the pencil in its header; its address lives in the separate navigation bar. Agents list every Portal in the workspace with name, URL, id, and connection state, then target it by unique name or id: orkestrai portal <name-or-nodeId> navigate (open URL), eval (run JS on the page), dom (read the HTML), screenshot. An unconnected Portal still exists and should be reused; creating an additional Portal requires explicit intent. Connected to an agent, it becomes the agent's eyes. Use it to test the app the team is building (point the portal at the dev server) or to research the web. In the desktop app, links and login flows that request a new window open in a sandboxed Orkestrai Portal window instead of the system browser, preserving window.opener and the shared Portal session. Persistent cookies and web storage are flushed to disk, and the node restores its last navigated URL after restart; sites may still intentionally use session-only cookies that expire on close. Full automation runs in Electron; in a regular browser the portal is viewer-only. The phone icon in the Portal header opens a responsiveness toolbar, similar to a browser's device toolbar: pick a device preset (iPhone, Pixel, iPad, laptop, desktop) or type an exact width/height, rotate orientation, or turn it off to go back to filling the node. The page's real viewport changes to that exact size — the same as resizing a real window — so its own responsive CSS reacts normally; if the emulated size is larger than the node, the Portal scrolls to it rather than shrinking or distorting the page.`,
    },
    {
      id: 'mcp',
      title: 'MCP (external tools for agents)',
      body: `MCP is the standard for giving external tools to agents (GitHub, Gmail, Figma, Drive, Postgres...). THE EASY WAY: Skills page (sidebar) → MCPs tab — search the official curation or MCP registry and install with one click; when a server needs a key/token, the app explains where to get it. Remote servers require no command. ADVANCED: pencil next to the workspace → "MCP Servers". AUTOMATIC: Orkestrai provisions its own bridge for Claude/Kimi (.mcp.json), OpenCode (opencode.json), Cursor (.cursor/mcp.json), Cline (.cline/mcp.json), Devin (.devin/mcp_config.json), and Antigravity (.agents/mcp_config.json), plus skills and a preserved AGENTS.md block. Codex receives the Orkestrai bridge and official Figma MCP as ephemeral launch overrides, so the app does not rewrite ~/.codex/config.toml. Every agent receives typed canvas tools scoped to the correct workspace.`,
    },
    {
      id: 'cli',
      title: 'orkestrai CLI (the bridge)',
      body: `Agents use the orkestrai CLI to act on the canvas: list, ask, usage, huddle list/say, note read/write/edit/create, task list/columns/add/move/assign/done/archive/history, role show/write/edit, floor create/list/preview/land/remove, notify, recruit/dismiss/connect/reassign, portal, device, port, fs, run, say, clip, notes, and portals. ask preserves unquoted multi-word messages, but a conversation counts only after the bridge returns Confirmed reply; a timeout or unconfirmed reply exits with an error. usage returns current quotas and the recommendation configured in the Usage node. huddle list/say lets a participating agent read the bounded transcript and contribute without recursively triggering agent replies. task columns returns the stages you defined; task add --column and task move let the lead and team follow any process, not only a software kanban. device lists, attaches, controls, inspects, captures, and stops the workspace mobile simulator. task done also notifies the leader automatically. MCP-speaking agents receive the same actions as native tools through orkestrai mcp. Bridge provisioning is automatic and the token lives in .orkestrai/workspace.json.`,
    },
    {
      id: 'usage-routing',
      title: 'Usage and quota-aware routing',
      body: `Open Usage in the bottom toolbar and use Add to canvas to keep provider capacity visible in the workspace. Leader routing appears first in the node: choose the source, fallback, 5-hour/weekly/monthly window, and threshold without resizing it. Provider details follow in a contained scroll area that supports mouse, trackpad, touch, and keyboard without zooming the canvas; previously saved compact nodes use the same scrolling behavior. Claude, Codex, and Kimi expose machine-readable windows through the credentials already owned by their CLIs; only these verified percentages participate in automatic source/fallback routing. The same panel lists Antigravity, Cursor, Devin, OpenCode, and Cline with their real official capability: Antigravity exposes quota in its AI Credits and Model Quotas panels, Cursor and Devin require separate Team/Enterprise administrative credentials, and OpenCode/Cline expose usage through their own account console, settings, or the selected model provider. No unavailable provider receives a fabricated percentage. The node refreshes automatic sources every five minutes, links to official documentation, and warns when the selected policy window is unavailable. A task already in progress is never moved to another terminal silently.`,
    },
    {
      id: 'appearance',
      title: 'Themes and appearance',
      body: `In Settings → Appearance, choose Orkestrai Dark, Graphite, Midnight, or Orkestrai Light. The default dark palette pairs graphite surfaces with the brand gold; the light theme keeps readable contrast across panels, canvas nodes, icons, provider marks, buttons, and hover states. To personalize one, duplicate any theme and edit its semantic tokens; the preview appears immediately and Save persists it. Custom themes can be exported or imported as validated JSON without accepting arbitrary CSS.`,
    },
    {
      id: 'atalhos',
      title: 'Shortcuts',
      body: `⌘P palette · ⌘K (or Ctrl+K) search documentation from any screen · ⌘2 Provider Center · ⌘⇧A next attention · ⌘⇧T organize selected nodes, or the whole canvas when none are selected · Cmd/Ctrl+D duplicate selected shapes · Cmd/Ctrl+C and Cmd/Ctrl+V copy and paste selected shapes · ⌘G group · ⌘⇧G ungroup · N new note · L connect selected · Alt+1…9 focus terminal · Alt+Space voice dictation · ⌘F search terminal · ⌘Z undo · Backspace delete. In Windows terminals, Ctrl+V pastes native clipboard text; when the clipboard has no text, the original CLI shortcut remains available for image paste. On Windows, the styled title bar provides File, Edit, View, Workspace, Window, and Help while preserving window controls; macOS and Linux keep their platform menus.`,
    },
  ],
  useCases: [
    {
      id: 'leader-team',
      title: 'Dev team with a leader (zero-config)',
      body: 'Create a Claude and say: "orchestrate feature X for me". It proposes the team, you approve, and it recruits, connects and distributes through kanban. Each ask consultation counts only after explicit bridge confirmation; when an agent uses task done, the leader receives the handoff automatically to review and coordinate the next step.',
      tags: ['Leader/Maestro', 'recruit/dismiss', 'kanban'],
    },
    {
      id: 'watch-24-7',
      title: '24/7 employee (task watcher)',
      body: 'Routine every 1–5 min on the leader: "check the board (orkestrai task list); assign whatever is unassigned; if an agent is missing, recruit". The whole team works without you touching anything — assigning dispatches the task straight to the agent\'s terminal.',
      tags: ['Routines', 'task assign', 'auto-dispatch'],
    },
    {
      id: 'parallel-features',
      title: 'Two features in parallel with no conflicts',
      body: 'One floor (worktree) per feature: team A on the Ground floor on main, team B on the "auth-refactor" floor. When done, floor preview shows conflicts first; land merges. A conflict becomes a task for an agent to resolve.',
      tags: ['Floors/worktrees', 'floor land', 'branches'],
    },
    {
      id: 'council-decision',
      title: 'Compare approaches before committing the team',
      body: 'Open Council from the Canvas toolbar, the top of the workspace in Workbench, or Command/Ctrl+K. Starting from a task carries its complete brief. Ask three agents to independently evaluate architecture, delivery risk, and cost. Keep advisory mode for a decision only, or implementation mode for isolated prototypes. Compare the normalized matrix, read the optional leader synthesis, and record your own selection, consensus request, or rejection. Only a selected implementation with a clean target and conflict-free preview can be landed.',
      tags: ['Council', 'human decision', 'isolated floors'],
    },
    {
      id: 'api-client-workflow',
      title: 'Bring a REST contract into the team workflow',
      body: 'Add an API Client and import Bruno, OpenCollection YAML, Postman v2.1, Swagger 2.0, or OpenAPI 3.x. For a project that already owns Bruno/Postman tests, ask the lead or agent to use api_client_import with the repository-relative path. If the workspace coordinates sibling repositories, authorize them in Edit workspace > Additional repositories and use aliases such as @api-tests/bruno. The same collection appears in Canvas and Workbench, subsequent api_client_replace edits persist in the original repository files, and unregistered parent paths remain blocked. Organize folders, environments, and runners, write automation and JavaScript tests with completion, run the suite, inspect sync conflicts, then commit the changed collection with the rest of the project.',
      tags: ['REST collections', 'scripts + tests', 'Canvas + Workbench'],
    },
    {
      id: 'visual-annotations',
      title: 'Reuse a visual explanation without rebuilding it',
      body: 'Style one shape or a complete arrangement of labels, containers, and arrows. Duplicate a selected shape with its action or Cmd/Ctrl+D, or copy and paste a multi-selection to create another version with the same geometry and spacing. Edit the copied text and colors independently while the original stays unchanged.',
      tags: ['Shapes', 'copy and paste', 'Canvas annotations'],
    },
    {
      id: 'visual-qa',
      title: 'Visual QA of your application',
      body: 'Portal pointed at the dev server (http://localhost:5173) connected to an agent: "open the portal, run the checkout flow, take a screenshot and tell me what broke". The agent navigates, runs JS, reads the DOM and reports.',
      tags: ['Portal', 'screenshot', 'eval/dom'],
    },
    {
      id: 'mobile-qa',
      title: 'Reproduce and verify an iOS or Android flow',
      body: 'Add Mobile Device to Canvas or open it from Workbench. Attach an iOS Simulator on Apple Silicon, an Android AVD on macOS, Windows, or Linux, or explicitly confirm an ADB-authorized physical Android device, then install a workspace build. The same persistent node and session remain available in both views. The complete screen fits the pane by default; use zoom, 1:1, and two-axis scrolling to inspect details. You or an agent can tap, swipe, type, rotate, use system buttons, change permissions, inspect accessibility data, capture screenshots, and collect bounded logs while keeping every artifact inside the project.',
      tags: ['iOS/Android', 'mobile QA', 'CLI/MCP'],
    },
    {
      id: 'research-summary',
      title: 'Automated research with summary',
      body: '"Use the Research Portal to read about X, create a note called X Summary and write the findings in bullet points." The agent browses, extracts and writes — you read it formatted in the connected note.',
      tags: ['Portal', 'notes', 'note create'],
    },
    {
      id: 'inbox-files',
      title: 'File inbox processed by itself',
      body: 'Routine every 2 min: "list ./inbox; for each new image, describe and classify it; move it to ./inbox/done and log it on the board". Drop files in the folder and the team processes them in batches, nonstop.',
      tags: ['Routines', 'folders', 'batch'],
    },
    {
      id: 'cross-review',
      title: 'Cross-review between providers',
      body: 'Connect Claude and Codex: Claude implements, Codex reviews (orkestrai ask), the verdict comes back on the same rope (it glows green during the conversation). Two different model perspectives on every change.',
      tags: ['Connections', 'ask', 'multi-provider'],
    },
    {
      id: 'choose-agent-provider',
      title: 'Choose an agent without learning CLIs',
      body: 'Use a provider you already have installed and authenticated; Orkestrai handles the terminal, bridge, and conversation resume. Claude, Codex, Kimi, OpenCode, Cursor, Antigravity, Cline, and Devin appear in the same toolbar when available. For a campaign, visual identity, research, content, or product work, name agents after the outcome you need and add a second provider only when you want an independent review.',
      tags: ['8 providers', 'no terminal knowledge', 'any profession'],
    },
    {
      id: 'pin-favorite-agents',
      title: 'Keep favorite agents one click away',
      body: 'Open Agents in the bottom toolbar and pin up to four services you use most. Ready favorites become direct buttons beside the menu in your chosen order across every workspace and app restart; a temporarily unavailable service stays in your preference without taking toolbar space.',
      tags: ['Agents menu', 'pinned favorites', 'global preference'],
    },
    {
      id: 'setup-agent-provider',
      title: 'Prepare an AI provider without guessing commands',
      body: 'Open Provider Center to see which agents this device can already use. Expand Claude, Codex, Kimi, OpenCode, Cursor, Antigravity, Cline, or Devin for OS-aware installation guidance, complete sign-in in the official CLI, and use Check again before returning to the canvas.',
      tags: ['Provider Center', 'guided setup', 'local credentials'],
    },
    {
      id: 'deploy-sentinel',
      title: 'Deploy/test sentinel',
      body: 'Hourly routine on a shell or agent: "run the tests; if they fail, open a task for the team and notify me (orkestrai notify)". You get a native system notification and the kanban already has the card.',
      tags: ['Routines', 'notify', 'local CI'],
    },
    {
      id: 'automate-workspace',
      title: 'Automate repeatable work with an audit trail',
      body: 'Open Automations in Canvas or Workbench, start from an operations, research, design, marketing, or development recipe, then choose the exact trigger and action. Use task and message events for coordination, file or commit changes for local workflows, usage thresholds for routing safeguards, webhooks for external systems, and the encrypted GitHub connection for pull requests. The execution history shows what fired, which agent received it, what action completed, and whether a bounded retry is available.',
      tags: ['Automations', 'triggers', 'execution history'],
    },
    {
      id: 'framework-preset',
      title: 'Preset for your framework (new project in 30s)',
      body: 'Open the Preset library and choose React, Next.js, SvelteKit, Svelar, or Laravel. The project starts with connected lead, implementation, architecture, and QA agents, complete roles, Claude/Codex skills, a board, and an initial task. Agent terminals use the provider adapter’s autonomous full-access mode so the team can execute without repeated confirmations. Save the workspace as a preset to duplicate and customize the recipe.',
      tags: ['Preset library', 'roles/skills', 'bootstrap'],
    },
    {
      id: 'portable-role-library',
      title: 'Reuse a specialist role from another project',
      body: 'Open Roles, choose "Discover from another folder...", and select the project that owns the role. Orkestrai validates the bounded role files under that project\'s .orkestrai/roles directory, imports only new role names, and never overwrites an existing workspace role.',
      tags: ['Roles', 'portable instructions', 'safe import'],
    },
    {
      id: 'custom-workflow',
      title: 'A board with the stages of your process',
      body: 'Open Stages in the Tasks header and build the flow that fits your work: Ideas → Production → Review → Approval → Published. The lead and specialists automatically read and update those stages without requiring you to learn commands.',
      tags: ['Custom stages', 'approval', 'any process'],
    },
    {
      id: 'campaign-launch',
      title: 'A complete campaign without assembling a team',
      body: 'Choose Campaign and launch in the Library. The canvas starts with campaign lead, market research, copy, channels and measurement, plus a brief and first task. For visual or editorial work, use Brand and design or Content and SEO.',
      tags: ['Marketing', 'design', 'content'],
    },
    {
      id: 'orkestrai-contributing',
      title: 'Contribute to Orkestrai with three perspectives',
      body: 'Apply Orkestrai Contributing. Claude leads, Codex and Kimi act as independent oracles and both must approve the plan before any task is created; Svelar, desktop, and QA/release specialists execute the documented plan.',
      tags: ['Claude + Codex + Kimi', 'consensus', 'open source'],
    },
    {
      id: 'approval-pipeline',
      title: 'Pipeline writes → reviews → approves',
      body: 'Flow with 3 steps: Dev writes the feature, Reviewer critiques it (one output becomes the other\'s {{input}}) and the Approval step pauses until you OK it on the node. Progress shows live and the latest runs stay in the flow history.',
      tags: ['Flows', 'human approval', 'pipeline'],
    },
    {
      id: 'chained-flows',
      title: 'Chained flows (pipeline of pipelines)',
      body: 'Connect one Flow to another on the canvas: when the first finishes successfully, its final output triggers the next one automatically (failure does not chain, cycles are blocked). E.g.: Flow "Research" → Flow "Writing" → Flow "SEO review", or fan-out — one Flow "extract topics" feeding the "EN translation" and "ES translation" Flows at the same time. And with the Sync button, each agent connected to the Flow becomes a step in edge order — the pipeline is the drawing itself.',
      tags: ['Flows', 'chaining', 'fan-out'],
    },
    {
      id: 'ui-exploration',
      title: 'Create three complete UI directions before implementing',
      body: 'Open Design in the Canvas toolbar and choose Three complete UI directions. Enter the objective, audience, platform, code target, constraints, references, and whether both Light and Dark are required. Orkestrai creates one traceable group with a linked spec, eight progressive Kanban tasks, and three native Design documents: Clarity, Expressive, and Efficient. Each designer starts with only one representative desktop screen and one mobile screen, preferably through semantic HTML/CSS import, and must show a first revision within five minutes. The node status distinguishes waiting, working, stalled, and ready for review. Open the document and use Visual review under Quality to approve it or return traceable feedback; layer counts and the structural audit do not replace that inspection. Only the approved direction expands into responsive states, typed tokens, components, prototype, and real framework code preview. Pan wide documents with the trackpad, Hand (H), Space-drag, or middle mouse button and use Fit. Finish by validating the approved result against a Portal or mobile device and recording it in Review Center.',
      tags: ['3 UI directions', 'design + tokens + code', 'human approval'],
    },
    {
      id: 'design-figma',
      title: 'Design an interface together with your AI team',
      body: 'Add a native Design node and open it in Canvas Design Mode or Workbench. Build vector paths, masks, gradients, responsive auto-layout frames, and reusable image assets yourself, or paste an SVG to turn its paths, transforms, styles, and gradients into editable native layers. Group or ungroup artwork, select every layer that uses the same color, replace matching colors across solids and gradient stops, then copy a selection as SVG or PNG. Under Variables, use presets, import or export tokens, define modes and aliases, bind properties, and audit repetition. Under Components, create sources, instances, properties, variants, slots, and overrides. Publish versioned libraries only to authorized workspaces, or extract and synchronize CSS variables, Tailwind, and Svelte, React, or Vue contracts through the static Code scan. In the Figma tab, keep the official MCP managed for compatible agents, store a read-only REST token in the operating-system vault, inspect a file link, choose pages or frames, and import layers, vectors, assets, styles, variables, components, variants, local instances, and external-library identities into the same native document. Linked sources compare remote and local hashes before a selective sync, so you explicitly resolve Figma changes, local edits, and conflicts. Choosing the local version queues only that reviewed layer for Figma. The first-party plugin transfers the live Figma selection with raster assets, copies editable SVG or structural JSON, imports an Orkestrai document with native assets, variables, styles, components, and variants on a new Figma page, and sends only queued linked changes back to the current Figma file through a loopback-only workspace connection. Connect the document to a Designer or leader: the agent reads the exact current revision, combines the official Figma MCP with typed Orkestrai Figma/import/sync tools, and verifies the result while your editor refreshes live. Existing Code Connect mappings complete the persistent Figma node → Orkestrai layer → implementation link. Export the approved selection or page to SVG, PNG, JPEG, WebP, or PDF. The document, assets, thumbnails, design system, Figma links, and revision history stay in the workspace and remain searchable alongside tasks, notes, files, portals, and the rest of the team.',
      tags: ['Native Design Mode', 'vectors + auto layout', 'manual + agents'],
    },
    {
      id: 'design-delivery',
      title: 'Turn design into code and verify the implementation',
      body: 'Open a native Design document and choose Components → Code. Import HTML/Tailwind, Svelte, React/JSX, or Vue structure as editable native layers without executing project code. For delivery, select a frame or group, choose the Svelar/Svelte 5, React, Next.js, Vue 3, or HTML/Tailwind adapter, review the complete generated file, and only then write it inside the workspace. Compatible Code Connect mappings reuse the real project components first; the linked artifact opens directly in Monaco and refuses to overwrite a file changed after preview. Connected agents use design_import_code and design_generate_code_preview/apply through the typed Orkestrai MCP, or the equivalent bundled CLI commands, with the same revision and task attribution. In Validate, choose a live Portal or attached iOS/Android device and a frame, mobile, tablet, or desktop viewport. Orkestrai captures the implementation, normalizes both images, and shows the design, implementation, adjustable overlay, and pixel diff. Create a Kanban feedback task with all three screenshots or create a Review Center entry tied to the actual Git change so a leader or specialist can reproduce, assign, and approve the result.',
      tags: ['design to code', 'pixel diff', 'Monaco + Review Center'],
    },
    {
      id: 'design-prototype',
      title: 'Prototype and animate the experience before implementation',
      body: 'Open a native Design document and switch the right inspector from Design to Prototype. Create one or more starting flows, select any layer, and attach click, press, hover, or timed interactions that navigate to a frame, open or close an overlay, return through history, scroll to content, or switch a variable mode. Frames can scroll horizontally or vertically while selected children remain fixed. Play the flow in the focused presentation player with transitions, hotspots, device framing, fullscreen, and restart/back controls, then share a self-contained read-only HTML prototype without exposing the workspace. Under Motion, create reusable duration and easing tokens, add per-layer tracks and keyframes, preview the result, and copy CSS keyframes or Motion.dev code. The prototype, animation, variables, components, code artifacts, and revision history remain one native document, so designers and connected agents edit the same source through the revision-safe MCP command bus.',
      tags: ['interactive prototype', 'motion timeline', 'manual + agents'],
    },
    {
      id: 'design-collaboration',
      title: 'Review visual work with people and agents',
      body: 'Open Collaboration in a native Design document. Follow a live participant, leave a page or layer comment, and ask an agent for a revisioned proposal instead of an immediate edit. Inspect the structural diff and preview, then approve, reject, send it to Council, or create a parallel Floor. For an external reviewer, share the workspace and grant only the exact Design level they need; the Companion receives sanitized summaries rather than the scene graph or project files.',
      tags: ['live presence', 'comments + proposals', 'Council + Floors'],
    },
    {
      id: 'design-quality',
      title: 'Audit and recover a production design',
      body: 'Open Quality in a native Design document to find naming, clipping, overlap, contrast, and accessibility problems, then jump directly to each layer. Start a real product, marketing page, mobile flow, or design system from an editable native template. Automatic backups, schema migration, bounded history, explicit restore, and incremental viewport rendering protect large documents. A connected agent can run design_audit and apply the same templates without bypassing revisions.',
      tags: ['quality audit', 'backup + recovery', 'large documents'],
    },
    {
      id: 'mcp-tools',
      title: 'Agents with external tools via MCP',
      body: 'Add MCP servers in the workspace editor (e.g.: filesystem, web, database) — agents get the tools natively, and Orkestrai itself appears as an MCP server with the canvas actions (orkestrai mcp). Presets can carry the MCPs along with the team.',
      tags: ['MCP', 'typed tools', '.mcp.json'],
    },
    {
      id: 'managed-ports',
      title: 'Release ports left by dev servers',
      body: 'Create a local Portal for the app (e.g. http://localhost:5173). The Ports panel, immediately after Usage in the bottom toolbar, shows whether that listener is active, which process/PID owns it, and lets you stop it with confirmation. Only ports linked to local Portals in the workspace are listed; Orkestrai\'s own server is protected.',
      tags: ['Ports', 'Portal', 'dev server'],
    },
    {
      id: 'leader-dictation',
      title: 'Dictate into any text field',
      body: 'Focus any editable field — a kanban title or description, role, note, or form — then use the global voice orb or Alt+Space. The very first click preserves that field and inserts the transcript at its cursor without requiring a leader. Under Settings → Voice dictation, you can enable automatic sending: terminals also receive Enter after the transcript, while regular fields still only receive text. The clickable badge shows whether the orb is pinned or movable and opens position controls directly; the tooltip also displays the Ctrl-click or Command-click shortcut. In Workbench, the pinned position uses a dedicated header slot and never covers tabs or actions; unpinning restores free movement. With no active field, the same control finds the workspace leader in both Canvas and Workbench. On macOS, Fn/Globe by itself belongs to the system; choose a key combination or an F1–F12 key.',
      tags: ['Global dictation', 'text fields', 'local voice'],
    },
    {
      id: 'audio-devices',
      title: 'Choose the microphone and speaker',
      body: 'Open Settings → Voice to choose and test the microphone used by every local dictation surface and the speaker used by previews and spoken replies. Grant microphone access to reveal device names, watch the live input meter, and play a short output tone before saving. Dictation records direct PCM through the same Web Audio route as that meter and normalizes quiet speech before local STT. If a selected device disappears, Orkestrai returns to the system default. Permission denial, a missing device, interrupted capture, likely contention, and a device that opens but produces no signal receive distinct guidance; platforms that cannot route app audio to a specific output explain that limitation instead of silently ignoring the choice.',
      tags: ['Audio devices', 'microphone test', 'speaker test'],
    },
    {
      id: 'switch-agent-provider',
      title: 'Change a team member\'s provider',
      body: 'Open ⇄ in the agent header and choose another installed provider. Orkestrai closes only the previous PTY and provider conversation, preserves name, role, Maestro Mode, floor, position, and connections, then starts the replacement in the same node.',
      tags: ['Providers', 'change in place', 'team preserved'],
    },
    {
      id: 'devin-local-agent',
      title: 'Use Devin as a local team member',
      body: 'Install and authenticate the official Devin CLI, then create a Devin agent from the canvas. Search the account model list in the bounded, scrollable selector, choose one, and start with autonomous workspace access. Orkestrai provisions the native MCP bridge and skill and resumes the exact local conversation after an app restart.',
      tags: ['Devin CLI', 'local agent', 'exact resume'],
    },
    {
      id: 'multilingual-spoken-replies',
      title: 'Hear replies in your language',
      body: 'In Settings → Voice, choose one of the three local voices: Brazilian Portuguese, US English or Latin American Spanish. Adjust speed from 0.75× to 1.50× and use Play preview to compare before enabling the speaker in the agent header. Parakeet still handles dictation only; replies use offline Supertonic 3 and start playing sentence by sentence to reduce waiting.',
      tags: ['TTS', 'Supertonic 3', 'pt-BR · en-US · es-MX'],
    },
    {
      id: 'quota-aware-delegation',
      title: 'Delegate work without exhausting a quota',
      body: 'Add the Usage node to the canvas, set Claude as the source and Codex as the fallback, then choose the 5-hour, weekly, or monthly window and its percentage. Before delegating new work, the leader checks orkestrai usage and recommends the healthy agent when the source crosses that threshold. The panel also explains why Antigravity, Cursor, Devin, OpenCode, or Cline cannot provide the same automatic percentage and links to each official source instead of guessing; conversations and tasks already in progress stay on their current provider.',
      tags: ['Canvas usage', 'fallback', 'delegation'],
    },
    {
      id: 'organize-canvas',
      title: 'Reorganize a growing workspace',
      body: 'Select the nodes you want to realign and choose Organize canvas from the toolbar or command palette. Orkestrai lays out only that selection; with nothing selected, it organizes the whole canvas into deterministic rows without moving nodes into each other. Connections stay behind every node.',
      tags: ['Canvas layout', 'selection', 'connections'],
    },
    {
      id: 'focused-workspace-view',
      title: 'Work with multiple artifacts in the Workbench',
      body: 'Use the Canvas/Workbench switch in the upper-left corner to open the grouped workspace explorer. Open items use vertical tabs by default; under Settings → Appearance, you can choose horizontal tabs above each pane. Split the active pane right or down and arrange up to eight resizable terminals, boards, notes, portals, files, flows, or usage nodes. Drag a tab to another pane or use its Move to menu. Layout is saved per workspace, old layouts migrate automatically, and invalid references are discarded safely. Canvas artifacts keep their persisted identity so sessions, content, and edits stay synchronized; workspace files use local tabs and do not create canvas nodes. Terminal font metrics and pane geometry settle before an existing PTY is attached, so the blinking cursor remains aligned after switching through Settings, documentation, Canvas, or Workbench. The footer shows every Claude, Codex, and Kimi usage window and opens details with one click, using the same five-minute snapshot as the Usage panel and node. Command/Ctrl+Page Up or Page Down cycles items, Shift switches panes, and Command/Ctrl+\\ splits the pane. The voice orb also uses the active workspace leader in this view. When you return to Canvas, Orkestrai preserves the workspace and centers the selected node.',
      tags: ['Workbench', 'up to 8 panes', 'recursive splits'],
    },
    {
      id: 'monitor-team-control-center',
      title: 'See what the team is really doing',
      body: 'Open Control Center from an expanded workspace in Workbench to compare who is working, idle, blocked, waiting for input, or offline. The compact explorer shows each active agent\'s current task, state, and Floor; agents and nodes from landed or deleted Floors remain historical without inflating current counts. The communications inbox proves whether a handoff was queued, delivered, acknowledged, replied to, or failed under one persistent message id. Switch workspaces or restart the app without waking idle terminals; the history reconstructs the same operational view.',
      tags: ['Control Center', 'verified delivery', 'agent activity'],
    },
    {
      id: 'triage-attention-across-workspaces',
      title: 'Triage every workspace from one attention inbox',
      body: 'Open the bell beside Canvas/Workbench to see questions, permission requests, blockers, and failures from every workspace, with the current workspace first. Expand any item to read the complete failure and original request without leaving the inbox. Open source is a separate action and becomes unavailable when its agent or task has been removed; the persisted content remains readable. Mark it read, snooze it, or resolve it without losing the audit trail. Use Command/Ctrl+K with type:attention, workspace:"Name", agent:"Name", status:open, has:error, before:, or after: to recover the same event later.',
      tags: ['Attention Center', 'cross-workspace triage', 'search operators'],
    },
    {
      id: 'trace-delivery-workstream',
      title: 'Trace a delivery from brief to Git evidence',
      body: 'Create and assign the work in Kanban, then open Workstreams in Workbench. The task becomes the stable delivery identity: its agent and Floor appear automatically, Council decisions keep the same brief, Review Center links the exact revision and selected files, and the activity timeline explains every transition. Open the original board, Council, or review at any time; the workstream never replaces or duplicates those records.',
      tags: ['Workstreams', 'end-to-end traceability', 'Kanban to Git'],
    },
    {
      id: 'preserve-sourced-workspace-memory',
      title: 'Preserve a decision without losing its source',
      body: 'Open Workspace memory, record the reusable decision or constraint, and attach the user statement, task, note, file, URL, message, review, or Council that supports it. Agents can query the same evidence only when relevant. When the decision changes, revise it against the current revision so the previous value remains auditable and concurrent edits cannot silently overwrite each other.',
      tags: ['Workspace memory', 'provenance', 'versioned decisions'],
    },
    {
      id: 'triage-traceable-annotations',
      title: 'Triage code and design feedback in one place',
      body: 'Open Annotation Center from Canvas or Workbench to compare every open Review Center comment and native Design thread. Search by feedback, author, file, layer, or artifact; inspect the captured revision and stale state; then open the canonical source to reply or resolve it. The center never creates a disconnected copy of the feedback.',
      tags: ['Annotation Center', 'code + design feedback', 'revision traceability'],
    },
    {
      id: 'version-and-share-team-pack',
      title: 'Version and share a complete team',
      body: 'Capture the current workspace as a custom Team Pack, publish a semantic version with release notes, and inspect its immutable checksums. Export the pack for another installation or import a shared file after Orkestrai validates its schema, size, content, and SHA-256 checksum. Agents, roles, skills, stages, routines, MCP configuration, and layout travel; live sessions and credentials do not.',
      tags: ['Team Packs', 'semantic versions', 'safe import/export'],
    },
    {
      id: 'run-agent-huddle',
      title: 'Reach a decision with a persistent agent huddle',
      body: 'Open Huddles, set the topic and agenda, choose the facilitator and participating agents, then type or dictate a turn to the agents whose perspective you need. Follow pending and completed replies in one ordered transcript, hear new replies when TTS is enabled, and let participating agents add concise findings through the bridge. End the room when the decision is clear and create a linked Kanban task so the agenda and transcript remain attached to the delivery workstream. A remote collaborator can join the same sanitized room according to view, speak, or manage permission.',
      tags: ['Persistent huddle', 'dictation + TTS', 'task evidence'],
    },
    {
      id: 'edit-and-preview-files',
      title: 'Edit and inspect files without leaving the Workbench',
      body: 'Expand Files in the Workbench sidebar and open a workspace file directly in a local tab, without creating a canvas node. The Canvas file tree and Command/Ctrl+K use the same direct handoff. Monaco preserves cursor, undo, selection, and unsaved state across panes. Find or replace text, navigate symbols, format supported files, and choose minimap, wrapping, font size, or optional autosave under Settings → Appearance. Markdown switches between source and a sanitized preview; PDFs have page and zoom controls; images support zoom, pan, dimensions, and transparency; binary files show metadata and open through the system application. Files above 512 KB open a bounded read-only preview so unloaded content cannot be overwritten.',
      tags: ['Monaco editor', 'offline previews', 'dirty buffers'],
    },
    {
      id: 'share-reference-material',
      title: 'Give the team complete context',
      body: 'Drag an image, PDF, file, or HTTP/HTTPS link onto a briefing note, an agent composer, or a kanban card. Orkestrai stores files up to 10 MB inside the workspace, inserts a readable reference, and delivers the title, description, and every attachment when the lead or agent receives the task.',
      tags: ['Attachments', 'drag and drop', 'complete brief'],
    },
    {
      id: 'universal-workspace-search',
      title: 'Find anything without navigating menus',
      body: 'Press Command/Ctrl+K from any screen to search workspaces, agents, tasks, notes, tools, roles, skills, files, settings, and commands. Search shows context and a preview, remembers recent and favorite items, and can open an artifact in the current pane, right, or below. Use the content: prefix to search inside workspace file contents. Reads remain confined to the workspace folder.',
      tags: ['Universal search', 'Command/Ctrl+K', 'files and commands'],
    },
    {
      id: 'review-delivery',
      title: 'Review a delivery with evidence and a clear decision',
      body: 'Open Review Center in Workbench, select the changed files and create a review linked to the kanban task and responsible agent. Record screenshots or delivery evidence, tests performed, and known risks. Add comments to exact files or lines, then approve, request changes, or reject. Requested changes are submitted to the agent terminal when available; if the code changes first, the original comment is kept and marked as outdated context.',
      tags: ['Review Center', 'Monaco diff', 'agent feedback'],
    },
    {
      id: 'portal-design-feedback',
      title: 'Point at a visual problem instead of describing it from memory',
      body: 'Open the app in a Portal and choose Inspect design. Click the exact button, heading, field, image, or layout area that needs attention, review the cropped screenshot and safe element context, and describe the expected result. Create an unassigned task for leader triage, a task already assigned to a specialist, or append the feedback to an existing task. Every submission remains traceable on the Kanban board without exposing browser secrets.',
      tags: ['Portal Design Mode', 'visual feedback', 'safe inspection'],
    },
    {
      id: 'remote-collaboration',
      title: 'Share a workspace without sharing your machine',
      body: 'Enable experimental workspace sharing, start an end-to-end encrypted session, and choose a Browser/mobile or Orkestrai app invite. The web link opens the installable Remote PWA. The app invite opens the installed Orkestrai app automatically; the guest can also use Workspace → Join remote workspace and paste the invite. Both remove the secret from the URL before connecting and store a non-extractable pairing key only on that device. Approve the exact device fingerprint and choose Viewer, Collaborator, Operator, or Administrator. An Operator can hold sanitized, traceable conversations with the leader or another agent and dictate into either one through the host local STT. The overview keeps the leader history visible; when the leader uses tools and speaks in several stages, Remote waits for the real end of the turn and combines every text block before publishing the reply. An Administrator can also start or restore an offline agent. Raw terminal control is a separate Administrator-only switch on that device, disabled by default, limited to one responsive terminal, rate-limited, encrypted, and audited. Terminal dictation inserts text without pressing Enter. It never grants file browsing, Portal or mobile-device viewing, or Canvas editing. Revoke a device or stop the session at any time, and inspect accepted and rejected commands in the audit trail.',
      tags: ['Encrypted Remote PWA', 'host-side dictation', 'responsive opt-in terminal'],
    },
    {
      id: 'custom-app-theme',
      title: 'Adapt the app appearance to your work',
      body: 'Choose one of three dark themes or the high-contrast light theme under Settings → Appearance. Duplicate the closest option, adjust semantic color tokens with an immediate preview, and export the JSON to use the same theme in another installation.',
      tags: ['Themes', 'semantic tokens', 'import/export'],
    },
    {
      id: 'windows-wsl-agents',
      title: 'Use tools installed only inside WSL',
      body: 'Choose the most common runtime when creating or editing the workspace on Windows. To mix environments, open each terminal compact menu, select Execution environment, and choose Workspace default, native Windows, or the exact WSL distribution where Kimi, Claude, Codex, or another CLI is installed. Provide the matching Linux path for the same project folder. The WIN/WSL badge confirms the exception, and only that terminal restarts. Canvas, files, tasks, and notes remain shared while every agent uses its own tools.',
      tags: ['Windows + WSL', 'multiple distributions', 'local providers'],
    },
    {
      id: 'provider-profiles',
      title: 'Keep work and personal provider accounts separate',
      body: 'Open Provider Center, expand Claude, Codex, Kimi, GitHub Copilot, Cursor, Cline, or OpenCode, and add a named Profile that points to the account-specific config directory or directories documented by that CLI. Pick it in the New agent dialog when creating the agent, or select it later from the terminal menu, or route new work to it through the Usage node. Orkestrai stores only the Profile reference and directory paths in its database; credentials remain in the provider-owned files and are resolved server-side only when the PTY starts. A Profile in use by a terminal or routing rule cannot be deleted. Antigravity and Devin remain unavailable here because no safe, documented cross-platform CLI account override has been verified.',
      tags: ['Provider Profiles', 'multiple accounts', 'credential isolation'],
    },
    {
      id: 'saved-terminal-commands',
      title: 'Reopen a shell ready to work',
      body: 'Open a terminal options menu and choose Saved commands. Store shortcuts for that terminal or global commands available everywhere, search by name or content, and run any item manually. In pure shells, enable Run on resume to submit commands once when the session is created or restored, including WSL. Orkestrai never auto-runs text in Claude, Codex, Kimi, or another agent, preventing conversation contamination. Commands are plain text: use environment variables or the tool vault for secrets, never passwords or tokens inside a saved command. Shells preserve your operating-system environment and the Orkestrai bridge, but exclude private desktop-server values so each project .env remains authoritative, including Laravel APP_KEY.',
      tags: ['Saved commands', 'safe auto-run', 'shells and WSL'],
    },
    {
      id: 'creative-image-workflow',
      title: 'Create a character, apply the brand, and deliver a carousel',
      body: 'Start the guided use case to validate the complete chain without assembling the Canvas manually. As you advance, Orkestrai creates one Codex Creative Director, reusable character and campaign briefs, a sample-logo PNG, and three sequential workflows: Character Master, Branded Character, and XYZ Carousel. Do it for me dispatches each real generation; the tour unlocks the next stage only after validating workspace files and materializing Image nodes. The first output from one stage is automatically connected as an ordered reference for the next, preserving prompts, paths, provenance, and history. The example generates three masters, two branded poses, and three slides for a fast validation; every workflow accepts up to ten outputs. An authenticated Codex account or plan with ImageGen is required, without an OpenAI API key.',
      tags: ['Codex ImageGen', 'character and brand', 'guided carousel'],
    },
    {
      id: 'desktop-diagnostics',
      title: 'Diagnose a desktop action that does not respond',
      body: 'Open View > Developer tools and reproduce the problem while watching Console. Then choose Help > Open logs folder and share orkestrai.log with support. The rotating local log includes renderer errors, internal-server failures, and unexpected exits; common credentials are redacted and normal agent output is not persisted.',
      tags: ['Developer tools', 'local logs', 'support'],
    },
  ],
  changelog: [
    {
      date: 'Aug 27, 2026 · 0.22.0',
      title: 'Orkestrai 0.22.0: native image workflows for people and agents',
      summary: 'Build reusable image-generation graphs from briefs, references, and agents without leaving the workspace.',
      items: [
        'Image Generation nodes combine their prompt with connected Note context, up to five ordered Image references, and a connected live Codex, then add every validated output back to the canvas and the selected workspace folder.',
        'The Codex executor uses its authenticated built-in image_gen.imagegen tool independently for each requested output; references pass through referenced_image_paths and invalid alpha receives bounded corrective edits.',
        'A connected Codex can create and configure drafts, manage ordered Note and Image inputs, and execute one logical run with up to ten outputs through typed image_workflow_* tools.',
        'Orkestrai never asks for or stores an image API key and never calls a provider endpoint directly. Only the assigned Codex can complete the run, and exact paths, signatures, sizes, and public errors are bounded before persistence.',
        'Runs keep traceable history and provenance, while Canvas, Workbench, CLI/MCP, and the guided creative-team tour operate the same visible workflow without a parallel automation state.',
        'The guided use case now builds and validates Character → Brand → Carousel: it creates briefs and a sample logo, waits for real outputs, and automatically connects each result to the next stage.',
        'The panel states that ImageGen requires an authenticated Codex account or plan without asking for an OpenAI API key.',
        'New or recovered agents never resume another terminal\'s latest conversation: Orkestrai resumes only the exact ID attributed to the node and starts a clean conversation when that link does not exist yet.',
        'Interactive Codex terminals always receive the current packaged MCP before resume, packaged builds retain the complete WebADB runtime closure, and image workflow calls no longer fail because of a stale global MCP or a missing Android support module.',
        'Unavailable Portals use bounded backoff with manual retry; stale board requests return not found; Windows ConPTY cleanup and local health probes no longer flood logs with expected errors.',
        'Desktop logs stay actionable: expected Portal outcomes use structured command results, microphone capture uses AudioWorklet, Electron and the updater use current APIs, and inert Svelte derivations no longer emit runtime warnings.',
        'Transparent workflows now validate decoded PNG alpha pixels and automatically repair opaque or fake-checkerboard results with another native ImageGen edit, never Python or local pixel manipulation, up to three times per output; stalled runs expire instead of leaving the guided tour waiting indefinitely.',
        'Packaged macOS startup restores the executable permission of the extracted PTY helper so terminal launch remains reliable after dependency installation or archive extraction.',
      ],
    },
    {
      date: 'Aug 27, 2026 · 0.21.2',
      title: 'Orkestrai 0.21.2: reliable terminal paste on Windows',
      summary: 'Ctrl+V now pastes copied text instead of being mistaken for an image-paste command by agent CLIs.',
      items: [
        'Windows terminals detect text in the native clipboard and dispatch a real xterm paste, including bracketed-paste handling used by interactive CLIs.',
        'Clipboard contents stay inside Electron and are never exposed through the renderer bridge; only the focused Orkestrai window can request the paste.',
        'When the clipboard contains no text, Ctrl+V keeps its original control character so providers that support image paste retain that workflow.',
      ],
    },
    {
      date: 'Aug 26, 2026 · 0.21.1',
      title: 'Orkestrai 0.21.1: workspaces stay paused and Windows stays in the background',
      summary: 'Unload is now persistent, and internal runtime launches no longer steal Windows focus.',
      items: [
        'Unloading a workspace persists its paused state, stops live terminals, task-driven session creation, and background automation enqueueing, and keeps it idle across navigation and app restarts until you explicitly open it again.',
        'Paused workspaces are identified in Canvas and Workbench, while their layout and exact agent conversations remain saved for the next explicit open.',
        'Internal CLI and server runtime invocations no longer trigger Windows single-instance focus; intentional app launches, tray actions, notifications, and collaboration links still open normally.',
      ],
    },
    {
      date: 'Aug 26, 2026 · 0.21.0',
      title: 'Orkestrai 0.21.0: portable Roles and faster workspace setup',
      summary: 'Reuse specialist Roles, select the right provider account, and file a workspace into its folder during creation.',
      items: [
        'Added a "Discover from another folder..." button next to Roles\' existing repository discovery: pick any folder in a native dialog and Orkestrai imports every `role.json` found under its `.orkestrai/roles/` directory.',
        'Imported role files are size- and count-bounded, validated before persistence, confined to the selected project, and never overwrite an existing workspace role.',
        'Added a Profile field to the New agent dialog for providers with multi-account Provider Profiles configured.',
        'The profile/provider pair is validated before the terminal is persisted; credentials remain in secure storage and never enter canvas data.',
        'Added a Folder field to the New workspace dialog, and a plus icon on each folder\'s header that opens the dialog with that folder pre-selected as the destination.',
        'Regular and preset-based workspaces are persisted directly in the validated destination, preventing partial creation at the sidebar root when the folder is invalid.',
        'Switching only a terminal profile now shows the correct profile confirmation, and the focused terminal view sends that selection to the backend instead of dropping it.',
        'Usage and the Workbench footer now key rows by the unique provider/profile routing id, preventing duplicate-key crashes and showing the profile name for each account.',
        'After restart confirmation, Windows and Linux install the verified update silently and relaunch the app without showing the installer wizard.',
        'Side panels now stay below the 36px Windows title bar while keeping their bottom edge inside the viewport.',
        'The terminal theme submenu now scrolls within its own boundary instead of overflowing past the screen.',
        'Interactive native buttons and role-based controls now use a pointer cursor, while disabled controls keep their non-interactive cursor.',
      ],
    },
    {
      date: 'Aug 25, 2026 · 0.20.1',
      title: 'Orkestrai 0.20.1: safe Codex MCP configuration',
      summary: 'Codex keeps the automatic workspace bridge without surrendering control of its global dotfile or Git visibility.',
      items: [
        'Codex receives the Orkestrai and official Figma MCP definitions through ephemeral native and WSL launch overrides; workspace provisioning no longer rewrites ~/.codex/config.toml.',
        'The exact malformed multiline args and duplicate env structure written by older Orkestrai builds is repaired after validation, with a backup, serialized access, and atomic replacement; unrelated malformed TOML stays untouched.',
        'AGENTS.md, provider MCP files, and opencode.json are no longer hidden through .git/info/exclude; exact legacy blocks are narrowed to Orkestrai-owned runtime and skill directories.',
        'Bridge provisioning failures now enter desktop diagnostics instead of disappearing silently.',
      ],
    },
    {
      date: 'Aug 25, 2026 · 0.20.0',
      title: 'Orkestrai 0.20.0: organized workspaces and sharper provider tools',
      summary: 'Nested workspace folders, responsive Portal testing, richer terminal personalization, and safer provider-wide MCP and skill management arrive together.',
      items: [
        'MCP servers and skills added or installed on a workspace now propagate to Cursor, Cline, Devin, Antigravity, and OpenCode’s native config formats, matching the same providers the built-in Orkestrai bridge already covers.',
        'The Skills marketplace opens with a curated catalog, safely merges live results, and validates registry downloads before they reach the workspace.',
        'Workspaces can be organized into persistent nested folders in the Canvas sidebar, with drag and drop, subfolders, renaming, collapse state, cycle prevention, and non-destructive deletion.',
        'Portal has a persistent editable name separate from its address, accepts a unique name or node id in automation, inventories every workspace Portal with explicit connection state, reuses repeated URLs, follows the active theme across its address rail, and provides a real responsive-device viewport with contained scrolling.',
        'Settings previews terminal colors, font, and padding, shows the correct OS shortcut modifier, and adds Monokai, Ayu Dark, Rosé Pine, and Solarized Light.',
        'Terminal selection is accurate at any Canvas zoom, Claude Profile Usage reads config-specific macOS Keychain credentials, Canvas provider/tool icons stay consistent across themes, Workbench loading states expose valid assistive semantics, and deleting an active workspace safely switches away from its terminated PTYs.',
        'Installed desktop builds expose Developer tools again and can open a bounded, rotating diagnostics folder that captures renderer and internal-server failures while redacting common credentials.',
        'Workspace provisioning remains compatible with creation flows that omit the optional additional-repository list, treating it as empty instead of failing.',
      ],
    },
    {
      date: 'Aug 24, 2026 · 0.19.0',
      title: 'Orkestrai 0.19.0: provider accounts, status, identity, and clearer routing',
      summary: 'Providers are easier to identify, monitor, and route across multiple accounts, with a new terminal theme and a usable Usage node.',
      items: [
        'Usage and routing now opens at a useful default size, shows Leader routing before provider details, wraps controls at narrow widths, and contains mouse, trackpad, touch, and keyboard scrolling without zooming the canvas.',
        'Added named Provider Profiles, profile-aware Usage routing, live public provider status, provider-specific marks on Canvas agent nodes, GitHub Copilot as an agent provider, and the Obsidian terminal theme.',
        'Provider Profile credentials never enter canvas payloads: only the profile reference and non-secret paths persist, values are resolved server-side at PTY launch, secure storage is verified, active references block deletion, and unsupported Devin API keys are not accepted as local CLI profiles.',
        'Profile names are unique case-insensitively, legacy collisions migrate safely, full UUIDs survive Usage routing, errors are localized, and a failed public status check is shown as unavailable instead of healthy.',
        'The PTY WebSocket accepts browser connections only from Orkestrai on the exact application port, preventing another localhost website from opening or controlling terminal sessions.',
      ],
    },
    {
      date: 'Aug 24, 2026 · 0.18.1',
      title: 'Orkestrai 0.18.1: reliable project, Portal, voice, and terminal state',
      summary: 'Project environments remain isolated while desktop browsing, dictation, and terminal rendering recover reliably.',
      items: [
        'Terminal processes keep the user operating-system environment and Orkestrai bridge, but remove the desktop APP_KEY and every private variable loaded from the app runtime. Laravel encrypted records, cookies, and sessions therefore use the project .env and no longer fail with “The MAC is invalid”.',
        'Portal login pop-ups now open in a sandboxed Orkestrai window with the same persistent session instead of escaping to the system browser. Cookies and storage are flushed to disk, and each Portal node restores its last navigated URL.',
        'Dictation now records direct PCM through the same Web Audio path as the input meter, normalizes quiet speech, and clearly identifies a selected microphone that opened without producing signal.',
        'Terminal font and pane geometry now settle before PTY reattachment, and ANSI history finishes replaying before the final redraw, keeping the xterm cursor aligned after navigating away from and back to Canvas.',
      ],
    },
    {
      date: 'Aug 23, 2026 · 0.18.0',
      title: 'Orkestrai 0.18.0: durable coordination, sourced knowledge, and reusable teams',
      summary: 'Messages, activity, attention, delivery, memory, annotations, Team Packs, and Huddles now preserve their operational context.',
      items: [
        'Every agent message now has a canonical envelope with verified recipient and content, durable delivery receipts, correlations, deduplication, and idempotent replay protection.',
        'Control Center adds a semantic Activity timeline for messages, tasks, reviews, decisions, Git work, and system events, with raw diagnostics available on demand.',
        'A global Attention Center prioritizes questions, permission requests, blockers, and failures from every workspace and supports read, snooze, resolve, and source navigation.',
        'Command/Ctrl+K now indexes activity, canonical messages, and attention with type, agent, workspace, status, error, and date operators.',
        'Workbench adds Workstreams, a live projection from each Kanban task to its assignee, Floor, Council decisions, reviews, semantic activity, and exact Git evidence.',
        'Workspace memory now preserves sourced decisions, facts, preferences, constraints, references, and lessons with search, immutable revisions, conflict protection, archive history, and on-demand MCP/CLI access for agents.',
        'Annotation Center projects code-review and native Design feedback together while preserving each canonical artifact, author, target, revision, resolution state, and stale-code warning.',
        'Custom presets are now versioned Team Packs with semantic releases, immutable local history, SHA-256 verification, bounded import validation, and no live runtime or credential state.',
        'Team Pack import, export, and version-publishing failures now remain in the selected UI language instead of exposing internal server copy.',
        'Persistent Huddles bring selected people and agents into one bounded transcript with dictation, optional TTS, targeted replies, CLI/MCP contributions, encrypted remote permissions, lifecycle recovery, and linked Kanban/Workstream evidence.',
        'The Huddles window now uses the available area, keeps history and transcript independently scrollable, rearranges content in narrow windows, and provides an always-visible close action.',
        'The Command/Ctrl+P palette now uses the shared modal stack and closes reliably with Escape or an outside click, including after opening Huddles.',
        'Agents can link existing Bruno, OpenCollection, and Postman project collections by repository-relative path or an explicitly authorized sibling-repository alias such as @api-tests/bruno. Canvas and Workbench show the same requests while guarded, atomic synchronization persists scripts and tests in the actual repository files, blocks unregistered path escapes, and exposes conflicts before either side is replaced.',
        'On Windows, Ctrl+C and right-click copy selected terminal text through the native desktop clipboard; Ctrl+C still interrupts the running process when no text is selected.',
        'Attention Center items now expand in place to show the complete failure and original request, keep source navigation separate, and identify removed agents or tasks.',
        'Agent replies are now correlated to the provider\'s exact turn even after later messages or delayed session discovery; concurrent deliveries to one terminal are serialized and no longer raise false structured-transcript failures.',
        'Maestro recruitment now inherits the active Floor, starts and validates the PTY in the correct runtime including WSL, and rolls back incomplete nodes. Assigned tasks enter In progress only after the agent starts or resumes and the briefing reaches its terminal.',
        'Long briefings sent to Codex on Windows and WSL now wait for the composer to process the text, confirm activity after submission, and retry only the Enter key when the TUI does not acknowledge it.',
      ],
    },
    {
      date: 'Aug 22, 2026 · 0.17.0',
      title: 'Orkestrai 0.17.0: complete API test authoring for people and agents',
      summary: 'Runtime-aware JavaScript tests, completion, and protected MCP/CLI authoring now share one collection model.',
      items: [
        'The Tests tab now switches between structured assertions and a full-height JavaScript editor with contextual completion for Bruno, Postman, and native Orkestrai APIs. Test scripts execute separately from post-response automation and round-trip through Bruno and Postman exports.',
        'Connected agents and leads can create, read, fingerprint-replace, execute, and export complete collections through typed api_client_* MCP tools or CLI commands. Concurrent UI changes are protected, local secrets remain redacted, and exported files stay inside the workspace.',
      ],
    },
    {
      date: 'Aug 22, 2026 · 0.16.0',
      title: 'Orkestrai 0.16.0: official Postman and Bruno scripting runtimes',
      summary: 'The native API Client executes imported automation with source-compatible official runtimes, portable scopes, and encrypted secrets.',
      items: [
        'API Client scripts now run through the official Postman Runtime or Bruno’s official safe QuickJS runtime with separate scopes, sendRequest/runRequest, cookies, flow control, visualizers, bundled libraries, complete Chai tests, and an operating-system-encrypted vault. Imported Bruno variables, assertions and tests blocks execute natively, while runners expose accurate iteration data and metadata.',
        'Documentation now includes a complete, searchable API Client scripting reference with separate copyable examples for Postman Runtime, Bruno QuickJS, and native Orkestrai declarative tests, plus the explicit boundary around Postman cloud-only services.',
      ],
    },
    {
      date: 'Aug 20, 2026 · 0.15.0',
      title: 'Orkestrai 0.15.0: reusable commands and a multi-protocol API Client',
      summary: 'Shell startup becomes repeatable while the API Client covers editing, execution, security, responses, and synchronization in the daily workflow.',
      items: [
        'Invalid pre-request or post-response scripts now identify the exact request or collection stage and source line instead of collapsing QuickJS failures into a generic API execution error.',
        'The native API Client now executes HTTP/REST, GraphQL, WebSocket, and gRPC requests. GraphQL includes query, variables, and operation selection; WebSocket adds queued messages, reconnect, keepalive, and a bidirectional transcript; gRPC loads local proto files and supports all four streaming modes.',
        'Assisted OAuth 2.0 supports authorization code with state and PKCE plus direct client credentials, password, refresh-token grants. HTTP and WebSocket share cookies, proxy, custom CA, PEM or PKCS#12 client certificates, and TLS verification controls.',
        'Linked Bruno and OpenCollection sources now support guarded pull, push, five-second watch mode, fingerprints, stale-file cleanup, and explicit conflict resolution. Postman and OpenAPI links remain pull-only.',
        'JSON, JavaScript, GraphQL, and XML fields now use syntax-aware editors with search, wrapping, and formatting. Responses render JSON and XML as expandable trees, protocol transcripts open directly, and active request, script, and response views use an unmistakable themed state.',
        'The API collection runner dialog now keeps its complete action footer visible at shorter window heights and wraps its controls responsively. Reordering requests and folders shows the exact before, after, or inside-folder destination before dropping.',
        'Every terminal now has searchable saved commands scoped to that terminal or shared globally. The manager clearly marks the active scope, identical startup commands are deduplicated across both scopes, and a PTY respawn cannot submit the same resume command twice.',
        'The native API Client now provides nested folders, node-safe drag-and-drop, contextual right-click actions, and multiple persisted runners with request selection/order, environment, iterations, delay, stop-on-failure, and variables chained between requests.',
        'API collections can now export to Bruno through its official serializer or to Postman v2.1 while retaining REST metadata not directly editable in Orkestrai. A versioned Orkestrai format restores the complete native state, including folders, runners, environments, scripts, and history.',
        'Swagger 2.0 and OpenAPI 3.x contracts now import with bounded local references, generated examples, authentication mapping, and visible fidelity notes. Collections export as OpenAPI 3.1 JSON/YAML or OpenCollection YAML, while Postman environments move independently.',
        'English is now the true startup default, including the Electron splash shown before saved settings load; the saved language still takes over when the app is ready.',
        'Usage credential, token, timeout, and provider API warnings now use stable codes translated into pt-BR, English, and Spanish instead of exposing Portuguese backend text.',
        'Creating or editing an API request no longer raises its entire invisible hit area above higher neighboring nodes, so terminal menus and Canvas tools remain clickable after API Client interaction.',
        'Canvas and Design Studio keyboard shortcuts now safely ignore browser events whose target is Window, a text node, or another non-element target instead of crashing with “closest is not a function”.',
        'DOMPurify 3.4.14 is now enforced throughout Monaco’s dependency tree, removing every known npm audit finding without downgrading or replacing the editor.',
        'Automation forms can once again create, edit, and enable automations and save GitHub integrations without incorrectly rejecting internal route parameters.',
        'Changing language during onboarding now keeps the wizard open on the welcome step while the interface remounts.',
        'Deleting a workspace now stops its live terminals before removing persisted nodes, preventing orphaned processes and late activity events.',
        'Returning to Workbench from a Canvas deep link now preserves the exact selected node in its existing pane instead of dropping the split layout.',
        'Creating an agent now reuses provider status already verified for the workspace runtime, avoiding a redundant CLI scan and unnecessarily disabled submit button.',
        'Canvas and Workbench nodes now appear without waiting for the slower provider scan; newly created selected terminals recover focus after session persistence, and view switching preserves the node during asynchronous loading.',
        'Input typed during the PTY handshake is now held in a short queue and delivered to the created session, while xterm remains mounted as its ID is persisted.',
        'The guided UI exploration tour now creates its brief, task board, and three editable directions through “Do it for me” instead of stopping behind an unsubmitted setup dialog.',
      ],
    },
    {
      date: 'Aug 19, 2026 · 0.14.0',
      title: 'Orkestrai 0.14.0: native RPM packages for Linux',
      summary: 'Fedora, RHEL, CentOS, and compatible distributions now have a package-native Orkestrai installer.',
      items: [
        'Every Linux release now publishes an RPM alongside the existing AppImage.',
        'The package includes the public maintainer metadata required by native Linux installers.',
        'RPM files use the same stable Orkestrai product naming as the other installers.',
        'The release pipeline verifies the RPM and its latest-linux.yml updater entry before publishing any assets.',
        'Installed RPM builds use the package-aware Linux update path.',
      ],
    },
    {
      date: 'Aug 18, 2026 · 0.13.0',
      items: [
        'Orkestrai 0.13.0 keeps terminal keyboard input isolated from Canvas accessibility shortcuts. Escape correctly reaches Vim, merge/rebase editors, pagers, and other TUIs without deselecting the node or blurring xterm; search and dictation remain local to the terminal.',
        'Scrolling inside terminals and other Canvas nodes now remains isolated even at the start or end of their content. Canvas zoom responds only while the pointer is over the free Canvas pane.',
        'Canvas shapes now expose a visible duplicate action plus Cmd/Ctrl+D. Cmd/Ctrl+C and Cmd/Ctrl+V copy and paste single shapes or complete multi-selection arrangements while preserving size, text, styles, editable arrow geometry, and relative spacing.',
        'New native API Client in Canvas and Workbench: create and send requests with methods, URLs, headers, Bearer/Basic authentication, bodies, and variables, inspect formatted status, duration, size, and response data, import Bruno folders through the official parser or Postman v2.1 collections, and reopen the source in its installed application.',
        'Native shell terminals now preserve their current folder after restarting Orkestrai. Cursor and other providers also receive an explicit tool to list existing notes before reading or editing, preventing duplicates and empty-array dead ends.',
        'Command/Ctrl+K once again searches the complete localized documentation alongside workspace content. Topics, use cases, and changelog entries use accent-insensitive matching, open at their exact anchor, and remain available even if the workspace search request fails.',
        'Large Design documents now expand around every frame instead of clipping artwork to the nominal page. Use trackpad or scroll, the Hand tool (H), Space-drag, or the middle mouse button to move across the workspace; Fit frames all content and zoom reaches 2%. Exports and thumbnails include the same complete bounds. Connected agents now consult design_reference once, create up to 2,000 layers with design_create_elements, or apply layers, tokens, bindings, components, prototype, and motion together with design_apply_blueprint. Guided explorations explicitly prohibit installation inspection, schema probes, and scratch discovery scripts.',
        'Workbench and Control Center no longer accumulate agents, boards, and other nodes from landed or deleted Floors. The upgrade archives legacy records, floor retirement removes obsolete edges, active agents show their floor name, and layout clones start without reusing a PTY session or provider conversation. Bridge recruitment now honors and validates the requested Floor.',
        'Guided UI exploration now uses progressive gates. Each direction first delivers only one desktop and one mobile screen through compact semantic composition, with a first revision expected within five minutes. Nodes expose waiting, working, stalled, and ready states; the Quality tab approves the current revision or requests changes with traceable feedback. Only the approved direction expands into states, tokens, components, prototype, and code, and the structural audit is no longer presented as evidence of visual quality. Explorations created before this update remain recognized.',
        'Canvas connection geometry now reuses node and adjacency indexes for each immutable snapshot instead of scanning the entire graph per edge and handle. Agent-driven graph changes refresh raw node, edge, and floor snapshots without rechecking every provider.',
        'Audio settings now select and test the microphone used by every local dictation surface and the speaker used by voice previews and spoken replies. Removed devices fall back to the system default, and capture failures distinguish permission, missing hardware, interruption, and likely contention for the only input.',
        'Canvas connections now adapt physics, frame rate, and rendering to edge count, viewport visibility, document visibility, and reduced-motion preferences. Dense workspaces keep active-conversation colors while idle or offscreen edges become lightweight static paths.',
        'Design Studio quality and scale: a live audit finds naming, clipping, overlap, WCAG contrast, and accessibility issues and focuses the affected layer; four complete native templates create editable product, marketing, mobile, or design-system foundations; automatic backups, corruption recovery, schema migration, bounded history, explicit restore, and incremental viewport rendering protect large documents. Agents receive the same audit and template operations through typed CLI/MCP commands.',
        'Windows WSL terminals now preflight the exact distribution, directory, login PATH, and CLI before spawning and track provider conversations inside that distribution\'s Linux home. Only confirmed transcripts are persisted or resumed; invalid ids start clean instead of invoking a speculative latest conversation, and missing distribution, path, or command errors are distinct and actionable.',
        'Usage now inventories all eight agent providers from one capability catalog. Claude, Codex, and Kimi keep verified automatic quota windows and routing; Antigravity, Cursor, Devin, OpenCode, and Cline show their documented CLI, administrative API, or underlying model-provider limitations with official links instead of fabricated percentages.',
        'Native Design documents now support live human-agent collaboration with presence, cursors, selections, follow mode, short layer leases, anchored comment threads, revisioned visual proposals, structural diffs, and atomic approval. Proposals can be reviewed in Council or implemented in an isolated Floor. The encrypted Remote Companion uses independent per-device Design permissions and receives only sanitized activity, comment, and proposal summaries; connected agents use the same comment, propose, and decide operations through typed Orkestrai MCP tools.',
        'Design Studio now includes native interactive prototypes and motion in the same revisioned document. Create multiple starting flows; attach click, press, hover, and timed interactions for navigation, overlays, back, scrolling, or variable modes; preview transitions, fixed layers, overflow, hotspots, device framing, and fullscreen in a focused player; and share a self-contained read-only HTML prototype. Reusable motion tokens, per-layer tracks, keyframes, easing, CSS keyframes, and Motion.dev output are searchable and available to connected agents through the same MCP command bus.',
        'Native Design delivery now imports HTML/Tailwind, Svelte, React/JSX, and Vue structure into editable layers and generates Svelar/Svelte 5, React, Next.js, Vue 3, or HTML/Tailwind through a preview-before-write flow. Existing Code Connect mappings are reused first, generated artifacts stay linked to the Design document and open in Monaco, and a live Portal or attached mobile device can be compared with the selected frame through pixel diff and an adjustable overlay. The evidence becomes a traceable Kanban feedback task or a Review Center entry tied to the actual Git change.',
        'Official Figma interoperability now provisions the managed remote MCP for compatible providers and imports selected pages or frames as native layers, vectors, assets, styles, variables, components, variants, instances, and external-library identities. Figma sources retain persistent node mappings, appear in universal search, and use a selective conflict preview before synchronization. A first-party loopback-only Figma plugin transfers live selections with raster assets, editable SVG or structural JSON, creates a Figma page with native design resources from an Orkestrai document, and sends only reviewed queued changes back to the current file. REST credentials remain encrypted by the operating system, while agents receive typed inspect, import, preview, and sync tools through the Orkestrai MCP.',
        'The Design Systems phase of native Design Mode is complete: product, marketing, and mobile token presets; DTCG/CSS import and DTCG/CSS/Tailwind export; duplicate, hardcoded-value, and component-candidate audits; components, instances, properties, variants, slots, and overrides; versioned libraries across authorized workspaces; and static extraction of CSS variables, Tailwind, and Svelte, React, or Vue contracts without executing project code. Tokens and components are also available in universal search, the Canvas preview, and the MCP command bus.',
        'Native Design Mode now provides typed design variables in collections and modes, aliases, searchable property bindings, instant mode previews, and the full revision-safe design command bus for agents through the Orkestrai MCP.',
        'SVG paste, drop, and import now create editable native vector layers instead of flattened image assets. Group/ungroup, deep selection, color occurrence lists, same-color selection and replacement across gradient stops, selection-aware export, and Copy as SVG/PNG are available with undo/redo.',
        'Design Mode now separates layer selection from vector editing. Pen previews and continues paths, bends or splits segments, supports Corner, Mirrored, Asymmetric, and Disconnected tangents, multi-point box selection and transforms, rotated editing, direct layer resize, and in-canvas multiline text editing. Editing overlays stay out of exports and thumbnails.',
        'Expanded native Design Mode with editable Pen paths, boolean operations, masks, multiple solid or gradient paints, effects and blend modes; snapping, rulers, guides, alignment and distribution; responsive horizontal, vertical, wrapping, and grid auto layout; reusable raster image assets plus editable structural SVG import by picker, paste, or drop; SVG, PNG, JPEG, WebP, and PDF export; and revision-bound raster thumbnails for efficient large Canvas previews.',
        'Added the first phase of native Design Mode: persistent Design nodes shared by Canvas and Workbench, a structured scene graph with frames, rectangles, ellipses, and text, manual property editing, layers, zoom, undo/redo, revision history, live agent updates, and typed CLI/MCP operations with conflict protection. Shapes now draw by dragging with a live preview and free sizing; Delete stays isolated inside the editor and no longer removes the Design node from Canvas; rotation and text alignment are available in the property inspector.',
      ],
    },
    {
      date: 'Aug 15, 2026 · 0.12.0',
      items: [
        'Orkestrai 0.12.0 lets one team combine native Windows and multiple WSL distributions. The workspace defines the default runtime, each terminal can inherit it or select its own environment, and provider detection/models, PTY, resume, Council, recruitment, and the bridge follow the effective runtime. A change restarts only the affected terminal and validates the distribution, path, and CLI without silent fallback.',
        'The packaged server now includes the required WSL runtime modules, allowing the installed desktop app to create, restore, and run WSL-backed workspaces.',
        'When creating or editing a WSL workspace, Orkestrai now derives and locks the Windows-visible folder from the Linux path automatically, without requiring a second equivalent path or rejecting the configuration by mistake.',
      ],
    },
    {
      date: 'Aug 15, 2026 · 0.11.0',
      items: [
        'Orkestrai 0.11.0 adds traceable remote leader and agent conversations bound to the exact question and provider session across every registered provider. The overview preserves the leader history and waits for the real end of a turn across intermediate messages and tool use. Host-side local STT works in leader, agent, and terminal input; terminal dictation only inserts text. Start or restore remains Administrator-only, and the separately approved raw terminal stays off by default, phone-responsive, rate-limited, limited to one session, encrypted, and audited. Opening the terminal closes the conversation before taking over the screen.',
        'Browser and mobile invitations now reach the host approval queue after the production relay was recreated with the official Remote PWA origin enabled.',
        'The Canvas tool strip now prioritizes compact icons with tooltips; the How to use header stays available while scrolling; the changelog separates collapsible releases and numbered changes; sharing form fields align correctly; and Canvas plus the native Workspace menu now expose an explicit entry point for joining a remote workspace.',
        'The app interface was rebuilt on semantic theme tokens: the default dark palette now pairs graphite surfaces with the brand gold, the light theme has strong contrast, and Canvas, Workbench, Settings, documentation, Provider Center, panels, dialogs, menus, fields, and voice-orb docking now share one responsive hierarchy.',
        'Workspace folders protected by macOS now have localized privacy descriptions. Canvas and Workbench replace raw EPERM/EACCES errors with recovery that reauthorizes the exact folder and retries the workspace without restarting the app.',
        'Workspace sharing now offers separate Browser/mobile and Orkestrai app invitations. The installable Remote PWA follows agents, tasks, reviews, activity, and provider usage, persists a non-extractable WebCrypto key, and removes the invitation secret from the URL before connecting.',
        'Workspace sharing now uses the production relay.orkestrai.app endpoint by default. The relay accepts the installed app\'s dynamic local origin and configured official web origins while rejecting unrelated websites.',
        'Experimental workspace sharing now creates an end-to-end encrypted host session with one-time link and QR invites, explicit device fingerprint approval, Viewer/Collaborator/Operator/Administrator roles, immediate revocation, command audit, and a bounded remote companion for team state, tasks, reviews, and leader messages. The opaque relay never receives plaintext, while PTY output, files, notes, portals, credentials, private URLs, and local paths remain excluded.',
        'Routines evolved into Automations with manual, schedule, task, message, Git commit, GitHub pull request, webhook, file-change, and usage-threshold triggers; prompt, task, and desktop-notification actions; ready recipes; idempotent queued jobs; recoverable execution history; and GitHub credentials encrypted by the installed app.',
        'The focused mode evolved into Workbench with persistent open items, vertical tabs by default, and optional horizontal tabs in Settings.',
        'Up to eight live artifacts can now be arranged in resizable right/down splits, with active-pane switching and per-workspace layout restoration without duplicate sessions.',
        'The explorer now groups agents, work, content, and tools; tabs move by drag or menu, and old layouts migrate safely to the new format.',
        'Command/Ctrl+K now opens a universal search for workspaces, agents, tasks, notes, roles, skills, files, settings, and commands, with previews, recents, favorites, and direct pane placement.',
        'File search uses workspace-confined ripgrep and virtualizes large result lists to keep the interface responsive.',
        'Images, PDFs, files, and links can now be dropped, pasted, or selected in agents, tasks, notes, and composers; files up to 10 MB stay confined to .orkestrai/attachments/ and travel with the complete brief.',
        'The Workbench footer shows every Claude, Codex, and Kimi usage window with the same severity colors and shared five-minute snapshot as the Usage panel and node.',
        'The pinned voice orb now uses a dedicated Workbench header slot and no longer covers tabs or actions in the open artifact.',
        'Opening to the side from another workspace now switches context first, without creating empty panes or mixing artifacts from different workspaces.',
        'Inter, Sora, and JetBrains Mono are now bundled with the app, removing the Google Fonts and network dependency for typography.',
        'Canvas and Workbench no longer wait for slow provider diagnostics before opening, and global search no longer blocks view mounting with a reactive loop or compresses its list and preview.',
        'Closing the active pane now preserves its visible artifact, while terminal indicators and compact labels use accessible semantics and contrast.',
        'Workspace restoration now shares duplicate checks per workspace, isolates protected-folder access between workspaces, and repairs bridge files asynchronously, so a pending macOS permission prompt cannot block Canvas or Workbench elsewhere.',
        'Removing an attachment from a note now removes its rendered Markdown and deletes the workspace file instead of leaving both behind.',
        'The Workbench now has a native workspace file explorer. Files open directly in local tabs from the explorer, Canvas file tree, or global search instead of creating disconnected Editor nodes, while the lazy-loaded Monaco editor preserves models, dirty buffers, symbols, formatting, and find/replace.',
        'Markdown, PDFs, images, and binary files now open in dedicated offline previews with safe large-file limits, page and zoom controls, image dimensions, metadata, and system-app fallback.',
        'Production assets now receive the same cross-origin isolation headers as the app, keeping Monaco and PDF workers off the UI thread in packaged builds.',
        'Workbench now includes a Control Center with persisted agent states, current tasks, state duration, provider usage, and a verified communications inbox.',
        'Bridge messages now keep one message id across queued, sent, delivered, acknowledged, replied, and failed events; ask succeeds only after a confirmed reply.',
        'Canvas and Workbench activity indicators now update through WebSocket events instead of polling every ten seconds, and informational heartbeats no longer trigger native notifications.',
        'Agent names and roles now wrap onto dedicated lines in the Workbench explorer, and vertical open-item labels show their full names instead of hiding distinguishing text behind ellipses.',
        'Workbench now includes a Review Center with structured staged and unstaged changes, branch synchronization, bounded Monaco diffs, persisted file and line comments, stale-context detection, task and agent context, and approve, request changes, or reject decisions with direct agent handoff.',
        'Portal Design Mode now highlights real page elements, captures a cropped screenshot and bounded safe context, previews it before sending, and records every submission on the Kanban board: as a new leader-triage task, a new task assigned to an agent, or an update to an existing task. Cookies, tokens, storage, headers, and query strings remain excluded.',
        'Council now runs two to five real agents as independent, budget-limited perspectives with structured evidence, risks, tests, disagreements, confidence, partial-failure handling, optional leader synthesis, and a persisted human decision. Implementation perspectives use isolated Git floors and require a fresh clean, conflict-free preview before the selected committed result can be landed.',
        'Features from phases 0 through 8 now have consistent discovery: Council appears in the Canvas toolbar, Workbench, and global search; tours remain visible between Canvas and Workbench; every documented use case starts its matching tour; and the tour catalog includes search plus a dedicated attachment flow.',
        'Canvas and Workbench now share one persistent Mobile Device node and workspace-scoped session. In addition to iOS Simulator on Apple Silicon, Android now discovers Android Studio SDK tools across macOS, Windows, and Linux, starts or attaches to AVDs, and attaches to authorized physical devices only after explicit confirmation. A bundled scrcpy 3.1 server and hardware-accelerated WebCodecs provide live H.264 video, touch and gesture controls, Back/Home/Recents, rotation, text, APK install and package launch, screenshots, bounded logcat, UIAutomator trees, permissions, lifecycle cleanup, stable AVD restart, and matching orkestrai CLI and MCP tools.',
      ],
    },
    {
      date: 'Aug 11, 2026 · 0.10.0',
      items: [
        'Orkestrai 0.10.0 introduces Terminals mode, with a searchable explorer across all workspaces that opens terminals, boards, notes, portals, files, flows, and usage in the full work area while preserving the selected node when returning to the canvas.',
        'The voice orb now finds and opens the active workspace leader in Terminals mode instead of incorrectly reporting that a workspace or leader is missing.',
        'Existing PTY sessions now fill the focused Terminals viewport instead of retaining their small Canvas dimensions and rendering agent chats as compressed or garbled.',
        'The terminal header now uses a compact options menu for provider, role, theme, reload, Maestro Mode, and removal, without overlapping controls on narrow nodes.',
        'The locate-on-canvas action now uses one centered icon instead of overlapping symbols in the Terminals header.',
        'Terminals now offer 10 complete ANSI palettes with visual named selection; Settings explains why macOS cannot use Fn/Globe alone as an app shortcut.',
      ],
    },
    {
      date: 'Aug 11, 2026 · 0.9.1',
      items: [
        'Kimi role files now include the required agent-profile frontmatter, and legacy or missing files are repaired before terminal launch instead of ending the PTY with an invalid-agent error.',
        'The global voice orb now has a clickable pinned or movable badge that opens position controls directly, while its tooltip also shows the correct platform shortcut.',
      ],
    },
    {
      date: 'Aug 11, 2026 · 0.9.0',
      items: [
        'Presets now configure roles through the native Claude, Codex, and Kimi mechanisms; other providers receive a short file reference instead of long terminal pasted text.',
        'Usage routing can monitor the 5-hour, weekly, or monthly window and explains when a provider does not report the selected period.',
        'The collector understands the current Kimi response and Codex additional limits, showing each reported window once in the panel and node.',
        'The shadcn toggle visually reflects its state again, and the workspace editor has responsive layout, bounded scrolling, and a stable footer.',
        'On Windows, the divider below the desktop title bar now spans the complete window width.',
      ],
    },
    {
      date: 'Aug 10, 2026 · 0.8.3',
      items: [
        'Orkestrai 0.8.3: the searchable model selector now follows the official shadcn-svelte composition, opens without clipping search, and keeps its icon, list, and focus aligned.',
        'Settings now offers automatic terminal dictation submission with Enter without submitting forms or other text fields.',
      ],
    },
    {
      date: 'Aug 10, 2026 · 0.8.2',
      items: [
        'Orkestrai 0.8.2: Claude and Codex conversations were validated in both directions with real responses confirmed from the correct transcript.',
        'Codex sessions use the real workspace directory and Kimi sessions use its exact path hash, preventing concurrent projects from crossing conversations.',
        'ask preserves unquoted multi-word messages, while timeouts and unconfirmed replies now fail explicitly.',
        'task done automatically hands completion back to the leader without mixing the message into an unfinished human draft.',
      ],
    },
    {
      date: 'Aug 10, 2026 · 0.8.1',
      items: [
        'The global voice orb now targets the focused field on the first click, can be pinned or dragged, and moves away from open canvas panels.',
        'Provider model selectors are searchable and scrollable, including Devin accounts with large model catalogs.',
        'Orkestrai Light now has consistent contrast across panels, nodes, text, buttons, icons, provider marks, and hover states.',
        'Organize canvas now aligns either selected nodes or the whole workspace, while connections consistently remain behind nodes.',
        'Usage node severity colors match the Usage panel, and Skills loads useful initial results automatically.',
        'Workspace recovery validates provider conversations before resume, avoiding stale session errors and unnecessary role reinjection.',
        'Windows now uses the correct CLI launcher, DPI-aware terminal selection, and a styled desktop title bar and menu.',
      ],
    },
    {
      date: 'Aug 10, 2026 · 0.8.0',
      items: [
        'The Usage panel can now be added to the canvas as a persistent node with Claude, Codex, and Kimi quotas.',
        'The Usage node configures source, fallback, and threshold; leaders and agents read its recommendation through the new CLI and MCP usage action before distributing new work.',
        'Settings now includes Appearance with three dark themes, one light theme, and a semantic token editor with immediate preview.',
        'Custom themes can be duplicated, imported, and exported as validated JSON and persist across restarts.',
        'The canvas, nodes, Provider Center, Skills, documentation, and Settings now honor the global theme tokens.',
      ],
    },
    {
      date: 'Aug 10, 2026 · 0.7.0',
      items: [
        'The crowded provider buttons are now consolidated into one Agents menu while Shell remains directly available.',
        'Up to four favorite agents can be pinned beside the menu, with their order saved globally across workspaces and restarts.',
        'Unavailable agents remain visible with a direct path to Provider Center and never occupy the toolbar.',
      ],
    },
    {
      date: 'Aug 10, 2026 · 0.6.0',
      items: [
        'Devin is now a native provider with local detection, account model discovery, autonomous interactive sessions, and exact conversation resume.',
        'The Orkestrai bridge provisions Devin\'s project MCP configuration and skill, while ATIF transcripts provide clean agent replies and spoken responses.',
        'Concurrent Devin agents are matched to their own local sessions by workspace directory without inspecting or modifying Devin\'s data.',
        'Cursor now starts with workspace trust and MCP approval, while Antigravity starts autonomously and exposes its supported effort levels.',
      ],
    },
    {
      date: 'Aug 10, 2026 · 0.5.2',
      items: [
        'Long dictation recordings now reach transcription instead of hitting the packaged server’s 512 KB default request limit after a few seconds.',
        'Recordings longer than approximately 15 minutes show a clear localized limit message in both global and terminal dictation.',
        'Saved Portals automatically retry when their local dev server starts after the canvas and wait for the real page before running automation.',
        'Concurrent Claude terminals reserve distinct conversation ids, preventing crossed transcripts and corrupted agent-to-agent replies.',
        'Portal errors preserve their actionable detail, and provider replies never fall back to raw terminal redraw output.',
        'Resuming a workspace no longer injects roles again: only agents with unfinished assigned tasks, or the leader with unassigned work, receive a continuation prompt.',
        'The server remains responsive while macOS waits for workspace-folder permission, and interrupted provisioning is retried safely.',
      ],
    },
    {
      date: 'Aug 10, 2026 · 0.5.1',
      items: [
        'Terminals now discard obsolete process-local PTY ids after an app restart and automatically resume each provider’s preserved conversation.',
        'Session recovery uses a stable WebSocket error code and waits for the replacement id to persist before reattaching.',
      ],
    },
    {
      date: 'Aug 10, 2026 · 0.5.0',
      items: [
        'Local dictation now writes into the active text field on any screen; with no active field on the canvas, it still sends to the leader.',
        'An agent provider can be changed from the header without losing its name, role, Maestro Mode, floor, position, or connections.',
        'Preset roles now include mission, context, process, acceptance criteria, and handoff, and are applied automatically when the PTY starts.',
        'The leader receives the initial kanban queue with title, description, images, and linked note and must assign each item before delegating.',
        'Notifications distinguish Task completed, Project completed, and Attention so partial delivery cannot look like the entire project finished.',
        'Floors lists the real tasks, their stages, and assignees for every worktree and ground.',
        'Shape text editing matches the rendered size, weight, and alignment, including large type.',
      ],
    },
    {
      date: 'Aug 09, 2026 · 0.4.0',
      items: [
        'Cursor, Antigravity, and Cline now join the canvas as native providers alongside Claude, Codex, Kimi, and OpenCode.',
        'Provider, model, and effort choices come from installed adapters, with no fixed provider enums in the UI, schemas, or recruitment bridge.',
        'Each provider receives the bridge skill and MCP configuration in its supported format; Cline uses workspace-scoped settings.',
        'Session resume tracks exact IDs through each CLI’s transcripts, manifests, or cache, preventing a terminal from opening another agent’s conversation.',
        'Provider Center now detects supported CLIs locally and provides OS-aware installation, official sign-in guidance, capability details, and one-click rechecks.',
        'New installations start in English and ask for language first in onboarding, immediately saving Brazilian Portuguese, English, or Spanish.',
        'The app now waits for the initial saved locale before enabling the interface, preventing mixed-language screens and lost startup clicks.',
        'Preset terminals now start with each provider’s autonomous full-access flags; existing empty-argument terminals are repaired without overwriting customized commands.',
      ],
    },
    {
      date: 'Aug 09, 2026 · 0.3.0',
      items: [
        'Boards now support up to ten custom stages with names, colors, and ordering; the lead and team automatically inspect and update the same workflow.',
        'The Library gained Campaign and launch, Brand and design, and Content and SEO teams with briefs and roles designed for marketers, designers, and creators too.',
        'Orkestrai Contributing combines a Claude lead, Codex and Kimi oracles, Svelar/desktop/QA specialists, and a Flow that requires consensus before task creation.',
      ],
    },
    {
      date: 'Aug 09, 2026 · 0.2.0',
      items: [
        'The preset library is now available on the canvas with search, filters, and ready-made Product, React, Next.js, SvelteKit, Svelar, and Laravel teams; use one in a new workspace or merge it into the current team.',
        'Preset v2 preserves complete task descriptions and statuses plus portable skills, without copying PTY sessions or overwriting customized skills in the destination project.',
        'Roles now includes a localized catalog of 12 complete leadership, engineering, quality, and operations functions.',
        'Floors now shows active agents, assigned tasks, and Git state for every worktree and the ground floor.',
        'The desktop app gained localized native menus, while Settings and Documentation now share the website visual foundation.',
      ],
    },
    {
      date: 'Aug 09, 2026 · 0.1.5',
      items: [
        'Automated messages now wait for the user to finish a draft and are delivered through a queue, so other agents cannot merge text into the leader terminal.',
        'Inter-agent messages are no longer silently truncated at 4,000 characters.',
        'Terminal silence is now a neutral idle state and no longer triggers false desktop attention notifications.',
        'Brazilian Portuguese copy received an accent and language-quality pass, backed by a regression test for frequent mistakes.',
      ],
    },
    {
      date: 'Aug 08, 2026 · 0.1.4',
      items: [
        'Orkestrai 0.1.4 is the first macOS release signed with Developer ID Application and notarized by Apple; ad-hoc signing is restricted to local builds.',
        'The pipeline stops the release when any of the five Apple credentials is missing, preventing another package without a trusted signature from being published.',
        'CI verifies authority, Team ID, Hardened Runtime, Gatekeeper acceptance, and the notarization ticket on Apple Silicon and Intel builds before publication.',
        'This version is also published to the legacy feed to reach existing installations and migrates the app to the main repository for future updates.',
      ],
    },
    {
      date: 'Aug 07, 2026 · 0.1.3',
      items: [
        'Orkestrai 0.1.3 fixes the 0.1.2 macOS package: the files were intact, but a partial ad-hoc signature made Gatekeeper report that the app was damaged.',
        'macOS bundles without a certificate now receive a complete ad-hoc signature; CI validates deep signatures, DMGs, and ZIPs for Apple Silicon and Intel before publication.',
        'Legacy updaters are blocked on Mac so they cannot remove the current installation; the new app detects releases through the public API and directs users to safe manual installation.',
        'On the first launch without a Developer ID, try to open the app, dismiss the warning, then use System Settings → Privacy & Security → Security → Open Anyway; authenticate and confirm Open. Windows was not affected.',
      ],
    },
    {
      date: 'Aug 07, 2026 · 0.1.2',
      items: [
        'Orkestrai 0.1.2: the Usage panel now refreshes Claude, Codex, and Kimi automatically every 5 minutes instead of every 60 seconds, reducing unnecessary calls and the risk of HTTP 429 responses.',
        'The server cache uses the same interval and prevents duplicate requests when reopening the panel or returning to the app.',
        'The manual refresh button still fetches fresh data immediately and bypasses the cache only when explicitly used.',
      ],
    },
    {
      date: 'Aug 07, 2026 · 0.1.1',
      items: [
        'Orkestrai 0.1.1 includes electron-updater in the installed application; Settings no longer mistakes a missing module for running outside the desktop app.',
        'Installations on 0.0.1 and 0.1.0 need one manual update to 0.1.1. After that, Windows and Linux return to automatic updates; unsigned macOS keeps the safe manual download.',
        'User-created tasks reach the leader only after title, markdown description, and every attached image have been persisted.',
        'The briefing sent to the leader and assigned agent always contains the title, description, and complete reference-image list.',
      ],
    },
    {
      date: 'Aug 07, 2026',
      items: [
        'Orkestrai 0.1.0: first public release prepared to update existing 0.0.1 installations.',
        'Tag-driven pipeline builds macOS Apple Silicon/Intel, Windows x64 and Linux x64 and publishes binaries only to the public releases repository.',
        'A release becomes public only after validating installers, blockmaps, latest-*.yml manifests, sizes and SHA-512; macOS requires update ZIPs for both architectures and the Windows installer uses the exact filename referenced by latest.yml.',
        '“Check now” returns the actual result and no longer stays stuck on “Checking”; boot events are also retained when the screen mounts later.',
        'A temporary GitHub check failure no longer opens the manual update dialog. The fallback appears only after a found update fails to download or install.',
        'Windows NSIS and Linux AppImage update unsigned; on macOS without an Apple certificate, the app keeps the safe manual download fallback.',
      ],
    },
    {
      date: 'Aug 06, 2026',
      items: [
        'New Ports panel immediately after Usage: lists listeners linked to local workspace Portals, including process, PID and in-use/free state.',
        'Fixed Codex MCP on Windows: config.toml now uses absolute runtime and CLI paths, without depending on PATH, PATHEXT, .cmd files or external Node.js.',
        'The global orkestrai mcp handshake now starts even outside a workspace; token and URL are required only when a tool actually accesses the bridge.',
        'Safe port stopping with confirmation, PID revalidation and Orkestrai process protection; arbitrary machine ports are never listed.',
        'New dictation orb at the top right: triggers the leader\'s exact microphone flow and writes the transcript straight into that terminal, even on another floor; without a leader, it shows a clear toast.',
        'Fixed Claude resume tracking: subagent transcripts and startup files without a resumable message no longer replace the leader conversation\'s valid ID.',
        'After deleting local voice models, both the terminal microphone and leader orb ask for confirmation before downloading again; the UI also reports deletion failures.',
        'Supertonic 3 replaces Kokoro for spoken replies, with local 44.1 kHz audio; Parakeet and the entire STT flow remain unchanged.',
        'Three speech presets — pt-BR, en-US and Latin American Spanish — with preview, adjustable speed from 0.75× to 1.50× and automatic migration from old voices.',
        'Long replies are synthesized sentence by sentence, with prefetch for the next segment and binary PCM over IPC so playback starts sooner without overlapping speech.',
        'The new INT8 model has a smaller download, is verified with SHA-256 and removes the old Kokoro only after successful installation.',
        'Global documentation search with Cmd/Ctrl+K now covers wide monitors completely and keeps the dialog centered.',
        'Interface, documentation, use cases and three new tours translated into pt-BR, English and Español (16 onboarding tours).',
      ],
    },
    {
      date: 'Aug 05, 2026',
      items: [
        'Trello-style kanban: composer with title, markdown description and images attached right at task creation (Ctrl+V or picker, with thumbnails).',
        'Task description rendered on the card (double-click to edit) and supported in the API/CLI.',
        'Full markdown in notes, roles and kanban history: links, checkboxes, tables and code — sanitized.',
        'New Image node on the canvas: visual reference connectable to agents (paste with Ctrl+V or pick the file).',
        'All app placeholders translated (pt-BR/English/Español).',
        '100% i18n coverage: the whole app (canvas, nodes, panels, dialogs, palette, pages) speaks pt-BR, English and Español — 500+ new keys.',
        '"How to use" documentation fully translated: topics, use cases, quickstart and changelog follow the chosen language.',
        'CLI: task add accepts --description in markdown (also in the MCP tool).',
        'Flow that actually works: agents without a session are started by the pipeline itself, errors show in a banner on the node (no more silent failures) and empty states guide you.',
        'Folder icon (the default) selectable in the workspace editor — the picker had 24 icons but not the original one.',
        'Terminal text injection fully unified (roles included): text and Enter always in separate writes — the composer never gets stuck on any provider (Claude, Codex, Kimi).',
        'Chained flows: a Flow connected to another triggers the next one with its final output (failure does not chain, cycles blocked) — compound pipelines and fan-out.',
        'Sync button on the Flow: each connected agent becomes a step in edge order — the pipeline is the drawing itself.',
        'New guided tour "Chained flows" in onboarding (12 tours now): creates both flows, connects them and you run the chaining.',
        'Onboarding modal polished: the purple selection/focus ring is no longer clipped by the scroll, fade at the bottom of the list and a wider use-case step.',
        'Onboarding always guides from scratch: welcome → create a new workspace → use case, even with a workspace open (the "use current" shortcut remains).',
        '"Do it for me" shows up instantly on the canvas: nodes and connections created by tour, CLI or API trigger live refresh — no leaving and re-entering the workspace.',
        'Fix: onboarding would not open in English/Spanish — the language switch remounted the page after the URL was cleaned and the wizard died; the intent now survives the remount (regression test included).',
        'Fix: the research tour no longer gets stuck on the last step — steps now run several actions in sequence (both connections are made) and the tour completes by itself when the last check passes.',
        'Fix: MCP search broke the list when the registry returned duplicates (now dedupes) — searching "Figma" works and the curation comes first.',
        'New use case + tour "From Figma to code": Designer agent, Image node with the mockup and Figma MCP to read the file directly (13 tours).',
        'Serious fix: agent-to-agent replies come from the CLI clean transcript (no TUI junk, status bars or duplicated characters) — no more composer opening an external editor with corrupted text.',
        'Fix: the Orkestrai MCP server spoke the wrong framing (LSP) and Kimi timed out after 30s — now it is NDJSON, the official MCP stdio standard (Claude, Kimi and co. connect).',
        'All composer text injection is sanitized: no control bytes and no stray Enter (partial submit) on any provider.',
        'Serious tour fix: a step with an action but no check never advanced (and each click created another agent) — now it advances by itself, with a duplicate guard. An e2e audit runs all 13 tours end to end on every build.',
        'Fix: MCP tools with wrong fields (ask sent text instead of message, notes pointed to nonexistent routes, dismiss sent agent instead of target) — now covered by body-to-body mapping tests against the bridge schemas.',
        'Full MCP contract: all 23 tools are validated against the real bridge routes and schemas on every build; maestro tools without identity give a clear error instead of a 422.',
        'Ask no longer returns boot junk: if the transcript is still empty (trust screen, composer echo), the bridge waits for the real answer instead of passing along the raw screen.',
        'Codex, Kimi and OpenCode now BORN knowing the bridge: block in AGENTS.md (merged, nothing of yours is erased), Codex MCP in ~/.codex/config.toml and opencode.json in the project — before, only Claude got the instructions.',
        'Deleting a node asks for confirmation (keyboard Delete and the node X): no more losing an agent and its context by accident.',
        'An agent reply is no longer injected into the other composer (it already arrives via the command result) — no more text spliced into your typing.',
        'Kimi unlocked for good: the bridge waits for the TUI to finish booting before writing (Enter became a newline in the composer), re-sends Enter if nothing happens and reads the answer from the real wire.jsonl — verified with the real Kimi answering cleanly.',
        'Duplicate titles no longer break routing: new agents get an automatic suffix (Dev 2, Dev 3) and an ambiguous ask explains how to fix it instead of messaging the wrong agent.',
        'orkestrai list now marks who leads with [LIDER] — agents no longer guess "orkestrai ask Maestro" (Maestro is the role, not a title).',
      ],
    },
    {
      date: 'Aug 04, 2026',
      items: [
        'Voice conversation cycle: you dictate, the agent replies speaking — in real Brazilian Portuguese.',
        '100% self-contained voice (no Node, no Docker): its own runtime downloaded together with the model, disk-space check and option to delete the model.',
        'Speech reads only the current reply — no markdown, URLs or weird characters.',
        'Kanban: attaching images to cards working (Ctrl+V and picker).',
        'No more leaking arrow tip; style panel with sliders and configurable arrowhead.',
        'Kimi usage renews the credential by itself.',
        'No port fights between workspaces: orkestrai port returns a free port and agents learn to never kill a process on someone else\'s port.',
        'Unload button with confirmation and feedback; redesigned Settings; changelog right here on the page.',
        'Automatic updates: the app fetches a new version by itself and installs on switch, without touching your data.',
        'Loading skeletons in the sidebar, usage, skills and Settings — no UI jumps.',
        'Kanban with history: archive completed tasks without losing the record of what was delivered.',
        'Task with linked spec note: archived together, protected against deletion, readable from the history.',
        'Voice reads the session transcript: the agent\'s full reply, without invisible characters.',
        'Team presets: save the workspace as a template and start projects with the team ready.',
        'Flows: visual agent pipelines with human approval and run history.',
        'Own MCP server + new CLI tools (fs, say, run, clip) + MCP manager.',
        'Agent-to-agent reply submitted by itself — composer no longer hangs.',
        'Automatic reconnection after laptop suspension, with context restored.',
        'Reload button on every terminal (restarts the session with context).',
        'Windows are never born smaller than the minimum — no leaking buttons.',
        'Tooltips across the toolbar; Diff/Loop/Floors copy in plain language.',
        '⌘K / Ctrl+K global: search the documentation from any screen.',
        'MCP marketplace on the Skills page: official curation + registry, 1-click install and guided token fields.',
        'App in Portuguese, English and Spanish: language selector in Settings (paraglide).',
        'Design pass: redesigned Skills & MCPs page (segmented tabs, cards with badges) and polished docs.',
        'Interactive onboarding: 11 guided tours by use case, with "Do it for me" and auto-completion, in 3 languages.',
        'Workspace icon is now a Lucide picker (sidebar, editor and presets); old emoji keeps working.',
      ],
    },
    {
      date: 'Aug 03, 2026',
      items: [
        'Embedded voice with no Docker and no Python, with confirmation before the download.',
        'Kanban with reference images and leader notified of new tasks; roles with markdown editor.',
        'Full Windows support; native notifications with brand, workspace and agent.',
      ],
    },
    {
      date: 'Aug 02, 2026',
      items: [
        'Maestro Mode fixed end to end: the leader recruits, connects and distributes on its own.',
        'Provider usage panel and skills marketplace (skills.sh) inside the app.',
        'Automatic orchestration on the canvas: org chart, live edges, kanban and portal.',
        'Offline dictation with configurable shortcut; Linux/Windows builds and DMG background with the brand.',
      ],
    },
    {
      date: 'Aug 01, 2026',
      items: [
        'Orkestrai is born: agent canvas, CLI bridge, floors (worktrees), routines, roles, kanban, portal and Maestro Mode.',
        'Multi-workspace with exact context resume; desktop app for macOS, Linux and Windows.',
      ],
    },
  ],
};
