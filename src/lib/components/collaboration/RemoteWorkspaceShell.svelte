<script lang="ts">
  import { untrack } from "svelte";
  import {
    Activity,
    ArrowRight,
    Bot,
    Check,
    CheckCircle2,
    CircleAlert,
    Clock3,
    Gauge,
    KanbanSquare,
    LogOut,
    MessageSquareText,
    MessageCircleMore,
    Mic,
    Network,
    Palette,
    Plus,
    RefreshCw,
    RotateCcw,
    Send,
    ShieldCheck,
    UsersRound,
    XCircle,
  } from "@lucide/svelte";
  import { Button } from "$lib/components/ui/button";
  import { Textarea } from "$lib/components/ui/textarea";
  import { Input } from "$lib/components/ui/input";
  import { Checkbox } from "$lib/components/ui/checkbox";
  import { Slider } from "$lib/components/ui/slider";
  import * as Select from "$lib/components/ui/select";
  import * as Tooltip from "$lib/components/ui/tooltip";
  import NodeEmptyState from "$lib/components/agent-room/canvas/NodeEmptyState.svelte";
  import { localeState } from "$lib/i18n/locale.svelte.js";
  import type { SharedWorkspaceDto } from "$lib/modules/collaboration/domain/types.js";
  import { TEXT_DICTATION_COMMAND } from "$lib/components/agent-room/text-dictation.js";
  import * as m from "$lib/paraglide/messages.js";

  type RemoteTab =
    | "overview"
    | "team"
    | "tasks"
    | "huddles"
    | "designs"
    | "reviews"
    | "activity";

  let {
    snapshot,
    role,
    scopes,
    revision,
    busy,
    activeTab = $bindable("overview"),
    leaderMessage = $bindable(""),
    onRefresh,
    onLeave,
    onCreateTask,
    onUpdateTask,
    onDecideReview,
    onCreateDesignComment,
    onReplyDesignComment,
    onResolveDesignComment,
    onCreateDesignProposal,
    onDecideDesignProposal,
    onUpdateDesignElement,
    onSendLeaderMessage,
    onCreateHuddle,
    onSendHuddleTurn,
    onEndHuddle,
  }: {
    snapshot: SharedWorkspaceDto;
    role: string | null;
    scopes: string[];
    revision: number;
    busy: boolean;
    activeTab?: RemoteTab;
    leaderMessage?: string;
    onRefresh: () => void | Promise<void>;
    onLeave: () => void | Promise<void>;
    onCreateTask: () => void;
    onUpdateTask: (taskId: string, status: string) => void | Promise<void>;
    onDecideReview: (
      reviewId: string,
      status: "approved" | "changes_requested" | "rejected",
    ) => void | Promise<void>;
    onCreateDesignComment: (
      nodeId: string,
      pageId: string,
      elementId: string | null,
      body: string,
    ) => Promise<void>;
    onReplyDesignComment: (
      nodeId: string,
      commentId: string,
      body: string,
    ) => Promise<void>;
    onResolveDesignComment: (
      nodeId: string,
      commentId: string,
      status: "open" | "resolved",
    ) => Promise<void>;
    onCreateDesignProposal: (
      nodeId: string,
      elementId: string,
      title: string,
      description: string,
      changes: RemoteDesignChanges,
    ) => Promise<void>;
    onDecideDesignProposal: (
      nodeId: string,
      proposalId: string,
      status: "approved" | "rejected",
    ) => Promise<void>;
    onUpdateDesignElement: (
      nodeId: string,
      elementId: string,
      changes: RemoteDesignChanges,
    ) => Promise<void>;
    onSendLeaderMessage: () => Promise<void>;
    onCreateHuddle: (input: {
      title: string;
      agenda: string | null;
      agentNodeIds: string[];
      facilitatorNodeId: string | null;
    }) => Promise<void>;
    onSendHuddleTurn: (
      huddleId: string,
      text: string,
      targetNodeIds: string[],
    ) => Promise<void>;
    onEndHuddle: (huddleId: string) => Promise<void>;
  } = $props();

  const canWriteTasks = $derived(scopes.includes("tasks.write"));
  const canDecideReviews = $derived(scopes.includes("approvals.decide"));
  const canMessageLeader = $derived(scopes.includes("leader.message"));
  const canCommentDesign = $derived(scopes.includes("design.comment"));
  const canProposeDesign = $derived(scopes.includes("design.propose"));
  const canDecideDesign = $derived(scopes.includes("design.decide"));
  const canEditDesign = $derived(scopes.includes("design.edit"));
  const canViewHuddles = $derived(scopes.includes("huddles.view"));
  const canSpeakHuddles = $derived(scopes.includes("huddles.speak"));
  const canManageHuddles = $derived(scopes.includes("huddles.manage"));
  const workingAgents = $derived(
    snapshot.agents.filter((agent) => agent.state === "working"),
  );
  const attentionAgents = $derived(
    snapshot.agents.filter((agent) =>
      ["waiting_input", "waiting_permission", "blocked", "error"].includes(
        agent.state,
      ),
    ),
  );
  const openTasks = $derived(
    snapshot.tasks.filter((task) => task.status !== "done"),
  );
  const pendingReviews = $derived(
    snapshot.reviews.filter((review) => review.status === "pending"),
  );
  const pendingDesignProposals = $derived(
    snapshot.designs.reduce(
      (total, design) =>
        total +
        design.proposals.filter((proposal) => proposal.status === "pending")
          .length,
      0,
    ),
  );
  let selectedDesignId = $state("");
  let selectedDesignPageId = $state("");
  let selectedDesignElementId = $state("");
  let designComment = $state("");
  let designReplies = $state<Record<string, string>>({});
  let designProposalTitle = $state("");
  let designProposalDescription = $state("");
  let designX = $state(0);
  let designY = $state(0);
  let designWidth = $state(1);
  let designHeight = $state(1);
  let designOpacity = $state(100);
  let designFill = $state("#ffffff");
  let selectedHuddleId = $state("");
  let huddleTitle = $state("");
  let huddleAgenda = $state("");
  let huddleAgents = $state<string[]>([]);
  let huddleMessage = $state("");
  let huddleTargets = $state<string[]>([]);
  let huddleComposer = $state<HTMLTextAreaElement | null>(null);
  const activeHuddle = $derived(
    snapshot.huddles.find((huddle) => huddle.status === "active") ?? null,
  );
  const selectedHuddle = $derived(
    snapshot.huddles.find((huddle) => huddle.id === selectedHuddleId) ??
      activeHuddle ??
      snapshot.huddles[0] ??
      null,
  );
  const selectedDesign = $derived(
    snapshot.designs.find((design) => design.nodeId === selectedDesignId) ??
      snapshot.designs[0] ??
      null,
  );
  const selectedDesignElements = $derived(
    selectedDesign?.elements.filter(
      (element) => element.pageId === selectedDesignPageId,
    ) ?? [],
  );
  const selectedDesignElement = $derived(
    selectedDesignElements.find(
      (element) => element.id === selectedDesignElementId,
    ) ??
      selectedDesignElements[0] ??
      null,
  );

  type RemoteDesignChanges = {
    x: number;
    y: number;
    width: number;
    height: number;
    opacity: number;
    fill: string;
  };

  // `tone` so decide a aparencia do contador: atencao (ambar), ao vivo (ponto
  // verde) ou contagem neutra. Nao muda o que cada aba mostra.
  type TabTone = "attention" | "live" | "neutral";
  const tabs = $derived([
    { id: "overview" as const, label: m["remote.overview"](), icon: Activity, tone: "neutral" as TabTone },
    {
      id: "team" as const,
      label: m["remote.team"](),
      icon: UsersRound,
      count: attentionAgents.length || undefined,
      tone: "attention" as TabTone,
    },
    {
      id: "tasks" as const,
      label: m["remote.tasks"](),
      icon: KanbanSquare,
      count: openTasks.length || undefined,
      tone: "neutral" as TabTone,
    },
    ...(canViewHuddles
      ? [
          {
            id: "huddles" as const,
            label: m["huddle.title"](),
            icon: MessageCircleMore,
            count: activeHuddle ? 1 : undefined,
            tone: "live" as TabTone,
          },
        ]
      : []),
    ...(scopes.includes("design.view")
      ? [
          {
            id: "designs" as const,
            label: m["remote.designs"](),
            icon: Palette,
            count: pendingDesignProposals || undefined,
            tone: "attention" as TabTone,
          },
        ]
      : []),
    {
      id: "reviews" as const,
      label: m["remote.approvals"](),
      icon: CheckCircle2,
      count: pendingReviews.length || undefined,
      tone: "attention" as TabTone,
    },
    { id: "activity" as const, label: m["remote.activity"](), icon: Clock3, tone: "neutral" as TabTone },
  ]);

  const pageCopy = $derived(
    {
      overview: {
        title: m["remote.overview_title"](),
        body: m["remote.overview_body"](),
      },
      team: { title: m["remote.team_title"](), body: m["remote.team_body"]() },
      tasks: { title: m["remote.tasks"](), body: m["remote.tasks_body"]() },
      huddles: { title: m["huddle.title"](), body: m["remote.huddles_body"]() },
      designs: {
        title: m["remote.designs_title"](),
        body: m["remote.designs_body"](),
      },
      reviews: {
        title: m["remote.approvals"](),
        body: m["remote.reviews_body"](),
      },
      activity: {
        title: m["remote.activity"](),
        body: m["remote.activity_body"](),
      },
    }[activeTab],
  );

  function roleLabel(value: string | null): string {
    if (!value) return "";
    const labels: Record<string, () => string> = {
      viewer: m["collaboration.role_viewer"],
      collaborator: m["collaboration.role_collaborator"],
      operator: m["collaboration.role_operator"],
      administrator: m["collaboration.role_administrator"],
    };
    return labels[value]?.() ?? value;
  }

  function usageDiagnostic(
    value: SharedWorkspaceDto["usage"][number]["diagnostic"],
  ): string {
    if (value === "provider_cli_only") return m["usage.diagnostic_cli_only"]();
    if (value === "admin_api_required")
      return m["usage.diagnostic_admin_api"]();
    if (value === "enterprise_api_required")
      return m["usage.diagnostic_enterprise_api"]();
    if (value === "model_provider_managed")
      return m["usage.diagnostic_model_provider"]();
    return m["usage.status_unavailable"]();
  }

  function updateDesignReply(commentId: string, event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    designReplies = { ...designReplies, [commentId]: input.value };
  }

  function agentStateLabel(state: string): string {
    const labels: Record<string, () => string> = {
      starting: m["control_center.state_starting"],
      working: m["control_center.state_working"],
      waiting_input: m["control_center.state_waiting_input"],
      waiting_permission: m["control_center.state_waiting_permission"],
      blocked: m["control_center.state_blocked"],
      idle: m["control_center.state_idle"],
      done: m["control_center.state_done"],
      error: m["control_center.state_error"],
      disconnected: m["control_center.state_disconnected"],
    };
    return labels[state]?.() ?? state;
  }

  function stateTone(state: string): string {
    if (state === "working" || state === "done" || state === "approved")
      return "bg-[var(--app-success)]";
    if (
      state === "waiting_input" ||
      state === "waiting_permission" ||
      state === "pending" ||
      state === "changes_requested"
    )
      return "bg-[var(--app-warning)]";
    if (state === "blocked" || state === "error" || state === "rejected")
      return "bg-[var(--app-danger)]";
    return "bg-[var(--app-text-muted)]";
  }

  // Tom semantico de uma pilula de estado (mesma regra do stateTone).
  function toneOf(state: string): "success" | "warning" | "danger" | "neutral" {
    const tone = stateTone(state);
    if (tone.includes("success")) return "success";
    if (tone.includes("warning")) return "warning";
    if (tone.includes("danger")) return "danger";
    return "neutral";
  }

  function reviewStatusLabel(status: string): string {
    const labels: Record<string, () => string> = {
      pending: m["review_center.status_pending"],
      approved: m["review_center.status_approved"],
      changes_requested: m["review_center.status_changes_requested"],
      rejected: m["review_center.status_rejected"],
    };
    return labels[status]?.() ?? status;
  }

  function relativeTime(value: string): string {
    const seconds = Math.round(
      (new Date(value).getTime() - Date.now()) / 1_000,
    );
    const formatter = new Intl.RelativeTimeFormat(
      localeState.current === "pt-BR"
        ? "pt-BR"
        : localeState.current === "es"
          ? "es-MX"
          : "en-US",
      { numeric: "auto" },
    );
    if (Math.abs(seconds) < 60) return formatter.format(seconds, "second");
    const minutes = Math.round(seconds / 60);
    if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
    const hours = Math.round(minutes / 60);
    if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
    return formatter.format(Math.round(hours / 24), "day");
  }

  function windowLabel(kind: "5h" | "weekly" | "monthly"): string {
    if (kind === "5h") return m["usage.window_5h"]();
    if (kind === "weekly") return m["usage.window_weekly"]();
    return m["usage.window_monthly"]();
  }

  function usageTone(percent: number): string {
    if (percent >= 85) return "var(--app-danger)";
    if (percent >= 60) return "var(--app-warning)";
    return "var(--app-success)";
  }

  function providerIcon(provider: string): string | null {
    return ["claude", "codex", "kimi"].includes(provider)
      ? `/images/${provider}.svg`
      : null;
  }

  function providerMask(provider: string): string {
    const icon = providerIcon(provider);
    return icon
      ? `-webkit-mask:url(${icon}) center/contain no-repeat;mask:url(${icon}) center/contain no-repeat;background:var(--app-text)`
      : "";
  }

  function nodeStyle(node: SharedWorkspaceDto["nodes"][number]): string {
    if (!snapshot.nodes.length) return "";
    const minX = Math.min(...snapshot.nodes.map((item) => item.x));
    const minY = Math.min(...snapshot.nodes.map((item) => item.y));
    const maxX = Math.max(...snapshot.nodes.map((item) => item.x + item.width));
    const maxY = Math.max(
      ...snapshot.nodes.map((item) => item.y + item.height),
    );
    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    return `left:${((node.x - minX) / width) * 100}%;top:${((node.y - minY) / height) * 100}%;width:${Math.max(5, (node.width / width) * 100)}%;height:${Math.max(7, (node.height / height) * 100)}%`;
  }

  $effect(() => {
    if (!snapshot.designs.some((design) => design.nodeId === selectedDesignId))
      selectedDesignId = snapshot.designs[0]?.nodeId ?? "";
  });

  $effect(() => {
    if (!snapshot.huddles.some((huddle) => huddle.id === selectedHuddleId))
      selectedHuddleId = activeHuddle?.id ?? snapshot.huddles[0]?.id ?? "";
  });

  $effect(() => {
    if (!selectedHuddle) return;
    const ids = selectedHuddle.participants
      .filter((participant) => participant.kind === "agent")
      .map((participant) => participant.participantId);
    // untrack: ler e escrever huddleTargets no mesmo efeito entrava em loop
    // (effect_update_depth_exceeded) e congelava o shell com huddle aberto.
    untrack(() => {
      huddleTargets = huddleTargets.filter((id) => ids.includes(id));
      if (!huddleTargets.length) huddleTargets = ids.slice(0, 5);
    });
  });

  function toggleHuddleAgent(id: string, checked: boolean): void {
    huddleAgents = checked
      ? [...new Set([...huddleAgents, id])]
      : huddleAgents.filter((item) => item !== id);
  }

  function toggleHuddleTarget(id: string, checked: boolean): void {
    huddleTargets = checked
      ? [...new Set([...huddleTargets, id])].slice(0, 5)
      : huddleTargets.filter((item) => item !== id);
  }

  async function createRemoteHuddle(): Promise<void> {
    if (!huddleTitle.trim() || !huddleAgents.length) return;
    await onCreateHuddle({
      title: huddleTitle.trim(),
      agenda: huddleAgenda.trim() || null,
      agentNodeIds: huddleAgents,
      facilitatorNodeId: huddleAgents[0] ?? null,
    });
    huddleTitle = "";
    huddleAgenda = "";
    huddleAgents = [];
  }

  async function sendRemoteHuddleTurn(): Promise<void> {
    if (!selectedHuddle || !huddleMessage.trim() || !huddleTargets.length)
      return;
    const text = huddleMessage.trim();
    huddleMessage = "";
    await onSendHuddleTurn(selectedHuddle.id, text, huddleTargets);
  }

  function dictateHuddle(): void {
    huddleComposer?.focus();
    requestAnimationFrame(() =>
      window.dispatchEvent(new Event(TEXT_DICTATION_COMMAND)),
    );
  }

  $effect(() => {
    if (!selectedDesign?.pages.some((page) => page.id === selectedDesignPageId))
      selectedDesignPageId = selectedDesign?.pages[0]?.id ?? "";
  });

  $effect(() => {
    if (
      !selectedDesignElements.some(
        (element) => element.id === selectedDesignElementId,
      )
    )
      selectedDesignElementId = selectedDesignElements[0]?.id ?? "";
  });

  $effect(() => {
    if (!selectedDesignElement) return;
    designX = selectedDesignElement.x;
    designY = selectedDesignElement.y;
    designWidth = selectedDesignElement.width;
    designHeight = selectedDesignElement.height;
    designOpacity = Math.round(selectedDesignElement.opacity * 100);
    designFill = selectedDesignElement.fill;
  });

  function remoteDesignChanges(): RemoteDesignChanges {
    return {
      x: Number(designX),
      y: Number(designY),
      width: Math.max(1, Number(designWidth)),
      height: Math.max(1, Number(designHeight)),
      opacity: Math.max(0, Math.min(1, Number(designOpacity) / 100)),
      fill: designFill,
    };
  }

  async function submitDesignComment(): Promise<void> {
    if (!selectedDesign || !designComment.trim()) return;
    await onCreateDesignComment(
      selectedDesign.nodeId,
      selectedDesignPageId,
      selectedDesignElement?.id ?? null,
      designComment.trim(),
    );
    designComment = "";
  }

  async function submitDesignProposal(): Promise<void> {
    if (
      !selectedDesign ||
      !selectedDesignElement ||
      !designProposalTitle.trim()
    )
      return;
    await onCreateDesignProposal(
      selectedDesign.nodeId,
      selectedDesignElement.id,
      designProposalTitle.trim(),
      designProposalDescription.trim(),
      remoteDesignChanges(),
    );
    designProposalTitle = "";
    designProposalDescription = "";
  }

  async function applyDirectDesignEdit(): Promise<void> {
    if (!selectedDesign || !selectedDesignElement) return;
    await onUpdateDesignElement(
      selectedDesign.nodeId,
      selectedDesignElement.id,
      remoteDesignChanges(),
    );
  }

  async function submitDesignReply(commentId: string): Promise<void> {
    if (!selectedDesign || !(designReplies[commentId] ?? "").trim()) return;
    await onReplyDesignComment(
      selectedDesign.nodeId,
      commentId,
      designReplies[commentId].trim(),
    );
    designReplies = { ...designReplies, [commentId]: "" };
  }
</script>

<main
  class="grid h-full min-h-0 grid-cols-1 grid-rows-[48px_minmax(0,1fr)_auto] overflow-hidden bg-[var(--app-canvas)] text-[var(--app-text)] md:grid-cols-[232px_minmax(0,1fr)] md:grid-rows-[48px_minmax(0,1fr)]"
>
  <aside
    class="row-span-2 hidden min-h-0 flex-col border-r border-[var(--app-border)] bg-[var(--app-sidebar)] md:flex"
  >
    <div class="flex h-12 shrink-0 items-center gap-2 px-3">
      <span class="rw-brand" aria-hidden="true"><img src="/brand/icon.svg" width="14" height="14" alt="" /></span>
      <strong class="font-display text-[14.5px] font-semibold tracking-[-0.01em]">Orkestrai</strong>
      <span class="rw-chip ml-auto">{m["remote.companion_badge"]()}</span>
    </div>
    <nav class="grid grid-cols-1 gap-px px-2 pt-1" aria-label={m["remote.navigation"]()}>
      {#each tabs as tab (tab.id)}
        <button
          type="button"
          class="rw-row"
          class:selected={activeTab === tab.id}
          aria-current={activeTab === tab.id ? "page" : undefined}
          onclick={() => (activeTab = tab.id)}
        >
          <tab.icon size={14} class="rw-row-icon" aria-hidden="true" />
          <span class="min-w-0 flex-1 truncate">{tab.label}</span>
          {#if tab.count}
            {#if tab.tone === "live"}
              <span class="rw-live" title={m["huddle.live"]()}
                ><span class="sr-only">{m["huddle.live"]()}</span></span
              >
            {:else}
              <span class={tab.tone === "attention" ? "rw-badge" : "rw-count"}>{tab.count}</span>
            {/if}
          {/if}
        </button>
      {/each}
    </nav>
    <div class="mt-auto grid gap-2 border-t border-[var(--app-border)] p-3">
      <span class="section-label">{m["remote.your_access"]()}</span>
      <div class="flex min-w-0 items-center gap-2">
        {#if role}<span class="rw-chip min-w-0 truncate">{roleLabel(role)}</span>{/if}
        <span class="meta-mono ml-auto shrink-0">{m["remote.revision"]({ revision })}</span>
      </div>
      <p class="flex min-w-0 items-center gap-1.5 text-ui-xs text-[var(--app-text-muted)]">
        <ShieldCheck size={13} class="shrink-0 text-[var(--app-success)]" aria-hidden="true" />
        <span class="truncate">{m["remote.encrypted_connection"]()}</span>
      </p>
    </div>
  </aside>

  <header
    class="flex min-w-0 items-center gap-2 border-b border-[var(--app-border)] bg-[var(--app-sidebar)] pr-2 pl-3 md:col-start-2 md:pl-5"
  >
    <span class="rw-brand mobile-only" aria-hidden="true"><img src="/brand/icon.svg" width="14" height="14" alt="" /></span>
    <div class="min-w-0">
      <h1
        class="truncate font-display text-[14px] font-semibold tracking-[-0.01em]"
        title={snapshot.workspace.name}
      >
        {snapshot.workspace.name}
      </h1>
      <p class="truncate text-ui-xs text-[var(--app-text-muted)] md:hidden">
        {roleLabel(role)} · <span class="tabular-nums">{m["remote.revision"]({ revision })}</span>
      </p>
    </div>
    <span class="hidden shrink-0 sm:inline-flex"
      ><span class="rw-pill" data-tone="success"
        ><span class="rw-pill-dot" aria-hidden="true"></span>{m["remote.live"]()}</span
      ></span
    >
    <div class="ml-auto h-full w-[60px] shrink-0" data-dictation-dock aria-hidden="true"></div>
    <Tooltip.Root
      ><Tooltip.Trigger
        >{#snippet child({ props })}<Button
            {...props}
            variant="ghost"
            size="icon-sm"
            class="text-[var(--app-text-soft)]"
            aria-label={m["remote.refresh"]()}
            onclick={onRefresh}><RefreshCw size={14} aria-hidden="true" /></Button
          >{/snippet}</Tooltip.Trigger
      ><Tooltip.Content>{m["remote.refresh"]()}</Tooltip.Content></Tooltip.Root
    >
    <Button variant="ghost" size="sm" class="text-[var(--app-text-soft)]" onclick={onLeave}
      ><LogOut size={14} aria-hidden="true" /><span class="max-sm:sr-only">{m["remote.leave"]()}</span></Button
    >
  </header>

  <section class="min-h-0 overflow-y-auto overscroll-contain md:col-start-2">
    <div class="mx-auto w-full max-w-[1180px] px-4 py-6 pb-12 sm:px-6 lg:px-8">
      <header class="mb-6 flex min-w-0 flex-wrap items-end gap-x-4 gap-y-3">
        <div class="min-w-0 flex-1">
          <h2 class="font-display text-[20px] font-semibold tracking-[-0.015em] text-balance">
            {pageCopy.title}
          </h2>
          <p class="mt-1 max-w-2xl text-xs leading-5 text-pretty text-[var(--app-text-muted)]">
            {pageCopy.body}
          </p>
        </div>
        {#if activeTab === "tasks" && canWriteTasks}<Button
            size="sm"
            class="shrink-0"
            onclick={onCreateTask}
            ><Plus size={14} aria-hidden="true" />{m["remote.create_task"]()}</Button
          >{/if}
      </header>

      {#if activeTab === "overview"}
        <div class="rw-panel grid grid-cols-1 gap-7">
          {#if attentionAgents.length || pendingReviews.length}
            <button
              type="button"
              class="rw-attention"
              onclick={() => (activeTab = attentionAgents.length ? "team" : "reviews")}
            >
              <CircleAlert size={16} class="shrink-0 text-[var(--app-warning)]" aria-hidden="true" />
              <span class="min-w-0 flex-1"
                ><strong class="block text-ui-lg font-semibold">{m["remote.attention_title"]()}</strong
                ><span class="mt-0.5 block truncate text-ui-sm tabular-nums text-[var(--app-text-soft)]"
                  >{m["remote.attention_body"]({
                    agents: attentionAgents.length,
                    reviews: pendingReviews.length,
                  })}</span
                ></span
              >
              <ArrowRight size={15} class="rw-attention-arrow shrink-0" aria-hidden="true" />
            </button>
          {/if}

          <section class="grid grid-cols-2 gap-2 lg:grid-cols-4" aria-label={m["remote.workspace_status"]()}>
            {#each [{ label: m["remote.agents_working"](), value: workingAgents.length, icon: Activity }, { label: m["remote.open_tasks"](), value: openTasks.length, icon: KanbanSquare }, { label: m["remote.pending_reviews"](), value: pendingReviews.length, icon: CheckCircle2 }, { label: m["remote.team_size"](), value: snapshot.agents.length, icon: UsersRound }] as metric}
              <div class="rw-card grid min-h-[84px] min-w-0 grid-cols-1 content-between gap-3 p-3.5">
                <span class="flex min-w-0 items-center gap-1.5">
                  <metric.icon size={13} class="shrink-0 text-[var(--app-text-muted)]" aria-hidden="true" />
                  <span class="section-label truncate" title={metric.label}>{metric.label}</span>
                </span>
                <strong class="font-display text-[26px] font-semibold leading-none tabular-nums">{metric.value}</strong>
              </div>
            {/each}
          </section>

          <div class="grid min-w-0 grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1.25fr)_minmax(280px,.75fr)]">
            <div class="min-w-0 space-y-8">
              <section>
                <div class="rw-section-head">
                  <h3>{m["remote.active_work"]()}</h3>
                  <span class="meta-mono">{workingAgents.length}</span>
                  <Button
                    variant="ghost"
                    size="xs"
                    class="ml-auto text-[var(--app-text-soft)]"
                    onclick={() => (activeTab = "team")}
                    >{m["remote.view_all"]()}<ArrowRight aria-hidden="true" /></Button
                  >
                </div>
                <div class="rw-card overflow-hidden">
                  {#each workingAgents.slice(0, 5) as agent (agent.id)}
                    <div class="rw-list-item grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
                      <span class="rw-avatar">
                        {#if agent.provider && providerIcon(agent.provider)}<span
                            class="size-4"
                            style={providerMask(agent.provider)}
                          ></span>{:else}<Bot size={15} class="text-[var(--app-text-muted)]" aria-hidden="true" />{/if}
                        <span class="rw-avatar-dot bg-[var(--app-success)]" aria-hidden="true"></span>
                      </span>
                      <div class="min-w-0">
                        <p class="truncate text-xs font-medium">{agent.title}</p>
                        <p class="mt-0.5 truncate text-ui-xs text-[var(--app-text-muted)]">
                          {agent.currentTask?.title ??
                            agent.role ??
                            agent.provider ??
                            m["remote.no_current_task"]()}
                        </p>
                      </div>
                      <span class="text-ui-xs tabular-nums text-[var(--app-text-muted)]"
                        >{relativeTime(agent.stateSince)}</span
                      >
                    </div>
                  {:else}
                    <NodeEmptyState compact icon={Activity} title={m["remote.no_active_work"]()} />
                  {/each}
                </div>
              </section>

              <section>
                <div class="rw-section-head">
                  <h3>{m["remote.canvas_map"]()}</h3>
                  <span class="meta-mono">{snapshot.nodes.length}</span>
                </div>
                {#if snapshot.nodes.length}
                  <div class="rw-card rw-map relative aspect-[16/7] min-h-56 overflow-hidden">
                    <div class="absolute inset-3">
                      {#each snapshot.nodes as node (node.id)}
                        <div
                          class="rw-map-node"
                          class:agent={node.type === "agent"}
                          style={nodeStyle(node)}
                          title={node.title ?? node.type}
                        >
                          {#if node.type === "agent"}<Bot size={11} class="shrink-0" aria-hidden="true" />{/if}
                          <span class="truncate">{node.title ?? node.type}</span>
                        </div>
                      {/each}
                    </div>
                  </div>
                {:else}
                  <div class="rw-card">
                    <NodeEmptyState compact icon={Network} title={m["remote.map_empty"]()} />
                  </div>
                {/if}
              </section>
            </div>

            <aside class="min-w-0 space-y-8">
              {#if canMessageLeader}
                <section>
                  <div class="rw-section-head">
                    <h3>{m["remote.message_leader"]()}</h3>
                  </div>
                  <div class="rw-card rw-composer p-2">
                    <Textarea
                      bind:value={leaderMessage}
                      aria-label={m["remote.message_leader"]()}
                      class="min-h-24 resize-none border-0 bg-transparent px-1.5 py-1 text-xs shadow-none hover:border-transparent focus-visible:ring-0 md:text-xs dark:bg-transparent"
                      placeholder={m["remote.message_placeholder"]()}
                    />
                    <div class="mt-1 flex items-center justify-between gap-2 px-1 pt-1">
                      <span class="flex min-w-0 items-center gap-1.5 text-ui-xs text-[var(--app-text-muted)]"
                        ><ShieldCheck size={12} class="shrink-0" aria-hidden="true" /><span class="truncate"
                          >{m["remote.message_traceable"]()}</span
                        ></span
                      ><Button
                        size="sm"
                        disabled={busy || !leaderMessage.trim()}
                        onclick={onSendLeaderMessage}
                        ><Send size={13} aria-hidden="true" />{m["remote.send"]()}</Button
                      >
                    </div>
                  </div>
                </section>
              {/if}

              <section>
                <div class="rw-section-head">
                  <h3>{m["remote.provider_usage"]()}</h3>
                </div>
                {#if snapshot.usage.length}
                  <div class="rw-card divide-y divide-[var(--app-border)] overflow-hidden">
                    {#each snapshot.usage as usage (usage.provider)}
                      <div class="p-3">
                        <div class="flex min-w-0 items-center gap-2">
                          {#if providerIcon(usage.provider)}<span
                              class="size-3.5 shrink-0"
                              style={providerMask(usage.provider)}
                            ></span>{/if}<strong class="truncate text-ui-lg font-semibold capitalize"
                            >{usage.provider}</strong
                          >{#if usage.plan}<span class="rw-chip">{usage.plan}</span>{/if}
                        </div>
                        {#if usage.available}<div class="mt-2.5 grid gap-2">
                            {#each usage.windows as window}<div>
                                <div class="mb-1 flex text-ui-xs text-[var(--app-text-muted)]">
                                  <span>{windowLabel(window.kind)}</span><strong
                                    class="ml-auto font-medium tabular-nums text-[var(--app-text-soft)]"
                                    >{window.usedPercent}%</strong
                                  >
                                </div>
                                <div class="h-1 overflow-hidden rounded-full bg-[var(--app-hover)]">
                                  <span
                                    class="block h-full rounded-full"
                                    style:width={`${window.usedPercent}%`}
                                    style:background={usageTone(window.usedPercent)}
                                  ></span>
                                </div>
                              </div>{/each}
                          </div>{:else}<p
                            class="mt-1.5 text-ui-xs leading-4 text-pretty text-[var(--app-text-muted)]"
                          >
                            {usageDiagnostic(usage.diagnostic)}
                          </p>{/if}
                      </div>
                    {/each}
                  </div>
                {:else}
                  <div class="rw-card">
                    <NodeEmptyState compact icon={Gauge} title={m["remote.usage_waiting"]()} />
                  </div>
                {/if}
              </section>
            </aside>
          </div>
        </div>
      {:else if activeTab === "team"}
        {#if snapshot.agents.length}
          <div class="rw-panel grid grid-cols-1 gap-2 lg:grid-cols-2">
            {#each snapshot.agents as agent (agent.id)}
              <article class="rw-card grid grid-cols-[auto_minmax(0,1fr)] gap-3 p-3.5">
                <span class="rw-avatar"
                  >{#if agent.provider && providerIcon(agent.provider)}<span
                      class="size-4"
                      style={providerMask(agent.provider)}
                    ></span>{:else}<Bot size={16} class="text-[var(--app-text-muted)]" aria-hidden="true" />{/if}</span
                >
                <div class="min-w-0">
                  <div class="flex min-w-0 items-start gap-2">
                    <div class="min-w-0 flex-1">
                      <h3 class="truncate text-xs font-semibold">{agent.title}</h3>
                      <p class="mt-0.5 truncate text-ui-xs text-[var(--app-text-muted)]">
                        {agent.role ?? agent.provider ?? ""}
                      </p>
                    </div>
                    <span class="rw-pill shrink-0" data-tone={toneOf(agent.state)}
                      ><span class="rw-pill-dot" aria-hidden="true"></span>{agentStateLabel(agent.state)}</span
                    >
                  </div>
                  <div class="mt-3 flex items-center gap-2 border-t border-[var(--app-border)] pt-2">
                    <KanbanSquare size={12} class="shrink-0 text-[var(--app-text-muted)]" aria-hidden="true" /><span
                      class="min-w-0 flex-1 truncate text-ui-xs text-[var(--app-text-soft)]"
                      >{agent.currentTask?.title ?? m["remote.no_current_task"]()}</span
                    ><span class="shrink-0 text-ui-xs tabular-nums text-[var(--app-text-muted)]"
                      >{relativeTime(agent.stateSince)}</span
                    >
                  </div>
                </div>
              </article>
            {/each}
          </div>
        {:else}
          <div class="rw-panel rw-card">
            <NodeEmptyState icon={UsersRound} title={m["remote.no_agents"]()} />
          </div>
        {/if}
      {:else if activeTab === "tasks"}
        <div class="rw-panel -mx-1 flex min-w-0 snap-x snap-mandatory gap-3 overflow-x-auto px-1 pt-px pb-3">
          {#each snapshot.columns as column (column.id)}
            {@const columnTasks = snapshot.tasks.filter(
              (task) => task.status === column.key || task.status === column.name,
            )}
            <section class="rw-column w-[min(300px,85vw)] shrink-0 snap-start lg:w-auto lg:max-w-[340px] lg:min-w-[232px] lg:flex-1 lg:basis-0">
              <header class="flex h-9 items-center gap-2 px-3">
                <span class="size-2 shrink-0 rounded-full" style:background={column.color} aria-hidden="true"></span>
                <h3 class="min-w-0 truncate text-ui-sm font-semibold">
                  {column.name ?? column.key}
                </h3>
                <span class="meta-mono ml-auto">{columnTasks.length}</span>
              </header>
              <div class="grid grid-cols-1 gap-1.5 p-1.5 pt-0">
                {#each columnTasks as task (task.id)}
                  <article class="rw-task">
                    <h4 class="text-xs font-medium leading-5 text-pretty">{task.title}</h4>
                    {#if task.description}<p
                        class="mt-1 line-clamp-3 text-ui-xs leading-4 text-[var(--app-text-muted)]"
                      >
                        {task.description}
                      </p>{/if}
                    <div class="mt-2.5 flex items-center gap-2">
                      <span class="min-w-0 flex-1 truncate text-ui-xs text-[var(--app-text-soft)]"
                        >{task.assigneeTitle ?? m["remote.unassigned"]()}</span
                      >{#if canWriteTasks}<Select.Root
                          type="single"
                          value={task.status}
                          onValueChange={(value: string) => void onUpdateTask(task.id, value)}
                          disabled={busy}
                          ><Select.Trigger
                            size="sm"
                            class="h-7 max-w-32 text-ui-xs"
                            aria-label={m["remote.task_column"]()}
                            ><span class="truncate">{column.name ?? column.key}</span></Select.Trigger
                          ><Select.Content
                            >{#each snapshot.columns as target}<Select.Item value={target.key}
                                >{target.name ?? target.key}</Select.Item
                              >{/each}</Select.Content
                          ></Select.Root
                        >{/if}
                    </div>
                  </article>
                {:else}
                  <p class="rw-col-empty">{m["remote.column_empty"]()}</p>
                {/each}
              </div>
            </section>
          {/each}
        </div>
      {:else if activeTab === "huddles"}
        {#if snapshot.huddles.length || canManageHuddles}
          <div class="rw-panel grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
            <aside class="min-w-0">
              <h3 class="section-label mb-2 px-1">{m["huddle.history"]()}</h3>
              {#if snapshot.huddles.length}
                <div class="grid grid-cols-1 gap-px">
                  {#each snapshot.huddles as huddle (huddle.id)}
                    <button
                      type="button"
                      class="rw-row two-line"
                      class:selected={selectedHuddle?.id === huddle.id}
                      aria-current={selectedHuddle?.id === huddle.id ? "true" : undefined}
                      onclick={() => (selectedHuddleId = huddle.id)}
                    >
                      <span
                        class={`size-2 shrink-0 rounded-full ${huddle.status === "active" ? "bg-[var(--app-success)]" : "bg-[var(--app-text-muted)]"}`}
                        aria-hidden="true"
                      ></span>
                      <span class="grid min-w-0 flex-1 grid-cols-1">
                        <span class="truncate font-medium">{huddle.title}</span>
                        <span class="truncate text-ui-xs tabular-nums text-[var(--app-text-muted)]"
                          >{huddle.participants.length}
                          {m["huddle.people"]()} · {huddle.turns.length}
                          {m["remote.huddle_turns"]()}</span
                        >
                      </span>
                    </button>
                  {/each}
                </div>
              {:else}
                <div class="rw-card">
                  <NodeEmptyState compact icon={MessageCircleMore} title={m["remote.huddles_empty_title"]()} />
                </div>
              {/if}
            </aside>
            <div class="min-w-0 space-y-5">
              {#if !activeHuddle && canManageHuddles}
                <section class="rw-card p-4">
                  <h3 class="text-ui-lg font-semibold">{m["huddle.start_title"]()}</h3>
                  <p class="mt-1 text-ui-sm leading-snug text-pretty text-[var(--app-text-muted)]">
                    {m["remote.huddle_remote_hint"]()}
                  </p>
                  <div class="mt-4 grid gap-3.5">
                    <label class="grid grid-cols-1 gap-1.5"
                      ><span class="text-ui-md font-medium">{m["huddle.topic"]()}</span><Input
                        bind:value={huddleTitle}
                        maxlength="160"
                        placeholder={m["huddle.topic_placeholder"]()}
                      /></label
                    >
                    <label class="grid grid-cols-1 gap-1.5"
                      ><span class="text-ui-md font-medium">{m["huddle.agenda"]()}</span><Textarea
                        bind:value={huddleAgenda}
                        maxlength="8000"
                        class="min-h-20 resize-y"
                        placeholder={m["huddle.agenda_placeholder"]()}
                      /></label
                    >
                    <fieldset class="grid grid-cols-1 gap-1.5">
                      <legend class="mb-1.5 flex w-full items-center text-ui-md font-medium"
                        >{m["huddle.choose_agents"]()}<span class="meta-mono ml-auto">{huddleAgents.length}/11</span></legend
                      >
                      <div class="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                        {#each snapshot.agents as agent (agent.id)}<label class="rw-check"
                            ><Checkbox
                              checked={huddleAgents.includes(agent.id)}
                              disabled={!huddleAgents.includes(agent.id) && huddleAgents.length >= 11}
                              onCheckedChange={(value: boolean | "indeterminate") =>
                                toggleHuddleAgent(agent.id, value === true)}
                            /><span class="min-w-0 flex-1 truncate">{agent.title}</span></label
                          >{:else}<p class="text-ui-sm text-pretty text-[var(--app-text-muted)] sm:col-span-2">
                            {m["huddle.no_agents_hint"]()}
                          </p>{/each}
                      </div>
                    </fieldset>
                    <div>
                      <Button
                        size="sm"
                        disabled={busy || !huddleTitle.trim() || !huddleAgents.length}
                        onclick={createRemoteHuddle}
                        ><MessageCircleMore size={13} aria-hidden="true" />{m["huddle.start"]()}</Button
                      >
                    </div>
                  </div>
                </section>
              {/if}
              {#if selectedHuddle}
                <section class="rw-card overflow-hidden">
                  <header class="flex flex-wrap items-start gap-3 border-b border-[var(--app-border)] p-4">
                    <div class="min-w-0 flex-1">
                      <div class="flex min-w-0 items-center gap-2">
                        <h3 class="truncate text-ui-lg font-semibold">{selectedHuddle.title}</h3>
                        <span
                          class="rw-pill shrink-0"
                          data-tone={selectedHuddle.status === "active" ? "success" : "neutral"}
                          ><span class="rw-pill-dot" aria-hidden="true"></span>{selectedHuddle.status === "active"
                            ? m["huddle.live"]()
                            : m["huddle.finished"]()}</span
                        >
                      </div>
                      {#if selectedHuddle.agenda}<p
                          class="mt-1 text-ui-sm leading-snug text-pretty text-[var(--app-text-muted)]"
                        >
                          {selectedHuddle.agenda}
                        </p>{/if}
                    </div>
                    {#if selectedHuddle.status === "active" && canManageHuddles}<Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onclick={() => onEndHuddle(selectedHuddle.id)}>{m["huddle.end"]()}</Button
                      >{/if}
                  </header>
                  <div class="max-h-[48vh] min-h-52 space-y-3 overflow-y-auto overscroll-contain p-4">
                    {#each selectedHuddle.turns as turn (turn.id)}<article
                        class="rw-turn"
                        class:remote={turn.speakerKind === "remote"}
                      >
                        <div class="flex items-center gap-2 text-ui-xs">
                          <strong class="font-semibold">{turn.speakerName}</strong><span class="meta-mono"
                            >#{turn.sequence}</span
                          >{#if turn.state === "pending"}<span
                              class="size-2 animate-pulse rounded-full bg-[var(--app-warning)]"
                              aria-hidden="true"
                            ></span>{:else if turn.state === "failed"}<span class="text-[var(--app-danger)]"
                              >{m["huddle.reply_failed"]()}</span
                            >{/if}
                        </div>
                        {#if turn.text}<p class="mt-1 whitespace-pre-wrap text-xs leading-5">
                            {turn.text}
                          </p>{/if}
                      </article>{:else}<NodeEmptyState
                        compact
                        icon={MessageCircleMore}
                        title={m["huddle.transcript_empty"]()}
                      />{/each}
                  </div>
                  {#if selectedHuddle.status === "active" && canSpeakHuddles}<footer
                      class="grid grid-cols-1 gap-2 border-t border-[var(--app-border)] p-3"
                    >
                      <div class="flex flex-wrap items-center gap-1.5">
                        <span class="mr-0.5 text-ui-xs font-medium text-[var(--app-text-muted)]">{m["huddle.ask"]()}</span>
                        {#each selectedHuddle.participants.filter((participant) => participant.kind === "agent") as participant (participant.participantId)}<label
                            class="rw-check chip"
                            ><Checkbox
                              class="size-3.5"
                              checked={huddleTargets.includes(participant.participantId)}
                              disabled={!huddleTargets.includes(participant.participantId) &&
                                huddleTargets.length >= 5}
                              onCheckedChange={(value: boolean | "indeterminate") =>
                                toggleHuddleTarget(participant.participantId, value === true)}
                            />{participant.displayName}</label
                          >{/each}
                      </div>
                      <div class="flex items-end gap-2">
                        <Textarea
                          bind:ref={huddleComposer}
                          bind:value={huddleMessage}
                          aria-label={m["huddle.message_placeholder"]()}
                          class="min-h-16 resize-y text-xs md:text-xs"
                          placeholder={m["huddle.message_placeholder"]()}
                        /><Tooltip.Root
                          ><Tooltip.Trigger
                            >{#snippet child({ props })}<Button
                                {...props}
                                variant="ghost"
                                size="icon"
                                class="shrink-0 text-[var(--app-text-soft)]"
                                aria-label={m["huddle.dictate"]()}
                                onclick={dictateHuddle}><Mic size={15} aria-hidden="true" /></Button
                              >{/snippet}</Tooltip.Trigger
                          ><Tooltip.Content>{m["huddle.dictate"]()}</Tooltip.Content></Tooltip.Root
                        ><Button
                          class="shrink-0"
                          disabled={busy || !huddleMessage.trim() || !huddleTargets.length}
                          onclick={sendRemoteHuddleTurn}
                          ><Send size={13} aria-hidden="true" />{m["huddle.send"]()}</Button
                        >
                      </div>
                    </footer>{/if}
                </section>
              {/if}
            </div>
          </div>
        {:else}
          <div class="rw-panel rw-card">
            <NodeEmptyState
              icon={MessageCircleMore}
              title={m["remote.huddles_empty_title"]()}
              description={m["remote.huddle_remote_hint"]()}
            />
          </div>
        {/if}
      {:else if activeTab === "designs"}
        {#if snapshot.designs.length}
          <div class="rw-panel grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
            <aside class="grid min-w-0 grid-cols-1 content-start gap-px">
              {#each snapshot.designs as design (design.nodeId)}
                <button
                  type="button"
                  class="rw-row two-line"
                  class:selected={selectedDesign?.nodeId === design.nodeId}
                  aria-current={selectedDesign?.nodeId === design.nodeId ? "true" : undefined}
                  onclick={() => (selectedDesignId = design.nodeId)}
                >
                  <Palette size={14} class="rw-row-icon self-start mt-0.5" aria-hidden="true" />
                  <span class="grid min-w-0 flex-1 grid-cols-1 gap-0.5">
                    <span class="truncate font-medium">{design.name}</span>
                    <span class="truncate text-ui-xs tabular-nums text-[var(--app-text-muted)]"
                      >{m["remote.design_pages_layers"]({
                        pages: String(design.pageCount),
                        layers: String(design.elementCount),
                      })}</span
                    >
                    {#if design.presences.length}<span
                        class="flex items-center gap-1.5 text-ui-xs tabular-nums text-[var(--app-success)]"
                        ><span class="size-1.5 rounded-full bg-[var(--app-success)]" aria-hidden="true"></span>{m[
                          "remote.design_live_people"
                        ]({
                          count: String(design.presences.length),
                        })}</span
                      >{/if}
                  </span>
                </button>
              {/each}
            </aside>
            {#if selectedDesign}
              <div class="min-w-0 space-y-7">
                <header class="flex flex-wrap items-start gap-3">
                  <div class="min-w-0 flex-1">
                    <h3 class="truncate font-display text-[16px] font-semibold tracking-[-0.01em]">
                      {selectedDesign.name}
                    </h3>
                    <p class="mt-1 text-ui-xs tabular-nums text-[var(--app-text-muted)]">
                      {m["remote.revision"]({
                        revision: selectedDesign.revision,
                      })} · {m["remote.design_pages_layers"]({
                        pages: String(selectedDesign.pageCount),
                        layers: String(selectedDesign.elementCount),
                      })}
                    </p>
                  </div>
                  <div class="flex -space-x-1.5">
                    {#each selectedDesign.presences.slice(0, 6) as presence}<span
                        class="grid size-7 place-items-center rounded-full text-ui-xs font-semibold text-white ring-2 ring-[var(--app-canvas)]"
                        style:background={presence.color}
                        title={presence.name}>{presence.name.slice(0, 1).toUpperCase()}</span
                      >{/each}
                  </div>
                </header>
                <section class="rw-card grid grid-cols-1 gap-4 p-4">
                  <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label class="grid grid-cols-1 gap-1.5"
                      ><span class="text-ui-md font-medium">{m["remote.design_page"]()}</span><Select.Root
                        type="single"
                        value={selectedDesignPageId}
                        onValueChange={(value: string) => (selectedDesignPageId = value)}
                        ><Select.Trigger class="w-full"
                          ><span class="truncate"
                            >{selectedDesign.pages.find((page) => page.id === selectedDesignPageId)?.name ??
                              m["remote.design_page"]()}</span
                          ></Select.Trigger
                        ><Select.Content
                          >{#each selectedDesign.pages as page}<Select.Item value={page.id}
                              >{page.name}</Select.Item
                            >{/each}</Select.Content
                        ></Select.Root
                      ></label
                    >
                    <label class="grid grid-cols-1 gap-1.5"
                      ><span class="text-ui-md font-medium">{m["remote.design_layer"]()}</span><Select.Root
                        type="single"
                        value={selectedDesignElement?.id ?? ""}
                        onValueChange={(value: string) => (selectedDesignElementId = value)}
                        ><Select.Trigger class="w-full"
                          ><span class="truncate"
                            >{selectedDesignElement?.name ?? m["remote.design_no_layer"]()}</span
                          ></Select.Trigger
                        ><Select.Content
                          >{#each selectedDesignElements as element}<Select.Item value={element.id}
                              >{element.name} · {element.type}</Select.Item
                            >{/each}</Select.Content
                        ></Select.Root
                      ></label
                    >
                  </div>
                  {#if (canProposeDesign || canEditDesign) && selectedDesignElement}
                    <div class="grid grid-cols-1 gap-4 border-t border-[var(--app-border)] pt-4">
                      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <fieldset class="grid grid-cols-1 gap-1.5">
                          <legend class="mb-1.5 text-ui-md font-medium">{m["design.proposal_position"]()}</legend>
                          <div class="grid grid-cols-2 gap-2">
                            <label class="rw-num"
                              ><span class="rw-num-prefix">X</span><Input
                                type="number"
                                class="pl-7 font-mono text-[12px] tabular-nums md:text-[12px]"
                                bind:value={designX}
                              /></label
                            ><label class="rw-num"
                              ><span class="rw-num-prefix">Y</span><Input
                                type="number"
                                class="pl-7 font-mono text-[12px] tabular-nums md:text-[12px]"
                                bind:value={designY}
                              /></label
                            >
                          </div>
                        </fieldset>
                        <fieldset class="grid grid-cols-1 gap-1.5">
                          <legend class="mb-1.5 text-ui-md font-medium">{m["design.proposal_size"]()}</legend>
                          <div class="grid grid-cols-2 gap-2">
                            <label class="rw-num"
                              ><span class="rw-num-prefix">W</span><Input
                                type="number"
                                min="1"
                                class="pl-7 font-mono text-[12px] tabular-nums md:text-[12px]"
                                bind:value={designWidth}
                              /></label
                            ><label class="rw-num"
                              ><span class="rw-num-prefix">H</span><Input
                                type="number"
                                min="1"
                                class="pl-7 font-mono text-[12px] tabular-nums md:text-[12px]"
                                bind:value={designHeight}
                              /></label
                            >
                          </div>
                        </fieldset>
                      </div>
                      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div class="grid grid-cols-1 content-start gap-2.5">
                          <span class="flex items-center text-ui-md font-medium"
                            >{m["design.proposal_opacity"]()}<span
                              class="ml-auto font-mono text-[11px] tabular-nums text-[var(--app-text-soft)]"
                              >{designOpacity}%</span
                            ></span
                          >
                          <Slider
                            type="single"
                            min={0}
                            max={100}
                            step={1}
                            bind:value={designOpacity}
                            aria-label={m["design.proposal_opacity"]()}
                          />
                        </div>
                        <label class="grid grid-cols-1 content-start gap-1.5"
                          ><span class="text-ui-md font-medium">{m["design.proposal_fill"]()}</span><span
                            class="rw-swatch"
                            ><input type="color" bind:value={designFill} /><span
                              class="font-mono text-[12px] uppercase text-[var(--app-text-soft)]">{designFill}</span
                            ></span
                          ></label
                        >
                      </div>
                      {#if canProposeDesign}<div class="grid grid-cols-1 gap-3">
                          <label class="grid grid-cols-1 gap-1.5"
                            ><span class="text-ui-md font-medium">{m["design.proposal_title"]()}</span><Input
                              bind:value={designProposalTitle}
                              maxlength="180"
                              placeholder={m["design.proposal_title_placeholder"]()}
                            /></label
                          >
                          <label class="grid grid-cols-1 gap-1.5"
                            ><span class="text-ui-md font-medium">{m["design.proposal_description"]()}</span><Textarea
                              class="min-h-16 resize-y text-xs md:text-xs"
                              bind:value={designProposalDescription}
                              maxlength="4000"
                              placeholder={m["design.proposal_description_placeholder"]()}
                            /></label
                          >
                          <div class="flex flex-wrap justify-end gap-2">
                            {#if canEditDesign}<Button
                                variant="outline"
                                size="sm"
                                disabled={busy}
                                onclick={applyDirectDesignEdit}>{m["remote.design_apply_direct"]()}</Button
                              >{/if}<Button
                              size="sm"
                              disabled={busy || !designProposalTitle.trim()}
                              onclick={submitDesignProposal}
                              ><Send size={13} aria-hidden="true" />{m["design.proposal_submit"]()}</Button
                            >
                          </div>
                        </div>{:else if canEditDesign}<div class="flex justify-end">
                          <Button size="sm" disabled={busy} onclick={applyDirectDesignEdit}
                            >{m["remote.design_apply_direct"]()}</Button
                          >
                        </div>{/if}
                    </div>
                  {/if}
                </section>
                {#if canCommentDesign}
                  <section>
                    <div class="rw-section-head">
                      <h4>{m["remote.design_add_comment"]()}</h4>
                    </div>
                    <div class="rw-card rw-composer p-2">
                      <p class="px-1.5 pt-1 text-ui-xs text-[var(--app-text-muted)]">
                        {selectedDesignElement
                          ? m["design.comment_layer"]({
                              name: selectedDesignElement.name,
                            })
                          : m["design.comment_page"]()}
                      </p>
                      <Textarea
                        class="min-h-20 resize-y border-0 bg-transparent px-1.5 py-1 text-xs shadow-none hover:border-transparent focus-visible:ring-0 md:text-xs dark:bg-transparent"
                        bind:value={designComment}
                        aria-label={m["remote.design_add_comment"]()}
                        placeholder={m["remote.design_comment_placeholder"]()}
                      />
                      <div class="mt-1 flex justify-end px-1 pt-1">
                        <Button
                          size="sm"
                          disabled={busy || !designComment.trim() || !selectedDesignPageId}
                          onclick={submitDesignComment}
                          ><MessageSquareText size={13} aria-hidden="true" />{m["design.comment_add"]()}</Button
                        >
                      </div>
                    </div>
                  </section>
                {/if}
                <section>
                  <div class="rw-section-head">
                    <h4>{m["remote.design_open_comments"]()}</h4>
                    <span class="meta-mono"
                      >{selectedDesign.comments.filter((comment) => comment.status === "open").length}</span
                    >
                  </div>
                  <div class="grid grid-cols-1 gap-2">
                    {#each selectedDesign.comments as comment (comment.id)}<article
                        class="rw-card rw-comment p-3"
                        class:resolved={comment.status === "resolved"}
                      >
                        <div class="flex min-w-0 items-center gap-2 text-ui-xs text-[var(--app-text-muted)]">
                          <strong class="shrink-0 font-semibold text-[var(--app-text-soft)]">{comment.authorName}</strong
                          ><span aria-hidden="true">·</span><span class="min-w-0 truncate"
                            >{comment.elementName ?? comment.pageName}</span
                          >{#if comment.status === "resolved"}<span class="rw-pill shrink-0" data-tone="success"
                              ><Check size={11} aria-hidden="true" />{m["design.comment_resolved"]()}</span
                            >{/if}{#if comment.replyCount}<span class="ml-auto shrink-0 tabular-nums"
                              >{comment.replyCount}
                              {m["design.comment_reply"]()}</span
                            >{/if}
                        </div>
                        <p class="rw-comment-body mt-2 whitespace-pre-wrap text-xs leading-5">
                          {comment.body}
                        </p>
                        {#if canCommentDesign}<div class="mt-3 flex gap-1.5">
                            <Input
                              class="h-7 min-w-0 text-ui-sm md:text-ui-sm"
                              value={designReplies[comment.id] ?? ""}
                              aria-label={m["design.comment_reply_placeholder"]()}
                              placeholder={m["design.comment_reply_placeholder"]()}
                              oninput={(event: Event) => updateDesignReply(comment.id, event)}
                            /><Button
                              variant="outline"
                              size="sm"
                              disabled={busy || !(designReplies[comment.id] ?? "").trim()}
                              onclick={() => submitDesignReply(comment.id)}>{m["design.comment_reply"]()}</Button
                            ><Button
                              variant="ghost"
                              size="sm"
                              class="rw-reveal text-[var(--app-text-soft)]"
                              onclick={() =>
                                onResolveDesignComment(
                                  selectedDesign.nodeId,
                                  comment.id,
                                  comment.status === "open" ? "resolved" : "open",
                                )}
                              >{#if comment.status === "open"}<Check size={13} aria-hidden="true" />{:else}<RotateCcw
                                  size={13}
                                  aria-hidden="true"
                                />{/if}{comment.status === "open"
                                ? m["design.comment_resolve"]()
                                : m["design.comment_reopen"]()}</Button
                            >
                          </div>{/if}
                      </article>{:else}<div class="rw-card">
                        <NodeEmptyState compact icon={MessageSquareText} title={m["design.comments_empty"]()} />
                      </div>{/each}
                  </div>
                </section>
                <section>
                  <div class="rw-section-head">
                    <h4>{m["remote.design_pending_proposals"]()}</h4>
                    <span class="meta-mono"
                      >{selectedDesign.proposals.filter((proposal) => proposal.status === "pending").length}</span
                    >
                  </div>
                  <div class="grid grid-cols-1 gap-2">
                    {#each selectedDesign.proposals as proposal (proposal.id)}<article class="rw-card p-3">
                        <div class="flex items-start gap-2">
                          <div class="min-w-0 flex-1">
                            <h5 class="text-xs font-semibold text-pretty">
                              {proposal.title}
                            </h5>
                            <p class="mt-0.5 text-ui-xs tabular-nums text-[var(--app-text-muted)]">
                              {proposal.authorName} · {m["design.proposal_changes"]({
                                count: String(proposal.operationCount),
                              })}
                            </p>
                          </div>
                          <span class="rw-pill shrink-0" data-tone={toneOf(proposal.status)}
                            ><span class="rw-pill-dot" aria-hidden="true"></span>{proposal.status === "pending"
                              ? m["design.proposal_pending"]()
                              : proposal.status === "approved"
                                ? m["design.proposal_approved"]()
                                : m["design.proposal_rejected"]()}</span
                          >
                        </div>
                        {#if proposal.description}<p
                            class="mt-2 text-ui-sm leading-snug text-pretty text-[var(--app-text-soft)]"
                          >
                            {proposal.description}
                          </p>{/if}{#if canDecideDesign && proposal.status === "pending"}<div
                            class="mt-3 flex gap-2"
                          >
                            <Button
                              size="sm"
                              onclick={() => onDecideDesignProposal(selectedDesign.nodeId, proposal.id, "approved")}
                              ><CheckCircle2 size={13} aria-hidden="true" />{m["design.proposal_approve"]()}</Button
                            ><Button
                              variant="ghost"
                              size="sm"
                              class="text-[var(--app-danger)] hover:bg-[var(--app-danger-soft)] hover:text-[var(--app-danger)] dark:hover:bg-[var(--app-danger-soft)]"
                              onclick={() => onDecideDesignProposal(selectedDesign.nodeId, proposal.id, "rejected")}
                              ><XCircle size={13} aria-hidden="true" />{m["design.proposal_reject"]()}</Button
                            >
                          </div>{/if}
                      </article>{:else}<div class="rw-card">
                        <NodeEmptyState compact icon={Palette} title={m["design.proposals_empty"]()} />
                      </div>{/each}
                  </div>
                </section>
              </div>
            {/if}
          </div>
        {:else}
          <div class="rw-panel rw-card">
            <NodeEmptyState icon={Palette} title={m["remote.design_empty"]()} />
          </div>
        {/if}
      {:else if activeTab === "reviews"}
        <div class="rw-panel mx-auto grid max-w-4xl grid-cols-1 gap-2">
          {#each snapshot.reviews as review (review.id)}
            <article class="rw-card p-4">
              <div class="flex flex-wrap items-start gap-2">
                <h3 class="min-w-0 flex-1 text-ui-lg font-semibold text-pretty">
                  {review.title}
                </h3>
                <span class="rw-pill shrink-0" data-tone={toneOf(review.status)}
                  ><span class="rw-pill-dot" aria-hidden="true"></span>{reviewStatusLabel(review.status)}</span
                >
              </div>
              {#if review.summary}<p class="mt-1.5 text-xs leading-5 text-pretty text-[var(--app-text-muted)]">
                  {review.summary}
                </p>{/if}
              <div
                class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-ui-xs tabular-nums text-[var(--app-text-soft)]"
              >
                <span>{review.evidenceCount} {m["remote.evidence"]()}</span><span
                  >{review.testCount} {m["remote.tests"]()}</span
                ><span class:text-[var(--app-warning)]={review.riskCount > 0}
                  >{review.riskCount} {m["remote.risks"]()}</span
                >{#if review.assigneeTitle}<span class="ml-auto truncate text-[var(--app-text-muted)]"
                    >{review.assigneeTitle}</span
                  >{/if}
              </div>
              {#if canDecideReviews && review.status === "pending"}<div
                  class="mt-3 flex flex-wrap gap-2 border-t border-[var(--app-border)] pt-3"
                >
                  <Button size="sm" onclick={() => onDecideReview(review.id, "approved")}
                    ><CheckCircle2 size={13} aria-hidden="true" />{m["remote.approve"]()}</Button
                  ><Button
                    size="sm"
                    variant="outline"
                    onclick={() => onDecideReview(review.id, "changes_requested")}
                    ><RefreshCw size={13} aria-hidden="true" />{m["remote.request_changes"]()}</Button
                  ><Button
                    size="sm"
                    variant="ghost"
                    class="text-[var(--app-danger)] hover:bg-[var(--app-danger-soft)] hover:text-[var(--app-danger)] dark:hover:bg-[var(--app-danger-soft)]"
                    onclick={() => onDecideReview(review.id, "rejected")}
                    ><XCircle size={13} aria-hidden="true" />{m["remote.reject"]()}</Button
                  >
                </div>{/if}
            </article>
          {:else}
            <div class="rw-card">
              <NodeEmptyState icon={CheckCircle2} title={m["remote.no_reviews"]()} />
            </div>
          {/each}
        </div>
      {:else}
        <div class="rw-panel mx-auto max-w-3xl">
          {#if snapshot.activity.length}
            <ol class="relative ml-1 border-l border-[var(--app-border)] pl-5">
              {#each snapshot.activity as event (event.id)}
                <li class="relative pb-6 last:pb-0">
                  <span
                    class={`absolute -left-[24.5px] top-1 size-2 rounded-full ring-4 ring-[var(--app-canvas)] ${stateTone(event.state)}`}
                    aria-hidden="true"
                  ></span>
                  <div class="flex min-w-0 items-start gap-3">
                    <div class="min-w-0 flex-1">
                      <p class="text-xs font-medium">{event.title}</p>
                      <p class="mt-0.5 text-ui-xs text-[var(--app-text-muted)]">
                        {event.kind === "agent" ? agentStateLabel(event.state) : (event.detail ?? event.state)}
                      </p>
                    </div>
                    <time
                      class="shrink-0 text-ui-xs tabular-nums text-[var(--app-text-muted)]"
                      datetime={event.occurredAt}
                      >{relativeTime(event.occurredAt)}</time
                    >
                  </div>
                </li>
              {/each}
            </ol>
          {:else}
            <div class="rw-card">
              <NodeEmptyState icon={Clock3} title={m["remote.no_activity"]()} />
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </section>

  <nav
    class="flex overflow-x-auto border-t border-[var(--app-border)] bg-[var(--app-sidebar)] px-1 pb-[env(safe-area-inset-bottom)] [scrollbar-width:none] md:hidden"
    aria-label={m["remote.navigation"]()}
  >
    {#each tabs as tab (tab.id)}
      <button
        type="button"
        class="rw-tabbar-item"
        class:selected={activeTab === tab.id}
        aria-current={activeTab === tab.id ? "page" : undefined}
        onclick={() => (activeTab = tab.id)}
        ><span class="relative"
          ><tab.icon size={17} aria-hidden="true" />{#if tab.count}{#if tab.tone === "live"}<span
                class="rw-tabbar-live"
                ><span class="sr-only">{m["huddle.live"]()}</span></span
              >{:else}<span class={tab.tone === "attention" ? "rw-tabbar-badge" : "rw-tabbar-badge neutral"}
                >{tab.count > 9 ? "9+" : tab.count}</span
              >{/if}{/if}</span
        ><span class="max-w-full truncate">{tab.label}</span></button
      >
    {/each}
  </nav>
</main>

<style>
  /* Marca sobre fundo escuro fixo: o simbolo tem partes brancas que somem no tema claro. */
  .rw-brand {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    flex-shrink: 0;
    border-radius: 6px;
    background: #10101d;
  }

  /* A classe escopada venceria o md:hidden do Tailwind; o breakpoint fica aqui. */
  @media (min-width: 48rem) {
    .rw-brand.mobile-only {
      display: none;
    }
  }

  .rw-chip {
    display: inline-block;
    height: 20px;
    padding: 0 7px;
    line-height: 20px;
    border-radius: 6px;
    background: var(--app-hover);
    color: var(--app-text-soft);
    font-size: 11px;
    font-weight: 500;
    white-space: nowrap;
  }

  /* Linhas da navegacao: mesmo desenho das linhas do Workbench (30px, selecao
     neutra com indicador de destaque de 2px a esquerda). */
  .rw-row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-width: 0;
    min-height: 30px;
    padding: 0 8px 0 10px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--app-text-soft);
    font-size: 12.5px;
    text-align: left;
    cursor: pointer;
    transition:
      background-color var(--duration-quick) ease-out,
      color var(--duration-quick) ease-out;
  }

  .rw-row.two-line {
    min-height: 44px;
    padding-block: 6px;
  }

  .rw-row:hover {
    background: var(--app-hover);
    color: var(--app-text);
  }

  .rw-row.selected {
    background: var(--app-active);
    color: var(--app-text);
  }

  .rw-row.selected::before {
    content: '';
    position: absolute;
    left: 0;
    top: 8px;
    bottom: 8px;
    width: 2px;
    border-radius: 0 2px 2px 0;
    background: var(--app-accent);
  }

  .rw-row:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: -2px;
  }

  .rw-row :global(.rw-row-icon) {
    flex-shrink: 0;
    color: var(--app-text-muted);
  }

  .rw-row.selected :global(.rw-row-icon) {
    color: var(--app-accent);
  }

  .rw-count {
    min-width: 18px;
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 500;
    text-align: right;
    font-variant-numeric: tabular-nums;
    color: var(--app-text-muted);
  }

  .rw-badge {
    min-width: 18px;
    height: 18px;
    padding: 0 6px;
    border-radius: 999px;
    background: var(--app-warning-soft);
    color: var(--app-warning);
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 600;
    line-height: 18px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  .rw-live {
    width: 7px;
    height: 7px;
    margin-right: 5px;
    border-radius: 999px;
    background: var(--app-success);
    box-shadow: 0 0 0 3px var(--app-success-soft);
  }

  /* Pilula de estado: cor so para estado (sucesso/atencao/erro). */
  .rw-pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-height: 20px;
    padding: 0 8px;
    border-radius: 999px;
    background: var(--app-hover);
    color: var(--app-text-soft);
    font-size: 11px;
    font-weight: 500;
    line-height: 1.3;
    white-space: nowrap;
  }

  .rw-pill-dot {
    width: 6px;
    height: 6px;
    flex-shrink: 0;
    border-radius: 999px;
    background: var(--app-text-muted);
  }

  .rw-pill[data-tone='success'] {
    background: var(--app-success-soft);
    color: var(--app-success);
  }

  .rw-pill[data-tone='success'] .rw-pill-dot {
    background: var(--app-success);
  }

  .rw-pill[data-tone='warning'] {
    background: var(--app-warning-soft);
    color: var(--app-warning);
  }

  .rw-pill[data-tone='warning'] .rw-pill-dot {
    background: var(--app-warning);
  }

  .rw-pill[data-tone='danger'] {
    background: var(--app-danger-soft);
    color: var(--app-danger);
  }

  .rw-pill[data-tone='danger'] .rw-pill-dot {
    background: var(--app-danger);
  }

  /* Cartoes: elevacao por sombra (o token ja traz o anel de 1px). */
  .rw-card {
    border-radius: 10px;
    background: var(--app-surface);
    box-shadow: var(--app-shadow-border);
  }

  .rw-section-head {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 26px;
    margin-bottom: 8px;
  }

  .rw-section-head h3,
  .rw-section-head h4 {
    margin: 0;
    color: var(--app-text);
    font-size: 13px;
    font-weight: 600;
  }

  .rw-attention {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 12px 14px;
    border: 0;
    border-radius: 10px;
    background: var(--app-warning-soft);
    color: var(--app-text);
    text-align: left;
    cursor: pointer;
    transition: background-color var(--duration-quick) ease-out;
  }

  .rw-attention:hover {
    background: color-mix(in srgb, var(--app-warning) 22%, transparent);
  }

  .rw-attention:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 2px;
  }

  .rw-attention :global(.rw-attention-arrow) {
    color: var(--app-text-muted);
    transition:
      transform var(--duration-quick) var(--ease-smooth-out),
      color var(--duration-quick) ease-out;
  }

  .rw-attention:hover :global(.rw-attention-arrow) {
    transform: translateX(2px);
    color: var(--app-text-soft);
  }

  .rw-list-item {
    min-height: 52px;
    padding: 9px 12px;
  }

  .rw-list-item + .rw-list-item {
    box-shadow: inset 0 1px 0 var(--app-border);
  }

  .rw-avatar {
    position: relative;
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    flex-shrink: 0;
    border-radius: 8px;
    background: var(--app-hover);
  }

  .rw-avatar-dot {
    position: absolute;
    right: -2px;
    bottom: -2px;
    width: 9px;
    height: 9px;
    border-radius: 999px;
    box-shadow: 0 0 0 2px var(--app-surface);
  }

  .rw-map {
    background-image: radial-gradient(var(--app-border) 1px, transparent 1px);
    background-size: 18px 18px;
  }

  .rw-map-node {
    position: absolute;
    display: flex;
    align-items: center;
    gap: 5px;
    min-height: 26px;
    padding: 0 8px;
    overflow: hidden;
    border-radius: 6px;
    background: var(--app-surface-subtle);
    color: var(--app-text-muted);
    font-size: 11px;
    box-shadow: var(--app-shadow-border);
  }

  .rw-map-node.agent {
    background: var(--app-surface-raised);
    color: var(--app-text);
  }

  /* O Textarea interno perde a borda; o foco aparece no cartao inteiro. */
  .rw-composer {
    transition: box-shadow var(--duration-quick) ease-out;
  }

  .rw-composer:focus-within {
    box-shadow:
      0 0 0 1px var(--app-accent),
      0 0 0 4px color-mix(in srgb, var(--app-accent) 16%, transparent);
  }

  /* Raio concentrico: coluna 12px com 6px de respiro -> cartao 6px. */
  .rw-column {
    border-radius: 12px;
    background: var(--app-surface);
    box-shadow: var(--app-shadow-border);
  }

  .rw-task {
    padding: 10px;
    border-radius: 6px;
    background: var(--app-surface-raised);
    box-shadow: var(--app-shadow-border);
  }

  /* Coluna vazia: mesmo tracejado discreto do quadro de tarefas do canvas. */
  .rw-col-empty {
    display: grid;
    place-items: center;
    min-height: 64px;
    margin: 0;
    padding: 12px 6px;
    border: 1px dashed color-mix(in srgb, var(--app-border-strong) 70%, transparent);
    border-radius: 6px;
    color: var(--app-text-muted);
    font-size: 11.5px;
    text-align: center;
    text-wrap: pretty;
  }

  .rw-check {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 32px;
    padding: 0 10px;
    border-radius: 8px;
    box-shadow: var(--app-shadow-border);
    color: var(--app-text-soft);
    font-size: 12px;
    cursor: pointer;
    transition:
      background-color var(--duration-quick) ease-out,
      color var(--duration-quick) ease-out;
  }

  .rw-check:hover {
    background: var(--app-hover);
    color: var(--app-text);
  }

  .rw-check:has(:global([data-state='checked'])) {
    background: var(--app-active);
    color: var(--app-text);
  }

  .rw-check.chip {
    min-height: 26px;
    gap: 6px;
    padding: 0 9px 0 7px;
    border-radius: 999px;
    font-size: 11.5px;
  }

  .rw-turn {
    padding-left: 12px;
    box-shadow: inset 2px 0 0 var(--app-border-strong);
  }

  .rw-turn.remote {
    box-shadow: inset 2px 0 0 var(--app-accent);
  }

  .rw-num {
    position: relative;
    display: block;
  }

  .rw-num-prefix {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 10px;
    z-index: 1;
    display: grid;
    place-items: center;
    color: var(--app-text-muted);
    font-family: var(--font-mono);
    font-size: 11px;
    pointer-events: none;
  }

  .rw-swatch {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 32px;
    padding: 0 10px 0 4px;
    border-radius: 8px;
    box-shadow: var(--app-shadow-border);
  }

  .rw-swatch:focus-within {
    outline: 2px solid var(--app-accent);
    outline-offset: 2px;
  }

  .rw-swatch input[type='color'] {
    width: 24px;
    height: 24px;
    padding: 0;
    border: 0;
    border-radius: 4px;
    background: none;
    cursor: pointer;
    outline: none;
  }

  .rw-swatch input[type='color']::-webkit-color-swatch-wrapper {
    padding: 0;
  }

  .rw-swatch input[type='color']::-webkit-color-swatch {
    border: 0;
    border-radius: 4px;
    box-shadow: inset 0 0 0 1px var(--app-image-outline);
  }

  .rw-comment.resolved .rw-comment-body {
    color: var(--app-text-soft);
  }

  /* Resolver aparece no hover/foco em quem tem mouse; no toque fica visivel. */
  @media (hover: hover) {
    .rw-comment :global(.rw-reveal) {
      opacity: 0;
      transition: opacity var(--duration-quick) ease-out;
    }

    .rw-comment:hover :global(.rw-reveal),
    .rw-comment:focus-within :global(.rw-reveal) {
      opacity: 1;
    }
  }

  /* Troca de aba: entra com opacidade + 4px, sem atrasar a leitura. */
  .rw-panel {
    animation: rw-panel-in var(--duration-fast) var(--ease-smooth-out) both;
  }

  @keyframes rw-panel-in {
    from {
      opacity: 0;
      transform: translateY(var(--distance-micro));
    }
  }

  /* Todas as abas cabem na largura (rotulo trunca) em vez de esconder abas
     fora da tela sem pista de rolagem. */
  .rw-tabbar-item {
    display: grid;
    flex: 1 1 0;
    min-width: 48px;
    place-items: center;
    align-content: center;
    gap: 3px;
    padding: 8px 4px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--app-text-muted);
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    transition: color var(--duration-quick) ease-out;
  }

  .rw-tabbar-item.selected {
    color: var(--app-text);
  }

  .rw-tabbar-item.selected > span:first-child {
    color: var(--app-accent);
  }

  .rw-tabbar-item:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: -2px;
  }

  .rw-tabbar-badge {
    position: absolute;
    top: -5px;
    right: -10px;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 999px;
    background: var(--app-warning);
    color: var(--app-accent-contrast);
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 600;
    line-height: 16px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  .rw-tabbar-badge.neutral {
    background: var(--app-active);
    color: var(--app-text-soft);
  }

  .rw-tabbar-live {
    position: absolute;
    top: -2px;
    right: -3px;
    width: 7px;
    height: 7px;
    border-radius: 999px;
    background: var(--app-success);
    box-shadow: 0 0 0 2px var(--app-sidebar);
  }
</style>
