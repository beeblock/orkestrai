<script lang="ts">
  import { onMount } from "svelte";
  import { getCsrfToken } from "@beeblock/svelar/http";
  import { toast } from "@beeblock/svelar/ui";
  import {
    Check,
    ChevronRight,
    CircleAlert,
    LoaderCircle,
    LogOut,
    MonitorUp,
    ShieldCheck,
    WifiOff,
  } from "@lucide/svelte";
  import * as Dialog from "$lib/components/ui/dialog";
  import * as Select from "$lib/components/ui/select";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Textarea } from "$lib/components/ui/textarea";
  import RemoteWorkspaceShell from "$lib/components/collaboration/RemoteWorkspaceShell.svelte";
  import type {
    CollaborationCommand,
    CollaborationCommandResult,
    SharedWorkspaceDto,
  } from "$lib/modules/collaboration/domain/types.js";
  import * as m from "$lib/paraglide/messages.js";

  type RemoteState = {
    status:
      | "idle"
      | "connecting"
      | "waiting_approval"
      | "connected"
      | "reconnecting"
      | "rejected"
      | "expired"
      | "offline"
      | "incompatible"
      | "revoked"
      | "error";
    shareId: string | null;
    hostDeviceId: string | null;
    deviceId: string | null;
    displayName: string | null;
    role: string | null;
    scopes: string[];
    revision: number;
    snapshot: SharedWorkspaceDto | null;
    errorCode: string | null;
  };
  type DesktopBridge = {
    platform: "darwin" | "win32" | "linux";
    consumeCollaborationInvite?: () => Promise<string | null>;
    onCollaborationInvite?: (callback: () => void) => () => void;
  };
  type RemoteTab = "overview" | "team" | "tasks" | "huddles" | "designs" | "reviews" | "activity";

  let remoteState = $state<RemoteState>({
    status: "idle",
    shareId: null,
    hostDeviceId: null,
    deviceId: null,
    displayName: null,
    role: null,
    scopes: [],
    revision: 0,
    snapshot: null,
    errorCode: null,
  });
  let loading = $state(true);
  let busy = $state(false);
  let inviteUri = $state("");
  let relayUrl = $state("wss://relay.orkestrai.app/v1/connect");
  let displayName = $state("");
  let activeTab = $state<RemoteTab>("overview");
  let taskDialogOpen = $state(false);
  let taskTitle = $state("");
  let taskDescription = $state("");
  let taskStatus = $state("");
  let leaderMessage = $state("");
  const desktop = typeof window === 'undefined'
    ? undefined
    : (window as typeof window & { orkestraiDesktop?: DesktopBridge }).orkestraiDesktop;
  const desktopAvailable = Boolean(desktop) || import.meta.env.DEV;
  const snapshot = $derived(remoteState.snapshot);

  function headers(): Record<string, string> {
    const csrf = getCsrfToken();
    return {
      "content-type": "application/json",
      ...(csrf ? { "X-CSRF-Token": csrf } : {}),
    };
  }

  async function api<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(path, {
      ...init,
      headers: { ...headers(), ...(init?.headers ?? {}) },
    });
    const payload = await response.json();
    if (!response.ok || payload.error) {
      if (payload.data?.errorCode) throw new Error(m["remote.command_error"]());
      throw new Error(payload.error || m["remote.error"]());
    }
    return payload.data as T;
  }

  async function refresh(): Promise<void> {
    try {
      remoteState = await api<RemoteState>("/api/collaboration/remote");
    } catch {
      remoteState = {
        ...remoteState,
        status: "error",
        errorCode: "REMOTE_STATUS_FAILED",
      };
    } finally {
      loading = false;
    }
  }

  async function connect(invite = inviteUri): Promise<void> {
    if (!invite.trim() || !displayName.trim()) return;
    busy = true;
    try {
      remoteState = await api<RemoteState>("/api/collaboration/remote", {
        method: "POST",
        body: JSON.stringify({
          inviteUri: invite.trim(),
          relayUrl: relayUrl.trim(),
          displayName: displayName.trim(),
          platform: desktop?.platform ?? platformFromNavigator(),
        }),
      });
      inviteUri = "";
    } catch (error) {
      toast.error(error instanceof Error ? error.message : m["remote.error"]());
    } finally {
      busy = false;
    }
  }

  async function consumeInvite(): Promise<void> {
    const invite = await desktop?.consumeCollaborationInvite?.();
    if (!invite) return;
    inviteUri = invite;
    if (displayName) await connect(invite);
  }

  async function leave(): Promise<void> {
    await api("/api/collaboration/remote", { method: "DELETE" });
    remoteState = {
      ...remoteState,
      status: "idle",
      snapshot: null,
      shareId: null,
      scopes: [],
      role: null,
      revision: 0,
    };
  }

  async function command(
    input: CollaborationCommand,
  ): Promise<CollaborationCommandResult | null> {
    busy = true;
    try {
      const result = await api<CollaborationCommandResult>(
        "/api/collaboration/remote/commands",
        { method: "POST", body: JSON.stringify(input) },
      );
      await refresh();
      return result;
    } catch (error) {
      await refresh();
      toast.error(
        error instanceof Error ? error.message : m["remote.command_error"](),
      );
      return null;
    } finally {
      busy = false;
    }
  }

  async function createTask(): Promise<void> {
    const result = await command({
      type: "task.create",
      title: taskTitle,
      description: taskDescription || null,
      status: taskStatus || undefined,
    });
    if (!result?.accepted) return;
    taskTitle = "";
    taskDescription = "";
    taskStatus = "";
    taskDialogOpen = false;
  }

  async function updateTask(taskId: string, status: string): Promise<void> {
    await command({ type: "task.update", taskId, status });
  }

  async function decideReview(
    reviewId: string,
    status: "approved" | "changes_requested" | "rejected",
  ): Promise<void> {
    await command({ type: "review.decide", reviewId, status });
  }

  async function createDesignComment(nodeId: string, pageId: string, elementId: string | null, body: string): Promise<void> {
    const result = await command({ type: "design.comment.create", nodeId, pageId, elementId, body });
    if (result?.accepted) toast.success(m["remote.design_comment_sent"]());
  }

  async function replyDesignComment(nodeId: string, commentId: string, body: string): Promise<void> {
    await command({ type: "design.comment.reply", nodeId, commentId, body });
  }

  async function resolveDesignComment(nodeId: string, commentId: string, status: "open" | "resolved"): Promise<void> {
    await command({ type: "design.comment.resolve", nodeId, commentId, status });
  }

  type RemoteDesignChanges = { x: number; y: number; width: number; height: number; opacity: number; fill: string };

  async function createDesignProposal(nodeId: string, elementId: string, title: string, description: string, changes: RemoteDesignChanges): Promise<void> {
    const result = await command({ type: "design.proposal.create", nodeId, elementId, title, description, changes });
    if (result?.accepted) toast.success(m["remote.design_proposal_sent"]());
  }

  async function decideDesignProposal(nodeId: string, proposalId: string, status: "approved" | "rejected"): Promise<void> {
    await command({ type: "design.proposal.decide", nodeId, proposalId, status });
  }

  async function updateDesignElement(nodeId: string, elementId: string, changes: RemoteDesignChanges): Promise<void> {
    const result = await command({ type: "design.element.update", nodeId, elementId, changes });
    if (result?.accepted) toast.success(m["remote.design_edit_applied"]());
  }

  async function sendLeaderMessage(): Promise<void> {
    if (!leaderMessage.trim()) return;
    const result = await command({
      type: "leader.message",
      message: leaderMessage.trim(),
    });
    if (result?.accepted) leaderMessage = "";
  }

  async function createHuddle(input: { title: string; agenda: string | null; agentNodeIds: string[]; facilitatorNodeId: string | null }): Promise<void> {
    await command({ type: "huddle.create", ...input });
  }

  async function sendHuddleTurn(huddleId: string, text: string, targetNodeIds: string[]): Promise<void> {
    await command({ type: "huddle.turn", huddleId, text, targetNodeIds });
  }

  async function endHuddle(huddleId: string): Promise<void> {
    await command({ type: "huddle.end", huddleId });
  }

  function platformFromNavigator(): "darwin" | "win32" | "linux" {
    const platform = navigator.platform.toLowerCase();
    return platform.includes("mac")
      ? "darwin"
      : platform.includes("win")
        ? "win32"
        : "linux";
  }

  function statusLabel(status: RemoteState["status"]): string {
    const labels: Record<RemoteState["status"], () => string> = {
      idle: m["remote.status_idle"],
      connecting: m["remote.status_connecting"],
      waiting_approval: m["remote.status_waiting_approval"],
      connected: m["remote.status_connected"],
      reconnecting: m["remote.status_reconnecting"],
      rejected: m["remote.status_rejected"],
      expired: m["remote.status_expired"],
      offline: m["remote.status_offline"],
      incompatible: m["remote.status_incompatible"],
      revoked: m["remote.status_revoked"],
      error: m["remote.status_error"],
    };
    return labels[status]();
  }

  const failedStatuses: RemoteState["status"][] = ["rejected", "expired", "incompatible", "revoked", "error"];
  const failed = $derived(failedStatuses.includes(remoteState.status));
  let inviteInput = $state<HTMLInputElement | null>(null);

  // Proximo passo concreto para cada falha: o usuario nao precisa adivinhar
  // se deve esperar, atualizar o app ou pedir outro convite.
  function recoveryHint(status: RemoteState["status"]): string {
    if (status === "rejected") return m["remote.recover_rejected"]();
    if (status === "expired") return m["remote.recover_expired"]();
    if (status === "incompatible") return m["remote.recover_incompatible"]();
    if (status === "revoked") return m["remote.recover_revoked"]();
    return m["remote.recover_error"]();
  }

  // Rotulo curto para a pilula de estado da tela de espera.
  function shortStatus(status: RemoteState["status"]): string {
    if (status === "connecting") return m["collaboration.status_connecting"]();
    if (status === "reconnecting") return m["collaboration.status_reconnecting"]();
    if (status === "offline") return m["collaboration.status_offline"]();
    if (status === "connected") return m["remote.status_connected"]();
    return m["collaboration.pending"]();
  }

  function focusInvite(): void {
    inviteInput?.focus();
    inviteInput?.select();
  }

  const steps = [
    { title: m["remote.step_invite_title"], body: m["remote.step_invite_body"] },
    { title: m["remote.step_request_title"], body: m["remote.step_request_body"] },
    { title: m["remote.step_approve_title"], body: m["remote.step_approve_body"] },
  ];

  // Passo atual do fluxo guiado: so apresentacao, derivado do estado que ja existe.
  const currentStep = $derived(
    remoteState.status === "connecting"
      ? 1
      : ["waiting_approval", "reconnecting", "offline", "connected"].includes(remoteState.status)
        ? 2
        : inviteUri.trim()
          ? 1
          : 0,
  );

  onMount(() => {
    displayName = `${m["remote.device_default"]()} (${desktop?.platform ?? platformFromNavigator()})`;
    void refresh().then(consumeInvite);
    const unsubscribe = desktop?.onCollaborationInvite?.(
      () => void consumeInvite(),
    );
    const timer = setInterval(() => void refresh(), 1_000);
    return () => {
      clearInterval(timer);
      unsubscribe?.();
      inviteUri = "";
    };
  });
</script>

<svelte:head><title>{m["remote.title"]()} - Orkestrai</title></svelte:head>

{#snippet stepList(compact: boolean)}
  <ol class="rp-steps" class:compact>
    {#each steps as step, index}
      {@const state = index < currentStep ? "done" : index === currentStep ? "current" : "upcoming"}
      <li class="rp-step" data-state={state} aria-current={state === "current" ? "step" : undefined}>
        <span class="rp-step-marker" aria-hidden="true">
          {#if state === "done"}<Check size={12} strokeWidth={2.5} />{:else}{index + 1}{/if}
        </span>
        <div class="min-w-0">
          <p class="rp-step-title">{step.title()}</p>
          {#if !compact}<p class="rp-step-body">{step.body()}</p>{/if}
        </div>
      </li>
    {/each}
  </ol>
{/snippet}

{#if !desktopAvailable}
  <main
    data-dictation-hidden
    class="grid h-full place-items-center bg-[var(--app-canvas)] p-6 text-[var(--app-text)]"
  >
    <div class="rp-enter grid max-w-md justify-items-center text-center">
      <span class="grid size-11 place-items-center rounded-xl bg-[var(--app-hover)] text-[var(--app-text-soft)]">
        <MonitorUp size={20} aria-hidden="true" />
      </span>
      <h1 class="mt-4 font-display text-[20px] font-semibold tracking-[-0.015em] text-balance">
        {m["remote.desktop_required_title"]()}
      </h1>
      <p class="mt-2 text-sm leading-6 text-pretty text-[var(--app-text-muted)]">
        {m["remote.desktop_required_body"]()}
      </p>
    </div>
  </main>
{:else if loading}
  <main data-dictation-hidden class="grid h-full place-items-center bg-[var(--app-canvas)]">
    <span class="rp-pill" data-tone="neutral" role="status">
      <LoaderCircle size={13} class="animate-spin" aria-hidden="true" />{m["remote.loading"]()}
    </span>
  </main>
{:else if remoteState.status === "idle" || failed}
  <main
    data-dictation-hidden
    class="h-full overflow-y-auto bg-[var(--app-canvas)] text-[var(--app-text)]"
  >
    <div
      class="mx-auto grid min-h-full w-full max-w-[1040px] content-center gap-10 px-5 py-10 sm:px-8 lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)] lg:items-center lg:gap-16 lg:px-10"
    >
      <section class="rp-enter min-w-0" aria-labelledby="remote-join-title">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span class="flex items-center gap-2 text-ui-md font-medium text-[var(--app-text-soft)]">
            <span class="rp-brand" aria-hidden="true"><img src="/brand/icon.svg" width="13" height="13" alt="" /></span>{m["remote.eyebrow"]()}
          </span>
          <span class="rp-pill" data-tone={failed ? "danger" : "neutral"} role="status">
            <span class="rp-pill-dot" aria-hidden="true"></span>{statusLabel(remoteState.status)}
          </span>
        </div>
        <h1
          id="remote-join-title"
          class="mt-5 font-display text-[26px] font-semibold leading-tight tracking-[-0.02em] text-balance"
        >
          {m["remote.join_title"]()}
        </h1>
        <p class="mt-2 text-sm leading-6 text-pretty text-[var(--app-text-muted)]">
          {m["remote.join_body"]()}
        </p>

        {#if failed}
          <div class="rp-alert mt-5">
            <CircleAlert size={16} class="mt-px shrink-0 text-[var(--app-danger)]" aria-hidden="true" />
            <p class="min-w-0 flex-1 text-xs leading-5 text-pretty text-[var(--app-text-soft)]">
              {recoveryHint(remoteState.status)}
            </p>
            <Button variant="outline" size="sm" class="shrink-0" onclick={focusInvite}>
              {m["remote.use_new_invite"]()}
            </Button>
          </div>
        {/if}

        <form
          class="rp-card mt-6 grid gap-4 p-4"
          onsubmit={(event) => {
            event.preventDefault();
            void connect();
          }}
        >
          <div class="grid gap-1.5">
            <label for="remote-invite" class="text-ui-md font-medium">{m["remote.invite_link"]()}</label>
            <Input
              id="remote-invite"
              type="password"
              bind:ref={inviteInput}
              bind:value={inviteUri}
              autocomplete="off"
              spellcheck="false"
              placeholder="orkestrai://join/..."
              aria-describedby="remote-invite-help"
              class="font-mono text-[12px] md:text-[12px]"
            />
            <p id="remote-invite-help" class="text-ui-sm leading-snug text-pretty text-[var(--app-text-muted)]">
              {m["remote.invite_help"]()}
            </p>
          </div>
          <div class="grid gap-1.5">
            <label for="remote-device" class="text-ui-md font-medium">{m["remote.device_name"]()}</label>
            <Input
              id="remote-device"
              bind:value={displayName}
              maxlength="80"
              aria-describedby="remote-device-help"
            />
            <p id="remote-device-help" class="text-ui-sm leading-snug text-pretty text-[var(--app-text-muted)]">
              {m["remote.device_help"]()}
            </p>
          </div>
          <!-- Relay raramente muda: fica recolhido, como no dialogo de compartilhamento. -->
          <details class="rp-advanced group">
            <summary>
              <ChevronRight
                size={14}
                class="shrink-0 text-[var(--app-text-muted)] transition-transform duration-150 group-open:rotate-90"
                aria-hidden="true"
              />{m["collaboration.advanced"]()}
            </summary>
            <div class="grid gap-1.5 px-3 pb-3">
              <label for="remote-relay" class="text-ui-md font-medium">{m["collaboration.relay"]()}</label>
              <Input
                id="remote-relay"
                bind:value={relayUrl}
                autocomplete="off"
                spellcheck="false"
                aria-describedby="remote-relay-help"
                class="font-mono text-[12px] md:text-[12px]"
              />
              <p id="remote-relay-help" class="text-ui-sm leading-snug text-pretty text-[var(--app-text-muted)]">
                {m["collaboration.relay_help"]()}
              </p>
            </div>
          </details>
          <Button
            type="submit"
            class="h-9 w-full"
            disabled={busy || !inviteUri.trim() || !displayName.trim()}
            >{#if busy}<LoaderCircle class="animate-spin" aria-hidden="true" />{:else}<ShieldCheck
                aria-hidden="true"
              />{/if}{m["remote.connect"]()}</Button
          >
        </form>
        <p class="mt-3 flex items-center gap-1.5 text-ui-sm text-[var(--app-text-muted)]">
          <ShieldCheck size={13} class="shrink-0 text-[var(--app-success)]" aria-hidden="true" />{m[
            "remote.encrypted_connection"
          ]()}
        </p>
      </section>

      <aside class="rp-enter rp-enter-late min-w-0 lg:border-l lg:border-[var(--app-border)] lg:pl-12">
        <h2 class="section-label">{m["remote.how_title"]()}</h2>
        <div class="mt-4">{@render stepList(false)}</div>
      </aside>
    </div>
  </main>
{:else if remoteState.status !== "connected" || !snapshot}
  <main
    data-dictation-hidden
    class="grid h-full place-items-center overflow-y-auto bg-[var(--app-canvas)] p-6 text-[var(--app-text)]"
  >
    <div class="rp-enter w-full max-w-[420px]">
      <div class="rp-card grid justify-items-center p-6 text-center">
        <span
          class={`grid size-11 place-items-center rounded-xl ${remoteState.status === "offline" ? "bg-[var(--app-danger-soft)]" : "bg-[var(--app-hover)]"}`}
        >
          {#if remoteState.status === "offline"}
            <WifiOff size={19} class="text-[var(--app-danger)]" aria-hidden="true" />
          {:else}
            <LoaderCircle size={19} class="animate-spin text-[var(--app-text-soft)]" aria-hidden="true" />
          {/if}
        </span>
        <span
          class="rp-pill mt-4"
          data-tone={remoteState.status === "offline" ? "danger" : remoteState.status === "connected" ? "success" : "warning"}
          role="status"
        >
          <span class="rp-pill-dot" aria-hidden="true"></span>{shortStatus(remoteState.status)}
        </span>
        <h1 class="mt-3 font-display text-[20px] font-semibold tracking-[-0.015em] text-balance">
          {statusLabel(remoteState.status)}
        </h1>
        <p class="mt-2 text-sm leading-6 text-pretty text-[var(--app-text-muted)]">
          {m["remote.waiting_body"]()}
        </p>
        {#if remoteState.displayName}
          <p class="mt-4 flex max-w-full items-center gap-1.5 text-ui-md text-[var(--app-text-muted)]">
            {m["remote.device_name"]()}
            <span class="rp-chip truncate" title={remoteState.displayName}>{remoteState.displayName}</span>
          </p>
        {/if}
        <div class="mt-5 w-full border-t border-[var(--app-border)] pt-4 text-left">
          {@render stepList(true)}
        </div>
      </div>
      <div class="mt-3 flex justify-center">
        <Button variant="ghost" size="sm" onclick={leave}
          ><LogOut aria-hidden="true" />{m["remote.leave"]()}</Button
        >
      </div>
    </div>
  </main>
{:else}
  <RemoteWorkspaceShell
    {snapshot}
    role={remoteState.role}
    scopes={remoteState.scopes}
    revision={remoteState.revision}
    {busy}
    bind:activeTab
    bind:leaderMessage
    onRefresh={refresh}
    onLeave={leave}
    onCreateTask={() => (taskDialogOpen = true)}
    onUpdateTask={updateTask}
    onDecideReview={decideReview}
    onCreateDesignComment={createDesignComment}
    onReplyDesignComment={replyDesignComment}
    onResolveDesignComment={resolveDesignComment}
    onCreateDesignProposal={createDesignProposal}
    onDecideDesignProposal={decideDesignProposal}
    onUpdateDesignElement={updateDesignElement}
    onSendLeaderMessage={sendLeaderMessage}
    onCreateHuddle={createHuddle}
    onSendHuddleTurn={sendHuddleTurn}
    onEndHuddle={endHuddle}
  />
{/if}

<Dialog.Root bind:open={taskDialogOpen}>
  <Dialog.Content class="sm:max-w-lg"
    ><Dialog.Header
      ><Dialog.Title>{m["remote.create_task"]()}</Dialog.Title
      ><Dialog.Description>{m["remote.create_task_body"]()}</Dialog.Description
      ></Dialog.Header
    >
    <div class="space-y-4">
      <label class="grid gap-1.5 text-ui-md font-medium"
        >{m["remote.task_title"]()}<Input
          bind:value={taskTitle}
          maxlength="180"
        /></label
      ><label class="grid gap-1.5 text-ui-md font-medium"
        >{m["remote.task_description"]()}<Textarea
          bind:value={taskDescription}
          class="min-h-28 resize-y"
        /></label
      ><label class="grid gap-1.5 text-ui-md font-medium"
        >{m["remote.task_column"]()}<Select.Root type="single" bind:value={taskStatus}
          ><Select.Trigger class="w-full"
            ><span
              >{snapshot?.columns.find((column) => column.key === taskStatus)
                ?.name ?? m["remote.default_column"]()}</span
            ></Select.Trigger
          ><Select.Content
            >{#each snapshot?.columns ?? [] as column}<Select.Item
                value={column.key}>{column.name ?? column.key}</Select.Item
              >{/each}</Select.Content
          ></Select.Root
        ></label
      >
    </div>
    <Dialog.Footer
      ><Button variant="ghost" onclick={() => (taskDialogOpen = false)}
        >{m["settings.cancel"]()}</Button
      ><Button disabled={busy || !taskTitle.trim()} onclick={createTask}
        >{#if busy}<LoaderCircle class="animate-spin" aria-hidden="true" />{/if}{m[
          "remote.create_task"
        ]()}</Button
      ></Dialog.Footer
    ></Dialog.Content
  >
</Dialog.Root>

<style>
  /* Pilula de estado: a cor aparece so no ponto e no tom, nunca como enfeite. */
  .rp-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 24px;
    max-width: 100%;
    padding: 0 10px;
    border-radius: 999px;
    background: var(--app-hover);
    color: var(--app-text-soft);
    font-size: 11.5px;
    font-weight: 500;
    line-height: 1.3;
  }

  .rp-pill-dot {
    width: 6px;
    height: 6px;
    flex-shrink: 0;
    border-radius: 999px;
    background: var(--app-text-muted);
  }

  .rp-pill[data-tone='success'] {
    background: var(--app-success-soft);
    color: var(--app-success);
  }

  .rp-pill[data-tone='success'] .rp-pill-dot {
    background: var(--app-success);
  }

  .rp-pill[data-tone='warning'] {
    background: var(--app-warning-soft);
    color: var(--app-warning);
  }

  .rp-pill[data-tone='warning'] .rp-pill-dot {
    background: var(--app-warning);
  }

  .rp-pill[data-tone='danger'] {
    background: var(--app-danger-soft);
    color: var(--app-danger);
  }

  .rp-pill[data-tone='danger'] .rp-pill-dot {
    background: var(--app-danger);
  }

  /* Marca sobre fundo escuro fixo: o simbolo tem partes brancas que somem no tema claro. */
  .rp-brand {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    flex-shrink: 0;
    border-radius: 6px;
    background: #10101d;
  }

  .rp-chip {
    display: inline-block;
    min-width: 0;
    padding: 1px 8px;
    border-radius: 6px;
    background: var(--app-hover);
    color: var(--app-text-soft);
    font-weight: 500;
  }

  .rp-card {
    border-radius: 12px;
    background: var(--app-surface);
    box-shadow: var(--app-shadow-border);
  }

  /* Erro com a acao de recuperacao ao lado, em vez de uma faixa vermelha. */
  .rp-alert {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 10px 10px 12px;
    border-radius: 10px;
    background: var(--app-danger-soft);
  }

  .rp-advanced {
    border-radius: 8px;
    box-shadow: var(--app-shadow-border);
  }

  .rp-advanced summary {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 34px;
    padding: 0 12px;
    list-style: none;
    border-radius: 8px;
    color: var(--app-text-soft);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: color var(--duration-quick) ease-out;
  }

  .rp-advanced summary:hover {
    color: var(--app-text);
  }

  .rp-advanced summary::-webkit-details-marker {
    display: none;
  }

  .rp-advanced summary:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 2px;
  }

  /* Passos do fluxo: concluido (verde), atual (texto forte) e proximos (mudos). */
  .rp-steps {
    position: relative;
    display: grid;
    gap: 18px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .rp-steps.compact {
    gap: 12px;
  }

  .rp-step {
    position: relative;
    display: grid;
    grid-template-columns: 24px minmax(0, 1fr);
    gap: 12px;
    align-items: start;
  }

  /* Linha que liga um passo ao seguinte. */
  .rp-step:not(:last-child)::after {
    content: '';
    position: absolute;
    left: 11.5px;
    top: 28px;
    bottom: -14px;
    width: 1px;
    background: var(--app-border);
  }

  .compact .rp-step:not(:last-child)::after {
    bottom: -8px;
  }

  .rp-step[data-state='done']:not(:last-child)::after {
    background: color-mix(in srgb, var(--app-success) 45%, var(--app-border));
  }

  .rp-step-marker {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 999px;
    background: var(--app-hover);
    color: var(--app-text-muted);
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    transition-property: background-color, color, box-shadow;
    transition-duration: var(--duration-fast);
    transition-timing-function: var(--ease-smooth-out);
  }

  .rp-step[data-state='current'] .rp-step-marker {
    background: var(--app-surface-raised);
    color: var(--app-text);
    box-shadow: 0 0 0 1px var(--app-border-strong);
  }

  .rp-step[data-state='done'] .rp-step-marker {
    background: var(--app-success-soft);
    color: var(--app-success);
  }

  .rp-step-title {
    margin: 2px 0 0;
    color: var(--app-text-muted);
    font-size: 13px;
    font-weight: 600;
    line-height: 20px;
    transition: color var(--duration-fast) ease-out;
  }

  .compact .rp-step-title {
    font-size: 12px;
    font-weight: 500;
  }

  .rp-step[data-state='current'] .rp-step-title {
    color: var(--app-text);
  }

  .rp-step[data-state='done'] .rp-step-title {
    color: var(--app-text-soft);
  }

  .rp-step-body {
    max-width: 44ch;
    margin: 2px 0 0;
    color: var(--app-text-muted);
    font-size: 12px;
    line-height: 1.5;
    text-wrap: pretty;
  }

  /* Entrada da tela: opacidade + 6px, uma vez; o guard global de movimento reduzido cobre. */
  .rp-enter {
    animation: rp-enter var(--duration-slow) var(--ease-smooth-out) both;
  }

  .rp-enter-late {
    animation-delay: 100ms;
  }

  @keyframes rp-enter {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }
</style>
