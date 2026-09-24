<script lang="ts">
  import { onMount } from "svelte";
  import { getCsrfToken } from "@beeblock/svelar/http";
  import { toast } from "@beeblock/svelar/ui";
  import { defaults, superForm } from "sveltekit-superforms";
  import { zod } from "sveltekit-superforms/adapters";
  import QRCode from "qrcode";
  import {
    Check,
    Clipboard,
    Clock3,
    KeyRound,
    Laptop,
    LoaderCircle,
    RadioTower,
    RefreshCw,
    ShieldCheck,
    ShieldOff,
    Signal,
    UserCheck,
    UserX,
    MonitorSmartphone,
    AppWindow,
    ChevronRight,
    Minus,
    Plus,
  } from "@lucide/svelte";
  import { SegmentedControl } from "$lib/components/ui/segmented";
  import NodeEmptyState from "$lib/components/agent-room/canvas/NodeEmptyState.svelte";
  import * as AlertDialog from "$lib/components/ui/alert-dialog";
  import * as Dialog from "$lib/components/ui/dialog";
  import * as Select from "$lib/components/ui/select";
  import * as Tabs from "$lib/components/ui/tabs";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Switch } from "$lib/components/ui/switch";
  import { createCollaborationShareSchema } from "$lib/modules/collaboration/contracts/schemas/collaboration.schema.js";
  import { localeState } from "$lib/i18n/locale.svelte.js";
  import type {
    CollaborationAuditData,
    CollaborationDeviceData,
    CollaborationRole,
    CollaborationShareData,
  } from "$lib/modules/collaboration/domain/types.js";
  import * as m from "$lib/paraglide/messages.js";

  type SharingStatus = {
    enabled: boolean;
    share: CollaborationShareData | null;
    transport?: {
      state: "connecting" | "connected" | "reconnecting" | "offline";
      connectedPeers: number;
    };
    inviteAvailable: boolean;
    devices: CollaborationDeviceData[];
    audit: CollaborationAuditData[];
  };

  let { workspaceId, onClose }: { workspaceId: string; onClose: () => void } =
    $props();
  let status = $state<SharingStatus | null>(null);
  let loading = $state(true);
  let busy = $state(false);
  let activeTab = $state("invite");
  let inviteUri = $state("");
  let webInviteUri = $state("");
  let inviteTarget = $state<"web" | "app">("web");
  let qrDataUrl = $state("");
  let copied = $state(false);
  let confirmStop = $state(false);
  let pendingRevoke = $state<CollaborationDeviceData | null>(null);
  let roleDrafts = $state<Record<string, CollaborationRole>>({});
  let terminalDrafts = $state<Record<string, boolean>>({});
  type DesignAccess = "inherited" | "none" | "view" | "comment" | "propose" | "edit";
  let designDrafts = $state<Record<string, DesignAccess>>({});

  const inheritedDesignScopes: Record<CollaborationRole, string[]> = {
    viewer: ["design.view"],
    collaborator: ["design.view", "design.comment", "design.propose"],
    operator: ["design.view", "design.comment", "design.propose", "design.decide"],
    administrator: ["design.view", "design.comment", "design.propose", "design.decide", "design.edit"],
  };

  function savedDesignAccess(device: CollaborationDeviceData): DesignAccess {
    const actual = device.scopes.filter((scope) => scope.startsWith("design.")).sort();
    const inherited = [...inheritedDesignScopes[device.role]].sort();
    if (actual.length === inherited.length && actual.every((scope, index) => scope === inherited[index])) return "inherited";
    if (actual.includes("design.edit")) return "edit";
    if (actual.includes("design.propose")) return "propose";
    if (actual.includes("design.comment")) return "comment";
    if (actual.includes("design.view")) return "view";
    return "none";
  }

  const schema = createCollaborationShareSchema as unknown as Parameters<
    typeof zod
  >[0];
  const form = superForm(
    defaults(
      {
        defaultRole: "viewer" as CollaborationRole,
        expiresInMinutes: 15,
        maxPeers: 5,
        relayUrl: "wss://relay.orkestrai.app/v1/connect",
      },
      zod(schema),
    ),
    {
      SPA: true,
      validators: zod(schema),
      async onUpdate({ form: result }) {
        if (result.valid)
          await startSharing(result.data as Parameters<typeof startSharing>[0]);
      },
    },
  );
  const { form: formData, enhance } = form;

  const pendingDevices = $derived(
    status?.devices.filter(
      (device) => !device.approvedAt && !device.revokedAt,
    ) ?? [],
  );
  const approvedDevices = $derived(
    status?.devices.filter(
      (device) => device.approvedAt && !device.revokedAt,
    ) ?? [],
  );
  // Abas com o visual do SegmentedControl (trilho neutro, pilula elevada).
  const segmentTab =
    "h-8 gap-1.5 rounded-md text-[13px] data-[state=active]:bg-[var(--app-surface-raised)] data-[state=active]:text-[var(--app-text)] data-[state=active]:shadow-[var(--app-shadow-border)] dark:data-[state=active]:border-transparent dark:data-[state=active]:bg-[var(--app-surface-raised)] dark:data-[state=active]:text-[var(--app-text)]";
  const selectedInviteUri = $derived(inviteTarget === "web" ? webInviteUri : inviteUri);

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
    if (!response.ok || payload.error)
      throw new Error(payload.error || m["collaboration.error"]());
    return payload.data as T;
  }

  async function refresh(silent = false): Promise<void> {
    if (!silent) loading = true;
    try {
      const previousPendingIds = new Set(
        (status?.devices ?? [])
          .filter((device) => !device.approvedAt && !device.revokedAt)
          .map((device) => device.id),
      );
      const nextStatus = await api<SharingStatus>(
        `/api/agent-room/workspaces/${workspaceId}/collaboration`,
      );
      const hasNewPendingDevice = nextStatus.devices.some(
        (device) =>
          !device.approvedAt &&
          !device.revokedAt &&
          !previousPendingIds.has(device.id),
      );
      status = nextStatus;
      if (silent && hasNewPendingDevice) {
        activeTab = "access";
        toast.info(m["collaboration.event_device_requested"]());
      }
      roleDrafts = Object.fromEntries(
        (status.devices ?? []).map((device) => [
          device.id,
          roleDrafts[device.id] ?? device.role,
        ]),
      );
      terminalDrafts = Object.fromEntries(
        (status.devices ?? []).map((device) => [
          device.id,
          terminalDrafts[device.id] ?? device.scopes.includes("terminal.control"),
        ]),
      );
      designDrafts = Object.fromEntries(
        (status.devices ?? []).map((device) => [device.id, designDrafts[device.id] ?? savedDesignAccess(device)]),
      );
    } catch (error) {
      if (!silent)
        toast.error(
          error instanceof Error ? error.message : m["collaboration.error"](),
        );
    } finally {
      loading = false;
    }
  }

  async function setEnabled(enabled: boolean): Promise<void> {
    busy = true;
    try {
      await api(
        `/api/agent-room/workspaces/${workspaceId}/collaboration/experimental`,
        {
          method: "PATCH",
          body: JSON.stringify({ enabled }),
        },
      );
      await refresh(true);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : m["collaboration.error"](),
      );
    } finally {
      busy = false;
    }
  }

  async function renderQr(): Promise<void> {
    qrDataUrl = selectedInviteUri
      ? await QRCode.toDataURL(selectedInviteUri, {
          width: 224,
          margin: 2,
          errorCorrectionLevel: "M",
          color: { dark: "#111318", light: "#ffffff" },
        })
      : "";
  }

  async function startSharing(input: {
    defaultRole: CollaborationRole;
    expiresInMinutes: number;
    maxPeers: number;
    relayUrl: string;
  }): Promise<void> {
    busy = true;
    try {
      const created = await api<{
        share: CollaborationShareData;
        inviteUri: string;
        webInviteUri: string;
      }>(`/api/agent-room/workspaces/${workspaceId}/collaboration`, {
        method: "POST",
        body: JSON.stringify(input),
      });
      inviteUri = created.inviteUri;
      webInviteUri = created.webInviteUri;
      await renderQr();
      toast.success(m["collaboration.started"]());
      await refresh(true);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : m["collaboration.error"](),
      );
    } finally {
      busy = false;
    }
  }

  async function refreshInvite(): Promise<void> {
    if (!status?.share) return;
    busy = true;
    try {
      const data = await api<{ inviteUri: string; webInviteUri: string }>(
        `/api/agent-room/workspaces/${workspaceId}/collaboration/${status.share.id}/invite`,
      );
      inviteUri = data.inviteUri;
      webInviteUri = data.webInviteUri;
      copied = false;
      await renderQr();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : m["collaboration.error"](),
      );
    } finally {
      busy = false;
    }
  }

  async function copyInvite(): Promise<void> {
    if (!selectedInviteUri) return;
    await navigator.clipboard.writeText(selectedInviteUri);
    copied = true;
    setTimeout(() => (copied = false), 2_000);
  }

  async function decide(
    device: CollaborationDeviceData,
    approved: boolean,
  ): Promise<void> {
    if (!status?.share) return;
    busy = true;
    try {
      await api(
        `/api/agent-room/workspaces/${workspaceId}/collaboration/${status.share.id}/devices/${device.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            approved,
            role: roleDrafts[device.id] ?? device.role,
            terminalAccess:
              terminalDrafts[device.id] ??
              device.scopes.includes("terminal.control"),
            designAccess: designDrafts[device.id] ?? "inherited",
          }),
        },
      );
      if (approved) {
        inviteUri = "";
        webInviteUri = "";
        qrDataUrl = "";
        toast.success(
          m["collaboration.device_approved"]({ name: device.displayName }),
        );
      }
      await refresh(true);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : m["collaboration.error"](),
      );
    } finally {
      busy = false;
    }
  }

  async function revoke(): Promise<void> {
    if (!status?.share || !pendingRevoke) return;
    busy = true;
    try {
      await api(
        `/api/agent-room/workspaces/${workspaceId}/collaboration/${status.share.id}/devices/${pendingRevoke.id}`,
        { method: "DELETE" },
      );
      pendingRevoke = null;
      await refresh(true);
    } finally {
      busy = false;
    }
  }

  async function stopSharing(): Promise<void> {
    if (!status?.share) return;
    busy = true;
    try {
      await api(
        `/api/agent-room/workspaces/${workspaceId}/collaboration/${status.share.id}`,
        { method: "DELETE" },
      );
      inviteUri = "";
      webInviteUri = "";
      qrDataUrl = "";
      confirmStop = false;
      await refresh(true);
    } finally {
      busy = false;
    }
  }

  function roleLabel(role: CollaborationRole): string {
    return m[`collaboration.role_${role}`]();
  }

  function roleDescription(role: CollaborationRole): string {
    return (
      {
        viewer: m["collaboration.role_viewer_desc"],
        collaborator: m["collaboration.role_collaborator_desc"],
        operator: m["collaboration.role_operator_desc"],
        administrator: m["collaboration.role_administrator_desc"],
      } as const
    )[role]();
  }

  function designAccessLabel(access: DesignAccess): string {
    return m[`collaboration.design_access_${access}`]();
  }

  function transportLabel(
    state: "connecting" | "connected" | "reconnecting" | "offline",
  ): string {
    return (
      (
        {
          connecting: m["collaboration.status_connecting"],
          connected: m["collaboration.status_connected"],
          reconnecting: m["collaboration.status_reconnecting"],
          offline: m["collaboration.status_offline"],
        } as const
      )[state]?.() ?? m["collaboration.status_offline"]()
    );
  }

  function expiryLabel(minutes: number): string {
    return (
      (
        {
          15: m["collaboration.expires_15"],
          30: m["collaboration.expires_30"],
          60: m["collaboration.expires_60"],
          240: m["collaboration.expires_240"],
          1440: m["collaboration.expires_1440"],
        } as Record<number, () => string>
      )[minutes]?.() ?? String(minutes)
    );
  }

  function eventLabel(event: string): string {
    const key = `collaboration.event_${event.replaceAll(".", "_")}`;
    const labels: Record<string, () => string> = {
      "collaboration.event_share_started":
        m["collaboration.event_share_started"],
      "collaboration.event_share_stopped":
        m["collaboration.event_share_stopped"],
      "collaboration.event_share_expired":
        m["collaboration.event_share_expired"],
      "collaboration.event_device_requested":
        m["collaboration.event_device_requested"],
      "collaboration.event_device_approved":
        m["collaboration.event_device_approved"],
      "collaboration.event_device_rejected":
        m["collaboration.event_device_rejected"],
      "collaboration.event_device_revoked":
        m["collaboration.event_device_revoked"],
      "collaboration.event_device_reconnected":
        m["collaboration.event_device_reconnected"],
      "collaboration.event_command_accepted":
        m["collaboration.event_command_accepted"],
      "collaboration.event_command_rejected":
        m["collaboration.event_command_rejected"],
      "collaboration.event_terminal_opened":
        m["collaboration.event_terminal_opened"],
      "collaboration.event_terminal_closed":
        m["collaboration.event_terminal_closed"],
    };
    return labels[key]?.() ?? event;
  }

  onMount(() => {
    void refresh();
    const timer = setInterval(() => void refresh(true), 2_000);
    return () => {
      clearInterval(timer);
      inviteUri = "";
      webInviteUri = "";
      qrDataUrl = "";
    };
  });
</script>

<Dialog.Root open onOpenChange={(open) => !open && onClose()}>
  <!-- Altura fixa so com abas (evita saltos ao trocar); demais estados abracam o conteudo. -->
  <Dialog.Content class={`flex flex-col gap-0 overflow-hidden p-0 sm:max-w-[760px] ${status?.enabled && status.share ? 'h-[min(90dvh,720px)]' : 'max-h-[min(90dvh,720px)]'}`}>
    <Dialog.Header class="shrink-0 border-b border-border/70 px-5 pt-5 pb-4 pr-12">
      <div class="flex items-start gap-3">
        <span class="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--app-accent-soft)] text-[var(--app-accent)]" aria-hidden="true"><RadioTower size={16} /></span>
        <div class="grid min-w-0 gap-1">
          <Dialog.Title>{m["collaboration.title"]()}</Dialog.Title>
          <Dialog.Description>{m["collaboration.subtitle"]()}</Dialog.Description>
        </div>
        {#if status?.share}
          <span class="ml-auto flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--app-hover)] px-2.5 py-1 text-ui-sm text-[var(--app-text-soft)]" role="status">
            <span class={`size-1.5 rounded-full ${status.transport?.state === "connected" ? "bg-[var(--app-success)]" : "bg-[var(--app-warning)]"}`} aria-hidden="true"></span>
            {transportLabel(status.transport?.state ?? "offline")}
          </span>
        {/if}
      </div>
    </Dialog.Header>

    <div class="flex min-h-0 flex-1 flex-col">
      {#if loading}
        <div class="grid min-h-48 flex-1 place-items-center">
          <span class="flex items-center gap-2 rounded-full bg-[var(--app-hover)] px-3 py-1.5 text-ui-md text-[var(--app-text-soft)]" role="status">
            <LoaderCircle class="animate-spin text-[var(--app-accent)]" size={14} aria-hidden="true" />{m["collaboration.title"]()}
          </span>
        </div>
      {:else if !status?.enabled}
        <!-- Recurso desligado: estado vazio centrado com a proxima acao. -->
        <div class="grid flex-1 place-items-center overflow-y-auto px-6 py-10">
          <div class="grid max-w-md justify-items-center gap-2 text-center">
            <span class="mb-1 grid size-10 place-items-center rounded-xl bg-[var(--app-accent-soft)] text-[var(--app-accent)]" aria-hidden="true"><ShieldCheck size={19} /></span>
            <h2 class="font-display text-[15px] font-semibold text-balance">{m["collaboration.experimental_title"]()}</h2>
            <p class="text-ui-lg leading-relaxed text-pretty text-[var(--app-text-muted)]">{m["collaboration.experimental_body"]()}</p>
            <label class="mt-4 flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 shadow-[var(--app-shadow-border)] transition-[background-color] duration-150 hover:bg-[var(--app-hover)]">
              <Switch
                checked={false}
                disabled={busy}
                onCheckedChange={(checked: boolean) => void setEnabled(checked)}
                aria-label={m["collaboration.enable"]()}
              />
              <span class="text-ui-lg font-medium">{m["collaboration.enable"]()}</span>
            </label>
          </div>
        </div>
      {:else if !status.share}
        <form method="POST" use:enhance class="flex min-h-0 flex-1 flex-col">
          <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <div class="mx-auto grid max-w-2xl gap-6 px-5 py-5">
              <p class="flex items-start gap-3 rounded-lg bg-[var(--app-success-soft)] px-3 py-3 text-ui-md leading-relaxed text-pretty">
                <ShieldCheck size={16} class="mt-0.5 shrink-0 text-[var(--app-success)]" aria-hidden="true" />
                <span><strong class="block text-ui-lg font-medium">{m["collaboration.private_title"]()}</strong><span class="text-[var(--app-text-soft)]">{m["collaboration.private_body"]()}</span></span>
              </p>

              <div class="grid items-start gap-4 sm:grid-cols-2">
                <label class="grid content-start gap-1.5">
                  <span class="text-ui-lg font-medium">{m["collaboration.default_role"]()}</span>
                  <Select.Root type="single" value={$formData.defaultRole as string} onValueChange={(value: string) => ($formData.defaultRole = value as CollaborationRole)}>
                    <Select.Trigger class="w-full"><span class="truncate">{$formData.defaultRole ? roleLabel($formData.defaultRole as CollaborationRole) : ""}</span></Select.Trigger>
                    <Select.Content>{#each ["viewer", "collaborator", "operator", "administrator"] as role}<Select.Item value={role}>{roleLabel(role as CollaborationRole)}</Select.Item>{/each}</Select.Content>
                  </Select.Root>
                  <span class="text-ui-md leading-snug text-pretty text-[var(--app-text-muted)]">{roleDescription($formData.defaultRole as CollaborationRole)}</span>
                </label>
                <label class="grid content-start gap-1.5">
                  <span class="text-ui-lg font-medium">{m["collaboration.expires"]()}</span>
                  <Select.Root type="single" value={String($formData.expiresInMinutes)} onValueChange={(value: string) => ($formData.expiresInMinutes = Number(value))}>
                    <Select.Trigger class="w-full"><span class="truncate">{expiryLabel(Number($formData.expiresInMinutes))}</span></Select.Trigger>
                    <Select.Content>{#each [15, 30, 60, 240, 1440] as minutes}<Select.Item value={String(minutes)}>{expiryLabel(minutes)}</Select.Item>{/each}</Select.Content>
                  </Select.Root>
                </label>
              </div>

              <!-- Limite pequeno (1-5): stepper em vez de campo numerico livre. -->
              <div class="flex items-center justify-between gap-4 border-t border-[var(--app-border)] pt-4">
                <span class="text-ui-lg font-medium" id="collaboration-max-peers">{m["collaboration.max_peers"]()}</span>
                <div class="stepper" role="group" aria-labelledby="collaboration-max-peers">
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`${m["collaboration.max_peers"]()} −`} disabled={Number($formData.maxPeers) <= 1} onclick={() => ($formData.maxPeers = Math.max(1, Number($formData.maxPeers) - 1))}><Minus aria-hidden="true" /></Button>
                  <output class="stepper-value" aria-live="polite">{$formData.maxPeers}</output>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`${m["collaboration.max_peers"]()} +`} disabled={Number($formData.maxPeers) >= 5} onclick={() => ($formData.maxPeers = Math.min(5, Number($formData.maxPeers) + 1))}><Plus aria-hidden="true" /></Button>
                </div>
              </div>

              <!-- Relay e raramente alterado: fica recolhido. -->
              <details class="advanced group rounded-lg shadow-[var(--app-shadow-border)]">
                <summary class="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-ui-lg font-medium">
                  <ChevronRight size={14} class="shrink-0 text-[var(--app-text-muted)] transition-transform duration-150 group-open:rotate-90" aria-hidden="true" />{m["collaboration.advanced"]()}
                </summary>
                <div class="grid gap-1.5 px-3 pb-3">
                  <label class="grid gap-1.5">
                    <span class="text-ui-md font-medium">{m["collaboration.relay"]()}</span>
                    <Input bind:value={$formData.relayUrl} autocomplete="off" spellcheck="false" class="font-mono text-[12px]" />
                  </label>
                  <p class="text-ui-md leading-snug text-pretty text-[var(--app-text-muted)]">{m["collaboration.relay_help"]()}</p>
                </div>
              </details>
            </div>
          </div>
          <div class="flex shrink-0 justify-end gap-2 border-t border-border/70 bg-muted/35 px-5 py-3.5">
            <Button type="submit" disabled={busy}>{#if busy}<LoaderCircle class="animate-spin" aria-hidden="true" />{:else}<RadioTower aria-hidden="true" />{/if}{m["collaboration.start"]()}</Button>
          </div>
        </form>
      {:else}
        <Tabs.Root bind:value={activeTab} class="flex min-h-0 flex-1 flex-col gap-0">
          <Tabs.List class="mx-5 mt-4 grid h-9 shrink-0 grid-cols-3 rounded-lg bg-[var(--app-hover)] p-0.5">
            <Tabs.Trigger value="invite" class={segmentTab}>{m["collaboration.tab_invite"]()}</Tabs.Trigger>
            <Tabs.Trigger value="access" class={segmentTab}>{m["collaboration.tab_access"]()}{#if pendingDevices.length}<span class="min-w-4 rounded-full bg-[var(--app-warning)] px-1 font-mono text-[11px] leading-4 text-[var(--app-accent-contrast)] tabular-nums">{pendingDevices.length}</span>{/if}</Tabs.Trigger>
            <Tabs.Trigger value="activity" class={segmentTab}>{m["collaboration.tab_activity"]()}</Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="invite" class="m-0 min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">
            <div class="grid gap-5 md:grid-cols-[minmax(0,1fr)_224px]">
              <div class="grid content-start gap-4">
                <div>
                  <h2 class="flex items-center gap-2 text-ui-lg font-medium"><Signal size={15} class="text-[var(--app-success)]" aria-hidden="true" />{m["collaboration.active"]()}</h2>
                  <p class="mt-1 text-ui-md leading-relaxed text-pretty text-[var(--app-text-muted)]">{m["collaboration.invite_help"]()}</p>
                </div>
                <div class="grid gap-1.5">
                  <SegmentedControl
                    fill
                    label={m["collaboration.invite_target"]()}
                    value={inviteTarget}
                    onValueChange={(value) => { inviteTarget = value; copied = false; void renderQr(); }}
                    options={[
                      { value: "web", label: m["collaboration.invite_web"](), icon: MonitorSmartphone },
                      { value: "app", label: m["collaboration.invite_app"](), icon: AppWindow },
                    ]}
                  />
                  <p class="text-ui-md leading-snug text-pretty text-[var(--app-text-muted)]">{inviteTarget === "web" ? m["collaboration.invite_web_help"]() : m["collaboration.invite_app_help"]()}</p>
                </div>
                <div class="grid grid-cols-2 gap-2">
                  <div class="stat-tile"><span class="section-label">{m["collaboration.connected_peers"]()}</span><p class="mt-1 font-mono text-ui-lg tabular-nums">{status.transport?.connectedPeers ?? 0} / {status.share.maxPeers}</p></div>
                  <div class="stat-tile"><span class="section-label">{m["collaboration.expires_at"]()}</span><p class="mt-1 text-ui-lg tabular-nums">{new Date(status.share.expiresAt).toLocaleString(localeState.current)}</p></div>
                </div>
                {#if selectedInviteUri}
                  <div class="flex min-w-0 gap-2">
                    <Input readonly value={selectedInviteUri} class="min-w-0 font-mono text-[12px]" aria-label={m["collaboration.copy_invite"]()} />
                    <Button variant="outline" size="icon" aria-label={m["collaboration.copy_invite"]()} title={m["collaboration.copy_invite"]()} onclick={copyInvite}>{#if copied}<Check class="text-[var(--app-success)]" aria-hidden="true" />{:else}<Clipboard aria-hidden="true" />{/if}</Button>
                  </div>
                {:else}
                  <p class="flex items-start gap-2 rounded-lg bg-[var(--app-hover)] px-3 py-2.5 text-ui-md leading-snug text-pretty text-[var(--app-text-soft)]"><KeyRound size={14} class="mt-px shrink-0" aria-hidden="true" />{m["collaboration.invite_rotated"]()}</p>
                {/if}
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <Button variant="outline" size="sm" disabled={busy} onclick={refreshInvite}><RefreshCw aria-hidden="true" />{m["collaboration.refresh_invite"]()}</Button>
                  <Button variant="destructive" size="sm" onclick={() => (confirmStop = true)}><ShieldOff aria-hidden="true" />{m["collaboration.stop"]()}</Button>
                </div>
              </div>
              <div class="grid aspect-square place-items-center self-start rounded-xl bg-white p-3 shadow-[var(--app-shadow-border)]">
                {#if qrDataUrl}<img src={qrDataUrl} width="200" height="200" alt={m["collaboration.qr_alt"]()} class="aspect-square w-full" />{:else}<KeyRound size={28} class="text-neutral-400" aria-hidden="true" />{/if}
              </div>
            </div>
          </Tabs.Content>

          <Tabs.Content value="access" class="m-0 grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] content-start gap-6 overflow-y-auto overscroll-contain p-5">
            <section class="grid gap-2">
              <h2 class="section-label">{m["collaboration.pending"]()} · <span class="tabular-nums">{pendingDevices.length}</span></h2>
              {#each pendingDevices as device (device.id)}
                <!-- Pedido pendente: cartao neutro; o estado fica no icone em alerta. -->
                <div class="grid gap-3 rounded-lg p-3 shadow-[var(--app-shadow-border)]">
                  <div class="flex items-center gap-3">
                    <span class="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--app-warning-soft)] text-[var(--app-warning)]" aria-hidden="true"><Laptop size={15} /></span>
                    <div class="min-w-0 flex-1">
                      <p class="truncate text-ui-lg font-medium">{device.displayName}</p>
                      <p class="mt-0.5 truncate font-mono text-[11px] text-[var(--app-text-muted)]" title={device.fingerprint}>{device.fingerprint}</p>
                    </div>
                  </div>
                  <div class="flex flex-wrap items-end gap-3">
                    <label class="grid min-w-36 gap-1 text-ui-sm text-[var(--app-text-muted)]">
                      <span>{m["collaboration.default_role"]()}</span>
                      <Select.Root type="single" value={roleDrafts[device.id]} onValueChange={(value: string) => { roleDrafts = { ...roleDrafts, [device.id]: value as CollaborationRole }; if (value !== "administrator") { terminalDrafts = { ...terminalDrafts, [device.id]: false }; } }}>
                        <Select.Trigger size="sm" class="w-full"><span class="truncate">{roleLabel(roleDrafts[device.id] ?? device.role)}</span></Select.Trigger>
                        <Select.Content>{#each ["viewer", "collaborator", "operator", "administrator"] as role}<Select.Item value={role}>{roleLabel(role as CollaborationRole)}</Select.Item>{/each}</Select.Content>
                      </Select.Root>
                    </label>
                    <label class="grid min-w-40 gap-1 text-ui-sm text-[var(--app-text-muted)]">
                      <span>{m["collaboration.design_access"]()}</span>
                      <Select.Root type="single" value={designDrafts[device.id] ?? "inherited"} onValueChange={(value: string) => designDrafts = { ...designDrafts, [device.id]: value as DesignAccess }}>
                        <Select.Trigger size="sm" class="w-full"><span class="truncate">{designAccessLabel(designDrafts[device.id] ?? "inherited")}</span></Select.Trigger>
                        <Select.Content>{#each ["inherited", "none", "view", "comment", "propose", "edit"] as access}<Select.Item value={access}>{designAccessLabel(access as DesignAccess)}</Select.Item>{/each}</Select.Content>
                      </Select.Root>
                    </label>
                    <label class="flex h-7 items-center gap-2 text-ui-md text-[var(--app-text-soft)]" title={m["collaboration.terminal_access_help"]()}>
                      <Switch
                        checked={terminalDrafts[device.id] ?? false}
                        disabled={busy || roleDrafts[device.id] !== "administrator"}
                        onCheckedChange={(checked: boolean) => (terminalDrafts = { ...terminalDrafts, [device.id]: checked })}
                        aria-label={m["collaboration.terminal_access"]()}
                      />
                      <span>{m["collaboration.terminal_access"]()}</span>
                    </label>
                    <div class="ml-auto flex gap-2">
                      <Button size="sm" variant="ghost" disabled={busy} onclick={() => decide(device, false)}><UserX aria-hidden="true" />{m["collaboration.reject"]()}</Button>
                      <Button size="sm" disabled={busy} onclick={() => decide(device, true)}><UserCheck aria-hidden="true" />{m["collaboration.approve"]()}</Button>
                    </div>
                  </div>
                </div>
              {:else}
                <p class="flex items-center gap-2 rounded-lg bg-[var(--app-hover)] px-3 py-2.5 text-ui-md text-[var(--app-text-soft)]"><Laptop size={14} class="shrink-0" aria-hidden="true" />{m["collaboration.no_pending"]()}</p>
              {/each}
            </section>
            <section class="grid gap-2">
              <h2 class="section-label">{m["collaboration.approved"]()} · <span class="tabular-nums">{approvedDevices.length}</span></h2>
              <div class="overflow-hidden rounded-lg shadow-[var(--app-shadow-border)]">
                {#each approvedDevices as device (device.id)}
                  <div class="device-row">
                    <span class="size-2 shrink-0 rounded-full bg-[var(--app-success)]" aria-hidden="true"></span>
                    <div class="min-w-32 flex-1">
                      <p class="truncate text-ui-lg font-medium">{device.displayName}</p>
                      <p class="mt-0.5 truncate font-mono text-[11px] text-[var(--app-text-muted)]" title={device.fingerprint}>{device.fingerprint}</p>
                    </div>
                    <Select.Root type="single" value={roleDrafts[device.id]} onValueChange={(value: string) => { roleDrafts = { ...roleDrafts, [device.id]: value as CollaborationRole }; if (value !== "administrator") { terminalDrafts = { ...terminalDrafts, [device.id]: false }; } }}>
                      <Select.Trigger size="sm" aria-label={m["collaboration.default_role"]()}><span>{roleLabel(roleDrafts[device.id] ?? device.role)}</span></Select.Trigger>
                      <Select.Content>{#each ["viewer", "collaborator", "operator", "administrator"] as role}<Select.Item value={role}>{roleLabel(role as CollaborationRole)}</Select.Item>{/each}</Select.Content>
                    </Select.Root>
                    <label class="flex items-center gap-2 text-ui-md text-[var(--app-text-soft)]" title={m["collaboration.terminal_access_help"]()}>
                      <Switch
                        checked={terminalDrafts[device.id] ?? false}
                        disabled={busy || roleDrafts[device.id] !== "administrator"}
                        onCheckedChange={(checked: boolean) => (terminalDrafts = { ...terminalDrafts, [device.id]: checked })}
                        aria-label={m["collaboration.terminal_access"]()}
                      />
                      <span>{m["collaboration.terminal_access"]()}</span>
                    </label>
                    <div class="flex gap-1">
                      {#if roleDrafts[device.id] !== device.role || (terminalDrafts[device.id] ?? false) !== device.scopes.includes("terminal.control")}
                        <Button variant="outline" size="sm" disabled={busy} onclick={() => decide(device, true)}>{m["collaboration.update_access"]()}</Button>
                      {/if}
                      <Button variant="ghost" size="sm" class="text-[var(--app-danger)] hover:text-[var(--app-danger)]" onclick={() => (pendingRevoke = device)}>{m["collaboration.revoke"]()}</Button>
                    </div>
                  </div>
                {:else}
                  <p class="px-3 py-4 text-center text-ui-md text-[var(--app-text-muted)]">{m["collaboration.no_devices"]()}</p>
                {/each}
              </div>
            </section>
          </Tabs.Content>

          <Tabs.Content value="activity" class="m-0 min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">
            {#if status.audit.length}
              <ol class="overflow-hidden rounded-lg shadow-[var(--app-shadow-border)]">
                {#each status.audit as event (event.id)}
                  <li class="device-row items-start">
                    <Clock3 size={14} class="mt-0.5 shrink-0 text-[var(--app-text-muted)]" aria-hidden="true" />
                    <div class="min-w-0 flex-1">
                      <p class="text-ui-lg font-medium">{eventLabel(event.eventType)}</p>
                      <p class="mt-0.5 font-mono text-[11px] tabular-nums text-[var(--app-text-muted)]">{new Date(event.createdAt).toLocaleString(localeState.current)}</p>
                    </div>
                  </li>
                {/each}
              </ol>
            {:else}
              <NodeEmptyState icon={Clock3} title={m["collaboration.audit_empty"]()} />
            {/if}
          </Tabs.Content>
        </Tabs.Root>
      {/if}
    </div>
  </Dialog.Content>
</Dialog.Root>

<AlertDialog.Root open={confirmStop} onOpenChange={(open) => !open && (confirmStop = false)}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>{m["collaboration.stop_confirm_title"]()}</AlertDialog.Title>
      <AlertDialog.Description>{m["collaboration.stop_confirm_body"]()}</AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>{m["settings.cancel"]()}</AlertDialog.Cancel>
      <AlertDialog.Action variant="destructive" disabled={busy} onclick={stopSharing}>{m["collaboration.stop"]()}</AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

<AlertDialog.Root open={pendingRevoke !== null} onOpenChange={(open) => !open && (pendingRevoke = null)}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>{m["collaboration.revoke_confirm_title"]()}</AlertDialog.Title>
      <AlertDialog.Description>{m["collaboration.revoke_confirm_body"]({ name: pendingRevoke?.displayName ?? "" })}</AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>{m["settings.cancel"]()}</AlertDialog.Cancel>
      <AlertDialog.Action variant="destructive" disabled={busy} onclick={revoke}>{m["collaboration.revoke"]()}</AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

<style>
  .stat-tile {
    padding: 10px 12px;
    border-radius: 8px;
    background: var(--app-hover);
  }

  .device-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
  }

  .device-row + .device-row {
    border-top: 1px solid var(--app-border);
  }

  .stepper {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 2px;
    border-radius: 8px;
    background: var(--app-hover);
  }

  .stepper-value {
    min-width: 28px;
    font-family: var(--font-mono);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    text-align: center;
    color: var(--app-text);
  }

  .advanced summary::-webkit-details-marker {
    display: none;
  }

  .advanced summary:focus-visible {
    border-radius: 8px;
    outline: 2px solid var(--app-accent);
    outline-offset: 2px;
  }
</style>
