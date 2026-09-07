<script lang="ts">
  import {
    Activity,
    ArrowRight,
    Bot,
    CheckCircle2,
    CircleAlert,
    Clock3,
    Gauge,
    KanbanSquare,
    LogOut,
    MessageSquareText,
    MessageCircleMore,
    Mic,
    Palette,
    Plus,
    RefreshCw,
    ShieldCheck,
    UsersRound,
    XCircle,
  } from "@lucide/svelte";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import { Textarea } from "$lib/components/ui/textarea";
  import { Input } from "$lib/components/ui/input";
  import { Checkbox } from "$lib/components/ui/checkbox";
  import * as Select from "$lib/components/ui/select";
  import * as Tooltip from "$lib/components/ui/tooltip";
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

  const tabs = $derived([
    { id: "overview" as const, label: m["remote.overview"](), icon: Activity },
    {
      id: "team" as const,
      label: m["remote.team"](),
      icon: UsersRound,
      count: attentionAgents.length || undefined,
    },
    {
      id: "tasks" as const,
      label: m["remote.tasks"](),
      icon: KanbanSquare,
      count: openTasks.length || undefined,
    },
    ...(canViewHuddles
      ? [
          {
            id: "huddles" as const,
            label: m["huddle.title"](),
            icon: MessageCircleMore,
            count: activeHuddle ? 1 : undefined,
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
          },
        ]
      : []),
    {
      id: "reviews" as const,
      label: m["remote.approvals"](),
      icon: CheckCircle2,
      count: pendingReviews.length || undefined,
    },
    { id: "activity" as const, label: m["remote.activity"](), icon: Clock3 },
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
    huddleTargets = huddleTargets.filter((id) => ids.includes(id));
    if (!huddleTargets.length) huddleTargets = ids.slice(0, 5);
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
  class="grid h-full min-h-0 grid-cols-1 grid-rows-[52px_minmax(0,1fr)_64px] overflow-hidden bg-[var(--app-canvas)] text-[var(--app-text)] md:grid-cols-[218px_minmax(0,1fr)] md:grid-rows-[52px_minmax(0,1fr)]"
>
  <aside
    class="row-span-2 hidden min-h-0 flex-col border-r border-[var(--app-border)] bg-[var(--app-sidebar)] md:flex"
  >
    <div
      class="flex h-[52px] items-center gap-2.5 border-b border-[var(--app-border)] px-4"
    >
      <span class="grid size-7 place-items-center rounded-[6px] bg-[#10101d]"
        ><img src="/brand/icon.svg" class="size-4" alt="" /></span
      >
      <strong class="text-sm font-semibold tracking-[0]">Orkestrai</strong>
      <Badge variant="outline" class="ml-auto h-5 px-1.5 text-ui-xs uppercase"
        >{m["remote.companion_badge"]()}</Badge
      >
    </div>
    <nav class="grid gap-1 p-2" aria-label={m["remote.navigation"]()}>
      {#each tabs as tab}
        <button
          type="button"
          class={`group flex h-9 w-full items-center gap-2 rounded-[5px] px-2.5 text-left text-ui-sm font-medium transition-[background-color,color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)] ${activeTab === tab.id ? "bg-[var(--app-accent-soft)] text-[var(--app-text)]" : "text-[var(--app-text-soft)] hover:bg-[var(--app-surface-raised)] hover:text-[var(--app-text)]"}`}
          aria-current={activeTab === tab.id ? "page" : undefined}
          onclick={() => (activeTab = tab.id)}
        >
          <tab.icon
            size={15}
            class={activeTab === tab.id
              ? "text-[var(--app-accent)]"
              : "text-[var(--app-text-muted)]"}
          />
          <span class="min-w-0 flex-1 truncate">{tab.label}</span>
          {#if tab.count}<span
              class="grid min-w-5 place-items-center rounded-full bg-[var(--app-surface)] px-1 text-ui-xs tabular-nums text-[var(--app-text-muted)]"
              >{tab.count}</span
            >{/if}
        </button>
      {/each}
    </nav>
    <div class="mt-auto border-t border-[var(--app-border)] p-3">
      <div
        class="flex items-center gap-2 text-ui-xs text-[var(--app-text-muted)]"
      >
        <ShieldCheck size={13} class="text-[var(--app-success)]" />
        <span class="truncate">{m["remote.encrypted_connection"]()}</span>
      </div>
      <p
        class="mt-1.5 truncate text-ui-xs font-medium text-[var(--app-text-soft)]"
      >
        {roleLabel(role)}
      </p>
      <p class="mt-0.5 text-ui-xs text-[var(--app-text-muted)]">
        {m["remote.revision"]({ revision })}
      </p>
    </div>
  </aside>

  <header
    class="flex min-w-0 items-center gap-2 border-b border-[var(--app-border)] bg-[var(--app-sidebar)] px-3 md:col-start-2 md:px-4"
  >
    <span
      class="grid size-7 shrink-0 place-items-center rounded-[6px] bg-[#10101d] md:hidden"
      ><img src="/brand/icon.svg" class="size-4" alt="" /></span
    >
    <div class="min-w-0">
      <h1 class="truncate text-xs font-semibold sm:text-sm">
        {snapshot.workspace.name}
      </h1>
      <p class="truncate text-ui-xs text-[var(--app-text-muted)] md:hidden">
        {roleLabel(role)} · {m["remote.revision"]({ revision })}
      </p>
    </div>
    <div
      class="ml-auto size-12 shrink-0"
      data-dictation-dock
      aria-hidden="true"
    ></div>
    <Badge
      variant="outline"
      class="hidden h-6 gap-1 border-[var(--app-border)] text-ui-xs sm:inline-flex"
      ><span class="size-1.5 rounded-full bg-[var(--app-success)]"></span>{m[
        "remote.live"
      ]()}</Badge
    >
    <Tooltip.Root
      ><Tooltip.Trigger
        >{#snippet child({ props })}<Button
            {...props}
            variant="ghost"
            size="icon-sm"
            aria-label={m["remote.refresh"]()}
            onclick={onRefresh}><RefreshCw size={14} /></Button
          >{/snippet}</Tooltip.Trigger
      ><Tooltip.Content>{m["remote.refresh"]()}</Tooltip.Content></Tooltip.Root
    >
    <Tooltip.Root
      ><Tooltip.Trigger
        >{#snippet child({ props })}<Button
            {...props}
            variant="ghost"
            size="icon-sm"
            aria-label={m["remote.leave"]()}
            onclick={onLeave}><LogOut size={14} /></Button
          >{/snippet}</Tooltip.Trigger
      ><Tooltip.Content>{m["remote.leave"]()}</Tooltip.Content></Tooltip.Root
    >
  </header>

  <section class="min-h-0 overflow-y-auto overscroll-contain md:col-start-2">
    <div
      class="mx-auto w-full max-w-[1180px] px-4 py-5 pb-10 sm:px-6 sm:py-7 lg:px-8"
    >
      <header
        class="mb-6 flex min-w-0 items-end gap-4 border-b border-[var(--app-border)] pb-5"
      >
        <div class="min-w-0">
          <h2 class="text-lg font-semibold tracking-[0] sm:text-xl">
            {pageCopy.title}
          </h2>
          <p
            class="mt-1 max-w-2xl text-xs leading-5 text-[var(--app-text-muted)]"
          >
            {pageCopy.body}
          </p>
        </div>
        {#if activeTab === "tasks" && canWriteTasks}<Button
            size="sm"
            class="ml-auto shrink-0"
            onclick={onCreateTask}
            ><Plus size={14} />{m["remote.create_task"]()}</Button
          >{/if}
      </header>

      {#if activeTab === "overview"}
        {#if attentionAgents.length || pendingReviews.length}
          <button
            type="button"
            class="mb-5 flex w-full items-center gap-3 rounded-[6px] border border-[color-mix(in_srgb,var(--app-warning)_42%,var(--app-border))] bg-[color-mix(in_srgb,var(--app-warning)_7%,var(--app-surface))] px-3.5 py-3 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--app-warning)_11%,var(--app-surface))]"
            onclick={() =>
              (activeTab = attentionAgents.length ? "team" : "reviews")}
          >
            <CircleAlert size={17} class="shrink-0 text-[var(--app-warning)]" />
            <span class="min-w-0 flex-1"
              ><strong class="block text-xs"
                >{m["remote.attention_title"]()}</strong
              ><span
                class="mt-0.5 block truncate text-ui-xs text-[var(--app-text-muted)]"
                >{m["remote.attention_body"]({
                  agents: attentionAgents.length,
                  reviews: pendingReviews.length,
                })}</span
              ></span
            >
            <ArrowRight
              size={15}
              class="shrink-0 text-[var(--app-text-muted)]"
            />
          </button>
        {/if}

        <section
          class="grid grid-cols-2 border-l border-t border-[var(--app-border)] lg:grid-cols-4"
          aria-label={m["remote.workspace_status"]()}
        >
          {#each [{ label: m["remote.agents_working"](), value: workingAgents.length, icon: Activity, tone: "text-[var(--app-success)]" }, { label: m["remote.open_tasks"](), value: openTasks.length, icon: KanbanSquare, tone: "text-[var(--app-accent)]" }, { label: m["remote.pending_reviews"](), value: pendingReviews.length, icon: CheckCircle2, tone: "text-[var(--app-warning)]" }, { label: m["remote.team_size"](), value: snapshot.agents.length, icon: UsersRound, tone: "text-[var(--app-secondary)]" }] as metric}
            <div
              class="min-h-[92px] border-b border-r border-[var(--app-border)] p-3.5 sm:p-4"
            >
              <div class="flex items-center gap-2">
                <metric.icon size={14} class={metric.tone} /><span
                  class="text-ui-xs font-semibold uppercase text-[var(--app-text-muted)]"
                  >{metric.label}</span
                >
              </div>
              <strong class="mt-2 block text-2xl font-semibold tabular-nums"
                >{metric.value}</strong
              >
            </div>
          {/each}
        </section>

        <div
          class="mt-7 grid min-w-0 gap-8 xl:grid-cols-[minmax(0,1.25fr)_minmax(280px,.75fr)]"
        >
          <div class="min-w-0 space-y-8">
            <section>
              <div class="mb-3 flex items-center gap-2">
                <h3 class="text-xs font-semibold">
                  {m["remote.active_work"]()}
                </h3>
                <span
                  class="text-ui-xs tabular-nums text-[var(--app-text-muted)]"
                  >{workingAgents.length}</span
                ><button
                  class="ml-auto text-ui-xs font-medium text-[var(--app-accent)] hover:underline"
                  onclick={() => (activeTab = "team")}
                  >{m["remote.view_all"]()}</button
                >
              </div>
              <div
                class="divide-y divide-[var(--app-border)] border-y border-[var(--app-border)]"
              >
                {#each workingAgents.slice(0, 5) as agent (agent.id)}
                  <div
                    class="grid min-h-[62px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-2.5"
                  >
                    <span
                      class="relative grid size-8 place-items-center rounded-[6px] border border-[var(--app-border)] bg-[var(--app-surface)]"
                    >
                      {#if agent.provider && providerIcon(agent.provider)}<span
                          class="size-4"
                          style={providerMask(agent.provider)}
                        ></span>{:else}<Bot
                          size={15}
                          class="text-[var(--app-text-muted)]"
                        />{/if}
                      <span
                        class="absolute -bottom-0.5 -right-0.5 size-2 rounded-full border-2 border-[var(--app-canvas)] bg-[var(--app-success)]"
                      ></span>
                    </span>
                    <div class="min-w-0">
                      <p class="truncate text-xs font-medium">{agent.title}</p>
                      <p
                        class="mt-0.5 truncate text-ui-xs text-[var(--app-text-muted)]"
                      >
                        {agent.currentTask?.title ??
                          agent.role ??
                          agent.provider ??
                          m["remote.no_current_task"]()}
                      </p>
                    </div>
                    <span class="text-ui-xs text-[var(--app-text-muted)]"
                      >{relativeTime(agent.stateSince)}</span
                    >
                  </div>
                {:else}
                  <p
                    class="py-7 text-center text-xs text-[var(--app-text-muted)]"
                  >
                    {m["remote.no_active_work"]()}
                  </p>
                {/each}
              </div>
            </section>

            <section>
              <div class="mb-3 flex items-center gap-2">
                <h3 class="text-xs font-semibold">
                  {m["remote.canvas_map"]()}
                </h3>
                <span class="text-ui-xs text-[var(--app-text-muted)]"
                  >{snapshot.nodes.length}</span
                >
              </div>
              <div
                class="relative aspect-[16/7] min-h-56 overflow-hidden rounded-[6px] border border-[var(--app-border)] bg-[var(--app-surface)] [background-image:radial-gradient(var(--app-border)_1px,transparent_1px)] [background-size:18px_18px]"
              >
                {#each snapshot.nodes as node (node.id)}
                  <div
                    class={`absolute flex min-h-7 items-center overflow-hidden rounded-[4px] border px-2 text-ui-xs shadow-sm ${node.type === "agent" ? "border-[var(--app-accent)]/50 bg-[var(--app-accent-soft)] text-[var(--app-text)]" : "border-[var(--app-border)] bg-[var(--app-surface-raised)] text-[var(--app-text-soft)]"}`}
                    style={nodeStyle(node)}
                    title={node.title ?? node.type}
                  >
                    <span class="truncate">{node.title ?? node.type}</span>
                  </div>
                {/each}
              </div>
            </section>
          </div>

          <aside class="min-w-0 space-y-8">
            {#if canMessageLeader}
              <section>
                <div class="mb-3 flex items-center gap-2">
                  <MessageSquareText
                    size={14}
                    class="text-[var(--app-accent)]"
                  />
                  <h3 class="text-xs font-semibold">
                    {m["remote.message_leader"]()}
                  </h3>
                </div>
                <div
                  class="rounded-[6px] border border-[var(--app-border)] bg-[var(--app-surface)] p-2.5 focus-within:border-[var(--app-border-strong)]"
                >
                  <Textarea
                    bind:value={leaderMessage}
                    class="min-h-24 resize-none border-0 bg-transparent p-1 text-xs shadow-none focus-visible:ring-0"
                    placeholder={m["remote.message_placeholder"]()}
                  />
                  <div
                    class="mt-2 flex items-center justify-between border-t border-[var(--app-border)] pt-2"
                  >
                    <span class="text-ui-xs text-[var(--app-text-muted)]"
                      >{m["remote.message_traceable"]()}</span
                    ><Button
                      size="sm"
                      disabled={busy || !leaderMessage.trim()}
                      onclick={onSendLeaderMessage}
                      ><MessageSquareText size={13} />{m[
                        "remote.send"
                      ]()}</Button
                    >
                  </div>
                </div>
              </section>
            {/if}

            <section>
              <div class="mb-3 flex items-center gap-2">
                <Gauge size={14} class="text-[var(--app-warning)]" />
                <h3 class="text-xs font-semibold">
                  {m["remote.provider_usage"]()}
                </h3>
              </div>
              {#if snapshot.usage.length}
                <div
                  class="divide-y divide-[var(--app-border)] border-y border-[var(--app-border)]"
                >
                  {#each snapshot.usage as usage (usage.provider)}
                    <div class="py-3">
                      <div class="flex items-center gap-2">
                        {#if providerIcon(usage.provider)}<span
                            class="size-4"
                            style={providerMask(usage.provider)}
                          ></span>{/if}<strong class="text-ui-sm capitalize"
                          >{usage.provider}</strong
                        >{#if usage.plan}<span
                            class="text-ui-xs text-[var(--app-text-muted)]"
                            >{usage.plan}</span
                          >{/if}
                      </div>
                      {#if usage.available}<div class="mt-2 grid gap-2">
                          {#each usage.windows as window}<div>
                              <div
                                class="mb-1 flex text-ui-xs text-[var(--app-text-muted)]"
                              >
                                <span>{windowLabel(window.kind)}</span><strong
                                  class="ml-auto tabular-nums text-[var(--app-text-soft)]"
                                  >{window.usedPercent}%</strong
                                >
                              </div>
                              <div
                                class="h-1 overflow-hidden rounded-full bg-[var(--app-border)]"
                              >
                                <span
                                  class="block h-full rounded-full"
                                  style:width={`${window.usedPercent}%`}
                                  style:background={usageTone(
                                    window.usedPercent,
                                  )}
                                ></span>
                              </div>
                            </div>{/each}
                        </div>{:else}<p
                          class="mt-1.5 text-ui-xs leading-4 text-[var(--app-text-muted)]"
                        >
                          {usageDiagnostic(usage.diagnostic)}
                        </p>{/if}
                    </div>
                  {/each}
                </div>
              {:else}
                <p
                  class="border-y border-[var(--app-border)] py-5 text-center text-ui-xs text-[var(--app-text-muted)]"
                >
                  {m["remote.usage_waiting"]()}
                </p>
              {/if}
            </section>
          </aside>
        </div>
      {:else if activeTab === "team"}
        <div class="grid gap-3 lg:grid-cols-2">
          {#each snapshot.agents as agent (agent.id)}
            <article
              class="group grid min-h-[108px] grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-[6px] border border-[var(--app-border)] bg-[var(--app-surface)] p-3.5 transition-[border-color,background-color] hover:border-[var(--app-border-strong)] hover:bg-[var(--app-surface-raised)]"
            >
              <span
                class="relative grid size-9 place-items-center rounded-[6px] border border-[var(--app-border)] bg-[var(--app-surface-raised)]"
                >{#if agent.provider && providerIcon(agent.provider)}<span
                    class="size-4"
                    style={providerMask(agent.provider)}
                  ></span>{:else}<Bot size={16} />{/if}<span
                  class={`absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-[var(--app-surface)] ${stateTone(agent.state)}`}
                ></span></span
              >
              <div class="min-w-0">
                <div class="flex min-w-0 items-start gap-2">
                  <div class="min-w-0 flex-1">
                    <h3 class="truncate text-xs font-semibold">
                      {agent.title}
                    </h3>
                    <p
                      class="mt-0.5 truncate text-ui-xs text-[var(--app-text-muted)]"
                    >
                      {agent.role ?? agent.provider ?? ""}
                    </p>
                  </div>
                  <span
                    class="shrink-0 text-ui-xs font-medium text-[var(--app-text-soft)]"
                    >{agentStateLabel(agent.state)}</span
                  >
                </div>
                <div
                  class="mt-3 flex items-center gap-2 border-t border-[var(--app-border)] pt-2"
                >
                  <KanbanSquare
                    size={12}
                    class="shrink-0 text-[var(--app-text-muted)]"
                  /><span
                    class="min-w-0 flex-1 truncate text-ui-xs text-[var(--app-text-soft)]"
                    >{agent.currentTask?.title ??
                      m["remote.no_current_task"]()}</span
                  ><span class="text-ui-xs text-[var(--app-text-muted)]"
                    >{relativeTime(agent.stateSince)}</span
                  >
                </div>
              </div>
            </article>
          {:else}
            <p
              class="col-span-full rounded-[6px] border border-dashed border-[var(--app-border)] p-10 text-center text-xs text-[var(--app-text-muted)]"
            >
              {m["remote.no_agents"]()}
            </p>
          {/each}
        </div>
      {:else if activeTab === "tasks"}
        <div
          class="flex min-w-0 snap-x snap-mandatory gap-3 overflow-x-auto pb-3"
        >
          {#each snapshot.columns as column (column.id)}
            {@const columnTasks = snapshot.tasks.filter(
              (task) =>
                task.status === column.key || task.status === column.name,
            )}
            <section
              class="w-[min(310px,85vw)] shrink-0 snap-start rounded-[6px] border border-[var(--app-border)] bg-[var(--app-surface)]"
            >
              <header
                class="flex h-10 items-center gap-2 border-b border-[var(--app-border)] px-3"
              >
                <span
                  class="size-2 rounded-full"
                  style:background={column.color}
                ></span>
                <h3 class="truncate text-ui-sm font-semibold">
                  {column.name ?? column.key}
                </h3>
                <span
                  class="ml-auto text-ui-xs tabular-nums text-[var(--app-text-muted)]"
                  >{columnTasks.length}</span
                >
              </header>
              <div class="space-y-2 p-2">
                {#each columnTasks as task (task.id)}
                  <article
                    class="rounded-[5px] border border-[var(--app-border)] bg-[var(--app-surface-raised)] p-3 transition-colors hover:border-[var(--app-border-strong)]"
                  >
                    <h4 class="text-xs font-medium leading-5">{task.title}</h4>
                    {#if task.description}<p
                        class="mt-1 line-clamp-3 text-ui-xs leading-4 text-[var(--app-text-muted)]"
                      >
                        {task.description}
                      </p>{/if}
                    <div
                      class="mt-3 flex items-center gap-2 border-t border-[var(--app-border)] pt-2"
                    >
                      <span
                        class="min-w-0 flex-1 truncate text-ui-xs text-[var(--app-text-soft)]"
                        >{task.assigneeTitle ?? m["remote.unassigned"]()}</span
                      >{#if canWriteTasks}<Select.Root
                          type="single"
                          value={task.status}
                          onValueChange={(value: string) =>
                            void onUpdateTask(task.id, value)}
                          disabled={busy}
                          ><Select.Trigger
                            size="sm"
                            class="h-6 max-w-28 text-ui-xs"
                            ><span class="truncate"
                              >{column.name ?? column.key}</span
                            ></Select.Trigger
                          ><Select.Content
                            >{#each snapshot.columns as target}<Select.Item
                                value={target.key}
                                >{target.name ?? target.key}</Select.Item
                              >{/each}</Select.Content
                          ></Select.Root
                        >{/if}
                    </div>
                  </article>
                {:else}<p
                    class="py-8 text-center text-ui-xs text-[var(--app-text-muted)]"
                  >
                    {m["remote.column_empty"]()}
                  </p>{/each}
              </div>
            </section>
          {/each}
        </div>
      {:else if activeTab === "huddles"}
        <div class="grid min-w-0 gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
          <aside
            class="min-w-0 space-y-1 border-r border-[var(--app-border)] pr-3"
          >
            {#each snapshot.huddles as huddle (huddle.id)}
              <button
                type="button"
                class={`w-full rounded-[5px] px-3 py-2.5 text-left ${selectedHuddle?.id === huddle.id ? "bg-[var(--app-accent-soft)]" : "hover:bg-[var(--app-surface-raised)]"}`}
                onclick={() => (selectedHuddleId = huddle.id)}
                ><span class="flex items-center gap-2"
                  ><span
                    class={`size-2 rounded-full ${huddle.status === "active" ? "bg-[var(--app-success)]" : "bg-[var(--app-text-muted)]"}`}
                  ></span><strong class="min-w-0 flex-1 truncate text-ui-sm"
                    >{huddle.title}</strong
                  ></span
                ><span
                  class="mt-1.5 block text-ui-xs text-[var(--app-text-muted)]"
                  >{huddle.participants.length}
                  {m["huddle.people"]()} · {huddle.turns.length}
                  {m["remote.huddle_turns"]()}</span
                ></button
              >
            {:else}<p
                class="p-3 text-ui-xs leading-4 text-[var(--app-text-muted)]"
              >
                {m["huddle.history_empty"]()}
              </p>{/each}
          </aside>
          <div class="min-w-0">
            {#if !activeHuddle && canManageHuddles}
              <section
                class="mb-5 rounded-[6px] border border-[var(--app-border)] bg-[var(--app-surface)] p-4"
              >
                <h3 class="text-sm font-semibold">
                  {m["huddle.start_title"]()}
                </h3>
                <p class="mt-1 text-ui-xs text-[var(--app-text-muted)]">
                  {m["remote.huddle_remote_hint"]()}
                </p>
                <div class="mt-4 grid gap-3">
                  <Input
                    bind:value={huddleTitle}
                    maxlength="160"
                    placeholder={m["huddle.topic_placeholder"]()}
                  /><Textarea
                    bind:value={huddleAgenda}
                    maxlength="8000"
                    class="min-h-20 resize-y"
                    placeholder={m["huddle.agenda_placeholder"]()}
                  />
                  <div class="grid gap-1 sm:grid-cols-2">
                    {#each snapshot.agents as agent (agent.id)}<label
                        class="flex items-center gap-2 rounded border border-[var(--app-border)] px-2.5 py-2 text-ui-xs"
                        ><Checkbox
                          checked={huddleAgents.includes(agent.id)}
                          disabled={!huddleAgents.includes(agent.id) &&
                            huddleAgents.length >= 11}
                          onCheckedChange={(value: boolean | 'indeterminate') =>
                            toggleHuddleAgent(agent.id, value === true)}
                        /><span class="min-w-0 flex-1 truncate"
                          >{agent.title}</span
                        ></label
                      >{/each}
                  </div>
                  <div>
                    <Button
                      size="sm"
                      disabled={busy ||
                        !huddleTitle.trim() ||
                        !huddleAgents.length}
                      onclick={createRemoteHuddle}
                      ><MessageCircleMore size={13} />{m[
                        "huddle.start"
                      ]()}</Button
                    >
                  </div>
                </div>
              </section>
            {/if}
            {#if selectedHuddle}
              <section
                class="overflow-hidden rounded-[6px] border border-[var(--app-border)] bg-[var(--app-surface)]"
              >
                <header
                  class="flex flex-wrap items-start gap-3 border-b border-[var(--app-border)] p-4"
                >
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2">
                      <h3 class="truncate text-sm font-semibold">
                        {selectedHuddle.title}
                      </h3>
                      <Badge variant="outline" class="text-ui-xs"
                        >{selectedHuddle.status === "active"
                          ? m["huddle.live"]()
                          : m["huddle.finished"]()}</Badge
                      >
                    </div>
                    {#if selectedHuddle.agenda}<p
                        class="mt-1 text-ui-xs leading-4 text-[var(--app-text-muted)]"
                      >
                        {selectedHuddle.agenda}
                      </p>{/if}
                  </div>
                  {#if selectedHuddle.status === "active" && canManageHuddles}<Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onclick={() => onEndHuddle(selectedHuddle.id)}
                      >{m["huddle.end"]()}</Button
                    >{/if}
                </header>
                <div
                  class="max-h-[48vh] min-h-52 space-y-3 overflow-y-auto overscroll-contain p-4"
                >
                  {#each selectedHuddle.turns as turn (turn.id)}<article
                      class="border-l-2 pl-3"
                      class:border-[var(--app-accent)]={turn.speakerKind ===
                        "remote"}
                      class:border-[var(--app-border-strong)]={turn.speakerKind !==
                        "remote"}
                    >
                      <div class="flex items-center gap-2 text-ui-xs">
                        <strong>{turn.speakerName}</strong><span
                          class="text-[var(--app-text-muted)]"
                          >#{turn.sequence}</span
                        >{#if turn.state === "pending"}<span
                            class="size-2 animate-pulse rounded-full bg-[var(--app-warning)]"
                          ></span>{:else if turn.state === "failed"}<span
                            class="text-[var(--app-danger)]"
                            >{m["huddle.reply_failed"]()}</span
                          >{/if}
                      </div>
                      {#if turn.text}<p
                          class="mt-1 whitespace-pre-wrap text-xs leading-5"
                        >
                          {turn.text}
                        </p>{/if}
                    </article>{:else}<p
                      class="py-16 text-center text-xs text-[var(--app-text-muted)]"
                    >
                      {m["huddle.transcript_empty"]()}
                    </p>{/each}
                </div>
                {#if selectedHuddle.status === "active" && canSpeakHuddles}<footer
                    class="border-t border-[var(--app-border)] p-3"
                  >
                    <div class="mb-2 flex flex-wrap gap-1.5">
                      {#each selectedHuddle.participants.filter((participant) => participant.kind === "agent") as participant (participant.participantId)}<label
                          class="flex items-center gap-1.5 rounded border border-[var(--app-border)] px-2 py-1 text-ui-xs"
                          ><Checkbox
                            class="size-3"
                            checked={huddleTargets.includes(
                              participant.participantId,
                            )}
                            disabled={!huddleTargets.includes(
                              participant.participantId,
                            ) && huddleTargets.length >= 5}
                            onCheckedChange={(value: boolean | 'indeterminate') =>
                              toggleHuddleTarget(
                                participant.participantId,
                                value === true,
                              )}
                          />{participant.displayName}</label
                        >{/each}
                    </div>
                    <div class="flex items-end gap-2">
                      <Textarea
                        bind:ref={huddleComposer}
                        bind:value={huddleMessage}
                        class="min-h-16 resize-y text-xs"
                        placeholder={m["huddle.message_placeholder"]()}
                      /><Button
                        variant="outline"
                        size="icon"
                        class="size-9 shrink-0"
                        aria-label={m["huddle.dictate"]()}
                        onclick={dictateHuddle}><Mic size={14} /></Button
                      ><Button
                        size="sm"
                        disabled={busy ||
                          !huddleMessage.trim() ||
                          !huddleTargets.length}
                        onclick={sendRemoteHuddleTurn}
                        >{m["huddle.send"]()}</Button
                      >
                    </div>
                  </footer>{/if}
              </section>
            {/if}
          </div>
        </div>
      {:else if activeTab === "designs"}
        {#if snapshot.designs.length}
          <div class="grid min-w-0 gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
            <aside
              class="min-w-0 space-y-1 border-r border-[var(--app-border)] pr-4"
            >
              {#each snapshot.designs as design (design.nodeId)}
                <button
                  type="button"
                  class={`w-full rounded-[5px] px-3 py-2.5 text-left ${selectedDesign?.nodeId === design.nodeId ? "bg-[var(--app-accent-soft)]" : "hover:bg-[var(--app-surface-raised)]"}`}
                  onclick={() => (selectedDesignId = design.nodeId)}
                >
                  <span class="block truncate text-xs font-semibold"
                    >{design.name}</span
                  >
                  <span
                    class="mt-1 block text-ui-xs text-[var(--app-text-muted)]"
                    >{m["remote.design_pages_layers"]({
                      pages: String(design.pageCount),
                      layers: String(design.elementCount),
                    })}</span
                  >
                  {#if design.presences.length}<span
                      class="mt-1.5 flex items-center gap-1 text-ui-xs text-[var(--app-success)]"
                      ><span
                        class="size-1.5 rounded-full bg-[var(--app-success)]"
                      ></span>{m["remote.design_live_people"]({
                        count: String(design.presences.length),
                      })}</span
                    >{/if}
                </button>
              {/each}
            </aside>
            {#if selectedDesign}
              <div class="min-w-0 space-y-7">
                <header
                  class="flex flex-wrap items-start gap-3 border-b border-[var(--app-border)] pb-4"
                >
                  <div class="min-w-0 flex-1">
                    <h3 class="truncate text-base font-semibold">
                      {selectedDesign.name}
                    </h3>
                    <p class="mt-1 text-ui-xs text-[var(--app-text-muted)]">
                      {m["remote.revision"]({
                        revision: selectedDesign.revision,
                      })} · {m["remote.design_pages_layers"]({
                        pages: String(selectedDesign.pageCount),
                        layers: String(selectedDesign.elementCount),
                      })}
                    </p>
                  </div>
                  <div class="flex -space-x-1">
                    {#each selectedDesign.presences.slice(0, 6) as presence}<span
                        class="grid size-7 place-items-center rounded-full border-2 border-[var(--app-canvas)] text-ui-xs font-bold text-white"
                        style:background={presence.color}
                        title={presence.name}
                        >{presence.name.slice(0, 1).toUpperCase()}</span
                      >{/each}
                  </div>
                </header>
                <section
                  class="grid gap-3 rounded-[6px] border border-[var(--app-border)] bg-[var(--app-surface)] p-3"
                >
                  <div class="grid gap-3 sm:grid-cols-2">
                    <label class="grid gap-1.5 text-ui-xs font-medium"
                      >{m["remote.design_page"]()}<Select.Root
                        type="single"
                        value={selectedDesignPageId}
                        onValueChange={(value: string) =>
                          (selectedDesignPageId = value)}
                        ><Select.Trigger class="w-full"
                          ><span class="truncate"
                            >{selectedDesign.pages.find(
                              (page) => page.id === selectedDesignPageId,
                            )?.name ?? m["remote.design_page"]()}</span
                          ></Select.Trigger
                        ><Select.Content
                          >{#each selectedDesign.pages as page}<Select.Item
                              value={page.id}>{page.name}</Select.Item
                            >{/each}</Select.Content
                        ></Select.Root
                      ></label
                    >
                    <label class="grid gap-1.5 text-ui-xs font-medium"
                      >{m["remote.design_layer"]()}<Select.Root
                        type="single"
                        value={selectedDesignElement?.id ?? ""}
                        onValueChange={(value: string) =>
                          (selectedDesignElementId = value)}
                        ><Select.Trigger class="w-full"
                          ><span class="truncate"
                            >{selectedDesignElement?.name ??
                              m["remote.design_no_layer"]()}</span
                          ></Select.Trigger
                        ><Select.Content
                          >{#each selectedDesignElements as element}<Select.Item
                              value={element.id}
                              >{element.name} · {element.type}</Select.Item
                            >{/each}</Select.Content
                        ></Select.Root
                      ></label
                    >
                  </div>
                  {#if (canProposeDesign || canEditDesign) && selectedDesignElement}
                    <div class="border-t border-[var(--app-border)] pt-3">
                      <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        <label
                          class="grid gap-1 text-ui-xs text-[var(--app-text-muted)]"
                          >X<Input type="number" bind:value={designX} /></label
                        ><label
                          class="grid gap-1 text-ui-xs text-[var(--app-text-muted)]"
                          >Y<Input type="number" bind:value={designY} /></label
                        ><label
                          class="grid gap-1 text-ui-xs text-[var(--app-text-muted)]"
                          >W<Input
                            type="number"
                            min="1"
                            bind:value={designWidth}
                          /></label
                        ><label
                          class="grid gap-1 text-ui-xs text-[var(--app-text-muted)]"
                          >H<Input
                            type="number"
                            min="1"
                            bind:value={designHeight}
                          /></label
                        ><label
                          class="grid gap-1 text-ui-xs text-[var(--app-text-muted)]"
                          >{m["design.proposal_opacity"]()}<Input
                            type="number"
                            min="0"
                            max="100"
                            bind:value={designOpacity}
                          /></label
                        ><label
                          class="grid gap-1 text-ui-xs text-[var(--app-text-muted)]"
                          >{m["design.proposal_fill"]()}<Input
                            type="color"
                            bind:value={designFill}
                          /></label
                        >
                      </div>
                      {#if canProposeDesign}<div class="mt-3 grid gap-2">
                          <Input
                            bind:value={designProposalTitle}
                            maxlength="180"
                            placeholder={m[
                              "design.proposal_title_placeholder"
                            ]()}
                          /><Textarea
                            class="min-h-16 resize-y text-ui-xs"
                            bind:value={designProposalDescription}
                            maxlength="4000"
                            placeholder={m[
                              "design.proposal_description_placeholder"
                            ]()}
                          />
                          <div class="flex flex-wrap justify-end gap-2">
                            {#if canEditDesign}<Button
                                variant="outline"
                                size="sm"
                                disabled={busy}
                                onclick={applyDirectDesignEdit}
                                >{m["remote.design_apply_direct"]()}</Button
                              >{/if}<Button
                              size="sm"
                              disabled={busy || !designProposalTitle.trim()}
                              onclick={submitDesignProposal}
                              >{m["design.proposal_submit"]()}</Button
                            >
                          </div>
                        </div>{:else if canEditDesign}<div
                          class="mt-3 flex justify-end"
                        >
                          <Button
                            size="sm"
                            disabled={busy}
                            onclick={applyDirectDesignEdit}
                            >{m["remote.design_apply_direct"]()}</Button
                          >
                        </div>{/if}
                    </div>
                  {/if}
                </section>
                {#if canCommentDesign}
                  <section>
                    <h4 class="mb-2 text-xs font-semibold">
                      {m["remote.design_add_comment"]()}
                    </h4>
                    <div
                      class="rounded-[6px] border border-[var(--app-border)] bg-[var(--app-surface)] p-2"
                    >
                      <p
                        class="px-1 pt-1 text-ui-xs text-[var(--app-text-muted)]"
                      >
                        {selectedDesignElement
                          ? m["design.comment_layer"]({
                              name: selectedDesignElement.name,
                            })
                          : m["design.comment_page"]()}
                      </p>
                      <Textarea
                        class="min-h-20 resize-y border-0 bg-transparent text-xs shadow-none focus-visible:ring-0"
                        bind:value={designComment}
                        placeholder={m["remote.design_comment_placeholder"]()}
                      />
                      <div
                        class="mt-2 flex justify-end border-t border-[var(--app-border)] pt-2"
                      >
                        <Button
                          size="sm"
                          disabled={busy ||
                            !designComment.trim() ||
                            !selectedDesignPageId}
                          onclick={submitDesignComment}
                          ><MessageSquareText size={13} />{m[
                            "design.comment_add"
                          ]()}</Button
                        >
                      </div>
                    </div>
                  </section>
                {/if}
                <section>
                  <div class="mb-2 flex items-center gap-2">
                    <h4 class="text-xs font-semibold">
                      {m["remote.design_open_comments"]()}
                    </h4>
                    <Badge variant="outline" class="h-5 text-ui-xs"
                      >{selectedDesign.comments.filter(
                        (comment) => comment.status === "open",
                      ).length}</Badge
                    >
                  </div>
                  <div class="space-y-2">
                    {#each selectedDesign.comments as comment (comment.id)}<article
                        class={`rounded-[6px] border bg-[var(--app-surface)] p-3 ${comment.status === "resolved" ? "border-[var(--app-success)]/40 opacity-70" : "border-[var(--app-border)]"}`}
                      >
                        <div
                          class="flex items-center gap-2 text-ui-xs text-[var(--app-text-muted)]"
                        >
                          <strong class="text-[var(--app-text-soft)]"
                            >{comment.authorName}</strong
                          ><span>·</span><span
                            >{comment.elementName ?? comment.pageName}</span
                          >{#if comment.replyCount}<span class="ml-auto"
                              >{comment.replyCount}
                              {m["design.comment_reply"]()}</span
                            >{/if}
                        </div>
                        <p class="mt-2 whitespace-pre-wrap text-xs leading-5">
                          {comment.body}
                        </p>
                        {#if canCommentDesign}<div class="mt-3 flex gap-1.5">
                            <Input
                              class="h-8 min-w-0 text-ui-xs"
                              value={designReplies[comment.id] ?? ""}
                              placeholder={m[
                                "design.comment_reply_placeholder"
                              ]()}
                              oninput={(event: Event) =>
                                updateDesignReply(comment.id, event)}
                            /><Button
                              variant="outline"
                              size="sm"
                              disabled={busy ||
                                !(designReplies[comment.id] ?? "").trim()}
                              onclick={() => submitDesignReply(comment.id)}
                              >{m["design.comment_reply"]()}</Button
                            ><Button
                              variant="ghost"
                              size="sm"
                              onclick={() =>
                                onResolveDesignComment(
                                  selectedDesign.nodeId,
                                  comment.id,
                                  comment.status === "open"
                                    ? "resolved"
                                    : "open",
                                )}
                              >{comment.status === "open"
                                ? m["design.comment_resolve"]()
                                : m["design.comment_reopen"]()}</Button
                            >
                          </div>{/if}
                      </article>{:else}<p
                        class="rounded-[6px] border border-dashed border-[var(--app-border)] p-8 text-center text-xs text-[var(--app-text-muted)]"
                      >
                        {m["design.comments_empty"]()}
                      </p>{/each}
                  </div>
                </section>
                <section>
                  <div class="mb-2 flex items-center gap-2">
                    <h4 class="text-xs font-semibold">
                      {m["remote.design_pending_proposals"]()}
                    </h4>
                    <Badge variant="outline" class="h-5 text-ui-xs"
                      >{selectedDesign.proposals.filter(
                        (proposal) => proposal.status === "pending",
                      ).length}</Badge
                    >
                  </div>
                  <div class="space-y-2">
                    {#each selectedDesign.proposals as proposal (proposal.id)}<article
                        class="rounded-[6px] border border-[var(--app-border)] bg-[var(--app-surface)] p-3"
                      >
                        <div class="flex items-start gap-2">
                          <div class="min-w-0 flex-1">
                            <h5 class="text-xs font-semibold">
                              {proposal.title}
                            </h5>
                            <p
                              class="mt-0.5 text-ui-xs text-[var(--app-text-muted)]"
                            >
                              {proposal.authorName} · {m[
                                "design.proposal_changes"
                              ]({ count: String(proposal.operationCount) })}
                            </p>
                          </div>
                          <Badge variant="outline" class="h-5 text-ui-xs"
                            >{proposal.status === "pending"
                              ? m["design.proposal_pending"]()
                              : proposal.status === "approved"
                                ? m["design.proposal_approved"]()
                                : m["design.proposal_rejected"]()}</Badge
                          >
                        </div>
                        {#if proposal.description}<p
                            class="mt-2 text-ui-xs leading-4 text-[var(--app-text-soft)]"
                          >
                            {proposal.description}
                          </p>{/if}{#if canDecideDesign && proposal.status === "pending"}<div
                            class="mt-3 flex gap-2"
                          >
                            <Button
                              size="sm"
                              onclick={() =>
                                onDecideDesignProposal(
                                  selectedDesign.nodeId,
                                  proposal.id,
                                  "approved",
                                )}
                              ><CheckCircle2 size={12} />{m[
                                "design.proposal_approve"
                              ]()}</Button
                            ><Button
                              variant="outline"
                              size="sm"
                              onclick={() =>
                                onDecideDesignProposal(
                                  selectedDesign.nodeId,
                                  proposal.id,
                                  "rejected",
                                )}
                              ><XCircle size={12} />{m[
                                "design.proposal_reject"
                              ]()}</Button
                            >
                          </div>{/if}
                      </article>{:else}<p
                        class="rounded-[6px] border border-dashed border-[var(--app-border)] p-8 text-center text-xs text-[var(--app-text-muted)]"
                      >
                        {m["design.proposals_empty"]()}
                      </p>{/each}
                  </div>
                </section>
              </div>
            {/if}
          </div>
        {:else}<p
            class="rounded-[6px] border border-dashed border-[var(--app-border)] p-10 text-center text-xs text-[var(--app-text-muted)]"
          >
            {m["remote.design_empty"]()}
          </p>{/if}
      {:else if activeTab === "reviews"}
        <div class="mx-auto max-w-4xl space-y-3">
          {#each snapshot.reviews as review (review.id)}
            <article
              class="rounded-[6px] border border-[var(--app-border)] bg-[var(--app-surface)] p-4"
            >
              <div class="flex items-start gap-3">
                <span
                  class={`mt-1 size-2 shrink-0 rounded-full ${stateTone(review.status)}`}
                ></span>
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-start gap-2">
                    <h3 class="min-w-0 flex-1 text-sm font-semibold">
                      {review.title}
                    </h3>
                    <Badge variant="outline" class="text-ui-xs"
                      >{reviewStatusLabel(review.status)}</Badge
                    >
                  </div>
                  {#if review.summary}<p
                      class="mt-1.5 text-xs leading-5 text-[var(--app-text-muted)]"
                    >
                      {review.summary}
                    </p>{/if}
                  <div
                    class="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-[var(--app-border)] pt-2 text-ui-xs text-[var(--app-text-soft)]"
                  >
                    <span>{review.evidenceCount} {m["remote.evidence"]()}</span
                    ><span>{review.testCount} {m["remote.tests"]()}</span><span
                      >{review.riskCount} {m["remote.risks"]()}</span
                    >{#if review.assigneeTitle}<span class="ml-auto"
                        >{review.assigneeTitle}</span
                      >{/if}
                  </div>
                  {#if canDecideReviews && review.status === "pending"}<div
                      class="mt-3 flex flex-wrap gap-2"
                    >
                      <Button
                        size="sm"
                        onclick={() => onDecideReview(review.id, "approved")}
                        ><CheckCircle2 size={13} />{m[
                          "remote.approve"
                        ]()}</Button
                      ><Button
                        size="sm"
                        variant="outline"
                        onclick={() =>
                          onDecideReview(review.id, "changes_requested")}
                        ><RefreshCw size={13} />{m[
                          "remote.request_changes"
                        ]()}</Button
                      ><Button
                        size="sm"
                        variant="destructive"
                        onclick={() => onDecideReview(review.id, "rejected")}
                        ><XCircle size={13} />{m["remote.reject"]()}</Button
                      >
                    </div>{/if}
                </div>
              </div>
            </article>
          {:else}<p
              class="rounded-[6px] border border-dashed border-[var(--app-border)] p-10 text-center text-xs text-[var(--app-text-muted)]"
            >
              {m["remote.no_reviews"]()}
            </p>{/each}
        </div>
      {:else}
        <div class="mx-auto max-w-3xl">
          <ol class="relative border-l border-[var(--app-border)] pl-5">
            {#each snapshot.activity as event (event.id)}
              <li class="relative pb-6 last:pb-0">
                <span
                  class={`absolute -left-[23.5px] top-1 size-2 rounded-full ring-4 ring-[var(--app-canvas)] ${stateTone(event.state)}`}
                ></span>
                <div class="flex min-w-0 items-start gap-3">
                  <div class="min-w-0 flex-1">
                    <p class="text-xs font-medium">{event.title}</p>
                    <p class="mt-0.5 text-ui-xs text-[var(--app-text-muted)]">
                      {event.kind === "agent"
                        ? agentStateLabel(event.state)
                        : (event.detail ?? event.state)}
                    </p>
                  </div>
                  <time
                    class="shrink-0 text-ui-xs text-[var(--app-text-muted)]"
                    datetime={event.occurredAt}
                    >{relativeTime(event.occurredAt)}</time
                  >
                </div>
              </li>
            {:else}<p
                class="py-10 text-center text-xs text-[var(--app-text-muted)]"
              >
                {m["remote.no_activity"]()}
              </p>{/each}
          </ol>
        </div>
      {/if}
    </div>
  </section>

  <nav
    class="grid grid-flow-col auto-cols-fr border-t border-[var(--app-border)] bg-[var(--app-sidebar)] px-1 pb-[env(safe-area-inset-bottom)] md:hidden"
    aria-label={m["remote.navigation"]()}
  >
    {#each tabs as tab}
      <button
        type="button"
        class={`relative grid min-w-0 place-items-center content-center gap-1 text-ui-xs font-medium transition-colors ${activeTab === tab.id ? "text-[var(--app-accent)]" : "text-[var(--app-text-muted)]"}`}
        aria-current={activeTab === tab.id ? "page" : undefined}
        onclick={() => (activeTab = tab.id)}
        ><tab.icon size={17} /><span class="max-w-full truncate"
          >{tab.label}</span
        >{#if tab.count}<span
            class="absolute right-[calc(50%-16px)] top-1.5 grid size-4 place-items-center rounded-full bg-[var(--app-warning)] text-ui-xs font-bold text-black"
            >{tab.count > 9 ? "9+" : tab.count}</span
          >{/if}</button
      >
    {/each}
  </nav>
</main>
