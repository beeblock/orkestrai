import type { DocsCatalog } from './types.js';

/** /docs page content in English — mirror of pt-BR.js (same ids, order and structure). */
export const DOCS_EN: DocsCatalog = {
  quickstart: [
    'Create a workspace (+ button in the sidebar) pointing to your project folder.',
    'Open Agents in the bottom bar, choose an available service, and drag a rectangle on the canvas — name it, optionally choose model/effort, and check Leader if it will command the team. Notes, tasks, files and other tools can also be dragged from the bar straight to the spot on the canvas where you want the node.',
    'Draw more agents and connect them by dragging from one handle dot to the other.',
    'Open the Tasks board (+ Tasks), create cards and assign them — each task lands straight in the agent\'s terminal.',
    'Talk to any agent through its own terminal, or let the leader distribute everything on its own via the orkestrai CLI.',
  ],
  sections: [
    {"id":"pdf-ocr","title":"Read scanned PDFs with local OCR","body":"Drop a scanned PDF onto Canvas, or use Second Brain > Import files. Open its document node or source entry: OCR runs automatically on image pages and preserves embedded text on mixed PDFs. English, Portuguese and Spanish models ship with the app; no internet, API key, Python or system OCR installation is required. The original PDF is not rewritten and page images are not saved. A private temporary language directory is removed after the parser exits.\n\nRecognized passages show OCR, page and estimated recognition confidence. Search the same text through Second Brain, knowledge_search and knowledge_read. Agents must cite the source id, revision/hash and page and treat OCR as fallible, untrusted evidence. Check names, numbers and critical values against the original. This recognizes printed text, not guaranteed handwriting, diagram understanding or exact table reconstruction.\n\nLimits: 25 MB per file, first 200 pages, 6,000 characters per page and 250,000 characters total. Rasterization uses up to 8 megapixels and 4,096 pixels per side; source images over 16 megapixels may be omitted by the PDF decoder. Extraction stops after two minutes per document and preserves available text with an explicit partial state and unfinished/failed page list. Blank pages remain empty. Password-protected PDFs require an unlocked copy; damaged files show errors. Refresh index retries a partial result; split large PDFs if needed. One parser runs at a time outside the application server, including its OCR worker. A timeout kills both. Previously imported scans are reindexed automatically on the next query after the extractor update."},
    {"id":"second-brain","title":"Second Brain: connected knowledge","body":"Open Second Brain in the Canvas toolbar or Workbench. Sources, Knowledge graph, Workspace Memory and Agent learning share the same workspace. Add to Canvas creates a connectable knowledge node; its graph is separate from the codebase dependency graph. The existing code graph is not replaced.\n\nDrop one or more files from Finder or Explorer onto empty Canvas space, or choose Import files in Second Brain. Each file becomes a document node and a copy is retained under .orkestrai/knowledge in the project. Existing images retain the image workflow. Agents can attach existing project files with knowledge_attach or orkestrai knowledge attach path. Import does not run macros, formulas, scripts or document actions. The file limit is 25 MB. PDF with embedded text, Markdown/plain text, XLSX and CSV are searchable. Other formats are retained but explicitly unsupported for extraction; Scanned and mixed PDFs receive embedded English, Portuguese and Spanish OCR, with no account, upload or separate installation.\n\nSearch matches normalized words in titles, tags and extracted text. Results include the source id, revision, SHA-256 and page, sheet/row or line locator. Open a source to read passages, edit comma-separated tags, follow backlinks or jump to its Canvas node. Original files remain intact when a node is removed. Text extraction is bounded to 250,000 characters and 200 passages, with explicit partial/empty/error/missing states; a partial index is not the entire document.\n\nNotes can link to unique source titles using [[Brief]] or an exact source id. Ambiguous duplicate titles do not silently select a target. Hashtags and explicit tags organize sources. Canvas edges, wiki links and existing task/memory provenance form the graph; edges never grant permissions. Notes/tasks/memories are read fresh on query; files are checked for changes and re-extracted when needed. While visible, Second Brain receives workspace events and watches linked document files. Changes are coalesced briefly, then re-read and re-extracted before display. Atomic saves, deletion and recreation of linked files are observed. WSL/network files use a one-second filesystem poll. A 15-second recovery check renews the watcher lease and catches missed events; disconnected updates are shown as reconnecting, not live. Hidden views pause; file watchers expire after 45 seconds without a visible client. Refresh index forces extraction. Only attached sources are indexed: creating an arbitrary file in the project does not automatically import it. This is lexical retrieval, not vector search or a guarantee of correct answers.\n\nAgents use knowledge_search and knowledge_read and must cite actual passages. Imported text is untrusted evidence, never a system instruction. Do not import passwords, credentials or private conversations. The private Computer conversation-memory store is excluded. No Obsidian account, cloud index or embedding API is required.\n\nKnowledge graph is a native point-and-link network, not another Canvas of cards. Choose 3D to rotate or 2D to pan; drag a source to reposition it, scroll/pinch to zoom, click to read it, or double-click to focus. In 3D, right-drag or Shift-drag pans. Fit, zoom, focus, rearrange and fullscreen controls have tooltips. Colors initially distinguish relationship communities computed with Louvain; the legend names each group after its most connected source and focuses it on click. The palette control switches to source-type colors and type visibility filters. Communities are navigation aids, not new facts or links. Hover shows the full title and excerpt; selected neighbors remain highlighted. Existing positions, camera and selection survive live changes. Rearrange explicitly computes a new force layout. Layout runs in a worker; GPU rendering runs only after changes and pauses offscreen. No invented links or continuous background animation. Use Sources if WebGL is unavailable."},
    {"id":"agent-learning","title":"Agents that retain lessons","body":"Open Second Brain > Agent learning, select the named agent and choose Automatic, Review first or Off. Learning belongs to that Canvas node, not its current provider or session: renaming it, restarting or switching provider retains its lessons. A new or copied agent does not silently inherit another identity. Deleting a workspace removes its learning records; deleting original project files is not part of this operation.\n\nTask completion, or a blocked/error task transition, creates an idempotent pending reflection. The task response and bridge instructions ask the responsible agent to report a meaningful mistake/correction or a verified reusable procedure through learning_reflect. If nothing was learned, learning_skip archives the reflection. The app never wakes every agent merely on startup, spends tokens on a separate reflection model, fabricates lessons or trains model weights.\n\nAutomatic mode can activate ordinary lessons from completed assigned tasks. Evidence remains clearly labeled Agent-reported; this is not an independent test result. Review first keeps proposals pending. Suspicious instruction-changing content and lessons from unfinished work require review. Obvious credential patterns are rejected, but pattern matching is not universal DLP or immunity to prompt injection. Off stops reflection capture and recall without deleting history.\n\nReview the trigger, mistake, correction, task evidence and revision history. Activate, reject or archive a lesson; stale review writes are rejected. Relevant active lessons are included in new task briefs, bounded to five lessons and 1,200 characters each. Agents should also use learning_search before relevant direct work. Historical lessons cannot change security grants, rewrite roles/skills or override current instructions. Recall is assistance, not a promise the model will never repeat an error."},
    {"id":"creative-video-providers","title":"Choose a video provider without changing your image workflow","body":"Open Images > Video workflow in Canvas or Workbench. Existing drafts still use fal.ai. Create reference images and storyboards with the existing Codex subscription workflow; this feature does not send image generation to another provider.\n\nIn the video node, open Configure access > New account. Choose the provider before entering its credential: a fal key, a BytePlus ModelArk API key, or Higgsfield KEY_ID:KEY_SECRET. Save it in the encrypted desktop vault. Then enable this workspace, external media, permitted models, per-run/daily USD reservations and optional agent access. Website subscriptions do not imply API credit or model access. An existing account cannot change provider; create another account instead.\n\nSelect Video provider, Model and a matching Account in the node. fal.ai keeps its live catalog; BytePlus and Higgsfield use versioned, reviewed contracts. Matching model names do not imply matching resolutions, durations, audio or reference modes: Higgsfield H3 currently exposes 2K, not fal's 768p option. Changing provider explicitly resets incompatible parameters/account after confirmation while preserving required references and locked characters for remapping. Verify every input, dialogue and audio setting. Save before estimating.\n\nModel-list rates are labeled public estimates when applicable, with their verification date. They exclude assumed promotions and are not final quotes. Higgsfield Estimate uploads the approved local references and quotes the exact input against that account; it does not generate. BytePlus estimates documented token rates, duration and resolution, conservatively budgeting unknown input-video duration with a 4x reservation. fal keeps its current estimator. No estimate or local reservation guarantees the provider's final invoice. Generate explicitly only after reviewing the outbound data, cost and grants.\n\nEach run freezes its provider, account and contract. Reloading resumes the same remote job, never silently switches models and never retries an uncertain paid submission. Retry download does not regenerate. BytePlus accepts local image/audio references but currently requires public HTTPS URLs for input videos; Orkestrai does not publish them elsewhere automatically. It exposes reference generation, not direct editing/extension in this adapter. After submission, BytePlus cancellation is disabled because its deletion endpoint can erase completed results; local queued work can still be cancelled. Higgsfield supports its reviewed text/image/reference/edit/extend endpoints where listed. Inspect actual picture and sound before approval.\n\nAgents use video_workflow_models with input.provider, then the exact input.endpoint; set config.provider and a matching profileId when creating/updating. They retain assigned-task, owner-grant, preview/revision and idempotency requirements. New providers do not authorize spending or grant credentials automatically. Changing provider/model needs owner agreement; voice and character references are never a promise of perfect generative consistency.\n\nVideo references show names and previews for both canvas assets and standalone project files. Choose the role (first frame, last frame, reference image, video or audio), then pick canvas media or use Choose from project to browse folders. View reference opens a larger preview without leaving the workflow. Numbers are one-based model input positions, not filenames. Technical details contains the exact API mapping and editable relative file path. Viewing a file does not create a node or rewrite the agent's binding. Agents use the same bindings; the app does not infer missing references or start paid generation automatically. The provider adapter uploads or encodes inputs at the disclosed quote/generation step."},
    {"id":"creative-video-sequences","title":"Assemble and export a video sequence","body":"Open Images > Video sequence in Canvas or Workbench. Add existing workspace Video nodes (MP4, WebM or MKV). Install video encoder once in the node if requested: the owner confirms a separate, pinned FFmpeg download verified by SHA-256. No Homebrew, API key or paid generation is involved.\n\nSelect a clip in the vertical list. Move it up/down, set in/out points, audio level and a caption, then Save. Removing a clip only removes it from the sequence. The source hash is pinned; a changed or missing source blocks export instead of substituting media. Choose horizontal, vertical or square output and 24/25/30 fps. Fit keeps all picture content with black padding, never silent crop or stretch. Captions are burned inside 10% title-safe margins.\n\nPlay sequence previews the ordered trims. Export MP4 creates a new H.264/AAC file under generated/videos/sequences and a connected Video node. Inspect the delivered video and sound. An export keeps its source revision and is marked older after edits. Exporting is not delivery; failures and interruptions stay visible. Cancel stops the encoder and leaves sources intact. Owned temporary files are removed after success/failure/cancellation and abandoned job directories are removed before the next export.\n\nAgents use video_workflow_sequences or orkestrai video sequences with an assigned task. Read the current revision before apply/export; retry a timed-out request with the same UUID idempotencyKey. Runtime installation is owner-only. Limits are 30 clips, 10 minutes, even output dimensions 240–1920 per side, one local export at a time, at least 3 GB free disk and a bounded output size. Transfer a sequence together with all its source video nodes. Existing Codex ImageGen images and fal generation remain separate; this is assembly of delivered videos, not a new generative model. Use Full screen on the preview to inspect vertical clips and captions at a readable size, then return to the same editor."},
    {"id":"creative-reusable-workflows","title":"Reuse creative workflows and inspect the queue","body":"Open Images > Creative workflows in Canvas or Workbench, or Save workflow in a Storyboard header. Save workflow captures the current saved revision, ordered scene direction, dialogue, duration and shot. Name it and optionally select an existing workflow to create a new immutable version. Unsaved scene edits are not captured. The agent command video_workflow_recipes also accepts a group containing exactly one storyboard; it captures that board, not unrelated notes, agents or automation. Files, run history, sessions, account credentials and paid grants are not stored in the recipe.\n\nIn Library, choose a version, enter the production brief/script, output aspect ratio and optional Codex image agent. Bind every named product/reference slot to a current-workspace image or video, and every character slot to an approved local character. Matching approved identities can be preselected by exact family/version/digest. Only the owner may deliberately choose a different approved character; agents must preserve the saved identity. Import a character from Character library first when needed. The owner can reuse recipes from another workspace, but agents cannot browse or read other workspaces.\n\nCreate editable storyboard adds ordinary native content with fresh scene IDs and no previous run links. The script replaces the literal {{script}} once, without recursive evaluation; if a direction has no placeholder, the brief is appended. An empty required script or missing input blocks creation. Open the resulting storyboard, inspect every scene and prepare image/video drafts separately. Image dimensions are requested through the existing Codex workflow; video duration and aspect ratio must be declared by the selected endpoint or preparation stops. Existing generation, alpha validation, paid preview, budgets and security gates remain in force.\n\nGeneration queue refreshes real current-workspace image/video states while open. It shows drafts, failures, provider position, reserved USD and output links, not invented percentage progress. Open workflow exposes its regular estimate, grant, review and generation controls. Cancel uses the existing executor; Retry download only retrieves an existing remote result. Uncertain paid submissions have no automatic retry. Some completed outputs do not mean the whole storyboard is complete. Deleting a saved recipe version never deletes instantiated storyboards or output files."},
    {"id":"creative-brand-kits","title":"Reuse an approved brand kit","body":"Open Images > Brand kits in Canvas or Workbench. In This workspace, name the kit, choose color swatches and hexadecimal values, add named logo/product/style images, and write the brief, communication tone and usage rules. Image assets must be local PNG, JPEG or WebP files; export vector logos through the existing Design tools first. Save drafts before approving.\n\nReview the actual files, then Approve and lock kit. Approval freezes copies under generated/brands with SHA-256 fingerprints. Approved versions cannot be edited or deleted as drafts; create a new version to change them. Conflicting revisions or changed files stop the operation instead of overwriting another edit. Palette and rules alone can also form a kit.\n\nUse Approved library > Add kit to Canvas in any workspace. The exact version becomes a native group, a rules note and connected image nodes. Copies are independent of the original project; no provider account, token or generation grant is transferred. Connect the note and relevant images to existing Codex image or fal video workflows, respecting each model’s reference limit. Agents use video_workflow_brands to draft/read/fork/place local kits; only the owner can approve or import across workspaces. Kit inputs do not guarantee pixel-perfect generated outputs: review the result before use."},
    {"id":"creative-shot-direction","title":"Direct framing and camera movement","body":"Open a Storyboard scene or Video workflow and use Shot direction. Choose framing, angle, movement and pace. The same controls persist in the scene and its materialized video draft; still-image drafts include framing and angle, not camera motion.\n\nThese controls are creative intent in the prompt, not a guaranteed camera trajectory. First and last frames and other media fields depend on the selected endpoint’s declared contract. Scene duration must match an exact supported duration; unsupported or ambiguous durations stop preparation instead of silently shortening the clip.\n\nChanging model preserves saved shot intent, character and voice mappings, file references and parameters. Incompatible curated adapters refuse the switch; generic endpoints require repairing incompatible pointers before estimation. Required frame references remain required until explicitly rebound. Agents use the same shot object in video_workflow_storyboards scene operations and video workflow configuration."},
    {"id":"creative-actions","title":"Create a new direction from an existing image","body":"Open Creative actions in an Image node header. Choose Variation, Remove background, Change region or Animate. The original is never overwritten. Each action freezes the exact source bytes into generated/creative-actions and connects a reference node and a new native workflow. The saved ancestry includes the original node, file hash and generation context.\n\nVariation and Change region accept direction and 1–10 results. Choose a Codex agent or assign it in the resulting workflow. For Change region, drag a rectangle on the actual image or adjust X, Y, width and height with the keyboard-accessible sliders. Source dimensions are verified by the backend. This rectangle is prompt guidance, not a hard inpainting mask or a promise that every outside pixel will be unchanged.\n\nPrepare draft does not generate or spend credit. Open the new Image workflow and use the existing Codex subscription flow; background removal requests genuine RGBA transparency and retains the existing validation/repair loop, with no local pixel editing. Animate creates a native video draft: choose any compatible allowed model, map the frozen image and every required character, save, estimate and explicitly run. A missing or changed frozen reference blocks reuse. Cancel before preparation creates nothing; removing a draft never deletes the original. Agents use video_workflow_assets command=prepare with the inspected expectedDigest and edit.operation; both surfaces use the same validation."},
    {"id":"creative-variants","title":"Compare and approve creative variants","body":"Open Compare and review in an Image or Video node header, or in a Storyboard. Same workflow limits the contact sheet to related outputs; turn it off to compare other local assets. Choose A and B with searchable selectors or click a thumbnail for B. Open output locates the original Canvas node.\n\nVideo pairs share play, pause and seek over the shorter common duration; switch sound between A and B. A single video uses native controls. Images fit without cropping. Missing or undecodable files cannot be approved. Compare the face, wardrobe, framing, language and actual voice against approved references; a completed generation is not a consistency guarantee.\n\nWrite feedback and choose Approve, Request changes or Reject. History preserves each decision, author, time, comment and file fingerprint. Approval binds the exact asset bytes, generation provenance and available frozen character versions. A changed file invalidates the decision; competing reviews require reload. Agents use video_workflow_assets list/inspect/decide and may only propose a decision, never approve their own output. These actions do not call fal or ImageGen and do not spend credit."},
    {"id":"creative-storyboard","title":"Plan scenes in a native storyboard","body":"Open Images > Storyboard in Canvas or Workbench. Add a scene and set its title, direction, dialogue, language and requested duration. Select the exact approved character version and local reference images/clips; choose a Codex executor for image generation. Save before switching scenes. Duplicate starts a new draft without reusing execution links. Drag scenes to reorder or use Move up/down. Removing a scene preserves its workflows and output files.\n\nPrepare image draft creates a connected existing Codex image workflow, without running it. Up to five references are supported, including all selected character masters; excess references fail explicitly instead of being dropped. Open the draft and use its normal generation controls. Prepare video draft creates a native fal video workflow without charging. Choose an allowed endpoint, bind every required character and reference, review the actual model duration/audio capabilities and use Save > Estimate > Generate. Unsupported requested duration is rejected, never silently shortened. Preparing the same unchanged scene reuses its linked draft. To choose another draft explicitly, unlink and prepare again.\n\nScene changes mark linked drafts stale; outputs remain unchanged. Manual edits and video_workflow_storyboards use the same revisioned document. Concurrent writes fail with a revision conflict; local unsaved edits remain visible until you discard and reload. Copied storyboards retain missing reference/character IDs for explicit local repair; they never inherit account grants. Review actual picture and sound before approval. An available locked voice reference does not guarantee that every model can reproduce it."},
    {"id":"companion-orchestration","title":"A companion that remembers and schedules work","body":"Start with an active task assigned to the Canvas agent and the existing Computer conversation authorization. Ask the agent naturally to help; computer_capabilities reports supported resources, setup and permissions without reading credentials. Its briefing connects tasks, notes, published Workshop tools, integrations, native image workflows, TTS and PDF generation. It must inspect existing tools before proposing another and may publish automatically only within your existing Workshop policy.\n\nFor example: \"Every Monday at 14:00, America/Sao_Paulo, prepare my weekly report and send its summary to this authorized conversation.\" The agent creates an existing prompt_agent routine through automation_save, then returns its id and next occurrence. In Automations, Schedule offers interval or Calendar with once/daily/weekly/monthly, local time, IANA timezone, weekdays/date/day, and missed-run policy. Skip allows 60 seconds; Latest permits one recent occurrence within your configured delay, not a flood of missed reminders. Nonexistent daylight-saving times are skipped; repeated times run once; a nonexistent monthly day is skipped. The host must be awake, the workspace loaded and authorization active. Inspect, edit, pause or cancel in the same Automations UI; agents can edit only their own assigned-task routines with the current revision.\n\nIn Computer > Conversation replies, enable Private conversation memory explicitly. Only newly observed incoming messages after the baseline and successful native submissions enter this separate local journal. It is not shared project memory and never imports an application's entire history. Retention is 30–3650 days, also bounded by 5,000 messages/16 MiB per conversation. Up to 256 sourced facts retain their cited excerpts until removed; the agent searches older details on demand instead of placing the whole journal in each prompt. History lets the owner search, revise facts and erase a fact or all local memory. Deletion does not erase provider transcripts or the external chat. Disabling pauses new retention; revoking/removing the authorization deletes its private records.\n\nLong requests stay traceable after acknowledgment. Enable scheduled reminders and task results for that exact contact to allow computer_send without requiring a fresh incoming message. It requires an assigned task or automation run source, deduplicates that source across restarts and uses the same foreground, recipient, empty-draft, hourly-limit and risk safeguards. A permission change between typing and sending stops publication. Incoming messages never authorize new contacts, apps, files or purchases. Calendar dispatch and a cleared composer are not proof of a delivered report.\n\nartifact_speech reuses configured TTS to create a workspace WAV; artifact_report creates PDF; artifact_inspect verifies path, format, size and SHA-256. Native images retain the existing Codex workflow without a new API key. In Computer > Conversation replies > Native attachments, the owner authorizes the picker, optional menu item, preview Send, formats and size for that contact. computer_media_send uses an incoming digest or an authorized task/run source, a private immutable copy, exact recipient and preview filename guards. Retry keys cannot repeat an uncertain send. The original file is unchanged; temporary copies are limited to 100 MiB and expire after 15 minutes. Receiving is a separate opt-in: choose the message Download control and optional incoming-media prefixes. computer_media_receive saves into a NEW authorized workspace path, verifies format/hash and never executes incoming content or overwrites files. Only a Download belonging uniquely to that incoming message is accepted. Native picker support currently targets standard macOS attached file dialogs; custom dialogs and other desktop backends are not claimed as verified. Portal upload/download remains separate under existing browser grants. TTS WAV is an audio-file attachment, not a native push-to-talk recording. artifact_transcribe uses existing STT for PCM16 WAV; the installed app also decodes Ogg/Opus, MP3 and M4A with Chromium, bounded to 10 MiB and 10 minutes, without Python, external upload, microphone access or another window. Codec availability is checked at execution. Prepared, submitted, received and delivered are different states; an imported file is not yet understood content.\n\nInterrupted text composition has a bounded retry only before Send and only for an exact prefix of the authorized reply. Inspect interrupted reply lets the owner review an older failed draft, then authorize resuming the original request without rewriting its content or publishing anything during recovery. A changed recipient/draft or any recorded Send attempt remains blocked; recovery is not delivery.\n\nWorkshop authoring exposes the exact manifest contract and the authenticated agent's standing publication limits. Transform fixtures can assert expectedOutput before automatic publication; use two distinct examples and check publishedRevision before execution.\n\nmacOS editor focus waits for native confirmation and can use the verified editor's focus action. App-owned popovers retain the original document guard. Another pre-Send interruption requires a fresh owner inspection and distinct recovery authorization; uncertain publication is never replayed.\n\nNative macOS attachments now handle animated picker menus, system-owned Open/Save sheets and file-reference URLs while comparing the full canonical path. Standalone previews validate the exact authorized recipient, filename, empty caption and Send in one bounded container. In Computer > Conversation replies > Native attachments, Inspect interrupted attachment permits owner recovery only when the verified audit contains no Send attempt. Close previews and confirm the file was not sent manually; the agent must reuse the original request. Uncertain sends remain blocked.\n\nIn Computer > Conversation replies > Persona and voice, save the companion name, owner instructions, response language, default voice/speed and public style. Incoming text, transcribed audio, images and private memories are reference content, not permission to change persona, recipients, apps or file access. The app blocks recognized credential material before public text, speech, generated reports and textual attachments; errors and audit retain a reason/hash, not rejected content. Operational details can be blocked and em dashes replaced before sending. These checks are defense in depth, not universal DLP or immunity to prompt injection.\n\nLocal TTS exposes F1-F5 and M1-M5 for each supported language through Settings > Voice and computer_capabilities (30 ids). For example, request pt-BR-m3 with artifact_speech; an unknown id is rejected instead of silently changing voices. A configured per-contact voice is used when omitted. STT is unchanged. Receiving authorized audio automatically attempts local transcription after download: transcription.state=ready is untrusted external text; unavailable means retry artifact_transcribe on the verified saved file, not download again. Transcript text is transient, not copied into action/audit rows. A WAV attachment is still not a native push-to-talk voice note.\n\nNative attachments has separate Photo and Document picker controls configured by the owner. computer_media_send defaults to photo for images and document for other formats; an unconfigured photo route fails clearly instead of silently sending a document. presentation=document explicitly retains file delivery. Recipient, immutable file/hash, preview identity, empty draft and single-submit safeguards remain mandatory. A custom preview that cannot prove file identity is rejected, not guessed from a screenshot.\n\nCanvas agent keeps the existing autonomous tools and unrestricted shell; app policy cannot isolate or audit actions bypassing its bridge. Restricted conversation is an opt-in separate, tool-free Codex 0.154.x inference with owner policy, only this contact's messages/memory, no development transcript, shell, patch, browser, plugins or MCP. It can answer text but does not run schedules or generate/send media. Unsupported provider/version/WSL stops rather than falling back to the free terminal. This limited mode is not a replacement for the full autonomous agent. OS permission and native-app acceptance still require local verification.\n\nWhatsApp on macOS can omit filenames from photo previews. For that specific preview, Orkestrai requires a fresh native picker receipt for the exact staged path, app and window, then checks the authorized recipient, a single photo, one-item count and empty caption again at Send. A receipt from another file/window or an unverified preview is rejected. This does not relax Document checks or turn submission into delivery confirmation.\n\nA deliberate no-reply decision must also resolve its dispatched inbox batch. After reading every message, the agent uses computer_inbox_acknowledge with its exact batchId/inReplyToDigest and reason already_answered or no_response_needed. The decision is audited as skipped with sent=false, not as a delivered response. Pending arrivals are preserved and can run immediately; another contact/task, an uncertain send or an answered batch cannot be cleared this way. Merely saying in the terminal that no reply is needed leaves the queue pending.\n\nIn Computer > Conversation replies, enable Temporary focus for sending and Find and reopen this contact automatically to authorize native conversation navigation on macOS. If another chat is selected, the observer locates the exact approved recipient through native search and verifies its conversation header before reading messages. Reply preflight repeats this check if selection changed while the agent prepared its response. computer_open_conversation exposes the same bounded operation to the assigned agent; no manual search or screenshot polling is required. Navigation never types in a message composer or sends, and is audited separately. Ambiguous duplicate contacts, unsupported native search controls, revoked grants and unverified headers remain blocked rather than choosing someone else. Background monitoring still requires the host awake and the approved application running.\n\nMessages already captured in the conversation inbox remain actionable after restart or reopening the chat, even if the app only renders recent history. The assigned agent replies using the original batch id and digest; it does not need to scroll back to rediscover saved questions. The live authorized contact and composer are still verified before publication. Uncertain submissions remain blocked and unanswered messages are never silently discarded.\n\nIncoming native conversation events can include forwarded messages and media captions, not only plain text. For supported WhatsApp macOS labels, Orkestrai verifies the incoming envelope and exact authorized contact before queuing them, preserving the original label and digest. Recognizing a photo, sticker or audio notification does not mean the agent has seen the image or heard the audio. It can answer the available caption; downloading or transcribing the attachment still requires the separate media-receive authorization. Outgoing messages and quoted copies must not trigger a reply."},
    {
      id: 'workspaces',
      title: 'Workspaces',
      body: `A workspace = a team on a project: working directory, icon and canvas layout saved. Create it with the + button in the sidebar. Several workspaces run at the same time — agents stay alive in the background when you switch. Instructions in AGENTS.md/CLAUDE.md are injected into the agents (edit with the pencil next to the name). The ⏻ button (Unload) shuts down its live terminals and keeps the workspace paused across navigation and app restarts, without deleting anything. Open that workspace explicitly to resume its agents and conversations. On macOS, projects in Downloads, Documents, or Desktop require system consent; if access expires, Canvas and Workbench show Authorize folder so you can select the same directory again and continue without restarting the app.`,
    },
    {
      id: 'workspace-folders',
      title: 'Organize workspaces into folders',
      body: `Group workspaces into folders in the sidebar once you have several projects (per client, per team, per environment). Click "New folder" at the bottom of the sidebar, type a name and press Enter to create one at the root; drag a workspace onto a folder's header to file it there, or drag it onto empty space in the list to send it back to the root. A new workspace can start inside a folder right away too: use the plus icon in that folder's header, or pick any folder from the Folder field in the New workspace dialog itself. Folders nest inside other folders the same way, with no depth limit — drag one folder onto another to make it a subfolder, or use the "new subfolder" icon in any folder's header to create one already inside it; a folder can never be dropped into itself or into one of its own subfolders. Double-click a folder's name or use its pencil icon to rename it, and each folder remembers whether it's collapsed across restarts. Deleting a folder (trash icon, with confirmation) is never destructive: every workspace and subfolder inside it moves up to the root instead of being removed.`,
    },
    {
      id: 'workspace-node-transfer',
      title: 'Move or copy Canvas nodes between workspaces',
      body: `Select one or more Canvas nodes and use the selection bar at the top to choose another workspace. Copy leaves the originals in place; Move removes them only after the destination nodes, files, and internal connections are committed successfully. The group keeps its relative layout and is placed in a free destination area. Connections are preserved only when both endpoints are selected. Notes bring their attachments, Image nodes copy their workspace files, and native Design documents copy their visual content and assets. Terminals preserve provider, role, theme, and saved commands but start a clean session; only the first copied leader remains a leader when the destination has none. Image and Flow execution history is reset. API Clients detach source metadata and synchronization, clear known credential fields, runtime variables, cookies, proxies, certificates, and vault values. Usage, Code Graph, and Mobile Device allow only one instance per workspace. Moving a terminal with an enabled routine or a running image workflow is blocked until that work is stopped, so the source cannot be left half-moved.`,
    },
    {
      id: 'wsl-runtime',
      title: 'Windows workspaces with WSL',
      body: `On Windows, the environment selected when creating or editing a workspace is the team default. Each terminal can inherit it or use Execution environment in the creation dialog and compact terminal menu to force native Windows or one specific WSL distribution. Select the exact Ubuntu, Ubuntu-22.04, Ubuntu-24.04, Debian, or other installation and provide the Linux path for the same project folder. A single workspace can therefore combine Windows and WSL agents, including different distributions. A WIN or WSL badge identifies an override. Provider detection and models, PTY, exact conversation resume, Council, recruited agents, and the orkestrai bridge follow each terminal's effective runtime. Maestro recruits inherit the leader's active Floor and are confirmed only after the PTY starts in the correct environment; a failed launch removes the incomplete node. When a task is assigned, Orkestrai starts or resumes an offline agent and moves the card to In progress only after the complete briefing is delivered. Automatic questions, handoffs, assignments, roles, routines, and review feedback wait for the TUI composer to settle; on Windows and WSL, delivery is acknowledged only after the exact prompt appears in the provider transcript, with bounded Enter retries when it does not. Orkestrai validates the CLI in that distribution and reads the provider transcript from its own Linux home before persisting or restoring an id; an empty agent starts clean instead of guessing the latest conversation. Changing runtime restarts only that terminal. Missing distributions, directories, or commands produce distinct actionable errors without a silent native-Windows fallback.`,
    },
    {
      id: 'wsl-bridge-console',
      title: 'Reliable agent communication from WSL',
      body: "The Windows package includes a pinned console Node runtime verified by SHA-256. Each WSL launcher uses that known runtime when available and keeps Node inside its exact distribution as a fallback; it never invokes the graphical Orkestrai.exe for bridge commands, because Windows GUI processes do not reliably return stdout, stderr, or JSON-RPC to WSL. Existing workspaces repair this launcher automatically when opened. Messages between agents share a serialized delivery queue, not an exclusive lock on the recipient's entire response. Each reply remains linked to its exact prompt. If two agents ask each other while one is waiting, the explicit reverse message can resolve the waiting call without pretending that unrelated terminal output is an answer. Claude messages accepted while it is working are tracked as queued commands and then matched when consumed. Task guards still prevent stale work dispatch; an assigned agent may report completed work to the leader. Completion notices wait while the leader has an unsent draft instead of expiring after 30 seconds; reopening or archiving the task, changing the leader, or replacing its session invalidates the notice.",
    },
    {
      id: 'agentes',
      title: 'Agents: create, name, model & effort',
      body: `The Agents menu in the bottom toolbar lists Claude, Codex, Kimi, OpenCode, Cursor, Antigravity, Cline, Devin, and GitHub Copilot without crowding the canvas. Pin up to four favorites to keep them beside the menu; the ordered preference persists across workspaces and restarts, and an unavailable pinned agent stays saved without occupying the toolbar. You do not need terminal expertise or every provider: start with a service you already use, then add another when you want an independent perspective. Agents that need setup lead to Provider Center, also available from the cable icon in the sidebar, Cmd/Ctrl+2, or the native Workspace menu. When you draw an agent, the dialog asks for name, model, and effort only when that provider offers them, plus Leader (Maestro Mode). After creation, the compact header menu holds provider and profile switching, roles, a visual choice of 15 ANSI themes, context-preserving reload, Maestro Mode, and removal; the title remains editable with a double-click. Changing provider preserves connections, role, floor, and position, closes the previous conversation, and starts a clean session.`,
    },
    {
      id: 'provider-center',
      title: 'Provider Center',
      body: `Provider Center checks all nine supported CLIs locally and separates agents that are ready from those that still need setup. Expand a provider to see its official guide, an installation command for your operating system when available, sign-in instructions, detected capabilities, live public status when available, and named Profiles through the CLI's documented account-directory mechanism. Orkestrai never authenticates an agent silently or stores Profile credentials in canvas data; sign-in remains inside the official CLI and profile values are resolved server-side only when a PTY starts. Use Check again after installing, then return to the canvas. On first launch, Claude may ask whether you trust the workspace folder. Select Yes, I trust this folder yourself in its terminal. A quiet confirmation dialog is not a ready agent: Orkestrai waits for the message composer before injecting tasks or sending Enter, and it never chooses the trust option for you. If an older installation exits with code 1 at No, exit, run claude in a normal shell in that workspace folder, confirm trust there, then reload the Claude node.`,
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
      id: 'agent-runtime',
      title: 'Interactive, on-demand, and persistent agents',
      body: `Open an agent terminal menu and choose Agent runtime. Interactive preserves the existing Canvas lifecycle. On demand wakes through a human message or durable automation, resumes the exact provider conversation, and sleeps after the configured idle period when it has no active run or assigned work. Persistent is supervised by the background Core and restarts after process failure or system sleep without requiring a rendered Canvas. Per-agent safeguards cap concurrent automation runs and pause automatic starts when a known provider quota reaches the chosen threshold; a manual wake always remains available. The runtime, last wake/sleep, errors, active run count, task, and session state use the same persisted node and Control Center history across Canvas, Workbench, and Remote. Existing agents remain Interactive until explicitly changed.`,
    },
    {
      id: 'autonomy-security',
      title: 'Autonomy policy, approvals, and encrypted credentials',
      body: `Open Automations → Security to define one standing grant for unattended work. Observe records activity without restricting the current shell; Prepare and Ask before mutations pause writes; Bounded autonomous lets agents keep a free shell and execute brokered actions inside approved capabilities, workspace roots, hosts, operating hours, and concurrency limits. High-risk boundaries such as force push, production deploy, purchases, external publication, account changes, bulk deletion, and access outside the grant can be pre-approved or require the workspace owner, a named reviewer, or Council consensus. Emergency stop disables every routine and aborts active runs immediately. The Vault stores values through the operating-system encrypted store and gives agents only a SecretRef bound to explicit integrations, operations, and destinations. OAuth or an interactive Portal login is completed once by the user; later jobs receive a credential only inside the trusted connector executor. Every brokered action is exact semantic evidence in a hash-chained audit export. Free-shell effects remain labeled as inferred because Orkestrai does not pretend to provide syscall-level observation.`,
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
      id: 'git-workspace',
      title: 'Native Git workspace',
      body: `Add Git from the Canvas toolbar or open the same node in Workbench. Changes stages and unstages files, creates commits, stashes work, and opens the exact diff in Review Center. Graph shows bounded commit history with cherry-pick and revert actions. Branches checks out and creates branches, merges or rebases the current branch, and manages tags. Worktrees lists the same isolated work owned by Floors; create, preview, and land worktrees through Floors so task and agent ownership remain traceable. Fetch prunes stale refs, pull is fast-forward only, and every operation is executed without a shell. Destructive operations show the exact command, require explicit confirmation, and refuse to run if the repository changed after preview. Remote credentials are redacted. Agents use git_status, git_preview, and git_execute against this same workspace state; execution requires an active assigned Kanban task and is recorded in Control Center. WSL workspaces execute Git inside the selected distribution while native Windows workspaces keep using Windows Git.`,
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
      body: `Notes are living markdown shared with the agents. A note created by an agent through the bridge connects only to that exact author by default, so parallel agents and repeated roles keep independent context; the agent must explicitly choose --connect <agent> or --connect all to share it further. The convention: connect the note to whoever should read/write it and state the purpose in the title and content. E.g.: a "Backlog (leader writes)" note connected to the leader — you write "break this into tasks for the team" and it reads it with orkestrai note read and distributes it on the board. A "For me (human)" note — ask the leader to log status/decisions there with orkestrai note write/edit, and you follow along formatted (eye icon). Double-click the title to rename the note. Drop, paste, or select images, PDFs, other files, and HTTP/HTTPS links; files up to 10 MB stay in .orkestrai/attachments/ and their markdown reference is inserted at the cursor. Removing an attachment with its X also removes that reference and deletes the stored workspace file.`,
    },
    {
      id: 'tarefas',
      title: 'Tasks (kanban)',
      body: `The Tasks node (+ Tasks in the bottom bar) is the workspace board. Use the columns icon in its header to name, color, reorder, and create up to ten stages that match your process. The lead and team see those stages automatically and keep each delivery's real state current. "Add task" opens a complete composer with title, markdown description, and images, PDFs, files, or links; you can also drop them directly onto a card. Assigning a card dispatches its title, description, and every reference to the agent. At startup, the leader receives every unassigned task with its complete brief and must record/assign work on the board before delegating by message. task done sends a notification labeled Task completed and automatically hands completion back to the leader as soon as its composer is free; Project completed is reserved for the real end of the project. Completed work can be archived without losing history.`,
    },
    {
      id: 'imagens',
      title: 'Image node (visual reference)',
      bullets: ['Removing an Image or Video node removes it from the current Canvas inventory, not from the project folder. Agents must refresh that inventory and must not recover or reuse removed media from old messages, folders or generation history without your explicit request. Image workflow list/read and agent video reads return current outputs by default. To inspect past generations explicitly, use includeHistory=true (video: input.includeHistory; image CLI: --include-history). This reveals history, not permission to reuse it. Existing source-code access and deliberately selected character/brand library versions are unchanged. Failed deletions stay visible with an error instead of disappearing only from your screen.'],
      body: `The Image tool (bottom bar) creates a visual reference node on the canvas: mockup, screenshot, architecture diagram. Paste with Ctrl+V or click to pick the file — the image is saved in the workspace (.orkestrai/images/). Connect the node to the leader (or to a specific agent, like the designer) to make clear who should use that reference, and say in chat what to do with it. Double-click the title to rename; the image icon in the header swaps the file.`,
    },
    {
      ...{"id":"video-workflows","title":"Video workflows with fal.ai","body":"In Canvas, open the Image menu and choose Add video workflow. The same node opens in Workbench. Existing Codex image generation remains unchanged and needs no API key. Video is a separate, opt-in paid fal.ai integration: open Configure access in the node, save an account key in the desktop vault, enable the account and this workspace, authorize external prompts/images, select models, and set USD reservation limits and concurrency. Agents additionally need the workspace agent permission, a live authenticated terminal, and a task assigned to them.","bullets":["Storyboard-to-video: Codex writes the scene order, prompts, dialogue, language and sound direction in Notes. Existing Codex/GPT Image workflows create all characters, storyboards and visual references. Only approved reference files are uploaded to fal for video generation; fal does not generate these images. Enable native audio only on models whose own contract supports it. Seedance 2.5 reference-to-video accepts image/audio references and generate_audio; native speech is not an Orkestrai TTS voice, and exact language/voice behavior depends on the model.","Character library stores workspace drafts and owner-locked versions: appearance, 1–12 master images and either an approved audio reference or an existing provider voice ID scoped to account and compatible endpoints, plus language and delivery style. Approval copies local assets to generated/characters, records SHA-256 fingerprints and makes that version immutable. Changes create a new draft version, never rewrite existing scenes. Agents may propose/read versions, not approve, delete locked versions or silently replace an existing scene's character.","Bind an exact approved character version to each scene and map its master images and voice to supported model fields. The server injects the frozen inputs and rejects changed/missing files, conflicting bindings, an incompatible account/model or disabled native audio before generating. A transferred scene retains unresolved character IDs and cannot run in another workspace until the owner deliberately rebinds local approved identities. Snapshots retain version IDs and fingerprints. Input locking is not a 100% generative consistency guarantee: picture, speech and lip sync still need human review. Automatic voice enrollment and consistency scoring are not provided. Assemble delivered clips with the native Video sequence node.","Open the Images menu, choose Characters, then drag an approved character onto an empty area of the destination Canvas or choose Add to Canvas. The library is shared across local workspaces. Orkestrai copies all frozen images and the voice sample, preserving the exact version and fingerprint, and creates a grouped identity Note and reference Images without changing the source. Provider voice IDs retain their original account binding, but credentials and workspace grants are never copied. Workbench offers the same library and Add to Canvas command. Agents can place approved local characters; importing from another workspace requires the owner.","Choose an approved character by name: the scene shows its master images and voice sample, and assigns all references to conventional inputs declared by the selected model. No reference is dropped to fit. Advanced input mapping remains available for unusual contracts. Type @ in Direction or use Insert a character reference to insert a saved @{name} alias; the alias stays bound to the exact version ID. Removing a referenced character or using an unknown alias blocks generation instead of silently changing the subject. Agents can request the same conservative mapping with video_workflow_characters command=binding and the current config.","Browse the complete published fal.ai video catalog with search, including Seedance 2.5 and text-, image-, reference-, audio- and video-driven endpoints. Orkestrai loads the selected endpoint's official OpenAPI contract, preserves its input types, enums and nested parameters, and pins that contract to each run. Catalog visibility does not guarantee account access. Deprecated endpoints and invalid contracts cannot generate.","For catalog models, use Workspace media inputs to bind an Image/Video node or a workspace-relative image, video or audio file to an input path such as /image_urls/0 or /elements/0/frontal_image_url. Bindings are ordered, hashed and rechecked before sending; media bytes are not stored in workflow JSON. Nested parameters have a JSON editor and contract reference. Up to 50 bindings, 10 MB per image, 64 MB per audio/video and 100 MB total are accepted; the provider may impose stricter limits. Copying between workspaces remaps selected node bindings and clears file-only bindings.","Billing units normally follow duration or one output. For endpoints billed in tokens, frames, compute units or automatic duration, an explicit estimated billing quantity may be required. Read the selected endpoint's pricing and set account-side limits. A local reservation is not a provider-enforced invoice cap.","Wan 2.7 generates video from text, with 2–15 seconds, 720p/1080p and enumerated aspect ratios. Kling 3 Pro animates a selected first-frame Image node, optionally with an end frame, for 3–15 seconds. Kling inputs must be PNG/JPEG/WebP, at least 300 px per side, up to 10 MB and within a 0.4–2.5 aspect ratio. Only supported controls appear. Kling speech supports English and Chinese; Wan may create background audio automatically.","Select context Notes explicitly; their text becomes part of the outgoing prompt. Select first/last images by node identity. Ordinary collaboration edges do not execute other branches. Save, estimate cost, inspect the base estimate and reservation, then generate. The local reservation is four times the base-unit estimate as headroom, not a guaranteed cap on the provider invoice. Enforce account-level limits on fal.ai as well. Existing workspace security gates can require approval for paid operations.","Runs are persisted before submission. After restart, Orkestrai polls the saved remote job rather than generating again. If the paid submission itself loses its response, the run is marked unconfirmed and is not retried automatically. Check the fal.ai queue/account before taking further action. Cancellation requested is not confirmed cancellation or a refund; a completed result can win that race.","Each declared video/audio output is downloaded unchanged to the selected workspace folder with size limits and SHA-256 provenance, then appears as its own reusable node. MP4, WebM, MOV, MKV, GIF and supported audio containers retain their original format; playback depends on the installed browser codecs, and downloads remain available. A download retry never generates again. Files are not stretched, cropped or re-encoded. Deleting nodes preserves delivered files. Active paid runs block transfer and deletion.","Keys remain in the desktop secure vault. No account key or generated signed media link enters node payloads or agent responses. Local reference files upload only after the workspace execution gate, with a requested private ACL and 24-hour expiration; time-limited read links are passed only to the selected endpoint. fal request JSON storage is disabled. Supported outputs request a one-hour lifetime and private CDN ACL. These settings cannot guarantee upstream provider retention. Send only material you may share, and retain downloaded files yourself.","Agents use video_workflow_models/list/read/create/update/preview/run/cancel/retry_download/remove or orkestrai video. List exposes permitted profiles and model capabilities, never credentials. Use the returned revision and preview ID with a stable UUID idempotency key. A queued request is not a delivered video. Do not use raw provider HTTP to bypass workspace policy. Runway direct integration and arbitrary ComfyUI JSON are not supported. Creative workflows reuse native storyboards, and Video sequence assembles delivered clips locally.","The picker includes the public catalog, not a claim that every listed endpoint is usable. Some published entries have no queue OpenAPI contract, use real-time streaming instead, are deprecated, or return 404. These cannot execute through the queue adapter; contract errors are shown before a paid submission. The bundled discovery snapshot is refreshed from fal, and each selected model uses its current validated contract.","A run accepts up to 10 video/audio outputs. Each file is downloaded without resizing or transcoding and rechecks current filesystem exclusions, size and network grants before publication. If approval is pending or access was revoked, the paid job is preserved and Retry download recovers the result without generating again. FLAC references are supported alongside WAV, MP3, Ogg and M4A.","Selecting a model loads its official queue contract. Fields include provider descriptions, suggested examples and visible defaults. Examples are suggestions, not a closed set of valid values. Objects and lists have nested controls; JSON remains available for advanced or ambiguous contracts. Prompt rewriting is visible beside the main settings with a warning: it changes direction, not render speed. Saved legacy drafts offer Edit all model parameters to explicitly convert to the full endpoint without losing direction or references. Parameters not supported by a newly selected endpoint remain visible and must be removed or remapped, never silently discarded.","Select a configured account to compare base rates and billing units in the model picker. Rates are fetched only for displayed models, cached for up to five minutes and scoped to the account; missing rates are shown as unavailable, never zero. They are not configuration-aware final quotes: resolution, audio and other multipliers may apply. Estimate cost still validates the complete draft, references and budget before generation. This lookup never submits a job or reserves money. Agents use video_workflow_models with endpoint for the same documented schema, or pricingIds (up to 50) and profileId for permitted account rates; they never receive the credential."]},
    },
    {
      id: 'image-workflows',
      title: 'Native image generation workflows',
      body: `Open the Image menu in the Canvas toolbar and choose Generate images. Connect Notes for art direction, up to five ordered Image references, and a live Codex executor. An authenticated Codex account or plan with ImageGen is required; no OpenAI API key is needed. Enter a prompt, choose one to ten outputs, optionally require genuine transparent PNGs, and choose Auto, Instagram square (1080x1080), Instagram portrait (1080x1350), Instagram Stories/Reels or TikTok (1080x1920), or a custom delivery size. The same settings are available to a connected Codex through image_workflow_* tools. Generate delegates one logical run to that session. Each output is validated independently. When genuine alpha is required and ImageGen returns an opaque PNG or rendered checkerboard, Codex edits that result with native ImageGen and retries up to three times. For an exact delivery size, the prompt includes the target frame and a measurable safe area. Validation preserves the untouched native result under .masters/ and resamples the complete frame without cropping only when its native aspect ratio already matches within a strict tolerance. If it does not, the validator returns a native ImageGen reframe prompt that preserves content, safely recomposes or outpaints the frame, and must pass validation before an Image node is materialized. Orkestrai accepts only the assigned Codex and preallocated workspace paths, never requests or stores an image API key, and never calls an image provider endpoint directly. Connected Image nodes retain the input hash, source workflow, run id, output index, exact delivery dimensions, native-master provenance, duration, and bounded history. Outputs can feed another workflow as references. Cancel invalidates the active run so a late completion cannot be materialized; abandoned executions also expire after a bounded time. Canvas, Workbench, CLI, and MCP operate the same persisted graph without parallel automation state.`,
      bullets: [
        "Drag one or several images from Finder or File Explorer onto empty Canvas to create a separate Image reference for each file, without changing the original image. Imports accept up to 100 images, 10 MB each, and place them without overlap. Drop files onto an agent header, terminal body or quick prompt to attach workspace file references to that prompt instead, up to 12 per drop. Review the prompt and send it yourself; dropping does not press Enter or start generation. Invalid files are reported, and successfully imported references stay visible.",
        'Every Codex terminal started from Canvas receives the MCP launcher from the current Orkestrai installation as a session-only override. An old global Codex configuration cannot hide image_workflow_* tools, and the user-owned config file is never rewritten.',
        'Background removal and unsafe-aspect recomposition are always native image_gen.imagegen edits using only the rejected output as reference and the validator\'s dedicated prompt. Python, Pillow, ImageMagick, ffmpeg, remove-bg, generated masks, and agent-side pixel processing are forbidden. Exact delivery sizing is a bounded Orkestrai validation step, never crops incompatible content, and always keeps the native master.',
      ],
    },
    {
      id: 'workspace-folder',
      title: "Open a delivery folder",
      body: "Ask the agent to open generated/images/xyz-carousel. It uses fs_open_folder, or orkestrai fs open-folder \"generated/images/xyz-carousel\", to open the existing folder in Finder, Explorer, or the Linux file manager on the host. Computer Control, Accessibility and Screen Recording are not required. Registered @alias folders are supported; files, URLs, executable bundles, path escapes and new grants are not. Explicit filesystem restrictions and emergency stop remain effective. The operation is audited and confirms the operating system accepted the request; it does not claim visual inspection. If the agent session predates the MCP tool, it can use the CLI.",
    },
    {
      id: 'visual-annotations',
      title: 'Shapes and visual annotations',
      body: `Use Shapes in the Canvas toolbar to draw rectangles, rounded boxes, ellipses, diamonds, and editable curved arrows around the work. Double-click to edit the text; the style control changes fill, opacity, border, dash, typography, and arrow anchors. Select a shape and use its duplicate action or Cmd/Ctrl+D to preserve its exact size, text, style, and arrow geometry with a small offset. Cmd/Ctrl+C and Cmd/Ctrl+V copy and paste one or several selected shapes while keeping their relative spacing; every copy is a separate persistent node that remains independently editable.`,
    },
    {
      id: 'design-mode',
      title: 'Native Design Mode',
      body: `Add Design from the Canvas toolbar to create a structured visual document stored under .orkestrai/designs in the project. Double-click its preview or use expand to open the same document in full Canvas Design Mode or Workbench. Draw frames, rectangles, ellipses, text, and Pen paths at any size; Shift keeps proportions and Alt/Option draws or resizes from the center. Pen previews the next segment and close target: click for corners, drag for curves, click the first anchor to close, or press Enter/Escape to finish an open path. Select a path and press Enter or double-click it to enter vector editing. Drag anchors and handles, drag a segment to bend it, double-click a segment to split it, and choose Corner, Mirrored, Asymmetric, or Disconnected tangents from the contextual toolbar. Shift-click or box-select multiple points, then move, nudge, delete, or resize them as a group; choose Pen and click an endpoint to continue an open path. Selected layers expose eight resize handles, path geometry scales with its bounds, rotated vectors edit in place, and text supports direct in-canvas editing and multiline wrapping. Shift-select layers to align, distribute, combine with union, subtract, intersect, or exclude, and create or release masks. Group layers with Cmd/Ctrl+G and ungroup with Shift+Cmd/Ctrl+G; moving or resizing a group transforms its descendants, while Alt selects a nested layer directly. Stack solid or linear/radial gradient fills and strokes; add shadows, blur, blend modes, rulers, persistent guides, and snapping. Color tools list and select every layer using the same fill or stroke, apply one color to the selection, or replace matching solids and gradient stops across the page. Frames support horizontal, vertical, wrapping, and grid auto layout, padding and gaps, while child constraints respond when a frame is resized. Paste, drop, or choose an SVG to convert paths, primitive shapes, source group hierarchy, nested transforms, styles, gradients, and references into editable native vector layers; raster PNG, JPEG, WebP, and GIF files remain reusable assets. Copy the current selection as SVG or PNG, or export selected artwork or the full page as SVG, PNG, JPEG, WebP, or PDF; editing controls never appear in exports or thumbnails. Open Variables beside Layers to create typed tokens in collections, add modes such as Light and Dark, reuse a token through an alias, and bind compatible fill, stroke, opacity, radius, typography, spacing, padding, or effect properties from the inspector. Start from product, marketing, or mobile presets, import DTCG JSON or CSS variables, export DTCG, CSS, or Tailwind, and audit duplicate or unused tokens, repeated values, and component candidates. Under Components, turn a frame or group into a reusable source, create linked instances, expose text, visibility, and slot properties, swap an instance or variant, keep local overrides, or detach a copy. Under Libraries, publish a version only to selected workspaces, import and sync it without losing local placement, or detach editable local copies. In Inspect → Code, a read-only scan extracts CSS variables, static Tailwind configuration, and Svelte, React, or Vue contracts without executing project files; link visual components and synchronize tokens by source hash. Switching the active mode updates every bound layer immediately. Tokens and components appear in universal search and the Design node summary. Toolbar tooltips include shortcuts, Delete removes the selected points or layers, Escape steps out of point and vector editing, arrow keys nudge by one and Shift by ten, and undo/redo uses typed operations. Every mutation records a revision and bounded history. Connect the Design node to a leader or specialist so they can read and edit the exact scene graph through typed Orkestrai MCP tools, including tokens, components, instances, properties, variants, slots, and library links. Human and agent edits use optimistic revision checks, update open editors live, and never require direct JSON rewriting.`,
    },
    {
      id: 'design-workspace',
      title: 'Professional Design workspace',
      body: `Expand any Design node into optional focus mode to use the complete app viewport. Back to Canvas returns to that exact node without losing its revision, selection, active tool, zoom, camera, or panel state. Layers and assets on the left and Properties on the right can be collapsed independently; in a narrow Canvas or Workbench surface they open as dismissible overlays without shrinking the drawing area. Creation tools stay in the stable bottom toolbar, while document, organization, view, prototype, and export actions remain in the compact top bar. Use Command/Ctrl + wheel to zoom around the pointer, or choose Fit all content, Fit selection, or Zoom to 100%. The themed workspace remains visually separate from the real page background, including when frames are far apart. Pages are first-class: create, rename, duplicate, reorder, activate, or delete them from the file panel. Search the real layer hierarchy, collapse frames and groups, rename in place, or drag a selection before, inside, or after another layer with a precise insertion indicator. Command/Ctrl+C, X, V, and D copy complete descendant hierarchies; pasted layers get independent identities. The compact contextual inspector keeps sections collapsed per user; numeric labels scrub horizontally and accept arithmetic, relative values, pixels, percentages, arrow keys, Shift, and Alt/Option. Frames and children support fixed, hug, fill, min/max, independent padding, wrap, grid, main/cross-axis alignment, and absolute children before applying one atomic layout revision. Typography controls family, style, weight, line height, letter and paragraph spacing, horizontal and vertical alignment, decoration, case, and resize behavior. Solid and gradient paints share a visual picker with Hex, RGB, HSL, alpha, eyedropper, recent and document colors, variable binding, editable stops, angle, and radial mode. Page and layer changes use the same undoable, revisioned command bus as connected agents, MCP, and CLI.`,
    },
    {
      id: 'design-prototype-inspect',
      title: 'Prototype and inspect in context',
      body: `Use the right Design, Prototype, and Inspect tabs without leaving the current selection. In Prototype, select a layer and drag its purple connection handle directly to a destination frame; the visible wire is selectable on the canvas and the inspector refines its trigger, action, transition, easing, overlay, scrolling, and starting flow. Connected agents create, update, and delete those same flows and interactions through typed MCP and CLI operations with the current document revision. Inspect keeps accessibility metadata, resolved variable bindings, owning component and Code Connect contracts, Figma provenance, generated artifacts, and deterministic copyable CSS in one place; its Code and Figma views still operate on the same native document. Open Agents and reviews or Quality and history from the top bar as contextual drawers so comments, proposals, presence, audits, templates, visual review, and recovery never replace the properties required to finish the selection.`,
    },
    {
      id: 'design-collaboration',
      title: 'Live Design collaboration',
      body: `Open Agents and reviews in the Design inspector to work on the same native document with people and agents. Live presence shows each participant's page, cursor, and selection; Follow keeps your viewport on one participant until you stop it. Selecting a layer claims a short renewable lease, so another participant receives a clear conflict instead of overwriting the same layer. Add a thread to the page or selected layer, mention teammates, reply, resolve, or reopen it; threads and authorship remain in the revision history even if a layer is removed. A visual proposal previews position, size, opacity, and fill changes without mutating the document, lists its structural diff, and applies all operations atomically only after an explicit approval. Send a proposal to Council for independent perspectives or create a parallel Git Floor for isolated implementation. Connected agents use the same versioned comment, propose, and decide operations through Orkestrai MCP and cannot simulate human approval. In encrypted workspace sharing, Design access is approved separately per device as None, View, Comment, Propose, or Edit and decide. Remote receives sanitized pages, activity, threads, and proposal summaries, never the full scene graph, assets, files, credentials, or local paths.`,
    },
    {
      id: 'design-quality',
      title: 'Design quality and recovery',
      body: `Open Quality and history in the Design inspector to audit meaningful layer names, clipped text or content, accidental overlap, WCAG text contrast, and accessibility metadata. Selecting an issue focuses its exact layer. The same panel applies complete editable product, marketing, mobile, or design-system templates through the revision-safe command bus. Every valid write keeps an automatic backup; corrupted primary documents recover from it, large histories compact automatically, and manual restore creates a new revision instead of rewriting history. Documents above 500 layers render only the visible region plus selected layers and their hierarchy. Connected agents can run the same audit or apply a template through typed MCP and CLI commands.`,
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
      body: `Drag from one node's dot to another — the connection is bidirectional and the dot floats along the edge, always at the closest point to the other node. The dashed rope has physics (swings when you move) and glows animated green while the agents talk. Settings → Appearance → Canvas connections offers Adaptive, Elastic and animated, and Static modes. Adaptive keeps rope physics in small canvases, progressively replaces idle edges with inexpensive curves as density grows, and reduces work for offscreen connections. Elastic preserves the effect with a quality and frame-rate budget; Static disables physics and every connection animation for the lowest CPU and GPU use. Hidden windows and reduced-motion mode always stop animation. Hover shows the remove X; click pins the X. Connecting installs the bridge skill on the agents (they learn the orkestrai CLI on their own).`,
    },
    {
      id: 'andares',
      title: 'Floors (worktrees)',
      body: `A floor is a git worktree of the workspace repository with its own branch. For Ground and every active worktree, the Floors panel shows agents and a list of tasks with title, stage, and assignee, alongside changed files, branch synchronization, and the latest commit. Workbench and Control Center identify the floor of active agents. In a WSL workspace, creation, Git hooks, status, preview, landing, and removal all run inside the exact selected distribution; Windows Git never validates or mutates the Linux checkout. Landing or deleting automatically archives that floor's terminals, layout copies, and edges: they remain available for historical attribution but do not inflate counts or appear as current agents. Cloning a layout never reuses a PTY session or provider conversation. Create from the panel or CLI with orkestrai floor create/list/preview/land/remove; recruit --floor places a new agent on the selected active floor. Landing merges after a diff and conflict preview. Conflicts are never hidden: the error lists files and resolution becomes an explicit task.`,
    },
    {
      id: 'rotinas',
      title: 'Automations',
      body: "Open Automations from the Canvas toolbar, the Workbench explorer, or Command/Ctrl+K. A trigger can be manual, scheduled, a task change, a confirmed agent message, a Git commit, a GitHub pull request, a webhook, a file or folder change, or a provider usage threshold. Actions send a prompt to one agent, create a traceable Kanban task, or show an explicit desktop notification. Development, design, marketing, research, and operations recipes provide safe starting points. Every run records trigger input, target agent/provider, quota snapshots, output acknowledgement, duration, attempt, and recoverable failure; retries are bounded and duplicate event deliveries are idempotent. Settings → Autonomy & 24/7 Core can keep the local Core and active work in the system tray after every window closes, start it silently when you sign in, show its live uptime, and restart it without restarting the whole desktop app. Choosing Quit Orkestrai remains the explicit stop. GitHub tokens are encrypted by Electron safeStorage and never stored in the workspace database. Legacy scheduled Routines remain compatible and appear here automatically. 24/7 means the enabled Core waits for future events or schedules, not that a model thinks continuously. For example, schedule an inbox check every 15 minutes, prepare a report, and gate sending it. Each run finishes and the next trigger starts another. Keep the computer awake, Core active, credentials valid, and provider quota available; sleep and shutdown stop local execution. Closing a window differs from Quit Orkestrai. Verify run history and approvals rather than assuming that a persistent terminal guarantees completed work.",
    },
    {
      id: 'automation-durability',
      title: 'Durable automation execution',
      body: `Every automation trigger is written to the workspace database before execution. The Core claims it with a renewable lease, stores checkpoints, and prevents two workers from running the same delivery. If Orkestrai, the computer, or a queue backend stops, an expired lease returns to the queue automatically. Transient failures use bounded exponential backoff; the final failure moves to Needs intervention instead of looping forever. A prompt action starts or resumes its target agent when no PTY is open. Execution history shows the current attempt, next retry, cancellation, output, and dead-letter state; queued and running work can be cancelled, and final failures can be replayed as a new traceable run. Suspended workspaces do not enqueue work.`,
    },
    {
      id: 'integration-center',
      title: 'Integration Center and encrypted accounts',
      body: "Open Automations -> Integrations to connect Gmail, Slack, Telegram, WhatsApp, GitHub, or an HTTPS webhook. Gmail uses the official system-browser OAuth flow with PKCE; the other providers accept their revocable bot or app token directly into the operating-system encrypted Vault. The workspace database stores only a SecretRef and bounded account metadata. Choose the exact operations that account may perform and, when applicable, its default channel, chat, recipient, repository, or endpoint. Agents never receive the resolved value: integration_list exposes the account manifest, while integration_execute resolves the SecretRef only inside the trusted connector, requires the agent's active assigned task, applies the workspace autonomy policy, and records a sanitized idempotent event. Supported actions cover Gmail search/read/draft/send/labels and workspace attachments, Slack channels/messages, Telegram messages/updates/workspace documents, WhatsApp messages/document links, GitHub pull-request reads, and typed webhooks. Use a persistent or on-demand agent plus a durable Automation to classify an inbox, prepare a report or PDF in the workspace, and deliver it on schedule. Use a Managed Portal instead when a service has no connector; complete its login yourself so cookies and passwords remain outside prompts.\n\nIn Automations > Integrations > Activity, Accepted by provider means a provider message ID or an HTTP acceptance was received, not that the recipient read or received the message. Expand Provider receipt to inspect the returned IDs. Send unconfirmed means publication may have occurred before its response was lost; inspect the destination before taking any further action, and never invent a new retry key. The request remains blocked across restarts. A failure confirmed before publication may retry the same unchanged request and key after its authorization or configuration is repaired. Historical records without a request digest cannot be replayed automatically. An idempotency key cannot be reused for different text, recipients, attachments or operations. Native Computer sending has its own independent confirmation and recovery path.",
    },
    {
      id: 'visible-browser-workflows',
      title: "Visible browser workflows and automatic tool publication",
      body: "Open a Portal and sign in yourself. New and previously unconfigured Portals allow the whole workspace team to read and interact, including newly recruited agents. In the gear, choose All workspace agents or Selected agents only. Existing explicit lists, Manual only and Read only settings are preserved. The agent controls the same native page and tabs visible in Canvas or Workbench; opening another view does not create a second browser session. Visible control is the default. Enable background control explicitly to continue with that Portal hidden, and use Pause to stop further brokered actions immediately. Normal Portal use does not require enabling Automations > Security or assigning a task. An optional taskId must belong to the authenticated agent. Explicitly enabled enforcing policies still apply their boundaries and risk gates; disabled or Observe policies preserve interactive behavior and audit it. Emergency stop always applies. Password, token, OTP, and marked-private fields are withheld from semantic snapshots and DOM reads and masked in captures; arbitrary agent JavaScript is disabled. Re-snapshot after changes instead of reusing stale element references. In Security, enable Agent-created tools only for selected agents and executor types in Bounded mode. Valid fixtures, limits, existing Portal or integration permissions, and destination-bound SecretRefs are required. Commands still require owner publication. Browser tools bind to a Portal id and use ordered typed steps with exact semantic role/name targets and {{input}} templates. Gate approvals resume the same tool run from saved completed steps using its original revision and idempotency key; do not invent a new key for a retry. An interrupted effect whose outcome is unknown is not automatically replayed. Audit expands operation, actor, target, risk decision, safe output, and correlation details and refreshes without overwriting policy edits. Emergency stop remains latched even if the policy switch is turned off; prepare and save an explicit resume. Webhook triggers live in Automations > New > Webhook; after saving, reopen the editor to see the complete local endpoint and send X-Orkestrai-Webhook-Secret or Bearer authentication. Outbound webhooks are configured separately in Integrations. Internet ingress needs a private tunnel or a proxy limited to the webhook route, never public access to the entire Core. Browser permissions are broker controls, not an OS sandbox: a free shell, another browser, or unmediated program can act outside this audit. The app must remain running and the computer awake for local 24/7 work.",
    },
    {
      id: 'tool-workshop',
      title: 'Tool Workshop: reusable capabilities without exposed credentials',
      body: "Tool manifests declare schemaVersion, executor, inputSchema, outputSchema, capabilities, secretRefs, timeoutMs, maxOutputBytes and fixtures. Executors are browser, transform, http, integration, and workspace_command. Browser steps use {action, target: {role, name}, args}; targets must match exactly one element in a fresh snapshot. Templates resolve declared input fields and previous steps. Dry run validates structure and input without performing external effects; it is not a live endpoint test. Run controlled fixtures before enabling unattended effects. A saved revision is immutable, the published revision stays active across later drafts, and rollback creates a new draft. Automatic publication requires the explicit standing grant described above; workspace commands always require owner review. SecretRefs bind to tool:<slug>, tool integration, and the exact destination. Resume waiting runs with the same idempotency key; unknown interrupted effects require inspection before a new run.",
    },
    {
      "id": "computer-observation",
      "title": "Observe native app changes without continuous model polling",
      "body": "The macOS desktop embeds the official Cua SDK in Electron main, with Orkestrai-owned OS permissions and no separate Cua app or daemon. Reads stay window-bound; authorized foreground replies verify the complete draft and Send separately. Single-line replies use direct SDK text insertion rather than switching to a paste shortcut at 64 characters. Multiline drafts require verified plain-text paste, preserving supported clipboard formats and newer user copies; a literal paste key or partial draft is never submitted. Recovered inbox events explicitly require the original request and text, so the agent does not compose a different reply for the same delivery. SecretRef input never uses this clipboard route. Exact system file-picker verification remains a specialized adapter; unverified native operations never trigger an automatic input fallback. Computer-panel inspections and automatic monitoring share in-flight reads instead of rejecting one another as busy. One guarded action can wait for a read, but simultaneous actions and uncertain retries remain blocked. The existing bounded AX hierarchy supplies conversation scope; the SDK's partial actionable projection is used only to bind fresh native input tokens, never as proof of a complete conversation. After a timeout, new work resumes only after the SDK confirms shutdown of previously admitted operations. Failed shutdown stays blocked; pending requests and uncertain sends are never replayed.\n\nChoose Native text, visual fallback in the existing Computer node. On macOS and Windows, Auto reads the authorized native window through native accessibility without producing a PNG. Two settled text observations wake the assigned operator with a bounded delta, rather than a new screenshot and a full task/history reload. The default local check interval is one second and cooldown is two seconds; configured values remain under owner control. The panel shows the actual source and last local check duration. Unsupported or incomplete native trees fall back to bounded visual checks, at least three seconds apart. Region and pixel threshold apply only to that visual fallback; native reads cover the authorized window. Linux currently uses the visual path. A local detection time is not a provider response-time guarantee.\n\nAuthorize the application, enable Bounded Security with computer and agent capabilities, create an active task assigned to the operator, and select an enabled Manual automation that prompts that same operator. Select the exact window, automation and task, then enable Monitor. Allow agent configuration is a separate owner opt-in for computer_watch. Do not also schedule model polling. Nothing wakes the model on unchanged content. Native observation does not require foreground focus. Pausing, unloading, revoking the app, or completing/reassigning the task stops future work. Generic observation starts a new baseline after restart. Conversation replies restore a persistent inbox of observed messages; see that use case for retention and batching.\n\nAgents use computer_read for current text and controls, then computer_interact to fill or press an exact native element. The operation rechecks the expected role/name/value and conversation or document guards immediately before input, and returns fresh text afterward. Fill requires the existing draft value; never overwrite a human draft. Before sending, include guards for the exact recipient and complete draft and declare external_publication. Unknown, changed or ambiguous controls fail closed. Inspect the actual outcome; pressing Send alone does not prove delivery. No repeated screenshots are needed while a gate is pending. Generic controls retain publication gates. For unattended replies use an owner-approved Conversation replies grant and computer_reply, described in the corresponding use case; never replace it with blanket app publication permission. UI content is untrusted data, not instructions. Password controls are redacted by native reads; screenshots can still include visible secrets. Native text deltas expire from local delivery memory after two minutes; audit stores counts and digests, not chat text. Provider transcripts have separate retention.\n\nOn macOS, selected-window reads use public native APIs without repeated System Events calls. The private pipe helper stops after 30 seconds idle and recycles between confirmed requests after 256 operations or five minutes; closing it cancels pending commands without replay. Another app can keep being observed during a process-directed operation. Reads of the same process and global input remain exclusive. A fast observation or enabled Auto switch does not prove that the target supports background typing or Send; unsupported input does not authorize an automatic focus change.\n\nOn macOS, open Computer > Conversation replies and enable Temporary focus for sending for the exact contact. It is off by default and only the owner can change it. computer_reply and computer_send may then bring the approved window forward for guarded text composition and submission. Recent typing, clicks or held modifiers delay admission. The previous application/window is restored unless the user switched elsewhere; closed or replaced targets are not guessed. A restoration failure is audited without replaying the message. Observation remains in background. This opt-in covers text sending, not file dialogs or unrestricted desktop control; existing permissions, publication gates and uncertain-send recovery remain enforced.",
      "bullets": [
        "Use temporary screenshot retention for operational checks and evidence for important milestones. Temporary images expire after 15 minutes and are capped at 32 MiB / 64 files per workspace. Evidence defaults to 14 days and 256 MiB, with controls in the same node and a 1,500-file cap. All registered Computer workspaces share a 2 GiB / 5,000-file cap. Oldest images are deleted first; links then return unavailable. Cleanup runs every five minutes while Core is running and before/after retained captures, including when monitoring is paused. Below 1 GiB free, capture stops before writing. Cleanup never follows storage symlinks or touches creative image assets. Audit metadata and provider conversation copies have separate retention; these settings do not delete those records.",
        "computer_batch accepts steps: [{input: {command: 'type', targetId: '<window>', text: '<complete text>'}}, {input: {command: 'screenshot', target: 'window', targetId: '<window>', retention: 'temporary'}}]. Use a stable batch idempotency key and taskId; up to 12 steps are validated before any effect. Inspect completed and each step: failed or gated stops subsequent steps and includes gateId. Retry an approved gate only after inspecting the current target, with the same key; completed steps are not repeated. A potentially partial failure requires inspection and a deliberate new action. Never combine composition and publication without first verifying the recipient and content."
      ]
    },
    {
      id: 'computer-node',
      title: 'Computer node and bounded desktop control',
      bullets: ['Send the complete text with one computer_type call. On macOS, native Unicode events preserve accents and emoji without using the clipboard. Observe the composed text and recipient before sending; a successful input command alone is not proof of delivery.', 'Window-bound actions inspect the target process instead of repeatedly enumerating every application. Fresh focus and identity checks remain mandatory; changing the desktop or an uncertain send requires another observation, not a blind retry.'],
      body: "Tell an existing agent, locally by text or dictation or through Remote: \"Open Calculator and calculate 73 times 19; record and verify the result.\" The agent creates a briefing note and an active task assigned to itself, calls computer_prepare to create/reuse and connect the Computer node, and inspects the host computer. Preparation inherits only an existing enabled Bounded grant with the computer capability and exact allowedApps; it never widens access or reactivates a paused node. Otherwise authorize the required app and enable control yourself. Grant macOS Accessibility, Screen Recording and Automation when requested. computer_launch focuses an existing app window, preserving its session, or opens its registered app; then use wait/inspect, window-bound input and screenshot, inspect the real result, update the note and close the task. Example launch IDs: com.apple.calculator or com.google.Chrome on macOS; CalculatorApp or chrome on Windows; a registered .desktop ID or matching WM_CLASS on Linux X11. App authorization is possible by ID even before the app opens; closed authorized apps stay visible. Agent input/captures require an allowed window and a live assigned task. Use a stable idempotencyKey per exact action; running or possibly partial failed actions are not automatically replayed. Inspect first and create a new key only for a deliberate new action. Desktop input is serialized across workspaces and focus is checked before typing. Declare risk external_publication before sending email or posting, purchase before buying, and the appropriate destructive/credential risk; enforcing Security gates bind approval to the exact request and attempt. Pixel-only desktop operations cannot infer every business risk or browser origin: this is not a shell sandbox, nor automatic password masking. Prefer Portal or Integration Center when a structured contract is available. SecretRefs must bind computer.type_secret and the exact app; values travel through protected stdin and are not returned to the agent or audit. Linux secret typing is explicitly unsupported. Captures under .orkestrai/computer/evidence reject symlink escapes, refresh in the node, and remain read-only evidence; visible sensitive content can appear in a native screenshot. Remote sends the request to the existing host agent, not a new phone browser; the host must be awake with Core, an interactive desktop and required grants available.",
    },
    {
      id: 'portal',
      title: "Portal (the agents' browser)",
      body: "Portal remains a native node in Canvas and Workbench. Name it with the pencil, navigate from its address bar, and use the device control for exact responsive viewports. Manual and agent control share the same live page. Normal new-tab links create a new Portal; script-created popups remain inside native Portal tabs with their opener preserved. Private or workspace profiles persist cookies and storage, though sites can expire sessions. In the gear select agents, read/interact mode, allowed hosts, downloads inside the workspace, and optional background access. Connections alone do not grant control. Agents use snapshot, navigate, click, type, select, upload, download, wait, extract, dom and screenshot under the workspace policy. Arbitrary eval is unavailable. See Visible browser workflows for login handoff, protected fields and approvals. In a regular browser the embedded page is viewer-only.",
    },
    {
      id: 'portal-new-tabs',
      title: 'Tabs and authentication pop-ups in Portals',
      body: `In the desktop app, a page link that requests a foreground or background browser tab is intercepted before Electron creates an external window. Orkestrai creates a new Portal node on the same Canvas, places it beside the source without overlapping existing nodes, names it from the destination host, opens the requested HTTP or HTTPS URL, and focuses it. Both nodes use the persistent Portal session, so approved cookies and web storage remain shared across restarts. A real pop-up such as an OAuth or payment authentication window remains a separate sandboxed Orkestrai window because those protocols depend on window.opener and a child-window lifecycle; it never escapes to the system browser. Privileged schemes, oversized URLs, and malformed destinations are denied instead of reaching the renderer.`,
    },
    {
      id: 'managed-portal',
      title: 'Managed Portal automation',
      body: `The Portal gear selects a workspace-shared or Portal-private browser profile, allowed hosts, and a download folder confined to the workspace. Sign in directly in the visible Portal: cookies and passwords never enter prompts, while the Core reuses the protected profile with the Canvas closed. Agents call portal_snapshot for semantic references and then use typed tabs, navigate, click, type, select, upload, download, wait, extract, and screenshot operations by unique Portal name or id. Host changes are denied unless allowlisted, files cannot escape the workspace, and bounded results plus every navigation or mutation enter Control Center with actor, Portal, profile reference, outcome, and correlation data. Arbitrary agent scripts are refused; use typed operations with explicit Portal grants. Background control requires a separate opt-in. Automations can schedule the same typed operations durably.`,
    },
    {
      id: 'mcp',
      title: 'MCP (external tools for agents)',
      body: `MCP is the standard for giving external tools to agents (GitHub, Gmail, Figma, Drive, Postgres...). THE EASY WAY: Skills page (sidebar) → MCPs tab — search the official curation or MCP registry and install with one click; when a server needs a key/token, the app explains where to get it. Remote servers require no command. ADVANCED: pencil next to the workspace → "MCP Servers". AUTOMATIC: Orkestrai provisions its own bridge for Claude/Kimi (.mcp.json), OpenCode (opencode.json), Cursor (.cursor/mcp.json), Cline (.cline/mcp.json), Devin (.devin/mcp_config.json), and Antigravity (.agents/mcp_config.json), plus skills and a preserved AGENTS.md block. Codex receives the Orkestrai bridge and official Figma MCP as ephemeral launch overrides, so the app does not rewrite ~/.codex/config.toml. Every agent receives typed canvas tools scoped to the correct workspace.`,
    },
    {
      id: 'code-intelligence-graph',
      title: 'Code Intelligence Graph',
      body: `Add Code Graph from the Canvas toolbar to index the approved repositories of the workspace without executing project code, build scripts, plugins, or configuration. The same persistent node opens in Workbench and visualizes modules, imports, classes, interfaces, functions, methods, calls, instantiation, inheritance, and implementations for TypeScript, JavaScript, Svelte, and PHP. Choose one repository or the whole workspace, search names, paths, signatures, and nearby documentation, then inspect incoming, outgoing, or bidirectional relationships up to a bounded depth. Open Changes to combine the current Git working tree with every active Floor: changed files are mapped to direct and transitively affected symbols, likely test files, and shared-impact conflicts before review or landing. Open Insights for Contracts, Quality, Semantic, and Runtime. Contracts joins backend endpoints, frontend HTTP calls, generated clients, OpenAPI or Swagger schemas, gateway prefixes, and live API Client requests across approved repositories while withholding request hosts, query values, headers, and credentials. Quality provides confidence-scored evidence about structural duplication, import cycles, coupling, inferred layer violations, oversized code, security-sensitive execution, possible dead code, and static environment/file/network/database/IPC flows without values or source bodies. Semantic adds compact local vectors and turns the sparkle beside search on for intent queries; it requires no API key, external service, or model download. Assisted mode refreshes both graph structure and semantic vectors after settled source changes, reuses vectors whose content and neighborhood did not change, and makes agent searches wait for the freshest revision. Manual mode keeps both updates explicit. Runtime imports LCOV, JUnit XML, traceback, or structured Orkestrai JSON from a relative path inside the selected approved repository. It overlays covered symbols, failures, observed calls, and calls seen only at runtime while raw logs and test output are never persisted. Treat every finding as review evidence, not an automatic defect verdict. The actions beside each change scope create a bounded Kanban handoff; the primary working tree can also create a Review Center review tied to its current Git revision. Source files remain authoritative: Orkestrai stores hashes, spans, bounded metadata, compact vectors, derived evidence, and relationships in its own versioned SQLite graph adapter and swaps revisions atomically. Additional sibling repositories explicitly authorized in Edit workspace become separate graph projects. Agents query that exact visible graph through code_graph_status/index/search/symbol/neighbors/changes/contracts/quality/semantic/evidence/handoff or the equivalent orkestrai graph commands; arbitrary SQL and Cypher are never exposed. SQLite is the local-first default behind CodeGraphStore, while benchmark gates keep future adapters possible without changing the UI or agent contract.`,
    },
    {
      id: 'code-intelligence-modes',
      title: 'Freshness and access modes',
      body: `Open Edit workspace and choose a Code Intelligence mode. Assisted is the default and recommended mode: after the first index, Orkestrai watches every approved source and OpenAPI/Swagger contract, waits for a write to settle, debounces bursts, and rebuilds only changed files. It then synchronizes the compact Semantic index automatically, reusing vectors whose content hash did not change and recalculating only changed symbols and affected neighbors. A graph notification is published after the atomic revision swap. If another edit arrives during indexing, a second pass runs before the graph is considered current. Agent MCP and CLI reads pass through a freshness gate: they wait for pending structural and semantic refreshes, and the first graph read after an app restart verifies the repositories again, so an agent never receives a revision that Orkestrai already knows is outdated. Manual keeps the visual graph available only to you: file changes mark it Outdated, semantic search requires an explicit rebuild, and agent graph tools return a permission error. Disabled stops graph watchers and blocks both the visual graph and agent tools; existing local index data is retained so re-enabling does not destroy history. Initial structural indexing remains explicit from the Code Graph node in Assisted or Manual mode. Imported Runtime evidence remains an explicit revision-bound artifact and must be reimported when appropriate. The repository selector distinguishes All repositories, Main repository, and each approved @alias. Impact of changes means uncommitted Git work plus active Floors mapped to affected symbols, likely tests, and conflicts; it is not the graph revision history, which remains under Insights → Compare revisions.`,
      bullets: [
        'Use Assisted for teams: settled edits normally begin an incremental refresh within about one second, while completion time depends on repository size.',
        'Use Manual for deliberate inspection without agent access; click Index code whenever the Outdated state appears.',
        'Use Disabled when the workspace must not be watched or queried. Re-enable it from Edit workspace.',
      ],
    },
    {
      id: 'code-intelligence-operations',
      title: 'Operational code intelligence',
      body: `Code Intelligence turns the graph into a shared operational surface. Select a relationship to explain its type, source, confidence, static or runtime provenance, then open either endpoint in the workspace Monaco editor; selecting a symbol from the editor updates the graph without resetting the camera. Insights → Live work overlays active agents, Kanban tasks, and Floors on the files and symbols they touch and calls out concurrent ownership conflicts. Build a bounded context package from a selected symbol, change scope, or quality finding, choose a 500–16,000 token budget, review exactly what will be sent, and hand it to the leader, one agent, Council, or a traceable task. Every handoff carries graph revision and source ids. Compare retained graph revisions to inspect added, removed, and changed symbols or relationships. Named investigations preserve the current project, view, filters, selection, camera, and open file so a person or agent can resume the same inquiry later. The same contracts are available through code_graph_context/operations/explain/locate/revisions/compare/investigation_* and orkestrai graph commands. Packages, manifests, and investigation state remain bounded and workspace-scoped; source bodies, credentials, environment values, and arbitrary paths are never persisted in them.`,
      bullets: [
        'Use the explanation panel to distinguish parser evidence, imported runtime evidence, and inferred relationships before making a claim.',
        'Treat live ownership conflicts as coordination signals: open the agent or task, then create a traced handoff instead of silently reassigning work.',
        'Save an investigation before changing focus or revision; restoring it returns the same view and source location without creating another graph.',
      ],
    },
    {
      id: 'code-intelligence-runtime-format',
      title: 'Runtime evidence format',
      body: 'In Code Graph, open Insights, then Runtime. Select one indexed repository and provide a path relative to that repository. Auto-detection accepts LCOV .info, JUnit XML, common stack traces, or the bounded Orkestrai JSON v1 contract below. JSON paths are also repository-relative and line numbers are one-based. Files are limited to 5 MB; coverage is capped at 50,000 locations and failures or calls at 5,000 relationships. Orkestrai stores only content hashes, counters, mapped symbol ids, paths, line numbers, and derived relationships. It never persists the raw file, stack text, test output, environment values, or source bodies.',
      bullets: [
        'Build or refresh the structural graph before importing evidence so paths and lines can map to the current symbol revision.',
        'Use orkestrai graph evidence import <projectId> <relativePath> --kind auto from an agent terminal, or the equivalent code_graph_evidence_import MCP tool.',
        'A runtime-only call means the observed relationship was absent from the bounded static call graph. It is evidence to inspect, not proof of a defect.',
      ],
      examples: [{
        id: 'runtime-evidence-json-v1',
        title: 'Orkestrai JSON v1',
        description: 'Coverage, failures, and observed calls can share one document.',
        snippets: [{
          id: 'runtime-evidence-json',
          title: 'runtime-evidence.json',
          code: `{
  "version": 1,
  "coverage": [{ "path": "src/auth.ts", "line": 42, "count": 8 }],
  "failures": [{ "path": "src/auth.ts", "line": 67, "count": 1 }],
  "calls": [{
    "from": { "path": "src/routes/login.ts", "line": 18 },
    "to": { "path": "src/auth.ts", "line": 42 },
    "count": 8
  }]
}`,
        }],
      }],
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
      body: `⌘P palette · ⌘K (or Ctrl+K) search documentation from any screen · ⌘2 Provider Center · ⌘⇧A next attention · ⌘⇧T organize the whole visible canvas · Cmd/Ctrl+D duplicate selected shapes · Cmd/Ctrl+C and Cmd/Ctrl+V copy and paste selected shapes · ⌘G group · ⌘⇧G ungroup · N new note · L connect selected · Alt+1…9 focus terminal · Alt+Space voice dictation · ⌘F search terminal · ⌘Z undo · Backspace delete. In Windows terminals, Ctrl+V pastes native clipboard text; when the clipboard has no text, the original CLI shortcut remains available for image paste. On Windows, the styled title bar provides File, Edit, View, Workspace, Window, and Help while preserving window controls; macOS and Linux keep their platform menus.`,
    },
  ],
  useCases: [
    {"id":"pdf-ocr","title":"Read scanned PDFs with local OCR","body":"Import a scanned invoice containing a budget and delivery date. Ask an agent: Search Second Brain for the invoice amount and deadline; cite the page and flag uncertain OCR. Read the OCR passage and compare it with Open original before approving a payment or delivery plan. Replace the PDF, query again and verify the new revision.","tags":["PDF","OCR","MCP"]},
    {"id":"second-brain","title":"Second Brain: connected knowledge","body":"Create a campaign workspace. Import its PDF brief and XLSX budget, add a note named Campaign with [[brief.pdf]] and #launch, then ask an agent: “Search the Second Brain for the budget and deadline, cite the sheet/page, and create a plan.” Change a budget cell and query again to see the new revision. After a tracked task, ask the specialist to register a reusable correction with evidence, review it under Agent learning, and verify that a later related task recalls the active lesson.","tags":["PDF","XLSX","MCP"]},
    {"id":"creative-video-providers","title":"Choose a video provider without changing your image workflow","body":"Open Images > Video workflow in Canvas or Workbench. Existing drafts still use fal.ai. Create reference images and storyboards with the existing Codex subscription workflow; this feature does not send image generation to another provider.\n\nIn the video node, open Configure access > New account. Choose the provider before entering its credential: a fal key, a BytePlus ModelArk API key, or Higgsfield KEY_ID:KEY_SECRET. Save it in the encrypted desktop vault. Then enable this workspace, external media, permitted models, per-run/daily USD reservations and optional agent access. Website subscriptions do not imply API credit or model access. An existing account cannot change provider; create another account instead.\n\nVideo references show names and previews for both canvas assets and standalone project files. Choose the role (first frame, last frame, reference image, video or audio), then pick canvas media or use Choose from project to browse folders. View reference opens a larger preview without leaving the workflow. Numbers are one-based model input positions, not filenames. Technical details contains the exact API mapping and editable relative file path. Viewing a file does not create a node or rewrite the agent's binding. Agents use the same bindings; the app does not infer missing references or start paid generation automatically. The provider adapter uploads or encodes inputs at the disclosed quote/generation step.","tags":["Video","BytePlus","Higgsfield"]},
    {"id":"creative-video-sequences","title":"Assemble and export a video sequence","body":"Open Images > Video sequence in Canvas or Workbench. Add existing workspace Video nodes (MP4, WebM or MKV). Install video encoder once in the node if requested: the owner confirms a separate, pinned FFmpeg download verified by SHA-256. No Homebrew, API key or paid generation is involved.\n\nSelect a clip in the vertical list. Move it up/down, set in/out points, audio level and a caption, then Save. Removing a clip only removes it from the sequence. The source hash is pinned; a changed or missing source blocks export instead of substituting media. Choose horizontal, vertical or square output and 24/25/30 fps. Fit keeps all picture content with black padding, never silent crop or stretch. Captions are burned inside 10% title-safe margins.\n\nPlay sequence previews the ordered trims. Export MP4 creates a new H.264/AAC file under generated/videos/sequences and a connected Video node. Inspect the delivered video and sound. An export keeps its source revision and is marked older after edits. Exporting is not delivery; failures and interruptions stay visible. Cancel stops the encoder and leaves sources intact. Owned temporary files are removed after success/failure/cancellation and abandoned job directories are removed before the next export.\n\nAgents use video_workflow_sequences or orkestrai video sequences with an assigned task. Read the current revision before apply/export; retry a timed-out request with the same UUID idempotencyKey. Runtime installation is owner-only. Limits are 30 clips, 10 minutes, even output dimensions 240–1920 per side, one local export at a time, at least 3 GB free disk and a bounded output size. Transfer a sequence together with all its source video nodes. Existing Codex ImageGen images and fal generation remain separate; this is assembly of delivered videos, not a new generative model. Use Full screen on the preview to inspect vertical clips and captions at a readable size, then return to the same editor.","tags":["Creative","Video","Sequence"]},
    {"id":"creative-reusable-workflows","title":"Reuse creative workflows and inspect the queue","body":"Open Images > Creative workflows in Canvas or Workbench, or Save workflow in a Storyboard header. Save workflow captures the current saved revision, ordered scene direction, dialogue, duration and shot. Name it and optionally select an existing workflow to create a new immutable version. Unsaved scene edits are not captured. The agent command video_workflow_recipes also accepts a group containing exactly one storyboard; it captures that board, not unrelated notes, agents or automation. Files, run history, sessions, account credentials and paid grants are not stored in the recipe.\n\nIn Library, choose a version, enter the production brief/script, output aspect ratio and optional Codex image agent. Bind every named product/reference slot to a current-workspace image or video, and every character slot to an approved local character. Matching approved identities can be preselected by exact family/version/digest. Only the owner may deliberately choose a different approved character; agents must preserve the saved identity. Import a character from Character library first when needed. The owner can reuse recipes from another workspace, but agents cannot browse or read other workspaces.\n\nCreate editable storyboard adds ordinary native content with fresh scene IDs and no previous run links. The script replaces the literal {{script}} once, without recursive evaluation; if a direction has no placeholder, the brief is appended. An empty required script or missing input blocks creation. Open the resulting storyboard, inspect every scene and prepare image/video drafts separately. Image dimensions are requested through the existing Codex workflow; video duration and aspect ratio must be declared by the selected endpoint or preparation stops. Existing generation, alpha validation, paid preview, budgets and security gates remain in force.\n\nGeneration queue refreshes real current-workspace image/video states while open. It shows drafts, failures, provider position, reserved USD and output links, not invented percentage progress. Open workflow exposes its regular estimate, grant, review and generation controls. Cancel uses the existing executor; Retry download only retrieves an existing remote result. Uncertain paid submissions have no automatic retry. Some completed outputs do not mean the whole storyboard is complete. Deleting a saved recipe version never deletes instantiated storyboards or output files.","tags":["Creative","Storyboard","Queue"]},
    {"id":"creative-brand-kits","title":"Reuse an approved brand kit","body":"Open Images > Brand kits in Canvas or Workbench. In This workspace, name the kit, choose color swatches and hexadecimal values, add named logo/product/style images, and write the brief, communication tone and usage rules. Image assets must be local PNG, JPEG or WebP files; export vector logos through the existing Design tools first. Save drafts before approving.\n\nReview the actual files, then Approve and lock kit. Approval freezes copies under generated/brands with SHA-256 fingerprints. Approved versions cannot be edited or deleted as drafts; create a new version to change them. Conflicting revisions or changed files stop the operation instead of overwriting another edit. Palette and rules alone can also form a kit.\n\nUse Approved library > Add kit to Canvas in any workspace. The exact version becomes a native group, a rules note and connected image nodes. Copies are independent of the original project; no provider account, token or generation grant is transferred. Connect the note and relevant images to existing Codex image or fal video workflows, respecting each model’s reference limit. Agents use video_workflow_brands to draft/read/fork/place local kits; only the owner can approve or import across workspaces. Kit inputs do not guarantee pixel-perfect generated outputs: review the result before use.","tags":["Brand","Canvas","Creative"]},
    {"id":"creative-shot-direction","title":"Direct framing and camera movement","body":"Open a Storyboard scene or Video workflow and use Shot direction. Choose framing, angle, movement and pace. The same controls persist in the scene and its materialized video draft; still-image drafts include framing and angle, not camera motion.\n\nThese controls are creative intent in the prompt, not a guaranteed camera trajectory. First and last frames and other media fields depend on the selected endpoint’s declared contract. Scene duration must match an exact supported duration; unsupported or ambiguous durations stop preparation instead of silently shortening the clip.\n\nChanging model preserves saved shot intent, character and voice mappings, file references and parameters. Incompatible curated adapters refuse the switch; generic endpoints require repairing incompatible pointers before estimation. Required frame references remain required until explicitly rebound. Agents use the same shot object in video_workflow_storyboards scene operations and video workflow configuration.","tags":["video","creative"]},
    {"id":"creative-actions","title":"Create a new direction from an existing image","body":"Open Creative actions in an Image node header. Choose Variation, Remove background, Change region or Animate. The original is never overwritten. Each action freezes the exact source bytes into generated/creative-actions and connects a reference node and a new native workflow. The saved ancestry includes the original node, file hash and generation context.\n\nVariation and Change region accept direction and 1–10 results. Choose a Codex agent or assign it in the resulting workflow. For Change region, drag a rectangle on the actual image or adjust X, Y, width and height with the keyboard-accessible sliders. Source dimensions are verified by the backend. This rectangle is prompt guidance, not a hard inpainting mask or a promise that every outside pixel will be unchanged.\n\nPrepare draft does not generate or spend credit. Open the new Image workflow and use the existing Codex subscription flow; background removal requests genuine RGBA transparency and retains the existing validation/repair loop, with no local pixel editing. Animate creates a native video draft: choose any compatible allowed model, map the frozen image and every required character, save, estimate and explicitly run. A missing or changed frozen reference blocks reuse. Cancel before preparation creates nothing; removing a draft never deletes the original. Agents use video_workflow_assets command=prepare with the inspected expectedDigest and edit.operation; both surfaces use the same validation.","tags":["ImageGen","Canvas","Video"]},
    {"id":"creative-variants","title":"Compare and approve creative variants","body":"Open Compare and review in an Image or Video node header, or in a Storyboard. Same workflow limits the contact sheet to related outputs; turn it off to compare other local assets. Choose A and B with searchable selectors or click a thumbnail for B. Open output locates the original Canvas node.\n\nVideo pairs share play, pause and seek over the shorter common duration; switch sound between A and B. A single video uses native controls. Images fit without cropping. Missing or undecodable files cannot be approved. Compare the face, wardrobe, framing, language and actual voice against approved references; a completed generation is not a consistency guarantee.\n\nWrite feedback and choose Approve, Request changes or Reject. History preserves each decision, author, time, comment and file fingerprint. Approval binds the exact asset bytes, generation provenance and available frozen character versions. A changed file invalidates the decision; competing reviews require reload. Agents use video_workflow_assets list/inspect/decide and may only propose a decision, never approve their own output. These actions do not call fal or ImageGen and do not spend credit.","tags":["Canvas","Video","Review"]},
    {"id":"creative-storyboard","title":"Plan scenes in a native storyboard","body":"Open Images > Storyboard in Canvas or Workbench. Add a scene and set its title, direction, dialogue, language and requested duration. Select the exact approved character version and local reference images/clips; choose a Codex executor for image generation. Save before switching scenes. Duplicate starts a new draft without reusing execution links. Drag scenes to reorder or use Move up/down. Removing a scene preserves its workflows and output files.\n\nPrepare image draft creates a connected existing Codex image workflow, without running it. Up to five references are supported, including all selected character masters; excess references fail explicitly instead of being dropped. Open the draft and use its normal generation controls. Prepare video draft creates a native fal video workflow without charging. Choose an allowed endpoint, bind every required character and reference, review the actual model duration/audio capabilities and use Save > Estimate > Generate. Unsupported requested duration is rejected, never silently shortened. Preparing the same unchanged scene reuses its linked draft. To choose another draft explicitly, unlink and prepare again.\n\nScene changes mark linked drafts stale; outputs remain unchanged. Manual edits and video_workflow_storyboards use the same revisioned document. Concurrent writes fail with a revision conflict; local unsaved edits remain visible until you discard and reload. Copied storyboards retain missing reference/character IDs for explicit local repair; they never inherit account grants. Review actual picture and sound before approval. An available locked voice reference does not guarantee that every model can reproduce it.","tags":["Storyboard","Codex","fal.ai"]},
    {"id":"companion-orchestration","title":"A companion that remembers and schedules work","body":"Start with an active task assigned to the Canvas agent and the existing Computer conversation authorization. Ask the agent naturally to help; computer_capabilities reports supported resources, setup and permissions without reading credentials. Its briefing connects tasks, notes, published Workshop tools, integrations, native image workflows, TTS and PDF generation. It must inspect existing tools before proposing another and may publish automatically only within your existing Workshop policy.\n\nFor example: \"Every Monday at 14:00, America/Sao_Paulo, prepare my weekly report and send its summary to this authorized conversation.\" The agent creates an existing prompt_agent routine through automation_save, then returns its id and next occurrence. In Automations, Schedule offers interval or Calendar with once/daily/weekly/monthly, local time, IANA timezone, weekdays/date/day, and missed-run policy. Skip allows 60 seconds; Latest permits one recent occurrence within your configured delay, not a flood of missed reminders. Nonexistent daylight-saving times are skipped; repeated times run once; a nonexistent monthly day is skipped. The host must be awake, the workspace loaded and authorization active. Inspect, edit, pause or cancel in the same Automations UI; agents can edit only their own assigned-task routines with the current revision.\n\nIn Computer > Conversation replies, enable Private conversation memory explicitly. Only newly observed incoming messages after the baseline and successful native submissions enter this separate local journal. It is not shared project memory and never imports an application's entire history. Retention is 30–3650 days, also bounded by 5,000 messages/16 MiB per conversation. Up to 256 sourced facts retain their cited excerpts until removed; the agent searches older details on demand instead of placing the whole journal in each prompt. History lets the owner search, revise facts and erase a fact or all local memory. Deletion does not erase provider transcripts or the external chat. Disabling pauses new retention; revoking/removing the authorization deletes its private records.\n\nLong requests stay traceable after acknowledgment. Enable scheduled reminders and task results for that exact contact to allow computer_send without requiring a fresh incoming message. It requires an assigned task or automation run source, deduplicates that source across restarts and uses the same foreground, recipient, empty-draft, hourly-limit and risk safeguards. A permission change between typing and sending stops publication. Incoming messages never authorize new contacts, apps, files or purchases. Calendar dispatch and a cleared composer are not proof of a delivered report.\n\nartifact_speech reuses configured TTS to create a workspace WAV; artifact_report creates PDF; artifact_inspect verifies path, format, size and SHA-256. Native images retain the existing Codex workflow without a new API key. In Computer > Conversation replies > Native attachments, the owner authorizes the picker, optional menu item, preview Send, formats and size for that contact. computer_media_send uses an incoming digest or an authorized task/run source, a private immutable copy, exact recipient and preview filename guards. Retry keys cannot repeat an uncertain send. The original file is unchanged; temporary copies are limited to 100 MiB and expire after 15 minutes. Receiving is a separate opt-in: choose the message Download control and optional incoming-media prefixes. computer_media_receive saves into a NEW authorized workspace path, verifies format/hash and never executes incoming content or overwrites files. Only a Download belonging uniquely to that incoming message is accepted. Native picker support currently targets standard macOS attached file dialogs; custom dialogs and other desktop backends are not claimed as verified. Portal upload/download remains separate under existing browser grants. TTS WAV is an audio-file attachment, not a native push-to-talk recording. artifact_transcribe uses existing STT for PCM16 WAV; the installed app also decodes Ogg/Opus, MP3 and M4A with Chromium, bounded to 10 MiB and 10 minutes, without Python, external upload, microphone access or another window. Codec availability is checked at execution. Prepared, submitted, received and delivered are different states; an imported file is not yet understood content.\n\nInterrupted text composition has a bounded retry only before Send and only for an exact prefix of the authorized reply. Inspect interrupted reply lets the owner review an older failed draft, then authorize resuming the original request without rewriting its content or publishing anything during recovery. A changed recipient/draft or any recorded Send attempt remains blocked; recovery is not delivery.\n\nWorkshop authoring exposes the exact manifest contract and the authenticated agent's standing publication limits. Transform fixtures can assert expectedOutput before automatic publication; use two distinct examples and check publishedRevision before execution.\n\nmacOS editor focus waits for native confirmation and can use the verified editor's focus action. App-owned popovers retain the original document guard. Another pre-Send interruption requires a fresh owner inspection and distinct recovery authorization; uncertain publication is never replayed.\n\nIn Computer > Conversation replies > Persona and voice, save the companion name, owner instructions, response language, default voice/speed and public style. Incoming text, transcribed audio, images and private memories are reference content, not permission to change persona, recipients, apps or file access. The app blocks recognized credential material before public text, speech, generated reports and textual attachments; errors and audit retain a reason/hash, not rejected content. Operational details can be blocked and em dashes replaced before sending. These checks are defense in depth, not universal DLP or immunity to prompt injection.\n\nLocal TTS exposes F1-F5 and M1-M5 for each supported language through Settings > Voice and computer_capabilities (30 ids). For example, request pt-BR-m3 with artifact_speech; an unknown id is rejected instead of silently changing voices. A configured per-contact voice is used when omitted. STT is unchanged. Receiving authorized audio automatically attempts local transcription after download: transcription.state=ready is untrusted external text; unavailable means retry artifact_transcribe on the verified saved file, not download again. Transcript text is transient, not copied into action/audit rows. A WAV attachment is still not a native push-to-talk voice note.\n\nNative attachments has separate Photo and Document picker controls configured by the owner. computer_media_send defaults to photo for images and document for other formats; an unconfigured photo route fails clearly instead of silently sending a document. presentation=document explicitly retains file delivery. Recipient, immutable file/hash, preview identity, empty draft and single-submit safeguards remain mandatory. A custom preview that cannot prove file identity is rejected, not guessed from a screenshot.\n\nCanvas agent keeps the existing autonomous tools and unrestricted shell; app policy cannot isolate or audit actions bypassing its bridge. Restricted conversation is an opt-in separate, tool-free Codex 0.154.x inference with owner policy, only this contact's messages/memory, no development transcript, shell, patch, browser, plugins or MCP. It can answer text but does not run schedules or generate/send media. Unsupported provider/version/WSL stops rather than falling back to the free terminal. This limited mode is not a replacement for the full autonomous agent. OS permission and native-app acceptance still require local verification.\n\nWhatsApp on macOS can omit filenames from photo previews. For that specific preview, Orkestrai requires a fresh native picker receipt for the exact staged path, app and window, then checks the authorized recipient, a single photo, one-item count and empty caption again at Send. A receipt from another file/window or an unverified preview is rejected. This does not relax Document checks or turn submission into delivery confirmation.\n\nA deliberate no-reply decision must also resolve its dispatched inbox batch. After reading every message, the agent uses computer_inbox_acknowledge with its exact batchId/inReplyToDigest and reason already_answered or no_response_needed. The decision is audited as skipped with sent=false, not as a delivered response. Pending arrivals are preserved and can run immediately; another contact/task, an uncertain send or an answered batch cannot be cleared this way. Merely saying in the terminal that no reply is needed leaves the queue pending.\n\nIn Computer > Conversation replies, enable Temporary focus for sending and Find and reopen this contact automatically to authorize native conversation navigation on macOS. If another chat is selected, the observer locates the exact approved recipient through native search and verifies its conversation header before reading messages. Reply preflight repeats this check if selection changed while the agent prepared its response. computer_open_conversation exposes the same bounded operation to the assigned agent; no manual search or screenshot polling is required. Navigation never types in a message composer or sends, and is audited separately. Ambiguous duplicate contacts, unsupported native search controls, revoked grants and unverified headers remain blocked rather than choosing someone else. Background monitoring still requires the host awake and the approved application running.","tags":["Computer","Automation","Memory"]},
    {"id":"computer-replies","title":"Automatic replies to one approved conversation","body":"Enable Bounded Security with computer and agent capabilities. In the existing Computer node, open Conversation replies and read the authorized native window. Select an active assigned task, the actual conversation HEADER (never its sidebar contact), composer and Send control. Select a received-message prefix exactly as exposed by native accessibility, including the sender; the message label must distinguish received messages from your own and ideally include its timestamp. Limit response length and hourly count. Only the owner can create, enable or revoke this authorization; it does not grant publication to the entire app.\n\nCreate an enabled Manual prompt_agent automation for the same agent. Manual automations stay enabled across successive events; do not add scheduled polling. Select the exact native window, task and conversation authorization in observation, use Auto and enable Monitor. Switching focus to another app no longer pauses native observation. Reads remain bound to the authorized process/window; changing the selected conversation, closing the target or revoking access still prevents processing. Observation does not focus, click or type. Native accessibility must expose complete, unambiguous messages; this is not an API import of the application's entire chat history. Unsupported apps/Linux do not fall back to coordinate-based automatic sending.\n\nThe first observation establishes a baseline. Subsequent observed incoming messages enter a persistent local inbox, including arrivals while the agent is busy. A short configured cooldown groups consecutive questions. Events carry grantId, batchId, inReplyToDigest and ALL messages in the batch. The agent reads them in order, groups subjects and addresses every question using computer_reply with those fields, targetId, taskId, idempotencyKey and the complete response. Pending requests belong in the existing task/notes; accepting a request is not completing it. The same agent session retains conversational context. Each batch contains at most 20 messages and 60,000 characters; excess messages stay pending, never silently truncated. The inbox allows 128 unresolved messages and blocks with an error if full.\n\nOrkestrai validates the native incoming message before typing. During composition and submission, the pinned recipient, authorization, focus and complete draft remain guarded; the original message does not need to remain visible or keep the same history index. New messages remain pending while an already claimed batch is answered. Human drafts, changed recipient, revoked grants or ambiguous input stop execution. On macOS, process-targeted native input updates the actual composer; multiline editors use Shift+Return for line breaks, never an unmodified newline. Native PID/window/bounds checks remain active throughout. A successful command acknowledges its batch as natively submitted, not delivered/read. A partial or uncertain failure stays blocked for inspection; do not resend or claim nothing was sent without checking.\n\nThe panel displays pending-message count, observer state and measured local check time separately from provider generation time. Inbox text is stored in the app's local database outside the workspace repository: unresolved messages remain until handled, and up to 64 submitted messages are retained for context for at most 14 days while monitoring runs. Up to 4,096 recent message hashes prevent duplicate observation. Audit keeps counts/hashes, not chat text; provider transcripts have separate retention. App shutdown restores queued observations, but cannot guarantee recovery of messages the native interface never exposed. Text replies do not authorize attachments, file access or image generation on a contact's instructions; generated-image delivery needs its own owner-approved integration. Local builds remain ad-hoc; OS permissions belong to the owner and are never bypassed.","tags":["Computer","Automation","Audit"]},
    {"id":"computer-observation","title":"Monitor an authorized desktop app with bounded storage","body":"Auto mode prefers native accessibility text without PNG captures. Use computer_read and guarded computer_interact for known controls; preserve the recipient, full draft and publication gate. The panel shows the actual source and local check duration. Unsupported UIs use visual fallback. Provider response time is additional.\n\nNative accessibility observation and computer_read on macOS/Windows do not require the target to be foreground. On macOS, passive visual fallback captures the selected window by ID without activation. Screen-rectangle fallback on other backends still requires foreground to avoid capturing an unrelated covering app. This change does not remove input/publication focus safeguards or guarantee access to content an app does not expose. Approved text replies use process-directed native controls on supported macOS/Windows adapters, without global mouse or keyboard input. Exact window, recipient, draft, authorization and single-submit checks remain mandatory. Global input and native file dialogs still require foreground. A preflight failure before any native input keeps the batch retryable; an uncertain submission never retries automatically. Native apps, external browsers and managed Portals require their own controls and authorization; a successful test of one does not certify another or future interface changes.\n\nOn macOS, open Computer > Conversation replies and enable Temporary focus for sending for the exact contact. It is off by default and only the owner can change it. computer_reply and computer_send may then bring the approved window forward for guarded text composition and submission. Recent typing, clicks or held modifiers delay admission. The previous application/window is restored unless the user switched elsewhere; closed or replaced targets are not guessed. A restoration failure is audited without replaying the message. Observation remains in background. This opt-in covers text sending, not file dialogs or unrestricted desktop control; existing permissions, publication gates and uncertain-send recovery remain enforced.","tags":["Computer","Automation","Audit"]},
    {
      id: 'leader-team',
      title: 'Dev team with a leader (zero-config)',
      body: 'Create a Claude and say: "orchestrate feature X for me". It proposes the team, you approve, and it recruits, connects and distributes through kanban. Each ask consultation counts only after explicit bridge confirmation; when an agent uses task done, the leader receives the handoff automatically to review and coordinate the next step.',
      tags: ['Leader/Maestro', 'recruit/dismiss', 'kanban'],
    },
    {
      id: 'workspace-node-transfer',
      title: 'Reuse a working Canvas in another workspace',
      body: 'Select the agents, notes, images, flows, or other nodes that belong together and choose Move or copy selection in the bar above the Canvas. Pick Copy to reuse the setup while keeping the source, or Move to relocate it transactionally. The destination receives the same relative layout, internal connections, attachments, image files, and native Design content in a free area. Open that workspace to continue with clean terminal sessions and detached API credentials or runtime history.',
      tags: ['Multi-selection', 'workspace transfer', 'safe copy'],
    },
    {
      id: 'watch-24-7',
      title: '24/7 employee (task watcher)',
      body: 'Enable Run Orkestrai in the background under Settings → Autonomy & 24/7 Core, set the watcher terminal to Persistent under Agent runtime, and define its concurrency and provider-usage safeguards. Then create a routine every 1–5 minutes on the leader: "check the board (orkestrai task list); assign whatever is unassigned; if an agent is missing, recruit". Closing the window keeps the supervised process and durable runs available in the tray; Quit Orkestrai stops them explicitly.',
      tags: ['24/7 Core', 'Routines', 'task assign'],
    },
    {
      id: 'managed-browser-24-7',
      title: 'Run a signed-in browser task with the Canvas closed',
      body: 'Add and name a Portal, open Managed browser settings, keep a workspace profile, and allow only the required hosts. Sign in yourself in the visible Portal, then create a scheduled Managed browser automation. Agents use portal_snapshot references and typed actions rather than selectors or passwords; the Core preserves the profile, confines files, and records each effect in Control Center while the desktop window is closed.',
      tags: ['Managed Portal', 'authentication handoff', 'audited browser'],
    },
    {
      id: 'secure-autonomy-24-7',
      title: 'Authorize an autonomous agent without approving every step',
      body: 'Open Automations → Security, enable Bounded autonomous, grant only the project roots, capabilities, destinations, and operating window this worker needs, then keep destructive and external actions behind explicit gates. Add OAuth accounts through their official consent screen or store an API credential in the encrypted Vault with exact connector, operation, and destination bindings. The agent can then read mail, prepare reports, generate workspace PDFs, operate an authenticated Portal, and send approved Slack, Telegram, WhatsApp, or email notifications without seeing raw credentials or requesting permission for routine work. Review pending gates and export the hash-chained audit at any time; Emergency stop revokes future execution and aborts current runs.',
      tags: ['Standing policy', 'SecretRef', 'approval gates'],
    },
    {
      id: 'connected-reporting-agent',
      title: 'Receive an autonomous report by email or chat',
      body: 'Open Automations -> Integrations and add only the account the workflow needs. Grant read operations for its source and one explicit send operation for its destination, then bind the account to a bounded-autonomy policy. Create a persistent or on-demand agent and a scheduled Automation that gathers the approved data, writes the report or PDF inside the workspace, and calls integration_execute with a stable idempotency key. Gmail and Telegram can attach workspace files directly; Slack sends channel messages and WhatsApp sends messages or an approved HTTPS document link. The execution history and hash-chained audit retain actor, operation, destination, status, and safe metadata without storing credentials or full message content.',
      tags: ['Integration Center', 'scheduled reports', 'encrypted Vault'],
    },
    {
      id: 'visible-browser-worker',
      title: "Watch an agent work in your signed-in browser",
      body: "Create a named Portal, open the desired site, and log in manually. The team has Read and interact access by default, without selecting each agent. Keep background disabled. For this guarded automation example, optionally enable Bounded mode in Automations > Security, approve the needed host and risk categories, and keep sends or destructive operations gated. Normal interactive Portal use does not require this setup. Assign a task asking the agent to read the page, fill a non-sensitive field, and prepare a report without sending it. Watch the same page change live. Inspect the pending send in Security > Gates, approve it, then retry the same tool run or let the waiting automation resume. Expand Audit and Tool Workshop > Runs to see the completed steps. Pause the Portal to test revocation. Enable background only when desired, with audit/history as the observable record.",
      tags: ['Portal', 'Security', 'Tool Workshop'],
    },
    {
      id: 'workspace-tool-workshop',
      title: 'Turn a repeated operation into a reusable tool',
      body: 'Add Tool Workshop and create a draft with a typed input/output contract, timeout, output limit, and at least one fixture. Use a connected integration for Gmail, Slack, Telegram, WhatsApp, or GitHub; HTTP for a bounded approved API; Transform for deterministic payload shaping; or Workspace command for a confined executable with explicit arguments. Keep credentials in Security as SecretRefs bound to Tool Workshop, tool:<slug>, and the exact destination. Dry-run the draft, inspect the manifest and revision, then publish it yourself. Agents with active assigned tasks may propose later revisions and execute the published one, while automations call the same tool with stable idempotency. A proposed draft cannot silently replace production behavior, and run history plus Audit shows who invoked which revision without retaining secret values.',
      tags: ['Tool Workshop', 'versioned tools', 'SecretRef'],
    },
    {
      id: 'desktop-app-automation',
      title: 'Automate an installed desktop application',
      body: "Ask your agent: \"Open Calculator, calculate 73 times 19 and verify the result on screen.\" It creates the note, assigned task and Computer node itself, reuses the approved application, captures evidence for 1387 and records the result. You grant only OS access and the workspace/app boundary, not each ordinary click. For remote work, send the same request through Team or the leader chat. To inspect email already open in desktop Chrome, explicitly ask to reuse that existing window and account. Sending an email requires the declared external_publication risk and its configured gate; a login challenge stays with the user. The host desktop must remain available. Review the actual note, task, capture and audit, never only a success message.",
      tags: ['Computer node', 'desktop automation', 'bounded apps'],
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
      id: 'design-precision',
      title: 'Select, measure, and organize detailed artwork',
      body: 'Open the native Design document in its Canvas node or focus mode. Hover a layer to preview its exact boundary, click to select its group, or Command/Ctrl-click repeatedly to enter nested artwork and cycle overlapping layers. Hold Alt/Option while hovering another layer to see exact horizontal and vertical distances. Rotate from the direct handle and hold Shift for 15-degree snapping; drag against layers or guides to see labeled smart coordinates. Multi-select layers to align, distribute, or use Tidy Up, which preserves rough rows and moves each complete descendant hierarchy. Connected agents use design_arrange_elements and design_edit_vector, or the equivalent bundled CLI commands, against the same revisioned document.',
      tags: ['deep selection', 'measurements + rotation', 'typed agent tools'],
    },
    {
      id: 'design-figma',
      title: 'Design an interface together with your AI team',
      body: 'Add a native Design node and open it in Canvas Design Mode or Workbench. Build vector paths, masks, gradients, responsive auto-layout frames, and reusable image assets yourself, or paste an SVG to turn its paths, transforms, styles, and gradients into editable native layers. Group or ungroup artwork, select every layer that uses the same color, replace matching colors across solids and gradient stops, then copy a selection as SVG or PNG. Under Variables, use presets, import or export tokens, define modes and aliases, bind properties, and audit repetition. Under Components, create sources, instances, properties, variants, slots, and overrides. Publish versioned libraries only to authorized workspaces, or extract and synchronize CSS variables, Tailwind, and Svelte, React, or Vue contracts through the static Code scan. In Inspect → Figma, keep the official MCP managed for compatible agents, store a read-only REST token in the operating-system vault, inspect a file link, choose pages or frames, and import layers, vectors, assets, styles, variables, components, variants, local instances, and external-library identities into the same native document. Linked sources compare remote and local hashes before a selective sync, so you explicitly resolve Figma changes, local edits, and conflicts. Choosing the local version queues only that reviewed layer for Figma. The first-party plugin transfers the live Figma selection with raster assets, copies editable SVG or structural JSON, imports an Orkestrai document with native assets, variables, styles, components, and variants on a new Figma page, and sends only queued linked changes back to the current Figma file through a loopback-only workspace connection. Connect the document to a Designer or leader: the agent reads the exact current revision, combines the official Figma MCP with typed Orkestrai Figma/import/sync tools, and verifies the result while your editor refreshes live. Existing Code Connect mappings complete the persistent Figma node → Orkestrai layer → implementation link. Export the approved selection or page to SVG, PNG, JPEG, WebP, or PDF. The document, assets, thumbnails, design system, Figma links, and revision history stay in the workspace and remain searchable alongside tasks, notes, files, portals, and the rest of the team.',
      tags: ['Native Design Mode', 'vectors + auto layout', 'manual + agents'],
    },
    {
      id: 'design-delivery',
      title: 'Turn design into code and verify the implementation',
      body: 'Open a native Design document and choose Inspect → Code. Import HTML/Tailwind, Svelte, React/JSX, or Vue structure as editable native layers without executing project code. For delivery, select a frame or group, choose the Svelar/Svelte 5, React, Next.js, Vue 3, or HTML/Tailwind adapter, review the complete generated file, and only then write it inside the workspace. Compatible Code Connect mappings reuse the real project components first; the linked artifact opens directly in Monaco and refuses to overwrite a file changed after preview. Connected agents use design_import_code and design_generate_code_preview/apply through the typed Orkestrai MCP, or the equivalent bundled CLI commands, with the same revision and task attribution. Guided explorations expose an eight-part checklist in the Design node and Quality panel: required platform frames, a visible Brand board, a typed token system, bindings on real layers, components, prototype, applied code artifact, and visual approval of the current revision. Concept approval selects one delivery target and, when the leader runs the workflow, dispatches its tracked expansion task; the Kanban refuses to close expansion, implementation, or final validation while their evidence is missing. In Validate, choose a live Portal or attached iOS/Android device and a frame, mobile, tablet, or desktop viewport. Orkestrai captures the implementation, normalizes both images, and shows the design, implementation, adjustable overlay, and pixel diff. Create a Kanban feedback task with all three screenshots or create a Review Center entry tied to the actual Git change so a leader or specialist can reproduce, assign, and approve the result.',
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
      body: 'Open Agents and reviews in a native Design document. Follow a live participant, leave a page or layer comment, and ask an agent for a revisioned proposal instead of an immediate edit. Inspect the structural diff and preview, then approve, reject, send it to Council, or create a parallel Floor. For an external reviewer, share the workspace and grant only the exact Design level they need; the Companion receives sanitized summaries rather than the scene graph or project files.',
      tags: ['live presence', 'comments + proposals', 'Council + Floors'],
    },
    {
      id: 'design-quality',
      title: 'Audit and recover a production design',
      body: 'Open Quality and history in a native Design document to find naming, clipping, overlap, contrast, and accessibility problems, then jump directly to each layer. Start a real product, marketing page, mobile flow, or design system from an editable native template. Automatic backups, schema migration, bounded history, explicit restore, and incremental viewport rendering protect large documents. A connected agent can run design_audit and apply the same templates without bypassing revisions.',
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
      body: 'Focus any editable field — a kanban title or description, role, note, or form — then use the global voice orb or Alt+Space. The very first click preserves that field and inserts the transcript at its cursor without requiring a leader. Under Settings → Voice dictation, you can enable automatic sending: terminals also receive Enter after the transcript, while regular fields still only receive text. The clickable badge shows whether the orb is pinned or movable and opens position controls directly; the tooltip also displays the Ctrl-click or Command-click shortcut. In Workbench, the pinned position uses a dedicated header slot and never covers tabs or actions; unpinning restores free movement. With no active field, the same control finds the workspace leader in both Canvas and Workbench. On macOS, Fn/Globe by itself belongs to the system; choose a key combination or an F1–F12 key.' + " While the microphone is opening or transcribing, click its Cancel control to stop the attempt. Late responses cannot open the microphone or insert text afterwards. Startup is limited to 15 seconds and transcription to three minutes; recording automatically stops and transcribes after 15 minutes. Cancelling discards that attempt without sending text to the agent.",
      tags: ['Global dictation', 'text fields', 'local voice'],
    },
    {
      id: 'audio-devices',
      title: 'Choose the microphone and speaker',
      body: 'Open Settings → Voice to choose and test the microphone used by every local dictation surface and the speaker used by previews and spoken replies. Grant microphone access to reveal device names, watch the live input meter, and play a short output tone before saving. Dictation captures direct PCM at the microphone native hardware rate, selects the active input channel, then resamples and normalizes it for local STT. A same-take browser capture recovers the speech if Electron Web Audio opens but emits empty blocks, so you do not have to dictate it again. If a selected device disappears, Orkestrai returns to the system default. Permission denial, a missing device, interrupted capture, likely contention, and a device that opens but produces no signal receive distinct guidance; platforms that cannot route app audio to a specific output explain that limitation instead of silently ignoring the choice.',
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
      body: 'Choose Organize canvas from the toolbar or command palette. Orkestrai lays out the complete visible canvas into deterministic rows without moving nodes into each other, even when one item was still selected before the command; groups move as intact units and keep their internal arrangement. New agent, note, Portal, board, image workflow, reference, and generated Image nodes also search the real occupied rectangles and keep a stable margin instead of landing on existing work. Connections stay behind every node.',
      tags: ['Canvas layout', 'collision-free nodes', 'connections'],
    },
    {
      id: 'canvas-edge-performance',
      title: 'Keep a connection-heavy canvas responsive',
      body: 'Open Settings → Appearance → Canvas connections. Keep Adaptive to use elastic ropes on ordinary canvases and progressively switch idle connections to static geometry as the workspace grows. Choose Elastic and animated when the physical effect matters, or Static to disable all connection physics and animation on lower-power hardware. Offscreen connections and hidden windows are always paused, and reduced-motion preference is always respected.',
      tags: ['Canvas performance', 'static connections', 'reduced motion'],
    },
    {
      id: 'focused-workspace-view',
      title: 'Work with multiple artifacts in the Workbench',
      body: 'Use the Canvas/Workbench switch in the upper-left corner to open the grouped workspace explorer. Open items use vertical tabs by default; under Settings → Appearance, you can choose horizontal tabs above each pane. Split the active pane right or down and arrange up to eight resizable terminals, boards, notes, portals, files, flows, or usage nodes. Drag a tab to another pane or use its Move to menu; sidebar items can also be dragged straight into a pane. Layout is saved per workspace, old layouts migrate automatically, and invalid references are discarded safely. Canvas artifacts keep their persisted identity so sessions, content, and edits stay synchronized; workspace files use local tabs and do not create canvas nodes. Terminal font metrics and pane geometry settle before an existing PTY is attached, so the blinking cursor remains aligned after switching through Settings, documentation, Canvas, or Workbench. The footer shows every Claude, Codex, and Kimi usage window and opens details with one click, using the same five-minute snapshot as the Usage panel and node. Command/Ctrl+Page Up or Page Down cycles items, Shift switches panes, and Command/Ctrl+\\ splits the pane. The voice orb also uses the active workspace leader in this view. When you return to Canvas, Orkestrai preserves the workspace and centers the selected node.',
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
      id: 'manage-git-workspace',
      title: 'Manage branches and commits with people and agents',
      body: 'Add Git to Canvas and inspect Changes, Graph, Branches, and Worktrees. Stage the intended files, commit, switch or create a branch, and preview merge, rebase, cherry-pick, revert, tag, stash, fetch, pull, or push operations before running them. Use Floors for isolated worktrees and Review Center for the final diff and decision. An assigned agent can use the same guarded Git operations through MCP or CLI with the Kanban task id; destructive actions still require confirmation and a current repository revision.',
      tags: ['Native Git client', 'branches and worktrees', 'agent operations'],
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
      body: 'Enable experimental workspace sharing, start an end-to-end encrypted session, and choose a Browser/mobile or Orkestrai app invite. The web link opens the installable Remote PWA. The app invite opens the installed Orkestrai app automatically; the guest can also use Workspace → Join remote workspace and paste the invite. Both remove the secret from the URL before connecting and store a non-extractable pairing key only on that device. Approve the exact device fingerprint and choose Viewer, Collaborator, Operator, or Administrator. An Operator can hold sanitized, traceable conversations with the leader or another agent and dictate into either one through the host local STT. The overview keeps the leader history visible; when the leader uses tools and speaks in several stages, Remote waits for the real end of the turn and combines every text block before publishing the reply. Open Team to inspect each agent\'s current focus, recent semantic activity, and bounded coordination totals without exposing internal message bodies or terminal output. On phones, the fixed navigation keeps Overview, Team, Tasks, and Activity available while More opens Huddles and Reviews; task columns become a readable vertical view and every detail screen has an explicit return action. An Administrator can also start or restore an offline agent. Raw terminal control is a separate Administrator-only switch on that device, disabled by default, limited to one responsive terminal, rate-limited, encrypted, and audited. Terminal dictation inserts text without pressing Enter. It never grants file browsing, Portal or mobile-device viewing, or Canvas editing. Revoke a device or stop the session at any time, and inspect accepted and rejected commands in the audit trail.',
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
      ...{"id":"creative-video-workflow","title":"Turn a brief into a video","body":"Create a Codex director, a scene brief and an image workflow. The existing image_gen.imagegen tool makes the character/storyboard references; fal.ai is not used for image generation. Run the existing Codex image workflow. Wait for two validated Image outputs, then inspect the character and scene. Approve the visual identity before requesting a paid video; rejected images are not character masters. Create a five-second video draft without contacting fal or spending credit. The next steps bind the approved character and references before generation. Open Configure access, save the key in the desktop vault, then open Workspace permissions. Enable the workspace, reference uploads and Allow assigned agents to generate videos when delegating. This applies once per workspace and account to every permitted video node, regardless of whether the agent is Claude or Codex. Choose permitted models and budget reservations, then Save. New models and other workspaces are not authorized automatically. Open Character library in the video node. Save appearance and approved image paths, then choose an approved workspace audio reference or an existing provider voice ID with its account and compatible endpoints. Set the language and delivery style. Save, review and Approve and lock. Later edits require New version; agents cannot approve or overwrite a locked version. Open the Images menu, choose Characters, then drag an approved character onto an empty area of the destination Canvas or choose Add to Canvas. The library is shared across local workspaces. Orkestrai copies all frozen images and the voice sample, preserving the exact version and fingerprint, and creates a grouped identity Note and reference Images without changing the source. Provider voice IDs retain their original account binding, but credentials and workspace grants are never copied. Workbench offers the same library and Add to Canvas command. Agents can place approved local characters; importing from another workspace requires the owner. Select an allowed reference-to-video endpoint such as Seedance 2.5, bind the locked character version, and map its image and voice references to the model's input paths. Include dialogue and sound direction, enable native audio and set duration. Save, estimate, inspect outgoing data and reservation, then generate. Unsupported voice mappings or changed references stop before charging. Wait for Completed, play the Video node and download the original. Check the output under generated/videos. Retry download reuses the remote result without regenerating. Your existing Codex image flows are unchanged. Compare face, proportions, wardrobe and voice with the locked masters. Generated does not mean consistency-approved; separate clips are not automatically edited into one movie. Choose an approved character by name: the scene shows its master images and voice sample, and assigns all references to conventional inputs declared by the selected model. No reference is dropped to fit. Advanced input mapping remains available for unusual contracts. Type @ in Direction or use Insert a character reference to insert a saved @{name} alias; the alias stays bound to the exact version ID. Removing a referenced character or using an unknown alias blocks generation instead of silently changing the subject. Agents can request the same conservative mapping with video_workflow_characters command=binding and the current config.\n\nKeep approval history, provider names, source attribution and internal information in Production notes; these stay in the character record and are not appended to generation prompts. Appearance and delivery style are model-visible casting instructions: use only visible traits, accent, timbre and rhythm, not internal commentary or dialogue. Write spoken lines in the scene direction. Inspect the effective prompt and listen to the generated clip; instruction separation does not guarantee model compliance. Create a new version to correct misplaced notes in a locked character.\n\nDrop one or more MP4, M4V, MOV, WebM or MKV files (up to 64 MB each) onto an empty Canvas area. Each becomes a separate Video node at the drop location, with the original filename and playback controls; it is not a knowledge document. Orkestrai copies the unchanged original into .orkestrai/media/videos in the project. In a video workflow, add a Workspace media input, choose a video-compatible model field and select the named Video node. The same node/path is available to agents. Importing never generates or uploads to a provider; the existing consent, account and budget gates apply only when executing a workflow. Container/codec support varies: if local playback is unavailable, download the original; provider-specific reference limits still apply.\n\nEdited video delivery: ask the agent to add renders/final.mp4 to Canvas. With an assigned task it calls video_workflow_import with input.path and optional title/expectedSha256, or orkestrai video import --task <taskId> --input '{\"path\":\"renders/final.mp4\",\"title\":\"Final edit\"}'. Existing MP4/M4V/MOV/WebM/MKV files up to 256 MiB become native Video nodes without copying, transcoding, uploading or paid generation. A repeated import reuses the existing node on the same floor. Local montage renders need no provider key or paid-workspace opt-in. Files outside the configured project require an owner-approved repository alias; absolute paths, traversal and escaping symlinks are rejected. Provider-reference size/codec limits still apply. Removing the node preserves the original file and does not authorize its automatic reuse. The agent must verify the returned node id before declaring delivery. orkestrai list and video_workflow_list show the real project folder (workingDir on the host, wslWorkingDir in WSL). All briefs, prompts, assets, montage projects, renders and final exports belong there unless you explicitly choose another destination. A terminal cd or dropping a file from another folder does not switch the workspace. If the project differs, resolve that mismatch before generating; do not silently write into an old test workspace.","tags":["fal.ai","Canvas","MP4"]},
    },
    {
      id: 'creative-image-workflow',
      title: 'Create a character, apply the brand, and deliver a carousel',
      body: 'Start the guided use case to validate the complete chain without assembling the Canvas manually. As you advance, Orkestrai creates one Codex Creative Director, reusable character and campaign briefs, a sample-logo PNG, and three sequential workflows: Character Master, Branded Character, and XYZ Carousel. Do it for me dispatches each real generation; the tour unlocks the next stage only after validating workspace files and materializing Image nodes. The first output from one stage is automatically connected as an ordered reference for the next, preserving prompts, paths, provenance, and history. The example generates three masters, two branded poses, and three slides for a fast validation; every workflow accepts up to ten outputs. An authenticated Codex account or plan with ImageGen is required, without an OpenAI API key.',
      tags: ['Codex ImageGen', 'character and brand', 'guided carousel'],
    },
    {
      id: 'code-intelligence-graph',
      title: 'Understand a codebase before changing it',
      body: 'Start the guided use case to add one Code Graph node and index every repository explicitly approved for the workspace. Keep the recommended Assisted mode so settled source edits trigger an incremental refresh and every agent read waits for the freshest known revision; choose Manual for user-only explicit indexing or Disabled to stop watchers and block graph access without deleting history. Search a service, component, route, or method, explain a relationship with its provenance, and open the exact symbol in Monaco. Overlay live agents, tasks, and Floors to expose ownership conflicts, then build a reviewed context package within a chosen token budget for the leader, an agent, Council, or a traceable task. Compare revisions and save the project, view, filters, selection, camera, and open source as a named investigation. Contracts, Quality, Semantic, Runtime, and Change impact remain available in the same graph, and agents use the same bounded operations through MCP without loading whole repositories into the conversation.',
      tags: ['Code intelligence', 'operational context', 'multi-repository'],
    },
    {
      id: 'desktop-diagnostics',
      title: 'Diagnose a desktop action that does not respond',
      body: 'Open View > Developer tools and reproduce the problem while watching Console. Then choose Help > Open logs folder and share orkestrai.log with support. The rotating local log includes renderer errors, internal-server failures, and unexpected exits; common credentials are redacted and normal agent output is not persisted.',
      tags: ['Developer tools', 'local logs', 'support'],
    },
  ],
  changelog: [
    {"date":"September 26, 2026 · 0.36.2","title":"Orkestrai 0.36.2: Canvas media and project delivery","summary":"Keep Canvas inventory accurate and let agents deliver existing edited videos inside the configured project.","items":["Keep nodes visible when deletion fails, including partial selections, and preserve connected edges on a storage failure.","Exclude historical media paths from default agent workflow reads. Historical generations require an explicit query; removed media is not automatically reused and project files remain intact.","Let assigned agents add existing edited project videos as playable Canvas nodes without generating, uploading or moving files. Validate format, size and optional hash, preserve project boundaries and reuse existing nodes on retries.","Expose the configured project folder, including distinct host and WSL paths. Keep briefs, prompts, montage sources, renders and final deliverables there by default; changing terminal directories does not change the authenticated workspace."]},
    {"date":"September 26, 2026 · 0.36.1","title":"Orkestrai 0.36.1: Portal access and Canvas fixes","summary":"Restore team access to Portals, import local videos and keep browser surfaces aligned.","items":["Restore Portal use without requiring an enforcing autonomy policy or an assigned task. New and unconfigured Portals allow all workspace agents, including new recruits; explicit access lists, manual/read-only settings, pauses, protected fields, enabled policies and audit trails remain in force.","Drop MP4, M4V, MOV, WebM or MKV files up to 64 MB as native Video nodes with playback and reusable workflow references. Preserve original bytes and leave provider permissions unchanged.","Keep Portal pages behind Canvas controls. Use a temporary in-node preview while dragging, panning, zooming or resizing, then restore the same live page without reloading its session."]},
    {"date":"September 24, 2026 · 0.36.0","title":"Orkestrai 0.36.0: a new Canvas and Workbench experience","summary":"Refreshed native tools, direct manipulation and clearer navigation across desktop and Remote.","items":["Drag creation tools from the Canvas dock and sidebar items into Workbench panes. Reorder flow steps, sequence clips, design layers/pages and collection-runner requests directly.","Start empty workspaces with one-click actions, check image executor readiness and drop references onto empty image nodes.","Refresh Canvas and Workbench with consistent node frames, grouped tools, readable tabs, compact usage meters and keyboard-accessible row actions.","Redesign the native Design toolbar, layer tree, selection controls and property panels, with color swatches, layout controls and multi-selection alignment/Boolean actions.","Unify menus, dialogs, focus indicators, theme-aware surfaces and reduced-motion behavior; improve compact text, contrast, selected states and recovery messages.","Simplify Settings and Provider Center with live sliders, switches and segmented selectors. Improve command search and documentation navigation.","Refine terminal voice controls, notes, Kanban, Git, portals, API collections, creative workflows, automation nodes and Workbench hubs while preserving existing data and agent contracts.","Guide Remote connections with explicit steps, status and recovery hints; keep sharing and connected workspace views consistent.","Update the website and project READMEs with real app recordings and refreshed product showcases.","Accept tool, file and character drops on the empty Canvas, keep Flow execution controls reachable and restore code graph indexing controls.","Prevent clipped collection-runner footers, Git file lists and compact device panels; keep Design selection controls and property values visible.","Restore selected permission/scope states, icon-only tooltips and readable badges across themes; distinguish unavailable usage data from healthy status.","Keep Remote responsive when a shared workspace contains a huddle, and correct misleading labels, translations and empty-state actions."]},
    {"date":"September 24, 2026 · 0.35.0","title":"Orkestrai 0.35.0: Read scanned PDFs with local OCR","summary":"Local OCR makes scanned PDFs searchable by users and agents.","items":["Read scanned and mixed PDF pages offline with bundled English, Portuguese and Spanish OCR, preserving originals and page citations.","Show OCR confidence, encrypted files and partial extraction; automatically reindex older scans and contain parser timeouts in a separate process. Normalize bundled PDF resource paths for Windows, macOS and Linux."]},
    {"date":"September 23, 2026 · 0.34.0","title":"Orkestrai 0.34.0: Second Brain: connected knowledge","summary":"Turn documents and project work into cited, reusable knowledge.","items":["Search native workspace knowledge with citations, tags, backlinks and a separate knowledge graph in Canvas and Workbench.","Import document nodes by dropping PDF, Markdown, XLSX, CSV and other files; retain originals and show extraction/freshness limits explicitly.","Retain provider-independent agent lessons with task reflection, bounded recall and automatic/review/off controls shared by UI, CLI and MCP.","Explore a colored, interactive 2D/3D knowledge network with live workspace and linked-file updates, stable camera/positions, source details and offscreen/idle resource cleanup. Keep hover details available across labels and after dragging a source. Pinch gestures also work when a finger starts over a label."]},
    {"date":"September 23, 2026 · 0.33.0","title":"Orkestrai 0.33.0: more video providers","summary":"Use fal.ai, BytePlus ModelArk or Higgsfield with separate accounts, contracts and budgets.","items":["Add explicit BytePlus ModelArk and Higgsfield video providers alongside fal.ai, with provider-specific contracts, vault accounts and persistent queue routing. Existing fal and Codex image workflows stay compatible.","Expose matching provider/account/model controls, dated public rates and Higgsfield configured account quotes. Preserve required references on explicit provider changes and block unsafe credential routing or duplicate paid retries.","Document provider upload, cancellation and reference limits in all three languages; share contracts with agents, storyboards and guided onboarding.","Stop elastic connections after settling instead of restarting their own animation. Bound non-converging physics, reuse adjacency indexes and defer offscreen image/workflow painting without unloading agents or changing source files.","Show named video references and previews for canvas nodes and standalone project files. Browse project media, expand a reference preview, and keep paths/API mappings under technical details without changing agent bindings. Align account/model controls."]},
    {"date":"September 19, 2026 · 0.32.0","title":"Orkestrai 0.32.0: native video workflows","summary":"Opt-in fal.ai video generation on the existing Canvas and Workbench.","items":["Wait for the Claude message composer before delivering initial roles, Kanban tasks or automatic Enter. Workspace trust dialogs remain under human control instead of accidentally selecting No, exit; readiness timeouts do not claim task delivery.","Separate character production notes and approval/version provenance from generation prompts; distinguish casting instructions from scene dialogue without changing frozen references.","Expose bounded provider descriptions, examples and defaults to users and agents; edit nested model inputs, flag stale parameters after switching endpoints and compare account base prices in the model picker before estimating a run.","Isolate creative forms per mounted dialog so restoring several Canvas nodes cannot reuse character, account, policy, brand or recipe form identifiers. Keep provider settings scrollable with account selection, tabs and actions fixed, including compact windows.","Keep searchable model and reference menus inside the viewport, including workflow inputs near the bottom of a dialog.","Reserve character image and voice inputs when attaching scene media so the editor offers the next available model slots without conflicting with approved identities.","Declare exact workspace media response sizes so voice reference previews can determine their duration without waiting for playback to finish.","Close the video encoder confirmation after approval so the completed download cannot leave the sequence editor blocked behind an overlay.","Search the full fal.ai video catalog, including Seedance 2.5, with model-specific contracts, nested parameters, multiple image/video/audio references and per-workspace model grants. Existing Wan/Kling drafts and Codex image workflows remain compatible.","Configure vault credentials, workspace and model permissions, agent access, outgoing-data consent, estimates, budget reservations and concurrency under existing security gates.","Recover persistent jobs without duplicate paid submissions, cancel tracked work and retry downloads into the project. Manual UI, CLI/MCP, documentation and guided onboarding share the same workflow. Native video/audio files keep their original bytes and each output rechecks filesystem and network permissions. Provider-rejected generation is a failure, not a retryable download; its budget reservation is retained.","Save and owner-lock versioned character appearance and voice references. Reuse immutable, fingerprinted masters through UI and agents; block incompatible voice bindings and silent identity replacement before paid generation. Drag approved characters between workspaces with all visual and voice references, independent local copies and grouped native nodes; credentials and permissions are not transferred. Preview master images and voice, automatically match compatible inputs, and insert named character references without silently dropping assets or changing identities.","Require a protected operating-system credential store and preserve existing credentials when the vault file is unreadable or malformed.","Find curated skills by spaced or hyphenated names even when the online registry is unavailable.","Keep video account settings read-only until loading completes so delayed responses cannot overwrite edits or validation feedback. Keep creative dialog edits and selections stable during workspace refreshes.","Add native storyboards with ordered scenes, dialogue, locked character selections, references and linked image/video drafts. Share revision guards with CLI/MCP; preserve outputs and show stale or missing dependencies without automatic paid execution.","Compare image and video variants with synchronized playback and immutable, hash-bound review history. Changed files invalidate approval; agents can propose but cannot self-approve.","Add contextual image variation, genuine-alpha background removal, annotated changes and animation drafts. Preserve originals and frozen source lineage through the existing Codex image and fal video workflows.","Save shot intent alongside scenes without losing reference or voice bindings.","Version palettes, logos, products and creative rules, then place their exact assets in any workspace.","Save versioned scene briefs with named inputs and recreate editable storyboards without copying execution authority.","Order, trim and caption existing video clips without changing their source files.","Delete workspace-bound policies, audit records, integration events and tools in dependency order without leaving a partially removed Canvas; preserve unrelated workspaces and project files.","Update the serialization dependency to fix denial of service from malformed input."]},
    {"date":"September 16, 2026","title":"Orkestrai 0.31.5: agent communication and terminal selection","summary":"Reliable agent handoffs and precise terminal text selection.","items":["Deliver queued agent messages without waiting for an entire model response. Reciprocal messages unblock waiting callers, Claude mid-turn messages retain their transcript association, and valid completion reports remain available to the leader.","Keep terminal mouse coordinates aligned with Canvas zoom for dragging, word selection and scaled displays."]},
    {
      "date": "September 16, 2026 · 0.31.4",
      "title": "Orkestrai 0.31.4: responsive dictation and terminal recovery",
      "summary": "Prevent indexing stalls, cancel stuck dictation, and preserve each agent's conversation.",
      "items": [
        "Exclude dependency folders and generated build output from code indexing at every depth. Select large file sets deterministically to prevent repeated database rewrites that block terminals and delay microphone startup.",
        "Cancel microphone startup or transcription from the same control in Canvas and Workbench. Stop capture promptly and discard late results after cancellation or navigation. Startup times out after 15 seconds, transcription after three minutes; recording finishes automatically after 15 minutes.",
        "Restore each terminal with its exact conversation. Recovery cannot adopt or stop another agent's PTY, and simultaneous wake requests cannot create duplicate writers."
      ]
    },
    {
      "date": "September 16, 2026 · 0.31.3",
      "title": "Orkestrai 0.31.3: opening project folders",
      "summary": "Open output folders without enabling Computer Control.",
      "items": [
        "Restore agent-requested opening of project and generated-image folders in the system file manager without requiring Computer Control or screen permissions. The dedicated bridge action confines paths to the workspace or approved repositories, authenticates the agent, records an audit trail, and preserves explicit security restrictions."
      ]
    },
    {
      "date": "September 16, 2026 · 0.31.2",
      "title": "Orkestrai 0.31.2: Canvas selection transfers",
      "summary": "Copy and move selections between workspaces again.",
      "items": [
        "Restore copying and moving Canvas selections between workspaces, including large selections of 59 nodes, while preserving internal connections and relative positions. Invalid requests are rejected before changing nodes, with clearer validation feedback.",
        "Restore external file drops: images dropped on empty Canvas become separate persistent reference nodes, while files dropped on an agent become prompt attachments without sending automatically. Recognize protected file drags before drop and preserve every input while uploading.",
        "Save numeric Design edits only once on Enter and wait for pending saves before applying layout, avoiding duplicate revision conflicts."
      ]
    },
    {
      "date": "September 16, 2026 · 0.31.1",
      "title": "Orkestrai 0.31.1: incoming companion messages",
      "summary": "Forwarded messages and media captions reach the authorized companion.",
      "items": [
        "Recognize forwarded desktop messages and media captions from the authorized contact so companions receive their events instead of silently waiting. Preserve message identity and duplicate protection; downloading or transcribing attachments still requires separate authorization."
      ]
    },
    {
      "date": "September 16, 2026 · 0.31.0",
      "title": "Orkestrai 0.31.0: continuous desktop companions",
      "summary": "Conversation monitoring, private memory and scheduled work with owner-controlled access.",
      "items": [
        "Monitor authorized desktop conversations in the background and wake the Canvas agent when new messages arrive. On macOS, optional automatic navigation reopens the approved contact.",
        "Process incoming messages in persistent batches, including after reopening a chat, with complete-draft verification, duplicate-send protection and recovery for interrupted composition.",
        "Configure each companion's persona, language and voice, with optional private conversation memory, sourced preferences, retention controls and deletion.",
        "Let agents create and manage task-linked calendar schedules for reminders and reports, with timezones, recurrence and missed-run handling.",
        "Configure native photo and file delivery, authorized incoming audio transcription, 30 local TTS voice presets and audio playback in the Workbench. Media controls depend on the supported application; synthesized audio is an attachment, not a native voice note.",
        "Keep desktop access scoped to approved applications and contacts, with publication safeguards, auditable actions and automatic cleanup of temporary captures and attachments.",
        "Improve Computer panel reliability, permission feedback and observation controls across Canvas and Workbench. Package the native desktop runtime for each installer architecture.",
        "Update runtime and UI dependencies, harden integration delivery against duplicate retries, and improve the contracts and validation for agent-created tools."
      ]
    },
{
  "date": "September 11, 2026 · 0.30.0",
  "title": "Orkestrai 0.30.0: natural-language desktop work and signed microphone access",
  "summary": "Ask an agent to operate your existing desktop session",
  "items": [
    "Signed macOS apps and helpers now include microphone and Apple Events entitlements. Local packaging and release CI verify the actual signed permissions, not only signature validity and notarization. The STT model is unchanged.",
    "Agents can prepare and connect the workspace Computer node, create their own assigned task without self-dispatch, and open or reuse an approved native application through CLI and MCP. Existing browser windows keep their signed-in session.",
    "Preparation inherits only an existing bounded Computer/app grant and never reactivates an owner-paused node. Application identifiers can be authorized before an app opens, and closed authorized apps remain visible and revocable.",
    "Computer Control uses stable native macOS window IDs, rejects stale or ambiguous windows, verifies focus before input, serializes host input across workspaces, and blocks automatic replay after a possibly partial failure.",
    "Declared email/publication, purchase, credential, or destructive risks use the existing Security gates before native input. Approval is bound to the exact request and attempt. Pixel-only actions still require correct risk classification by the agent.",
    "Native SecretRef delivery suppresses echoed process output and errors; screenshot storage and reads reject paths that escape the workspace through symlinks. Typed content stays out of audit metadata.",
    "Computer state and agent captures refresh in Canvas and Workbench without manual reload. Readiness reflects activation and OS permission. Manual typing stays bound to the selected allowed window; stored captures are read-only evidence, not stale click maps.",
    "Computer inventory collapses identical native window/display records and excludes conflicting identities. Duplicate macOS Finder records no longer crash rendering or leave the loading indicator stuck; failed loads offer retry, and refresh keeps the existing panel visible.",
    "Flow execution waits for pending step edits to be saved in Canvas and Workbench. Failed saves prevent execution instead of starting with stale or missing steps.",
    "Native desktop adapters correct Linux window/PID discovery, Windows PowerShell argument handling, literal text and shortcuts, and macOS display coordinates and capture bounds. Windows desktop commands load only built-in PowerShell modules and preserve argument boundaries. Launch uses registered applications; unsupported targets fail explicitly.",
    "Microphone access is limited to the real app renderer and exact local origin, and the Settings input meter resumes a suspended audio context. Documentation and the guided desktop use case now start from a natural-language agent request, including Remote."
  ]
},
    {
  "date": "September 10, 2026 · 0.29.0",
  "title": "Orkestrai 0.29.0: Persistent agents, visible browser workflows, and reusable tools",
  "summary": "Watch an agent work in your signed-in browser",
  "items": [
    "Background schedulers wait for database migrations on first launch and retry transient database failures without crashing the Core.",
    "RPM installers no longer claim shared build-id paths that conflict with other Electron applications. Linux release validation checks the generated RPM before upload.",
    "Updated the transitive Joi and js-yaml parsers to patched compatible versions; the dependency security audit is clean.",
    "Settings now includes Autonomy & 24/7 Core with background execution, optional start at sign-in, live uptime, process status, automatic recovery count, and a guarded restart command.",
    "Closing every window keeps enabled active work in the system tray; Quit Orkestrai remains the explicit command that stops the Core and its child processes.",
    "The desktop supervisor reconnects after an unexpected Core exit or system resume without creating a second provider writer.",
    "Core discovery metadata is private to the operating-system user, and the health endpoint requires a per-process token that is never exposed to the renderer.",
    "Automation runs are persisted before execution, claimed with renewable leases, checkpointed, retried with bounded backoff, recovered after interruption, and moved to Needs intervention after the final attempt. Closed target agents are started or resumed automatically.",
    "Each provider terminal supports Interactive, On demand, or Persistent lifecycle modes with idle sleep, exact conversation resume, per-agent concurrency and provider-usage safeguards, manual wake/sleep, and Core supervision without a rendered Canvas.",
    "Portal is now a Core-managed browser with persistent workspace/private profiles, host allowlists, workspace-confined files, semantic references, typed actions, durable automations, and attributable evidence without exposing login credentials to agents.",
    "Automations now includes a workspace security plane with standing grants, high-risk approval gates, quiet hours, concurrency limits, immediate emergency stop, encrypted and bound SecretRefs, and a verified hash-chained audit export. Resolved values are redacted before any output metadata is persisted.",
    "The Integration Center now connects Gmail, Slack, Telegram, WhatsApp, GitHub, and HTTPS webhooks through operation-level grants. OAuth and app credentials stay in the operating-system Vault while agents use typed, idempotent actions and sanitized event history.",
    "A native Computer node can inspect and control explicitly approved desktop apps on macOS, Windows, and supported Linux X11 sessions through typed, idempotent commands, bounded screenshot evidence, and content-safe audit records.",
    "Tool Workshop creates reusable versioned workspace tools from integrations, bounded HTTP, deterministic transforms, and confined commands. Agents propose drafts, the owner publishes immutable revisions, automations execute them idempotently, and exact SecretRef bindings keep credentials inside trusted executors.",
    "Tool Workshop forms stay independent across Canvas and side panels, and browser executors use the correct label.",
    "Portal movement now follows Canvas geometry changes without 100 ms polling, repeated tab hiding, or redundant page zoom resets. Codex forwards ephemeral bridge identity to MCP, and quick prompts use the confirmed-submit queue.",
    "Saving autonomy policies, approving gates, and creating SecretRefs now validate their HTTP route parameters correctly.",
    "Browser popups remain embedded in the Portal and preserve their opener instead of opening a separate OS window. Protected screenshots wait for a fresh frame, including during explicitly enabled background control.",
    "Portal agents now operate the same visible native page with named-agent grants, read/interact modes, explicit background opt-in, immediate pause, protected-field masking, stale-reference checks, and no arbitrary scripts. Preauthorized agents can publish bounded browser/integration/HTTP/transform tools; gate resumptions preserve checkpoints and the original revision. Audit details, local webhook setup, and latched emergency stop are explicit in the UI."
  ]
},
    {
      date: 'September 7, 2026 · 0.28.0',
      title: 'Orkestrai 0.28.0: exact social delivery without unsafe cropping',
      summary: 'Image workflows gain explicit delivery profiles and safe areas, while native Windows terminals recover reliable history scrolling.',
      items: [
        'Image workflows now persist Instagram square and portrait, Stories/Reels, TikTok, or bounded custom dimensions across Canvas, Workbench, CLI, and MCP.',
        'ImageGen receives a measurable safe area for the selected frame. Orkestrai preserves the native master and resamples the complete image only when its aspect ratio already matches; incompatible results return to native ImageGen for safe recomposition or outpainting instead of cropping content.',
        'Copying a generated image together with its workflow to another workspace also copies and remaps its native master provenance.',
        'Native Windows PowerShell agent terminals advertise xterm mouse capabilities and isolate wheel events, restoring terminal history scrolling without zooming the Canvas.',
      ],
    },
    {
      date: 'September 7, 2026 · 0.27.0',
      title: 'Orkestrai 0.27.0: the Design editor starts to feel like a design tool',
      summary: 'The artboard now stands apart from the void, selection chrome moved out of the artwork, and the app gained elevation and type scales.',
      items: [
        'The Design canvas now has a ground: a dot grid that scrolls with the content, an artboard with real elevation, and no native scrollbars crossing the drawing surface.',
        'Selecting several layers draws a single bounding box, and resizing shows a live width by height readout while rotating shows a live angle.',
        'Fixed: the built-in marketing and mobile templates no longer start with clipped headlines, and every official template is now tested for text clipping.',
        'Fixed: rapid Canvas and Workbench node setting changes are applied optimistically and persisted in order per node, so a component remount or an earlier save response cannot restore stale values over a field that is still being edited.',
        'Fixed: node header commands keep their clicks isolated from the Canvas after moving to the shared icon button, so running an action cannot trigger an interaction underneath it.',
        'Fixed: the hover outline of the layer under the cursor leaked into every exported SVG, PNG, JPEG, WebP and PDF, into the document thumbnail, and into the reference image that gates visual approval. Editor chrome is now stripped through one shared list, covered by a test that fails when a new marker is left unclassified.',
        'Fixed: moving, adding or deleting a guide silently invalidated a human visual approval; and selection and hover outlines inherited the layer own opacity, blend mode, filter and clipping — selecting something at 20 percent opacity produced an outline at 20 percent.',
        'The inspector follows the order the work needs (Position, Size, Auto layout, Constraints, Appearance, Fill, Stroke, Effects), sets an 11px base, its dropdowns fill their column, and collapsed sections no longer flash open on mount.',
        'Foundation: the light theme now exists in CSS and the chosen theme is restored before the first paint; ten tokens the interface referenced but nobody had defined are now defined, along with elevation and type scales; around five hundred labels at 8 and 9 pixels moved up to a legible size; and the corner radius that clipped the border on every Canvas node was fixed.',
      ],
    },
    {
      date: 'September 7, 2026 · 0.26.1',
      title: 'Orkestrai 0.26.1: reliable Git Floors on WSL',
      summary: 'Windows workspaces backed by WSL now keep every Floor operation inside the selected Linux distribution.',
      items: [
        'Floor creation, Git hooks, previews, landing, removal, status summaries, and code-graph change impact now execute through the workspace WSL runtime instead of Windows Git.',
        'The agent bridge identifies the main . repository, its Git status, and its native or WSL runtime separately from optional additional repository aliases, so an empty alias list is no longer ambiguous.',
      ],
    },
    {
      date: 'September 6, 2026 · 0.26.0',
      title: 'Orkestrai 0.26.0: a professional native Design workspace',
      summary: 'The same Design node now expands into a focused, responsive workspace without losing visual context.',
      items: [
        'A native Git node now manages changes, commit history, branches, tags, remotes, stashes, and Floor worktrees in Canvas and Workbench. Guarded CLI/MCP operations use the same repository revision, require an active assigned task and that agent\'s authenticated live terminal, redact credentials, and execute inside the selected WSL distribution when applicable.',
        'Focus mode occupies the complete app viewport and returns to the exact Canvas node with its revision, selection, active tool, zoom, camera, and panel state preserved.',
        'Guided Design concepts now require literal adherence to the product brief, readable composition at 100 percent, moderate control radii, and a zero-error audit; placeholders, debug labels, arbitrary decoration, and stretched pill controls cannot be treated as finished work.',
        'Focused Design mode disables Canvas deletion shortcuts without registering an empty shortcut, keeping desktop diagnostics free of the repeated renderer warning.',
        'Entering or leaving the focused Design workspace releases focus before hiding the previous surface, preventing inaccessible focused controls and Chromium accessibility warnings.',
        'Kanban assignment waits for a newly recruited agent terminal to reach its first stable prompt, so work cannot appear in progress while its initial handoff was lost during CLI startup.',
        'Duplicating a nested Design layer now preserves the complete hierarchy even when its stored child appears before the parent frame or group.',
        'HTML, Svelte, React, and Vue imports preserve explicit desktop and mobile widths, scoped descendant selectors, inherited typography, complete CSS box padding, content-hugging controls, mixed inline text, standard row flex behavior, flexible remaining space, and absolute mobile navigation and floating actions; the import wrapper expands around the real artwork instead of clipping, overlapping, or compressing it.',
        'An agent remains authenticated to its original native or WSL workspace after changing into a scratch or sibling directory; only the existing workspace-config path is carried by the process, never a copied token.',
        'Creation tools live in a stable bottom toolbar; document, arrangement, view, prototype, and export actions stay in the compact top bar.',
        'Layers, assets, and properties are independently collapsible and become dismissible overlays in narrow Canvas and Workbench surfaces.',
        'Command/Ctrl + wheel zooms around the pointer, while view commands frame all content, frame the selection, or restore 100 percent.',
        'Fit all content and Fit selection use the visible artwork bounds instead of shrinking mostly empty pages to their nominal dimensions.',
        'The themed infinite workspace is visually separate from the actual page background, so distant frames no longer create a giant white scene.',
        'Pages can be created, renamed, duplicated, reordered, activated, and safely deleted; the searchable layer tree supports collapse, inline rename, visibility, lock, precise drag-and-drop reparenting, and context actions.',
        'Command/Ctrl copy, cut, paste, and duplicate preserve complete descendant hierarchies, while typed page operations give connected agents the same revision-safe control through MCP and CLI.',
        'Selection adds hover outlines, nested overlap cycling, direct rotation, Alt/Option measurements, labeled smart guides, and deterministic alignment, distribution, and Tidy Up through the same typed agent contract.',
        'The compact inspector adds calculations and scrub to numeric fields; fixed, hug, fill, min/max, and complete auto layout; rich typography with vertically auto-sizing new text layers; multi-selection editing; and a keyboard-accessible Hex/RGB/HSL color and gradient workflow with alpha, eyedropper, document colors, and variable binding.',
        'The right side now uses focused Design, Prototype, and Inspect tabs. Prototype connections are visible and directly drawable on the canvas, while Inspect centralizes accessibility, tokens, component contracts, Code Connect, Figma origin, artifacts, and copyable CSS.',
        'Connected agents can maintain prototype flows and interactions through typed MCP and CLI operations; agent reviews and quality history open as contextual drawers without replacing layer properties.',
        'Design documents wait for SVG layout before restoring the camera, large prototypes cull off-screen connections while retaining selected endpoints, and collaboration presence stays valid through the Svelar FormRequest route contract.',
        'Confirmation dialogs opened from contextual Design drawers remain above the focused editor and receive pointer input instead of rendering behind the canvas.',
        'Canvas previews regenerate at 2048 px, show only top-level frame labels, and reopen against tight scene bounds instead of blurred artwork or an empty black region.',
        'Guided explorations show an eight-part delivery checklist and block stage completion until the approved direction has its Brand board, required platform frames, typed and bound tokens, components, prototype, applied code artifact, and current visual approval.',
        'Approving a direction records one delivery target, completes the review gate, and automatically dispatches the tracked expansion task when the leader runs the workflow; each completed gate then queues implementation and validation in order, while dispatch failures become visible blockers. Approval stays disabled while the concept task is still editing, and a later revision preserves review metadata while requiring a fresh gate.',
        'The Design MCP publishes the complete component-property contract, fills omitted ordering defaults, and accepts blueprint or raw-operation batches of at most 100 revision-checked items. Versioned comments, replies, resolutions, pending proposals, and page navigation preserve a valid visual review because they do not change the reviewed delivery.',
        'PTY lifecycle events remain linked to the active Kanban task. A resumed terminal looks past disconnect noise to the last semantic task state, clears obsolete attention, and re-dispatches still-active blocked work after the TUI is ready; startup queues this recovery until the Task Board is available. Leaders must recheck the blocker, reconcile provider-native goals, Control Center, and Kanban, execute validation themselves, and only then report completion.',
        'A concept direction now has five minutes for its complete first gate, not only the first revision: one semantic import, at most one corrective mutation, one audit, and then human visual review before any branding system, tokens, components, prototype, or code expansion.',
        'Full-access Codex agents trust only the exact native or WSL workspace for their current process, so task delivery cannot be consumed by the directory-trust bootstrap screen; global Codex configuration and standard-access confirmation remain unchanged.',
        'Leader-run Design exploration creation is atomic: a failed initial handoff removes the newly created brief, designs, tasks, group, and edges instead of leaving a partial workflow on the Canvas.',
        'Windows WSL replies keep waiting for the exact structured transcript when the live PTY already knows its reserved conversation id but UNC-backed node persistence has not caught up; stale ids are repaired from each provider\'s runtime-local home without ever accepting raw TUI output.',
        'Windows packages include a pinned console Node runtime verified by SHA-256. Native and WSL bridge launchers use a real console process instead of the graphical Orkestrai.exe, preserving stdout, stderr, MCP JSON-RPC, and confirmed ask replies; existing WSL workspaces repair their launcher lazily.',
        'Task-scoped asks expire behind older conversations and are cancelled before submission when the task is completed, archived, or reassigned. Late status cannot reopen completed work, completion notices also expire, and a failed dispatch cannot roll back a task that completed concurrently.',
        'A prompt submitted by a person holds the automatic delivery queue until the provider consumes Enter and returns to an idle boundary, so a simultaneous ask, task handoff, or role cannot be appended to the same turn.',
        'API Client HTML visualizers resolve relative media and styles against the credential-free request URL instead of Orkestrai\'s local server, under a bounded sandbox that blocks active content.',
        'Desktop diagnostics omit expected bridge activations, intentional server shutdowns, ordinary browser 404s, and Portal navigation failures already represented by the node state; the updater bypasses a repeatedly failing differential path for the complete SHA-512-verified artifact, and Electron uses its current console event contract while preserving real failures.',
        'API Client compatibility now uses the latest reviewed Bruno filestore, script, and request runtimes, while CI uploads failure diagnostics through the Node 24-compatible artifact action. Production dependencies audit with zero known vulnerabilities after the upgrade.',
      ],
    },
    {
      date: 'September 5, 2026 · 0.25.0',
      title: 'Orkestrai 0.25.0: a complete Remote workspace on every screen',
      summary: 'Remote navigation is reliable on phones, and each agent now has a safe operational work summary.',
      items: [
        'Team shows each agent\'s current focus, recent semantic activity, and bounded sent, received, reply, and failure totals without exposing internal message bodies or terminal output.',
        'The phone navigation keeps Overview, Team, Tasks, and Activity visible while More provides Huddles and Reviews with their attention counts.',
        'Task columns become a readable vertical selector on small screens, while desktop keeps the horizontal board.',
        'Agent dialogs and Huddle rooms have explicit return actions, and safe areas no longer clip headers, composers, navigation, or the full-screen terminal.',
        'Mobile navigation occupies a stable viewport row instead of an independent overlay; Huddle details use the remaining space, text entry avoids Safari page zoom, and the PWA reloads when an upgraded service worker takes control.',
      ],
    },
    {
      date: 'September 5, 2026 · 0.24.2',
      title: 'Orkestrai 0.24.2: confirmed agent message delivery on Windows',
      summary: 'Inter-agent messages now start a real provider turn instead of stopping as pasted text in a terminal composer.',
      items: [
        'Windows and WSL wait for the TUI composer redraw to settle before sending Enter, preventing the key from overtaking a pasted prompt.',
        'A terminal redraw no longer counts as delivery: Orkestrai confirms the exact prompt in the provider transcript and retries only Enter within a bounded window when needed.',
        'Direct questions, one-way handoffs, Kanban assignments and completion notices, roles, routines, and design reviews now use the same confirmed delivery path.',
        'WSL sessions preserve their distribution-specific transcript home and Linux working directory for both delivery acknowledgement and exact reply correlation.',
      ],
    },
    {
      date: 'September 4, 2026 · 0.24.1',
      title: 'Orkestrai 0.24.1: secure dependencies and CI-gated releases',
      summary: 'The dependency baseline is secure again, terminal packaging is deterministic, and a failing CI can no longer publish a desktop release.',
      items: [
        'Patched dependencies resolve the Faker, fast-uri, qs, and xmldom advisories while preserving every supported Postman dynamic variable and the Bruno and Postman script runtimes.',
        'Clean macOS and Linux installs restore the executable permission required by the node-pty spawn helper, preventing terminal startup failures caused by package extraction modes.',
        'Shell terminals select an installed host shell instead of assuming that zsh exists, including when an older workspace is reopened on another platform.',
        'The attention counter maintains WCAG AA contrast in the light and dark themes.',
        'Embedded STT and TTS now use sherpa-onnx-node 1.13.7 with the matching official native packages for macOS, Linux, and Windows.',
        'CI now runs the complete Playwright end-to-end suite alongside the dependency audit, unit tests, and production build. Local preflight and Release Desktop both require that exact commit to pass before a tag can publish platform artifacts.',
      ],
    },
    {
      date: 'September 4, 2026 · 0.24.0',
      title: 'Orkestrai 0.24.0: move complete Canvas selections between workspaces',
      summary: 'Reuse a connected working setup without rebuilding nodes or carrying unsafe runtime state.',
      items: [
        'Select up to 100 Canvas nodes and copy or move them to another workspace while preserving relative layout and every connection whose two endpoints are selected.',
        'Note attachments, image files, and native Design documents are copied into the destination; terminals keep configuration and saved commands but begin a clean conversation, while API credentials and execution history remain detached.',
        'Move commits the destination before removing the source and blocks active routines, running image workflows, missing files, and duplicate mobile-device nodes with actionable feedback.',
      ],
    },
    {
      date: 'September 2, 2026 · 0.23.0',
      title: 'Orkestrai 0.23.0: operational code intelligence and reliable continuity',
      summary: 'Fresh shared code context joins resilient sessions, voice capture, Portal tabs, and collision-free canvas workflows.',
      items: [
        'After sleep, hibernation, or a renderer reload, each agent reattaches to the one live PTY for its workspace node instead of opening a second writer for the same provider conversation.',
        'Reload, provider/runtime changes, dismissal, deletion, workspace unload, parent disconnect, and desktop shutdown terminate the complete provider process group; a lost node binding is recovered from the exact conversation id.',
        'Dictation captures at the microphone native 44.1/48 kHz rate, chooses the active channel, resamples only afterward, and can recover the same take from a browser fallback when Electron Web Audio emits no samples.',
        'Payload updates are truly partial and live refresh protects a current drag, so image progress or session state can no longer restore stale node coordinates or dimensions.',
        'Image workflows and agent-created nodes use collision-aware placement against real node rectangles, including every generated output and reference.',
        'Notes created by agents through CLI or MCP connect only to their exact author by default, keeping parallel creative and engineering flows isolated unless a specific agent or the complete team is explicitly selected.',
        'Organize canvas always arranges the complete visible graph into deterministic non-overlapping rows, keeps groups intact, and works even when one node remains selected.',
        'Canvas connections can now use Adaptive, Elastic and animated, or Static rendering from Settings. Dense adaptive canvases drop idle rope simulations earlier, while Static disables all edge physics and animation for lower-power hardware.',
        'Code Intelligence now offers Assisted, Manual, and Disabled workspace modes. Assisted watches settled edits, refreshes structural and semantic indexes incrementally, reuses unchanged vectors, and makes agent reads wait for the freshest known revision; Manual keeps explicit indexing for the user and blocks agents; Disabled stops watchers and access without deleting local history.',
        'The graph keeps mouse, touch, wheel, visible canvases, and pointer picking aligned through both outer Canvas zoom and node resizing. Symbols have larger, scale-aware labels; click selects, centers, and opens context, double-click focuses closer, and double-clicking empty space no longer performs a blind zoom. Repository scopes, Change impact, lexical search, and semantic intent search also explain their actions directly.',
        'Portal links that request a foreground or background tab now create a second non-overlapping Portal node in the same Canvas. True authentication and payment pop-ups remain sandboxed child windows to preserve window.opener and the persistent session.',
        'Restored MCP and CLI sessions without ORKESTRAI_NODE_ID can report Control Center state through a task assigned to their real workspace agent; calls without either verified identity source remain blocked.',
        'The native Code Intelligence Graph safely indexes approved TypeScript, JavaScript, Svelte, and PHP repositories, provides atomic searchable revisions and bounded relationship traversal, overlays Git and active Floor changes with affected symbols, likely tests, and conflicts, creates traceable Review Center or Kanban handoffs, renders theme-aware labels in Canvas and Workbench, and exposes the same graph to agents through typed CLI and MCP tools.',
        'Its Contracts view joins backend endpoints, frontend calls, generated clients, OpenAPI or Swagger schemas, gateway prefixes, and live API Client requests across approved repositories, highlighting unmatched calls and route conflicts without retaining hosts, query values, headers, or credentials.',
        'Its Quality view adds confidence-scored evidence for duplication, import cycles, coupling, inferred layer violations, oversized code, security-sensitive execution, possible dead code, and static environment/file/network/database/IPC flows without retaining values, payloads, hosts, query strings, or source bodies.',
        'Its offline Semantic index adds intent search without an API key, model download, or external code transfer. Assisted mode now keeps it current automatically, while Manual retains explicit Build and Rebuild controls.',
        'Its Runtime view imports confined LCOV, JUnit, traceback, or structured JSON evidence and overlays coverage, failures, observed calls, and runtime-only relationships without persisting raw output.',
        'Code Intelligence accepts approved repositories with no supported source files as a valid empty graph, and the Index code action keeps readable contrast across every theme.',
        'Code graph watchers observe only supported source and contract files, ignore sockets and other special entries, and contain filesystem errors without terminating the app.',
        'Code graph scans read supported files with bounded concurrency and revision stats separate scan, parse, resolution, persistence, cache hits, cache misses, changed files, and indexing strategy. Empty roots keep no recursive watcher; resource-limit failures mark the graph stale and retry after a bounded backoff instead of showing healthy data.',
        'The reproducible code-graph benchmark validates the Orkestrai repository, a temporary full mirror, and a synthetic repository against the documented SQLite search, traversal, and single-file incremental gates; the real 1,672-file mirror stays below the two-second incremental target, so no alternate graph database is justified.',
        'Workspace and preset instructions now use a bounded managed block in AGENTS.md and, when enabled, CLAUDE.md. Existing user content is preserved, legacy Orkestrai-owned files migrate safely, and disabling synchronization removes only that block.',
        'Operational Code Intelligence explains relationship provenance, synchronizes graph and Monaco selection, overlays live agents, tasks, and Floors with ownership conflicts, and builds reviewed 500–16,000-token context packages for the leader, an agent, Council, or a traceable task.',
        'Compact retained revision manifests enable structural comparison, while named investigations restore the exact project, view, filters, selection, camera, and open source across Canvas, Workbench, CLI, and MCP.',
        'Bounded context previews, operational handoffs, and named investigation saves now accept their strict validated payloads without treating Svelar workspace route parameters as unexpected user input.',
        'Returning from Workbench restores the same Code Intelligence project, view, query mode, selected symbol, traversal settings, and graph camera instead of resetting the investigation.',
        'Live work keeps disconnected agents with in-progress tasks visible with their task, files, and symbols, while excluding them from new handoff targets.',
      ],
    },
    {
      date: 'Aug 28, 2026 · 0.22.0',
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
        'Transparent workflows validate decoded PNG alpha pixels. With multiple references, ImageGen first composes on a uniform white matte and removes it in a second native edit; the proven checkerboard-cutout prompt supplies another native fallback, never Python or local pixel manipulation. Stalled runs expire instead of leaving the guided tour waiting indefinitely.',
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
        'Large Design documents now expand around every frame instead of clipping artwork to the nominal page. Use trackpad or scroll, the Hand tool (H), Space-drag, or the middle mouse button to move across the workspace; Fit frames all content and zoom reaches 2%. Exports and thumbnails include the same complete bounds. Connected agents consult design_reference once, create up to 2,000 layers with design_create_elements, then expand the approved direction through revision-checked design_apply_blueprint batches of at most 100 tokens, bindings/components, or prototype/motion items. Guided explorations explicitly prohibit installation inspection, schema probes, and scratch discovery scripts.',
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
