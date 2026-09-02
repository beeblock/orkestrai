# Svelar App — Agent Guidelines

## Required Flow

- Follow the Svelar architecture: route -> controller/page action -> FormRequest/shared schema validation -> DTO -> action/service -> repository -> model/resource -> response.
- Use Svelar CLI generators before hand-writing artifacts when a generator exists.
- Use Svelar ORM and migrations. Avoid raw SQL unless it is a low-level driver/infrastructure exception.
- Keep one migration per table or focused schema change.
- Use shared schemas for backend validation and frontend forms. Use Superforms where app forms need shared validation.
- Keep validation consistent with `svelar.validation.json`. Use Zod schemas in Zod apps and Valibot schemas in Valibot apps.
- Use policies, permissions, teams, middleware, rate limits, sessions, jobs, events, listeners, observers, cache, storage, search, PDF, and broadcasting through Svelar APIs instead of ad hoc implementations.

## Imports

- Prefer app aliases such as `$lib/modules/...`, `$lib/domain/models/shared/...`, `$lib/database/...`, and `$lib/factories/...`.
- Prefer Svelar subpath imports such as `@beeblock/svelar/orm`, `@beeblock/svelar/routing`, `@beeblock/svelar/forms`, `@beeblock/svelar/validation`, `@beeblock/svelar/auth`, `@beeblock/svelar/queue`, and `@beeblock/svelar/storage`.

## Git And Commits

- Write every commit subject and body in English. Never use Portuguese or Spanish in commit messages.
- Use Conventional Commits with a lowercase type and an imperative, concise subject: `type(optional-scope): summary`.
- Prefer `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `build`, `ci`, and `chore`; add a scope when it makes the affected area clearer.
- Write GitHub Release titles and notes in English.
- Keep commits focused on one coherent concern. Do not mix unrelated cleanup or user changes into the same commit.
- Before committing, review the full staged diff and run the verification appropriate to the change. Never commit secrets, runtime databases, generated installers, build output, or local workspace data.

## Frontend

- Use Svelte 5 runes in `.svelte` files: `$props`, `$state`, `$derived`, `$effect`, and `{@render children()}`.
- Do not use Svelte runes in plain `.ts` files.
- Use generated shadcn-svelte components for app UI.
- Mutating browser `fetch` calls must include Svelar's CSRF header. Enhanced forms can use the regular form flow.

## Agent Room Module

- Agent CLIs (claude, codex, kimi, opencode) are accessed only through adapters in `src/lib/modules/agent-room/application/adapters/`. Register new providers via `registerAgentAdapter` in `registry.ts` — never hardcode provider ids outside `domain/types.ts` defaults.
- Agent Room persistence uses Svelar ORM models in `domain/models/` (tables `agent_*`) and repositories in `infrastructure/repositories/`. The legacy better-sqlite3 store (`data/app.sqlite`) was migrated by `npm run migrate:agent-room-data`.
- IDs are UUID v7 (`uuidv7()` from `@beeblock/svelar/support`).
- Legacy data import: `npm run migrate:agent-room-data` (idempotent).
- PTY sessions live in `infrastructure/pty/PtySessionManager.ts` — the singleton MUST stay attached to `globalThis` (the SSR bundle and the type-stripped WS layer load separate module copies; only `globalThis` makes it a true process singleton).
- The PTY WebSocket (`/ws/agent-room/pty`) is served by the vite plugin in dev and by `scripts/orkestrai-server.mjs` in production (HTTP handler + WS in one process; also what Electron spawns). `pty-ws.ts` must stay self-contained (erasable-syntax TS only — Node type stripping runs it).
- The `orkestrai` CLI bridge (ask/list/note/notify/recruit/dismiss/connect/port) lives in `packages/orkestrai-cli` and authenticates per-workspace via `.orkestrai/workspace.json` token written by `BridgeService`. A boot shim (`scripts/install-orkestrai-shim.mjs`, called by both `vite.config.ts` and `scripts/orkestrai-server.mjs`) writes self-contained `orkestrai`/`orkestrai.cmd` launchers into `ORKESTRAI_SHIM_DIR` (`storage/bin` in dev, `<userData>/bin` packaged) which `PtySessionManager` prepends to the PTY `PATH`; packaged shims invoke the Electron executable with `ELECTRON_RUN_AS_NODE=1`, so Windows does not require a separate `node.exe`. Codex's global `~/.codex/config.toml` is repaired on workspace provisioning to use the same absolute runtime + CLI paths (never a bare `.cmd`), and `orkestrai mcp` defers workspace token resolution until a tool call so its global handshake also succeeds outside Orkestrai. The packaged port is dynamic, so the CLI resolves the API URL in this order: `ORKESTRAI_API_URL` env → `~/.orkestrai/runtime.json` (rewritten at every boot) → `workspace.json` apiUrl → default. Agents get their identity via `ORKESTRAI_NODE_ID`/`ORKESTRAI_AGENT_TITLE` env injected at terminal spawn; the CLI uses them as default `--from`/`--agent`.
- Bridge provisioning (skill `.claude/skills/orkestrai/SKILL.md` + `workspace.json`) happens at workspace create AND is repaired lazily in `WorkspaceService.get` (`ensureProvisioned`) — never rely on create-only provisioning for old workspaces. The skill content is re-written when the template changes.
- Bridge automation (all in `BridgeService`): `recruit` auto-connects the recruit to the maestro and clamps titles to 48 chars and roles to 60 (sentence-long values break the node header; the UI additionally truncates the role label to 24 chars); `ask` auto-creates an edge between the two agents (edges reflect real conversations); `note create` connects only to its author by default, while `--connect all` explicitly shares it with the whole team; the first bridge `task add` auto-creates the `tasks` (kanban) node connected to the maestro via `ensureTasksBoard`; `portal create` (maestro-only) creates portal nodes — bare localhost URLs default to `http://`, the rest to `https://`. `orkestrai notify` prints `[orkestrai:notify]` to the server stdout, which `electron/main.cjs` turns into a native desktop notification — agents are told (via the skill) to call it when finishing or needing attention.

## Voice (dictation + TTS)

- **Default: embedded voice, no Docker and no Python.** `infrastructure/voice/EmbeddedVoice.ts` runs STT (Parakeet-TDT v3 int8, unchanged) and TTS (Supertonic 3 int8, 44.1 kHz, presets pt-BR/en-US/es-MX from `domain/voice.ts`) through the `sherpa-onnx-node` npm package in a **forked subprocess under a real Node.js** — never under the Electron binary: Electron's V8 sandbox rejects the external buffers sherpa's TTS uses ("External buffers are not allowed"). The pinned model archives are verified by SHA-256. The app downloads a standalone Node runtime (~50 MB from nodejs.org) together with the models; `resolveVoiceNode()` prefers it, falling back to a system Node (PATH, Homebrew, nvm). The subprocess self-terminates after 5 min idle and on IPC disconnect (no orphans). Downloads (~670 MB) + runtime/models land in `<data dir>/voice/models` (system `tar` extracts tar.bz2/tar.gz/tar.xz/zip), model dirs marked with `.complete` — `embeddedModelsReady()` gates the confirm dialog. After Supertonic is complete, the legacy Kokoro directory is removed.
- **Optional: voice-stack sidecar** (Docker, OpenAI-compatible) for faster-whisper/Chatterbox — selected via the `voiceBackend` setting (`embedded` default, `sidecar`). `VoiceService` branches on it; the sidecar path keeps `voiceStackUrl`/`voiceSttModel`.
- Dictation flow: renderer decodes MediaRecorder webm to WAV PCM16 16 kHz (`audio-pcm.ts` — no ffmpeg on the server), server runs `wavToPcm16` → `transcribePcm`. TTS: `speakWav` selects the Supertonic `sid` + `lang`, applies the persisted `voiceTtsSpeed` (0.75–1.50), converts native Float32 to PCM16 inside the worker and sends it through advanced binary IPC; `voice-speech.ts` synthesizes/prefetches sentence-sized chunks so playback starts before a long reply is fully generated.
- `VoiceService` (server) is also the proxy for the sidecar via `/api/agent-room/voice/{transcribe,speak,health}`.
- The dictation hotkey is reactive: `app-settings.svelte.ts` is a shared store (`getAppSettings`/`invalidateAppSettings`) — terminals re-read it; the settings page invalidates it on save. Do not fetch settings per-component at mount.
- Speak-back: `BridgeService.ask` broadcasts `agentReply` on the PTY WS; each `TerminalNode` forwards it and `TerminalCanvasNode` speaks it (toggle in the node header) via `voice-speech.ts`.
- `scripts/orkestrai-server.mjs` must set `ORIGIN` (adapter-node defaults to https when deriving `event.url`, which breaks the Svelar same-origin middleware). `hooks.server.ts` normalizes loopback Origin spellings (localhost vs 127.0.0.1) — do not remove that middleware.
- The Svelar rate limit is raised to 5000 in `hooks.server.ts`; the default (100/min) is exceeded by the canvas UI and the e2e suite.

## Canvas UI

- The canvas (`src/routes/canvas/+page.svelte`) uses @xyflow/svelte with custom node components in `src/lib/components/agent-room/canvas/`. Layout persists per workspace via the workspaces/nodes/edges API.
- `useSvelteFlow()` only works inside `SvelteFlowProvider` — use the `ZoomBridge` component pattern to expose zoom functions to the page.
- Canvas page and `/terminal` are client-only (`ssr = false`) — avoids hydration races with xterm/xyflow.
- e2e tests run against the production build (`npm run build && PORT=5199 node scripts/orkestrai-server.mjs`), serial workers. Clean up created workspaces via API at the end of each test.

## Figma interoperability

- The managed official remote MCP is `https://mcp.figma.com/mcp`. Provision it only in provider formats documented as compatible; do not replace it with community Figma MCP packages.
- App-side structural reads use `FigmaApiClient` against the fixed official REST host. The optional read-only token is stored under `automation:figma:<workspaceId>` through Electron secure storage and must never enter workspace files, logs, URLs, or renderer persistence.
- Figma imports remain native `DesignDocument` content with persistent `figmaLinks`, source mappings, and separate remote/local hashes. Synchronization must preview added, removed, remote, local, and conflicting states before applying explicit resolutions, while preserving Code Connect metadata.
- REST does not write the Figma scene graph. Selection transfer and write-back use the first-party `packages/orkestrai-figma-plugin` bridge, authenticated with the workspace token and restricted in code to loopback Orkestrai origins. Do not add OpenPencil, Pen.dev, or another editor/bridge dependency.

## Design delivery

- Code-to-design parses static HTML/Svelte/Vue with parse5, React/JSX/TSX with the ESM-safe Babel parser, CSS with PostCSS, and a bounded Tailwind utility map. Never execute imported scripts, framework configuration, plugins, or arbitrary CSS.
- Design-to-code supports Svelar/Svelte, React/Next, Vue, and HTML/Tailwind through `DesignDeliveryService`. Always preview before writing; preserve workspace path confinement, expected file hashes, document revisions, and Code Connect component mappings.
- Generated files are workspace artifacts linked to the native Design document. Monaco, Review Center, global search, Portal/device capture, bridge CLI, and MCP tools must operate on the same artifact path and revision rather than maintain parallel state.
- Visual comparison is evidence, not an automatic correctness claim: normalize explicit viewports, retain reference/actual/diff images, and create traceable review tasks for human or agent decisions.
- Native prototypes, interactions, presentation settings, motion tokens, tracks, and keyframes live inside the versioned `DesignDocument`; the manual editor, player, global search, CLI, and MCP agents must use that same command bus and revision guard rather than maintain a parallel prototype store.

## Electron

- `electron/main.cjs` spawns the adapter-node server (`build/index.js`) as a child process with `ELECTRON_RUN_AS_NODE=1` and loads it in a BrowserWindow.
- After changing native deps (better-sqlite3, node-pty), run `npm run electron:rebuild` to rebuild them for the Electron ABI.
- Dev: `npm run electron:dev` (build + launch).
- Packaging: `asar` is OFF on purpose — the production server (`scripts/orkestrai-server.mjs`) is ESM and Node's ESM loader cannot resolve packages inside an asar; with asar enabled the app only worked because the source repo's `node_modules` happened to be nearby. Do not re-enable it.
- Electron is pinned to v42 (ABI 146) because better-sqlite3 only publishes Electron prebuilds up to ABI 146 — upgrading Electron means compiling better-sqlite3 for every target (mac needs `electron:rebuild`; Linux/Windows cross-builds break).
- macOS: `npm run package:mac -- --arm64` (and/or `--x64` for Intel). The wrapper applies a complete ad-hoc signature and disables the macOS update rollout when Apple signing secrets are absent; never call electron-builder directly for a distributable Mac package. Linux/Windows locally via Docker: `scripts/package-cross.sh linux|linux-rpm|windows|windows-zip|clean` (official electronuserland images, staging without host `node_modules`, npm pinned to the host version). Native Windows build (recommended for the NSIS installer): see `docs/build-windows.md` — no MSVC needed, prebuilds cover everything.
- **Build hygiene**: after every packaging run, delete the unpacked intermediates — `release/mac`, `release/mac-arm64`, `release/linux-unpacked`, `release/win-unpacked` (~500-600 MB each, fully reproducible from the DMG/AppImage). Keep only the final artifacts (`*.dmg`, `*.AppImage`, `*.rpm`, `*.zip`, `*.exe`). The cross script already cleans its staging via trap; apply the same rule to local electron-builder runs.
- **Disk hygiene (o PC já crashou por ENOSPC)**: builds/e2e/docker comem GBs rápido. Regras: (1) apague `test-results/` depois de rodar e2e (traces de retry são centenas de MB); (2) após cross-build com Docker, remova a imagem `electronuserland/builder` e rode `docker builder prune -f` — NUNCA `system prune --volumes` (volumes de outros projetos do usuário guardam dados); (3) nunca rode `npm run build` ou vitest em paralelo com a suíte e2e (o webServer serve do `build/` — corrompe a suíte e lota o disco de traces); (4) `storage/voice` em dev duplica os modelos do app instalado (~1 GB) — pode apagar, o dev re-baixa se precisar; (5) `database.db.bak-*` acumula — mantenha só o mais recente.
- **Auto-update**: `electron-updater` wired in `electron/main.cjs` (packaged only) — checks at boot + every 6h, downloads to a cache dir, verifies sha512 from `latest-*.yml`, and swaps only on `quitAndInstall` (user data lives outside the bundle and is never touched). Events flow to the renderer via `orkestrai:update` IPC; `UpdateNotifier.svelte` (root layout) shows progress + the restart dialog, with manual-download fallback on error. Releases and update manifests publish in `beeblock/orkestrai`. Version `0.1.4` is the one-time transition release also published to `beeblock/orkestrai-releases`, allowing older installations to move to the main feed; never delete that legacy release or repository. macOS replacement is enabled only when `spctl` trusts the installed bundle; ad-hoc builds set `stagingPercentage: 0`, never download/replace in place, and show the manual-download dialog. Windows NSIS, Linux AppImage and Linux RPM update unsigned. mac target includes `zip` for the future signed updater path.
- **Install hygiene (macOS)**: never install from a `/Volumes/Orkestrai*` glob — stale mounted DMGs make it copy the wrong arch and `cp -R` merges bundles instead of replacing. Detach every `Orkestrai` volume first, `rm -rf /Applications/Orkestrai.app`, then `cp -R` from the exact volume path that `hdiutil attach` printed, and verify with `file /Applications/Orkestrai.app/Contents/MacOS/Orkestrai` (must say `arm64` on Apple Silicon).

## Docs & Changelog (obrigatório a cada mudança)

- Toda mudança de funcionalidade, correção visível ou UX **exige** atualizar, no MESMO commit: `CHANGELOG.md` (raiz, sempre em inglês e fonte das notas públicas da release), o changelog in-app (array `changelog` nos 3 catálogos de `src/lib/i18n/docs/`) e, quando aplicável, as seções/casos de uso da página "Como usar" e o `README.md`. Nunca empacotar/instalar com docs ou changelog desatualizados.
- Releases seguem SemVer estrito: correção compatível = patch, funcionalidade compatível = minor, quebra de compatibilidade = major. A mesma versão e as mesmas mudanças devem aparecer, antes da tag, no changelog do app e nos três catálogos do site irmão `../orkestra-site`; nunca publicar superfícies dessincronizadas. A versão de transição `0.1.4` também exige changelog e README sincronizados no repositório legado `../orkestrai-releases`.
- **Toda feature nova exige caso de uso documentado E tour guiado no onboarding**: adicione o caso de uso nos 3 catálogos de docs (`src/lib/i18n/docs/`, mesma posição nos 3) e um tour em `src/lib/components/agent-room/tours/catalog/{pt-BR,en,es}.ts` (mesmo id/ordem nos 3). Os testes de integridade (`tests/unit/docs-catalog.test.ts` e `tests/unit/tours-catalog.test.ts`) garantem a paridade — rode-os antes de commitar.

## i18n (pt-BR / en / es)

- O app é internacionalizado com paraglide (`project.inlang`, `messages/{pt-BR,en,es}.json` compilado para `src/lib/paraglide`). **Toda string nova de UI passa por `m['chave']()`** de `$lib/paraglide/messages.js` — nunca texto hardcoded; sempre adicione a chave nos 3 idiomas no mesmo commit.
- O locale vem da setting `uiLanguage` (seletor em Configurações) via `overwriteGetLocale` em `src/lib/i18n/locale.svelte.ts`; o layout raiz usa `{#key localeState.current}` para remontar a árvore na troca (é o mecanismo de reatividade — não remova).
- **Cobertura é 100%**: não existe "página ainda não migrada" — toda string visível usa `m.*()`. Conteúdo longo e estruturado NÃO vai para o paraglide: a página "Como usar" usa catálogos TS por idioma em `src/lib/i18n/docs/{pt-BR,en,es}.ts` (mesmo padrão dos tours em `tours/catalog/`), com teste de integridade (`tests/unit/docs-catalog.test.ts`) garantindo estrutura idêntica nos 3 idiomas — ao editar docs/changelog in-app, edite os 3 catálogos no mesmo commit.

## Verification

- Before shipping meaningful changes, run focused tests and `npm run build` when feasible.
- For queue or scheduler behavior, run `npm run dev:worker` and `npm run dev:scheduler` locally with Redis available.
- Do not revert unrelated user changes in the working tree.
- Before opening a PR, run a self-review pass distinct from "does it work": a maintainer review on this repo previously caught a credential-persistence leak, an overly permissive PTY WebSocket origin check, unvalidated external API payloads reaching the UI, and provider-specific assumptions that didn't hold, all of which passed the full test suite. Specifically:
  - **Secrets/credentials**: trace any resolved secret value all the way through, not just to where it's computed. Confirm it never lands in a persisted payload, a DB row, an API response, or a log, not only that resolution itself works.
  - **External input**: any payload from an external API (registries, status endpoints, marketplaces) must be allowlisted/bounded (known indicator values, string length limits, URL scheme checks) before it reaches the UI or storage, even for "read-only" display data.
  - **Cross-cutting dimensions**: check a new feature against the dimensions this codebase already has (WSL runtime alongside native, all agent providers, all 3 UI languages), not only the one dimension the task happened to touch.
  - **Per-provider claims**: verify a provider-specific mechanism (env var, CLI flag, account model) against that provider's actual docs before implementing; do not assume symmetry with another provider's pattern.
  - **Backend/UI state parity**: if a service exposes a distinct state (e.g., a `checked`/`verified` flag for a failed vs. unknown vs. confirmed result), confirm the UI actually branches on it instead of defaulting to the "healthy" appearance.
  - **Multi-target writes**: when a change fans out to several files or records (per-provider config files, MCP entries, etc.), validate every target before writing to any of them. A missing file and an invalid/malformed one are different cases — never silently coerce a parse failure into an empty default, since a later write could overwrite real user data with it.
  - **Generated UI controls**: don't hand-roll a raw `<select>`, `<input type="number">`, or similar when a generated shadcn-svelte component already covers it; reuse the existing wrapper so interaction and accessibility stay consistent with the rest of the app.
  - **Visual consistency**: check a new icon, mark, or color choice in both light and dark theme, and confirm it matches the same visual language everywhere it's reused (Provider Center, terminal headers, Usage, toolbar, etc.), not only the one surface the task happened to touch.

<!-- orkestrai:begin -->
## Ponte Orkestrai (agentes)

Este projeto roda dentro de um workspace do Orkestrai. Você tem a CLI `orkestrai` e/ou tools MCP `orkestrai` disponíveis para colaborar com o time no canvas:
- `orkestrai list` — agentes do workspace, notas e portais conectados. O [LIDER] marcado e o maestro do time: fale com ele pelo TITULO ("Maestro" e o papel, não um nome de agente).
- Repositórios adicionais aprovados aparecem em `orkestrai list` como aliases `@nome`; use esses aliases em caminhos de tools como `api_client_import`, nunca tente escapar com `../`.
- `orkestrai usage` — cotas reais e recomendação do nó Usage; líderes consultam antes de delegar e roteiam novas tarefas ao recommendedProvider quando shouldFallback=true.
- `orkestrai ask "<Agente>" "<mensagem>"` — fala com outro agente e aguarda a resposta.
- `huddle_list` / `huddle_say` — acompanha huddles ativos e registra somente a contribuição deste agente no transcript.
- `code_graph_status/index/search/symbol/neighbors/changes/contracts/quality/semantic/evidence/context/operations/explain/locate/revisions/compare/investigation/handoff` / `orkestrai graph ...` — consulta o mesmo grafo nativo visível no Canvas e Workbench. Use `explain` para procedência, `locate` para sincronizar código e grafo, `operations` para agentes/tarefas/Floors e conflitos, `context` para pacotes revisáveis com orçamento explícito, `compare` para revisões e `investigation` para salvar/restaurar visão, filtros, seleção, câmera e arquivo. Consulte `changes` antes de integrar, `contracts` para APIs e `quality` como evidência. Em modo Assistido, `semantic` aguarda o índice local atualizado automaticamente; em modo Manual, construa ou reconstrua esse índice explicitamente. Importe `evidence` apenas de caminho relativo confinado. Use `handoff` para Review Center ou tarefa rastreável; líder, agente e Council recebem revisão e ids de origem. Nunca invente relações ausentes nem peça SQL/Cypher arbitrário.
- `orkestrai note read/write/edit/create` — notas compartilhadas no canvas.
- `image_workflow_*` — controle completo dos fluxos nativos de imagem executados por Codex: crie/configure sem rodar, conecte ou reordene Notas e Imagens, adicione referencias do workspace, gere de 1 a 10 outputs, valide, conclua, cancele ou remova. Leia o contrato, use somente `image_gen.imagegen` com `referenced_image_paths`, copie cada output para o destino do workspace e chame `image_workflow_validate`. Se alpha real for exigido e falhar, chame `image_gen.imagegen` novamente usando apenas a saida invalida como referencia e o prompt corretivo retornado, depois valide o resultado, no maximo tres tentativas. Toda mudanca visual, inclusive remover fundo, deve vir da tool nativa: nunca use Python, Pillow, ImageMagick, ffmpeg, remove-bg, mascaras geradas ou processamento local de pixels. Chame `image_workflow_complete` apenas quando todos validarem. Nunca peça chave de API nem use API/script paralelo.
- `orkestrai design list/read/reference/apply` — documentos visuais nativos. Em exploração, produza primeiro 1 desktop + 1 mobile com design_import_code ou lote pequeno, entregue a primeira revisão em até 5 minutos e espere o gate visual humano. Só expanda a direção aprovada com blueprint completo. design list sinaliza stalled e o reviewStatus da revisão atual.
- `design_comment` / `design_propose` / `design_decide_proposal` — colaboracao visual com autoria e revisao: propostas ficam pendentes ate decisao explicita e podem ser comparadas em Floors/Council.
- `design_import_code` / `design_generate_code_preview/apply` — importacao estrutural de HTML/Svelte/React/Vue e entrega para Svelar/Svelte, React/Next, Vue ou HTML/Tailwind; sempre revise o preview e preserve os component mappings antes de aplicar.
- `design_figma_inspect/import/sync_preview/sync_apply` — interoperabilidade estrutural com Figma; combine com o MCP oficial `figma`, sempre revise conflitos antes de sincronizar e preserve Code Connect.
- `orkestrai task list/columns/add/move/done` — quadro do time; consulte `task columns` e respeite as etapas personalizadas pelo usuário.
- `orkestrai floor create/preview/land` — andares (worktrees git) isolados por frente.
- `orkestrai device list/attach/tap/swipe/pinch/type/permissions/tree/screenshot/stop` — device mobile visivel no Workbench; aparelhos Android fisicos so podem ser anexados pelo usuario apos confirmacao na UI.
- `orkestrai ask "<Agente>" "<mensagem>"` — só afirme que falou/consultou alguém quando a ponte retornar uma resposta confirmada; timeout ou erro NÃO contam como conversa.
- `orkestrai task done <id>` — conclui a tarefa, avisa o líder e envia uma notificação identificada; não duplique com notify.
- `orkestrai notify "<msg>" --kind attention|project` — atenção ou conclusão do projeto inteiro (somente após conferir o quadro).
- Todo trabalho delegado precisa de uma task no Kanban ANTES da mensagem direta; nunca execute ou delegue trabalho sem rastreamento.
- Sua identidade está no ambiente (ORKESTRAI_NODE_ID) — `--from`/`--agent` são opcionais. Se `orkestrai` não resolver no PATH, execute o launcher `"$ORKESTRAI_CLI" ...` DIRETO (sem `node`; no Windows `%ORKESTRAI_CLI%`/`& $env:ORKESTRAI_CLI`) — nunca rode o `...orkestrai.js` cru.
- Se as tools MCP `orkestrai` estiverem disponíveis, PREFIRA elas (chamadas tipadas); a CLI e o fallback.
- Detalhes completos: `.claude/skills/orkestrai/SKILL.md`, `.cline/skills/orkestrai/SKILL.md`, `.devin/skills/orkestrai/SKILL.md`, `.agents/skills/orkestrai/SKILL.md` ou `.orkestrai/SKILL.md`.
<!-- orkestrai:end -->
