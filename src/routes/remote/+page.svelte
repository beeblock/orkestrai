<script lang="ts">
  import { onMount } from "svelte";
  import { getCsrfToken } from "@beeblock/svelar/http";
  import { toast } from "@beeblock/svelar/ui";
  import {
    ArrowRight,
    LoaderCircle,
    LogOut,
    MonitorUp,
    RadioTower,
    ShieldCheck,
    XCircle,
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

{#if !desktopAvailable}
  <main
    data-dictation-hidden
    class="grid h-full place-items-center bg-[var(--app-canvas)] p-6 text-[var(--app-text)]"
  >
    <div class="max-w-md text-center">
      <MonitorUp size={34} class="mx-auto text-[var(--app-accent)]" />
      <h1 class="mt-4 text-xl font-semibold">
        {m["remote.desktop_required_title"]()}
      </h1>
      <p
        class="mt-2 text-sm leading-6 text-pretty text-[var(--app-text-muted)]"
      >
        {m["remote.desktop_required_body"]()}
      </p>
    </div>
  </main>
{:else if loading}
  <main data-dictation-hidden class="grid h-full place-items-center bg-[var(--app-canvas)]">
    <LoaderCircle size={24} class="animate-spin text-[var(--app-accent)]" />
  </main>
{:else if remoteState.status === "idle" || ["rejected", "expired", "incompatible", "revoked", "error"].includes(remoteState.status)}
  <main
    data-dictation-hidden
    class="grid h-full overflow-y-auto bg-[var(--app-canvas)] p-5 text-[var(--app-text)] lg:grid-cols-[minmax(320px,560px)_minmax(280px,1fr)] lg:items-center lg:gap-12 lg:p-12"
  >
    <section class="mx-auto w-full max-w-xl">
      <div
        class="flex items-center gap-2 text-xs font-semibold uppercase text-[var(--app-accent)]"
      >
        <RadioTower size={14} />{m["remote.eyebrow"]()}
      </div>
      <h1 class="mt-3 text-2xl font-semibold leading-tight text-balance">
        {m["remote.join_title"]()}
      </h1>
      <p
        class="mt-3 max-w-lg text-sm leading-6 text-pretty text-[var(--app-text-muted)]"
      >
        {m["remote.join_body"]()}
      </p>
      {#if remoteState.status !== "idle"}<div
          class="mt-4 flex items-center gap-2 rounded-lg border border-[var(--app-danger)]/30 bg-[var(--app-danger)]/5 p-3 text-xs text-[var(--app-danger)]"
        >
          <XCircle size={15} />{statusLabel(remoteState.status)}
        </div>{/if}
      <form
        class="mt-6 space-y-4"
        onsubmit={(event) => {
          event.preventDefault();
          void connect();
        }}
      >
        <label class="grid gap-1.5 text-xs font-medium"
          >{m["remote.invite_link"]()}<Input
            type="password"
            bind:value={inviteUri}
            autocomplete="off"
            spellcheck="false"
            placeholder="orkestrai://join/..."
          /></label
        >
        <div class="grid gap-4 sm:grid-cols-2">
          <label class="grid gap-1.5 text-xs font-medium"
            >{m["remote.device_name"]()}<Input
              bind:value={displayName}
              maxlength="80"
            /></label
          ><label class="grid gap-1.5 text-xs font-medium"
            >{m["collaboration.relay"]()}<Input
              bind:value={relayUrl}
              autocomplete="off"
              spellcheck="false"
            /></label
          >
        </div>
        <Button
          type="submit"
          disabled={busy || !inviteUri.trim() || !displayName.trim()}
          >{#if busy}<LoaderCircle class="animate-spin" />{:else}<ShieldCheck
            />{/if}{m["remote.connect"]()}<ArrowRight /></Button
        >
      </form>
    </section>
    <section class="mx-auto mt-10 w-full max-w-lg lg:mt-0">
      <div
        class="relative aspect-[4/3] overflow-hidden rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] shadow-xl"
      >
        <div
          class="flex h-10 items-center gap-2 border-b border-[var(--app-border)] px-3"
        >
          <span class="size-2 rounded-full bg-[var(--app-danger)]"></span><span
            class="size-2 rounded-full bg-[var(--app-warning)]"
          ></span><span class="size-2 rounded-full bg-[var(--app-success)]"
          ></span><span class="ml-2 text-[10px] text-[var(--app-text-muted)]"
            >{m["remote.preview_title"]()}</span
          >
        </div>
        <div class="grid h-[calc(100%-40px)] grid-cols-[34%_1fr]">
          <div class="border-r border-[var(--app-border)] p-3">
            <div class="mb-4 h-2 w-2/3 rounded bg-[var(--app-accent)]/30"></div>
            {#each [1, 2, 3, 4] as item}<div
                class="mb-2 h-7 rounded bg-[var(--app-surface-raised)]"
                style:opacity={1 - item * 0.12}
              ></div>{/each}
          </div>
          <div class="grid grid-cols-2 gap-3 p-4">
            {#each [1, 2, 3, 4] as item}<div
                class="rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-raised)] p-3"
              >
                <div class="h-2 w-1/2 rounded bg-[var(--app-accent)]/35"></div>
                <div
                  class="mt-3 h-1.5 w-full rounded bg-[var(--app-border)]"
                ></div>
                <div
                  class="mt-2 h-1.5 w-3/4 rounded bg-[var(--app-border)]"
                ></div>
              </div>{/each}
          </div>
        </div>
      </div>
    </section>
  </main>
{:else if remoteState.status !== "connected" || !snapshot}
  <main
    data-dictation-hidden
    class="grid h-full place-items-center bg-[var(--app-canvas)] p-6 text-[var(--app-text)]"
  >
    <div class="max-w-md text-center">
      <span
        class="mx-auto grid size-14 place-items-center rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-raised)]"
        ><LoaderCircle
          size={25}
          class={remoteState.status === "waiting_approval" ||
          remoteState.status === "connecting" ||
          remoteState.status === "reconnecting"
            ? "animate-spin text-[var(--app-accent)]"
            : "text-[var(--app-text-muted)]"}
        /></span
      >
      <h1 class="mt-4 text-lg font-semibold">
        {statusLabel(remoteState.status)}
      </h1>
      <p class="mt-2 text-sm leading-6 text-[var(--app-text-muted)]">
        {m["remote.waiting_body"]()}
      </p>
      <Button variant="ghost" class="mt-5" onclick={leave}
        ><LogOut />{m["remote.leave"]()}</Button
      >
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
      <label class="grid gap-1.5 text-xs font-medium"
        >{m["remote.task_title"]()}<Input
          bind:value={taskTitle}
          maxlength="180"
        /></label
      ><label class="grid gap-1.5 text-xs font-medium"
        >{m["remote.task_description"]()}<Textarea
          bind:value={taskDescription}
          class="min-h-28 resize-y"
        /></label
      ><label class="grid gap-1.5 text-xs font-medium"
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
        >{#if busy}<LoaderCircle class="animate-spin" />{/if}{m[
          "remote.create_task"
        ]()}</Button
      ></Dialog.Footer
    ></Dialog.Content
  >
</Dialog.Root>
