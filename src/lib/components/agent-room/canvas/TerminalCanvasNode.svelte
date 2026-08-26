<script lang="ts">
  import { untrack } from 'svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import { ArrowLeftRight, BadgeCheck, Ellipsis, Globe2, History, ListRestart, MonitorCog, Paperclip, RotateCcw, Scale, SendHorizontal, SquareTerminal, Star, SwatchBook, UserRound, X } from '@lucide/svelte';
  import { toast } from '@beeblock/svelar/ui';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import type { AgentRole } from '$lib/modules/agent-room/application/services/RoleService.js';
  import NodeShell from './NodeShell.svelte';
  import TerminalNode from '../TerminalNode.svelte';
  import VoiceConfirmDialog from '../VoiceConfirmDialog.svelte';
  import { appSettingsStore, getAppSettings, updateAppSettings } from '../app-settings.svelte.js';
  import { getCsrfToken } from '@beeblock/svelar/http';
  import { voiceModelsReadyForUse } from '../voice-model-status.js';
  import { speakText } from '../voice-speech.js';
  import { terminalThemeLabel } from '../terminal-theme-label.js';
  import { normalizeTerminalTheme, TERMINAL_THEMES, TERMINAL_THEME_ORDER, type TerminalThemeName } from '../terminal-themes.js';
  import type { AgentProviderInfo, ProviderProfile, TerminalNodePayload, WorkspaceAttachment, WorkspaceExecutionRuntime } from '$lib/modules/agent-room/domain/types.js';
  import { providerIcons } from '$lib/modules/agent-room/domain/provider-icons.js';
  import * as m from '$lib/paraglide/messages.js';
  import {
    attachmentPromptReference,
    attachmentsFromTransfer,
    transferHasWorkspaceAttachments,
    uploadWorkspaceAttachment,
  } from '../workspace-attachments.js';
  import CouncilDialog from '../CouncilDialog.svelte';
  import TerminalRuntimeDialog from './TerminalRuntimeDialog.svelte';
  import TerminalCommandsDialog from './TerminalCommandsDialog.svelte';
  import {
    normalizeSavedTerminalCommands,
    resumeTerminalCommandInput,
    savedTerminalCommandInput,
    terminalCommandFingerprint,
    type SavedTerminalCommand,
  } from '$lib/modules/agent-room/domain/terminal-commands.js';

  export type MentionTarget = { id: string; title: string; type: string };

  export type TerminalNodeData = {
    title: string;
    workingDir: string;
    workspaceRoot: string;
    executionRuntime: WorkspaceExecutionRuntime;
    workspaceRuntime: WorkspaceExecutionRuntime;
    workspaceId: string;
    payload: TerminalNodePayload;
    /** Avalia os args de resume do provider NA HORA do respawn. */
    resumeArgsFor?: () => string[] | null;
    /** Avalia os args de resume exato por session-id NA HORA do respawn. */
    exactResumeArgsFor?: (agentSessionId: string) => string[] | null;
    /** Template que reserva um id novo na CLI e elimina races entre agentes. */
    freshSessionArgsFor?: () => string[] | null;
    sessionStorageFor?: () => string | null;
    onAgentSessionFound?: (id: string, agentSessionId: string) => void;
    /** Promise da pagina: providers carregados (para o respawn nao correr a race). */
    providersReady?: Promise<void>;
    providers?: AgentProviderInfo[];
    onProviderChange?: (id: string, provider: string, profileId?: string | null, profileLabel?: string | null) => Promise<void>;
    onRuntimeChange?: (id: string, selection: { mode: 'default' | 'native' | 'wsl'; wslDistribution: string | null; wslWorkingDir: string | null }) => Promise<void>;
    onRoleChange?: (id: string, role: string | null) => void;
    onDelete: (id: string) => void;
    onResize?: (id: string, params: { x: number; y: number; width: number; height: number }) => void;
    onSessionCreated: (id: string, sessionId: string, options: { resumed: boolean }) => void | Promise<void>;
    onToggleMaestro?: (id: string) => void;
    onOpenFile?: (path: string) => void;
    onThemeChange?: (id: string, theme: TerminalThemeName) => void;
    onPayloadChange?: (id: string, partial: Record<string, unknown>) => void | Promise<void>;
    onRename?: (id: string, title: string) => void;
    /** Nome do workspace (notificacao de fim de sessao). */
    workspaceName?: string;
    /** Edge conversando (broadcast da bridge) — vem da pagina do canvas. */
    onTalking?: (payload: { from: string | null; to: string; talking: boolean }) => void;
  };

  let { id, data, selected } = $props<NodeProps & { data: TerminalNodeData }>();
  let terminalNode = $state<{ focus: () => void; write: (input: string) => void } | undefined>();
  let ownsCreatedSession = $state(untrack(() => !data.payload.sessionId));
  let restartGeneration = $state(0);

  // Quando a sessao morre (restart do app), recria com os args de resume do
  // provider para retomar o contexto da conversa anterior.
  let forceRespawn = $state(false);
  /** Session-id descoberto no momento do respawn (cobre o caso do watch ter
      expirado antes da primeira mensagem — Claude grava o jsonl so na 1a msg). */
  let respawnAgentSessionId = $state<string | null>(null);
  let councilOpen = $state(false);
  let runtimeOpen = $state(false);
  let commandsOpen = $state(false);
  let actionsOpen = $state(false);
  let runtimeProviders = $state<AgentProviderInfo[]>([]);
  let providerRequest = 0;
  const isWindows = typeof navigator !== 'undefined' && navigator.platform.startsWith('Win');
  const isPureShell = $derived(!data.payload.provider);
  const isPureNativeShell = $derived(!data.payload.provider && data.executionRuntime.kind === 'native');
  const launchWorkingDir = $derived(
    isPureNativeShell && data.payload.currentWorkingDir
      ? data.payload.currentWorkingDir
      : data.workingDir
  );

  $effect(() => {
    if (!actionsOpen) return;
    loadRoles();
    void loadProfiles();
    void getAppSettings();
  });

  function persistWorkingDirectory(cwd: string) {
    if (!isPureNativeShell || !cwd || cwd === data.payload.currentWorkingDir) return;
    data.onPayloadChange?.(id, { currentWorkingDir: cwd });
  }

  $effect(() => {
    const runtimeKey = data.executionRuntime.kind === 'wsl'
      ? `wsl:${data.executionRuntime.distribution}:${data.executionRuntime.linuxWorkingDir}`
      : 'native';
    void runtimeKey;
    runtimeProviders = data.providers ?? [];
    if (!(data.payload as TerminalNodePayload).executionRuntime) return;
    const request = ++providerRequest;
    void fetch(`/api/agent-room/status?workspaceId=${encodeURIComponent(data.workspaceId)}&nodeId=${encodeURIComponent(id)}`)
      .then((response) => response.json())
      .then((result) => {
        if (request === providerRequest && Array.isArray(result.data?.providers)) runtimeProviders = result.data.providers;
      })
      .catch(() => undefined);
  });

  async function resolveRespawn() {
    const payload = data.payload as TerminalNodePayload & { provider?: string };
    // Espera os providers carregarem — sem eles o respawn sairia sem os args
    // de resume (race no restart do app: attach falha antes do status voltar).
    await (data.providersReady ?? Promise.resolve());
    if (!respawnAgentSessionId && payload.provider && !payload.agentSessionId) {
      try {
        const response = await fetch(
          `/api/agent-room/sessions/latest?provider=${encodeURIComponent(payload.provider)}&cwd=${encodeURIComponent(data.workingDir)}&workspaceId=${encodeURIComponent(data.workspaceId)}&nodeId=${encodeURIComponent(id)}`
        );
        const result = await response.json();
        respawnAgentSessionId = result.data?.agentSessionId ?? null;
        if (respawnAgentSessionId) data.onAgentSessionFound?.(id, respawnAgentSessionId);
      } catch {
        // Sem um id confirmado, WSL inicia limpo em vez de adivinhar a
        // conversa mais recente de outra distribuicao ou terminal.
      }
    }
    ownsCreatedSession = false;
    forceRespawn = true;
  }

  async function persistCreatedSession(sessionId: string) {
    const payload = data.payload as TerminalNodePayload;
    const resumed = forceRespawn || Boolean(payload.agentSessionId) || Boolean(payload.resumeRecovery);
    ownsCreatedSession = true;
    await data.onSessionCreated(id, sessionId, { resumed });
    // Mantem o terminal criador montado ate o payload persistido apontar para
    // a nova sessao; liberar antes reanexaria por um instante ao id antigo.
    forceRespawn = false;
    if (selected) requestAnimationFrame(() => requestAnimationFrame(() => terminalNode?.focus()));
  }

  function terminalCommands(): SavedTerminalCommand[] {
    return normalizeSavedTerminalCommands((data.payload as TerminalNodePayload).savedCommands);
  }

  function globalCommands(): SavedTerminalCommand[] {
    return normalizeSavedTerminalCommands(appSettingsStore.values.terminalGlobalCommands);
  }

  async function openSavedCommands() {
    commandsOpen = true;
    await getAppSettings(true);
  }

  async function saveTerminalCommands(commands: SavedTerminalCommand[]) {
    await data.onPayloadChange?.(id, { savedCommands: normalizeSavedTerminalCommands(commands) });
  }

  async function saveGlobalCommands(commands: SavedTerminalCommand[]) {
    await updateAppSettings({ terminalGlobalCommands: JSON.stringify(normalizeSavedTerminalCommands(commands)) });
  }

  function runSavedCommand(command: SavedTerminalCommand) {
    terminalNode?.write(savedTerminalCommandInput(command.command));
    toast.success(m['term.commands_executed']());
    requestAnimationFrame(() => terminalNode?.focus());
  }

  async function handleSessionReady(sessionId: string) {
    if (!isPureShell || !sessionId || !terminalNode) return;
    await getAppSettings();
    const input = resumeTerminalCommandInput(
      [...globalCommands(), ...terminalCommands()],
      data.payload.command ?? '',
    );
    if (!input) return;
    const marker = `orkestrai.terminal-autoexec:${id}:${terminalCommandFingerprint(input)}`;
    try {
      if (sessionStorage.getItem(marker)) return;
      sessionStorage.setItem(marker, '1');
    } catch {
      // A sessão do terminal ainda executa; só perde a proteção entre views.
    }
    terminalNode.write(input);
  }

  // -- Recarregar terminal (reinicia a sessao COM o contexto) -------------------
  async function reloadTerminal() {
    await fetch(`/api/agent-room/workspaces/${data.workspaceId}/nodes/${id}/reload`, { method: 'POST' }).catch(() => {});
    // sessionId null no payload -> o no cai no caminho de criacao, que usa o
    // resume exato (agentSessionId permanece no payload).
    ownsCreatedSession = false;
    forceRespawn = true;
    restartGeneration += 1;
    data.onPayloadChange?.(id, { sessionId: null });
  }

  // -- Role do terminal ---------------------------------------------------------
  let roles = $state<AgentRole[]>([]);
  let rolesLoaded = false;

  const currentRole = $derived((data.payload as TerminalNodePayload).role ?? null);
  /** Role exibida no header: curta (o nome completo fica no dropdown/aria). */
  const roleLabel = $derived(currentRole && currentRole.length > 24 ? `${currentRole.slice(0, 23).trimEnd()}…` : currentRole);
  const currentProvider = $derived((data.payload as TerminalNodePayload).provider ?? null);
  const currentProfileId = $derived((data.payload as TerminalNodePayload).profileId ?? null);
  const availableProviders = $derived(runtimeProviders.length ? runtimeProviders : (data.providers ?? []));
  const currentProviderStrategy = $derived(availableProviders.find((provider) => provider.id === currentProvider)?.profileStrategy ?? null);
  const runtimeOverride = $derived((data.payload as TerminalNodePayload).executionRuntime ?? null);
  const runtimeTitle = $derived(
    data.executionRuntime.kind === 'wsl'
      ? `WSL · ${data.executionRuntime.distribution}`
      : m['dlg.runtime_native'](),
  );
  const currentTheme = $derived(normalizeTerminalTheme((data.payload as TerminalNodePayload).theme));
  const createSessionKey = $derived([
    restartGeneration,
    data.payload.command,
    data.payload.provider ?? '',
    currentProfileId ?? '__default__',
    JSON.stringify(data.payload.args ?? []),
    data.executionRuntime.kind === 'wsl'
      ? `${data.executionRuntime.distribution}:${data.executionRuntime.linuxWorkingDir}`
      : 'native',
  ].join(':'));
  let switchingProvider = $state(false);
  let providerError = $state('');

  async function changeProvider(provider: string, profileId: string | null = null, profileLabel: string | null = null) {
    if (!provider || (provider === currentProvider && profileId === currentProfileId) || switchingProvider) return;
    switchingProvider = true;
    providerError = '';
    try {
      forceRespawn = false;
      respawnAgentSessionId = null;
      await data.onProviderChange?.(id, provider, profileId, profileLabel);
    } catch {
      providerError = m['term.provider_switch_error']();
      setTimeout(() => (providerError = ''), 6_000);
    } finally {
      switchingProvider = false;
    }
  }

  // -- Perfis de multi-conta (por provider) --------------------------------------
  let profiles = $state<ProviderProfile[]>([]);
  let profilesLoadedForProvider: string | null = null;

  async function loadProfiles() {
    if (!currentProvider || profilesLoadedForProvider === currentProvider) return;
    profilesLoadedForProvider = currentProvider;
    try {
      const response = await fetch(`/api/agent-room/provider-profiles?providerId=${encodeURIComponent(currentProvider)}`);
      const payload = await response.json();
      profiles = payload.data ?? [];
    } catch {
      profiles = [];
    }
  }

  async function changeProfile(profileId: string | null) {
    if (!currentProvider) return;
    const profileLabel = profileId ? profiles.find((profile) => profile.id === profileId)?.name ?? null : m['term.profile_default']();
    await changeProvider(currentProvider, profileId, profileLabel);
  }

  async function changeRuntime(selection: { mode: 'default' | 'native' | 'wsl'; wslDistribution: string | null; wslWorkingDir: string | null }) {
    forceRespawn = false;
    respawnAgentSessionId = null;
    await data.onRuntimeChange?.(id, selection);
  }

  async function loadRoles() {
    if (rolesLoaded) return;
    rolesLoaded = true;
    try {
      const response = await fetch(`/api/agent-room/workspaces/${data.workspaceId}/roles`);
      const payload = await response.json();
      roles = payload.data ?? [];
    } catch {
      roles = [];
    }
  }

  async function assignRole(role: string | null) {
    data.onRoleChange?.(id, role);
    // Se ja tem sessao viva, injeta o prompt da role imediatamente.
    if (role && (data.payload as TerminalNodePayload).sessionId) {
      await fetch(`/api/agent-room/workspaces/${data.workspaceId}/roles/apply`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(getCsrfToken() ? { 'X-CSRF-Token': getCsrfToken()! } : {}),
        },
        body: JSON.stringify({ nodeId: id, mode: 'role' }),
      }).catch(() => {});
    }
  }

  // -- Composer com @mencoes ---------------------------------------------------
  let prompt = $state('');
  let mentionOpen = $state(false);
  let mentionFilter = $state('');
  let mentionTargets = $state<MentionTarget[]>([]);
  let promptInput: HTMLInputElement;
  let attachmentInput: HTMLInputElement;
  let attachmentBusy = $state(false);
  let attachmentDropActive = $state(false);
  let attachmentError = $state('');

  const filteredMentions = $derived(
    mentionTargets.filter((target) => target.title.toLowerCase().includes(mentionFilter.toLowerCase())).slice(0, 8)
  );

  async function loadMentions() {
    if (mentionTargets.length) return;
    try {
      const response = await fetch(`/api/agent-room/workspaces/${data.workspaceId}/nodes`);
      const payload = await response.json();
      mentionTargets = (payload.data ?? [])
        .filter((node: { id: string; type: string }) => node.id !== id && ['terminal', 'note', 'portal'].includes(node.type))
        .map((node: { id: string; type: string; title: string | null }) => ({
          id: node.id,
          title: node.title ?? node.type,
          type: node.type,
        }));
    } catch {
      mentionTargets = [];
    }
  }

  async function handlePromptInput() {
    const match = prompt.match(/@([\w .-]*)$/);
    if (match) {
      mentionFilter = match[1];
      mentionOpen = true;
      await loadMentions();
    } else {
      mentionOpen = false;
    }
  }

  function insertMention(target: MentionTarget) {
    prompt = prompt.replace(/@([\w .-]*)$/, `@${target.title} `);
    mentionOpen = false;
    promptInput?.focus();
  }

  async function sendPrompt() {
    const text = prompt.trim();
    if (!text) return;
    const sessionId = (data.payload as TerminalNodePayload).sessionId;
    if (!sessionId) return;
    prompt = '';
    await fetch(`/api/agent-room/workspaces/${data.workspaceId}/terminals/${id}/write`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(getCsrfToken() ? { 'X-CSRF-Token': getCsrfToken()! } : {}),
      },
      body: JSON.stringify({ data: `${text}\r` }),
    }).catch(() => {});
  }

  function handlePromptKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !mentionOpen) {
      event.preventDefault();
      sendPrompt();
      return;
    }
    if (event.key === 'Escape') {
      mentionOpen = false;
      return;
    }
    if (mentionOpen && event.key === 'Tab' && filteredMentions.length) {
      event.preventDefault();
      insertMention(filteredMentions[0]);
    }
  }

  function appendPromptAttachments(attachments: WorkspaceAttachment[]) {
    if (!attachments.length) return;
    const references = attachments.map(attachmentPromptReference).join(' · ');
    prompt = `${prompt.trim()}${prompt.trim() ? ' · ' : ''}${references}`;
    promptInput?.focus();
  }

  function handleAttachmentDragOver(event: DragEvent) {
    if (!transferHasWorkspaceAttachments(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    attachmentDropActive = true;
  }

  async function handleAttachmentDrop(event: DragEvent) {
    if (!event.dataTransfer || !transferHasWorkspaceAttachments(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    attachmentDropActive = false;
    attachmentBusy = true;
    attachmentError = '';
    try {
      appendPromptAttachments(await attachmentsFromTransfer(data.workspaceId, event.dataTransfer));
    } catch (error) {
      attachmentError = error instanceof Error && error.message === 'attachment_too_large'
        ? m['attachment.too_large']()
        : m['attachment.error']();
    } finally {
      attachmentBusy = false;
    }
  }

  async function handleAttachmentFiles(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    attachmentBusy = true;
    attachmentError = '';
    try {
      const attachments: WorkspaceAttachment[] = [];
      for (const file of files) attachments.push(await uploadWorkspaceAttachment(data.workspaceId, file));
      appendPromptAttachments(attachments);
    } catch (error) {
      attachmentError = error instanceof Error && error.message === 'attachment_too_large'
        ? m['attachment.too_large']()
        : m['attachment.error']();
    } finally {
      attachmentBusy = false;
    }
  }

  // -- Voz de volta (TTS pt-BR) ------------------------------------------------
  /** Le respostas de asks destinadas a este no em voz alta (toggle no header). */
  let voiceOn = $state(false);
  let voiceError = $state('');
  let voiceConfirmOpen = $state(false);
  let checkingVoiceModels = false;

  async function toggleVoice() {
    if (voiceOn) {
      voiceOn = false;
      return;
    }
    if (checkingVoiceModels) return;
    checkingVoiceModels = true;
    try {
      if (!(await voiceModelsReadyForUse(await getAppSettings(true)))) {
        voiceConfirmOpen = true;
        return;
      }
      voiceOn = true;
    } catch {
      voiceError = m['voice.model_status_error']();
      setTimeout(() => (voiceError = ''), 6_000);
    } finally {
      checkingVoiceModels = false;
    }
  }

  function handleAgentReply(payload: { to: string; from: string | null; text: string }) {
    if (payload.to !== id || !voiceOn || !payload.text.trim()) return;
    voiceError = '';
    speakText(payload.text, appSettingsStore.values.audioOutputDeviceId).catch((error) => {
      voiceError = error instanceof Error ? error.message : m['term.voice_error']();
      setTimeout(() => (voiceError = ''), 6_000);
    });
  }

  // Resume exato quando temos o session-id real da CLI; senao, fallback
  // para "a sessao mais recente do diretorio".
  const agentEnv = $derived({
    ...((data.payload as TerminalNodePayload).env ?? {}),
    ORKESTRAI_NODE_ID: id,
    ORKESTRAI_AGENT_TITLE: data.title,
  });
  const respawnRequest = $derived.by(() => {
    const payload = data.payload as TerminalNodePayload & { agentSessionId?: string };
    const exactId = payload.agentSessionId ?? respawnAgentSessionId;
    const exactArgs = exactId ? (data.exactResumeArgsFor?.(exactId) ?? null) : null;
    if (exactArgs) {
      return {
        command: data.payload.command ?? '',
        args: [...(data.payload.args ?? []), ...exactArgs],
        cwd: launchWorkingDir,
        env: agentEnv,
        profileId: currentProfileId,
        runtime: data.executionRuntime,
        workspaceRoot: data.workspaceRoot,
      };
    }
    const genericArgs = data.executionRuntime.kind === 'wsl' ? null : (data.resumeArgsFor?.() ?? null);
    return {
      command: data.payload.command ?? '',
      args:
        genericArgs && genericArgs.length
          ? [...(data.payload.args ?? []), ...genericArgs]
          : (data.payload.args ?? []),
      freshSessionArgs: !exactId && (!genericArgs || genericArgs.length === 0)
        ? (data.freshSessionArgsFor?.() ?? undefined)
        : undefined,
      cwd: launchWorkingDir,
      env: agentEnv,
      profileId: currentProfileId,
      runtime: data.executionRuntime,
      workspaceRoot: data.workspaceRoot,
    };
  });

  /**
   * Request de criacao quando NAO ha sessao para attachar. Apos o Descarregar
   * (sessionId removido do payload), agentes com session-id conhecido voltam
   * COM resume — mesmo comportamento do restart do app. Agentes novinhos
   * (sem agentSessionId) e shells continuam nascendo limpos.
   */
  const createRequest = $derived.by(() => {
    const payload = data.payload as TerminalNodePayload & { provider?: string; agentSessionId?: string };
    if (forceRespawn || (payload.provider && (payload.agentSessionId || payload.resumeRecovery))) return respawnRequest;
    return {
      command: payload.command ?? '',
      args: [...(payload.args ?? []), ...(payload.initialRoleArgs ?? [])],
      freshSessionArgs: data.freshSessionArgsFor?.() ?? undefined,
      cwd: launchWorkingDir,
      env: agentEnv,
      profileId: currentProfileId,
      runtime: data.executionRuntime,
      workspaceRoot: data.workspaceRoot,
    };
  });
</script>

<NodeShell
  {id}
  {selected}
  class="canvas-terminal"
  accent="var(--app-accent)"
  minWidth={360}
  minHeight={220}
  onResize={data.onResize}
  connections={data.connections ?? []}
  titleText={data.title}
  onRename={data.onRename}
  onJumpToNode={data.onJumpToNode}
  onRemoveConnection={data.onRemoveConnection}
>
  {#snippet icon()}
    {#if currentProvider && providerIcons[currentProvider]}
      <span class="terminal-provider-mark"><img src={providerIcons[currentProvider]} width="13" height="13" alt="" /></span>
    {:else}
      <SquareTerminal size={13} />
    {/if}
  {/snippet}
  {#snippet title()}{data.title}{/snippet}
  {#snippet actions()}
    {#if runtimeOverride}
      <span class="terminal-status-chip" role="status" title={runtimeTitle} aria-label={runtimeTitle}>
        <MonitorCog size={12} />
        <span>{data.executionRuntime.kind === 'wsl' ? 'WSL' : 'WIN'}</span>
      </span>
    {/if}
    {#if currentRole}
      <span class="terminal-status-chip" role="status" title={m['term.role_label']({ role: currentRole })} aria-label={m['term.role_label']({ role: currentRole })}>
        <BadgeCheck size={12} />
        <span>{roleLabel}</span>
      </span>
    {/if}
    {#if data.payload.maestro}
      <span class="terminal-leader-state" role="img" title={m['term.maestro_active']()} aria-label={m['term.maestro_active']()}>
        <Star size={12} fill="currentColor" />
      </span>
    {/if}
    <DropdownMenu.Root bind:open={actionsOpen}>
      <DropdownMenu.Trigger
        class="node-action-btn"
        aria-label={m['term.actions']()}
        title={m['term.actions']()}
        disabled={switchingProvider}
        data-testid="terminal-actions-menu"
      >
        <Ellipsis size={15} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end" class="w-56">
        <DropdownMenu.Label class="truncate">{data.title}</DropdownMenu.Label>
        <DropdownMenu.Separator />
        <DropdownMenu.Sub>
          <DropdownMenu.SubTrigger>
            <ArrowLeftRight size={14} />
            {m['term.provider_switch']()}
          </DropdownMenu.SubTrigger>
          <DropdownMenu.SubContent sideOffset={6} class="w-52">
            {#each availableProviders as provider (provider.id)}
              <DropdownMenu.Item
                disabled={!provider.installed || provider.id === currentProvider}
                onclick={() => changeProvider(provider.id)}
              >
                <span class="provider-state" class:available={provider.installed}></span>
                <span class="min-w-0 flex-1 truncate">{provider.displayName}</span>
                {#if provider.id === currentProvider}<span class="text-[9px] text-[var(--app-text-muted)]">{m['term.provider_current']()}</span>{/if}
              </DropdownMenu.Item>
            {/each}
          </DropdownMenu.SubContent>
        </DropdownMenu.Sub>
        {#if currentProviderStrategy && currentProviderStrategy.kind !== 'unsupported'}
          <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger>
              <UserRound size={14} />
              {m['term.profile_switch']()}
            </DropdownMenu.SubTrigger>
            <DropdownMenu.SubContent sideOffset={6} class="w-52">
              <DropdownMenu.RadioGroup
                value={currentProfileId ?? '__default__'}
                onValueChange={(value: string) => changeProfile(value === '__default__' ? null : value)}
              >
                <DropdownMenu.RadioItem value="__default__">{m['term.profile_default']()}</DropdownMenu.RadioItem>
                <DropdownMenu.Separator />
                {#each profiles as profile (profile.id)}
                  <DropdownMenu.RadioItem value={profile.id}>
                    <span class="min-w-0 flex-1 truncate">{profile.name}</span>
                  </DropdownMenu.RadioItem>
                {:else}
                  <DropdownMenu.Item disabled>{m['term.profile_empty']()}</DropdownMenu.Item>
                {/each}
              </DropdownMenu.RadioGroup>
            </DropdownMenu.SubContent>
          </DropdownMenu.Sub>
        {/if}
        {#if isWindows}
          <DropdownMenu.Item onclick={() => (runtimeOpen = true)}>
            <MonitorCog size={14} />
            {m['term.runtime_action']()}
          </DropdownMenu.Item>
        {/if}
        <DropdownMenu.Sub>
          <DropdownMenu.SubTrigger>
            <BadgeCheck size={14} />
            {m['term.role_assign']()}
          </DropdownMenu.SubTrigger>
          <DropdownMenu.SubContent sideOffset={6} class="max-h-72 w-52">
            <DropdownMenu.RadioGroup
              value={currentRole ?? '__none__'}
              onValueChange={(value: string) => assignRole(value === '__none__' ? null : value)}
            >
              <DropdownMenu.RadioItem value="__none__">{m['term.role_none']()}</DropdownMenu.RadioItem>
              <DropdownMenu.Separator />
              {#each roles as role (role.slug)}
                <DropdownMenu.RadioItem value={role.name}>
                  <span class="role-dot" style:background={role.color}></span>
                  <span class="min-w-0 truncate">{role.name}</span>
                </DropdownMenu.RadioItem>
              {:else}
                <DropdownMenu.Item disabled>{m['term.role_empty']()}</DropdownMenu.Item>
              {/each}
            </DropdownMenu.RadioGroup>
          </DropdownMenu.SubContent>
        </DropdownMenu.Sub>
        <DropdownMenu.Sub>
          <DropdownMenu.SubTrigger>
            <SwatchBook size={14} />
            {m['term.theme']()}
          </DropdownMenu.SubTrigger>
          <DropdownMenu.SubContent sideOffset={6} class="max-h-80 w-52">
            <DropdownMenu.RadioGroup
              value={currentTheme}
              onValueChange={(value: string) => data.onThemeChange?.(id, value as TerminalThemeName)}
            >
              {#each TERMINAL_THEME_ORDER as theme (theme)}
                <DropdownMenu.RadioItem value={theme}>
                  <span class="theme-swatch" aria-hidden="true">
                    <span style:background={TERMINAL_THEMES[theme].theme.background}></span>
                    <span style:background={TERMINAL_THEMES[theme].theme.blue}></span>
                    <span style:background={TERMINAL_THEMES[theme].theme.green}></span>
                  </span>
                  <span class="min-w-0 truncate">{terminalThemeLabel(theme)}</span>
                </DropdownMenu.RadioItem>
              {/each}
            </DropdownMenu.RadioGroup>
          </DropdownMenu.SubContent>
        </DropdownMenu.Sub>
        <DropdownMenu.Sub>
          <DropdownMenu.SubTrigger>
            <ListRestart size={14} />
            <span class="min-w-0 flex-1">{m['term.commands']()}</span>
            <span class="text-[9px] tabular-nums text-[var(--app-text-muted)]">{terminalCommands().length + globalCommands().length}</span>
          </DropdownMenu.SubTrigger>
          <DropdownMenu.SubContent sideOffset={6} class="max-h-80 w-64 overflow-y-auto">
            <DropdownMenu.Label>{m['term.commands_scope_terminal']()}</DropdownMenu.Label>
            {#each terminalCommands() as command (command.id)}
              <DropdownMenu.Item onclick={() => runSavedCommand(command)}>
                <SquareTerminal size={13} />
                <span class="min-w-0 flex-1"><span class="block truncate">{command.name}</span><code class="block truncate text-[9px] text-[var(--app-text-muted)]">{command.command}</code></span>
                {#if command.runOnResume}<History size={12} aria-label={m['term.commands_resume']()} />{/if}
              </DropdownMenu.Item>
            {:else}
              <DropdownMenu.Item disabled>{m['term.commands_empty_terminal']()}</DropdownMenu.Item>
            {/each}
            <DropdownMenu.Separator />
            <DropdownMenu.Label>{m['term.commands_scope_global']()}</DropdownMenu.Label>
            {#each globalCommands() as command (command.id)}
              <DropdownMenu.Item onclick={() => runSavedCommand(command)}>
                <Globe2 size={13} />
                <span class="min-w-0 flex-1"><span class="block truncate">{command.name}</span><code class="block truncate text-[9px] text-[var(--app-text-muted)]">{command.command}</code></span>
                {#if command.runOnResume}<History size={12} aria-label={m['term.commands_resume']()} />{/if}
              </DropdownMenu.Item>
            {:else}
              <DropdownMenu.Item disabled>{m['term.commands_empty_global']()}</DropdownMenu.Item>
            {/each}
            <DropdownMenu.Separator />
            <DropdownMenu.Item onclick={() => void openSavedCommands()}>
              <ListRestart size={14} />
              {m['term.commands_manage']()}
            </DropdownMenu.Item>
          </DropdownMenu.SubContent>
        </DropdownMenu.Sub>
        <DropdownMenu.Separator />
        {#if data.payload.maestro}
          <DropdownMenu.Item onclick={() => (councilOpen = true)}>
            <Scale size={14} />
            {m['council.ask_perspectives']()}
          </DropdownMenu.Item>
          <DropdownMenu.Separator />
        {/if}
        <DropdownMenu.Item onclick={reloadTerminal}>
          <RotateCcw size={14} />
          {m['term.reload']()}
        </DropdownMenu.Item>
        <DropdownMenu.Item onclick={() => data.onToggleMaestro?.(id)}>
          <Star size={14} fill={data.payload.maestro ? 'currentColor' : 'none'} />
          {data.payload.maestro ? m['term.maestro_disable']() : m['term.maestro_enable']()}
        </DropdownMenu.Item>
        <DropdownMenu.Separator />
        <DropdownMenu.Item variant="destructive" onclick={() => data.onDelete(id)}>
          <X size={14} />
          {m['term.remove_terminal']()}
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  {/snippet}

  {#if mentionOpen && filteredMentions.length}
    <div class="mention-pop nodrag">
      {#each filteredMentions as target (target.id)}
        <button class="mention-item" onclick={() => insertMention(target)}>
          <span class="mention-type">{target.type}</span>
          {target.title}
        </button>
      {/each}
    </div>
  {/if}

  <div
    class="terminal-body nodrag"
    class:attachment-drop-active={attachmentDropActive}
    role="group"
    aria-label={m['attachment.agent_drop_target']()}
    ondragover={handleAttachmentDragOver}
    ondragleave={() => (attachmentDropActive = false)}
    ondrop={handleAttachmentDrop}
  >
    {#if data.payload.sessionId && !forceRespawn && !ownsCreatedSession}
      <TerminalNode
        bind:this={terminalNode}
        sessionId={data.payload.sessionId}
        workspaceId={data.workspaceId}
        nodeId={id}
        sessionLabel={data.title}
        workspaceName={data.workspaceName}
        onOpenPath={(path) => data.onOpenFile?.(path)}
        themeName={currentTheme}
        provider={data.payload.provider}
        sessionStorage={data.sessionStorageFor?.() ?? undefined}
        onRespawn={resolveRespawn}
        onAgentSession={(agentSessionId) => data.onAgentSessionFound?.(id, agentSessionId)}
        onWorkingDirectoryChange={persistWorkingDirectory}
        onTalking={data.onTalking}
        onAgentReply={handleAgentReply}
        onSessionReady={handleSessionReady}
        {voiceOn}
        onToggleVoice={toggleVoice}
      />
    {:else if data.payload.command}
      {#key createSessionKey}
        <TerminalNode
          bind:this={terminalNode}
          {createRequest}
          workspaceId={data.workspaceId}
          nodeId={id}
          sessionLabel={data.title}
          workspaceName={data.workspaceName}
          onSessionCreated={persistCreatedSession}
          onOpenPath={(path) => data.onOpenFile?.(path)}
          themeName={currentTheme}
          provider={data.payload.provider}
          sessionStorage={data.sessionStorageFor?.() ?? undefined}
          onAgentSession={(agentSessionId) => data.onAgentSessionFound?.(id, agentSessionId)}
          onWorkingDirectoryChange={persistWorkingDirectory}
          onTalking={data.onTalking}
          onAgentReply={handleAgentReply}
          onSessionReady={handleSessionReady}
          {voiceOn}
          onToggleVoice={toggleVoice}
        />
      {/key}
    {:else}
      <p class="terminal-empty">{m['term.no_command']()}</p>
    {/if}
  </div>
  {#if voiceError}
    <p class="voice-error">{voiceError}</p>
  {/if}
  {#if providerError}
    <p class="voice-error">{providerError}</p>
  {/if}
  <VoiceConfirmDialog bind:open={voiceConfirmOpen} onConfirm={() => (voiceOn = true)} onCancel={() => {}} />
  <CouncilDialog bind:open={councilOpen} workspaceId={data.workspaceId} source={{ leaderNodeId: id }} />
  <TerminalRuntimeDialog
    open={runtimeOpen}
    workspaceRoot={data.workspaceRoot}
    workspaceRuntime={data.workspaceRuntime}
    override={runtimeOverride}
    onSave={changeRuntime}
    onClose={() => (runtimeOpen = false)}
  />
  <TerminalCommandsDialog
    open={commandsOpen}
    terminalTitle={data.title}
    pureShell={isPureShell}
    terminalCommands={terminalCommands()}
    globalCommands={globalCommands()}
    onSaveTerminal={saveTerminalCommands}
    onSaveGlobal={saveGlobalCommands}
    onRun={runSavedCommand}
    onClose={() => (commandsOpen = false)}
  />

  <div
    class="composer nodrag"
    class:attachment-drop-active={attachmentDropActive}
    role="group"
    aria-label={m['attachment.agent_drop_target']()}
    ondragover={handleAttachmentDragOver}
    ondragleave={() => (attachmentDropActive = false)}
    ondrop={handleAttachmentDrop}
  >
    <input bind:this={attachmentInput} type="file" multiple class="attachment-input" onchange={handleAttachmentFiles} />
    <button
      class="composer-attach"
      aria-label={m['attachment.add']()}
      disabled={attachmentBusy}
      onclick={() => attachmentInput.click()}
    >
      <Paperclip size={13} aria-hidden="true" />
    </button>
    <input
      bind:this={promptInput}
      bind:value={prompt}
      data-testid="terminal-quick-prompt"
      oninput={handlePromptInput}
      onkeydown={handlePromptKeydown}
      placeholder={m['ph.quick_prompt']()}
      spellcheck="false"
    />
    <button class="composer-send" aria-label={m['term.send']()} onclick={sendPrompt} disabled={!prompt.trim()}>
      <SendHorizontal size={13} />
    </button>
  </div>
  {#if attachmentError}<p class="attachment-error" role="status">{attachmentError}</p>{/if}
</NodeShell>

<style>
  .terminal-body {
    flex: 1;
    min-height: 0;
  }

  .terminal-body.attachment-drop-active,
  .composer.attachment-drop-active {
    box-shadow: inset 0 0 0 2px var(--app-accent);
  }

  .attachment-input {
    display: none;
  }

  .composer-attach {
    display: grid;
    width: 24px;
    height: 24px;
    flex-shrink: 0;
    place-items: center;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--app-text-muted);
    cursor: pointer;
  }

  .composer-attach:hover:not(:disabled) {
    background: var(--app-border);
    color: var(--app-text);
  }

  .composer-attach:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 1px;
  }

  .composer-attach:disabled {
    opacity: 0.45;
  }

  .attachment-error {
    margin: 0;
    padding: 3px 8px 5px;
    color: var(--app-danger);
    font-size: 10px;
  }

  .terminal-empty {
    color: var(--app-text-muted);
    font-size: 12px;
    padding: 10px;
  }

  .voice-error {
    margin: 0;
    padding: 4px 10px;
    font-size: 11px;
    color: var(--app-warning);
    background: color-mix(in srgb, var(--app-warning) 10%, transparent);
  }

  .composer {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    border-top: 1px solid var(--app-border);
    background: var(--app-surface);
  }

  .composer input {
    flex: 1;
    border: none;
    outline: none;
    background: transparent;
    color: var(--app-text);
    font-size: 12px;
  }

  .composer-send {
    display: inline-flex;
    border: none;
    background: transparent;
    color: var(--app-text-muted);
    cursor: pointer;
    padding: 3px;
  }

  .composer-send:hover:not(:disabled) {
    color: var(--app-accent);
  }

  .composer-send:disabled {
    opacity: 0.3;
    cursor: default;
  }

  .provider-state {
    width: 6px;
    height: 6px;
    flex: none;
    border-radius: 999px;
    background: var(--app-text-muted);
  }

  .provider-state.available {
    background: var(--app-success);
  }

  .mention-pop {
    position: absolute;
    bottom: 44px;
    left: 10px;
    right: 10px;
    z-index: 30;
    background: var(--app-surface-raised);
    border: 1px solid var(--app-border);
    border-radius: 10px;
    overflow: hidden;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
  }

  .mention-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 10px;
    border: none;
    background: transparent;
    color: var(--app-text-soft);
    font-size: 12px;
    cursor: pointer;
    text-align: left;
  }

  .mention-item:hover {
    background: var(--app-border);
  }

  .mention-type {
    font-size: 9px;
    text-transform: uppercase;
    color: var(--app-text-muted);
    background: var(--app-border);
    border-radius: 4px;
    padding: 1px 5px;
  }

  .terminal-status-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    max-width: 112px;
    height: 22px;
    padding: 0 6px;
    border: 1px solid color-mix(in srgb, var(--app-success) 30%, var(--app-border));
    border-radius: 5px;
    background: color-mix(in srgb, var(--app-success) 8%, transparent);
    color: var(--app-success);
    font-size: 10px;
  }

  .terminal-provider-mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 19px;
    height: 19px;
    border-radius: 5px;
    background: #20242c;
  }

  .terminal-status-chip span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .terminal-leader-state {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    color: var(--app-warning);
  }

  .theme-swatch {
    display: inline-grid;
    grid-template-columns: repeat(3, 1fr);
    width: 24px;
    height: 14px;
    flex: none;
    overflow: hidden;
    border: 1px solid color-mix(in srgb, currentColor 24%, transparent);
    border-radius: 3px;
  }

  .role-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    display: inline-block;
    margin-right: 6px;
  }
</style>
