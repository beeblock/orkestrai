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
  } from "@lucide/svelte";
  import * as AlertDialog from "$lib/components/ui/alert-dialog";
  import * as Dialog from "$lib/components/ui/dialog";
  import * as Select from "$lib/components/ui/select";
  import * as Tabs from "$lib/components/ui/tabs";
  import { Badge } from "$lib/components/ui/badge";
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
  <Dialog.Content
    class="grid h-[min(90dvh,720px)] max-h-[720px] max-w-[calc(100%-1.5rem)]! grid-rows-[auto_minmax(0,1fr)] gap-0! overflow-hidden rounded-lg p-0! sm:max-w-3xl!"
  >
    <Dialog.Header class="border-b border-border/60 px-5 py-4 pr-12">
      <div class="flex items-start gap-3">
        <span
          class="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--app-accent-soft)] text-[var(--app-accent)]"
          ><RadioTower size={18} /></span
        >
        <div class="min-w-0">
          <Dialog.Title>{m["collaboration.title"]()}</Dialog.Title>
          <Dialog.Description class="text-pretty"
            >{m["collaboration.subtitle"]()}</Dialog.Description
          >
        </div>
        {#if status?.share}
          <Badge
            variant="outline"
            class="ml-auto mr-5 gap-1 border-[var(--app-border)] text-[var(--app-text-soft)]"
          >
            <span
              class={`size-1.5 rounded-full ${status.transport?.state === "connected" ? "bg-[var(--app-success)]" : "bg-[var(--app-warning)]"}`}
            ></span>
            {transportLabel(status.transport?.state ?? "offline")}
          </Badge>
        {/if}
      </div>
    </Dialog.Header>

    <div class="min-h-0 overflow-hidden">
      {#if loading}
        <div class="grid h-full min-h-0 place-items-center">
          <LoaderCircle
            class="animate-spin text-[var(--app-accent)]"
            size={22}
          />
        </div>
      {:else if !status?.enabled}
        <div
          class="mx-auto flex h-full min-h-0 max-w-xl flex-col justify-center overflow-y-auto px-6 py-10 text-center"
        >
          <span
            class="mx-auto grid size-12 place-items-center rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-raised)] text-[var(--app-accent)]"
            ><ShieldCheck size={23} /></span
          >
          <h2 class="mt-4 text-base font-semibold">
            {m["collaboration.experimental_title"]()}
          </h2>
          <p
            class="mt-2 text-sm leading-6 text-pretty text-[var(--app-text-muted)]"
          >
            {m["collaboration.experimental_body"]()}
          </p>
          <div class="mt-5 flex items-center justify-center gap-3">
            <Switch
              checked={false}
              disabled={busy}
              onCheckedChange={(checked: boolean) => void setEnabled(checked)}
              aria-label={m["collaboration.enable"]()}
            />
            <span class="text-sm font-medium"
              >{m["collaboration.enable"]()}</span
            >
          </div>
        </div>
      {:else if !status.share}
        <form
          method="POST"
          use:enhance
          class="mx-auto h-full max-w-2xl space-y-5 overflow-y-auto px-6 py-6"
        >
          <div
            class="rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-raised)] p-4"
          >
            <div class="flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck size={16} class="text-[var(--app-success)]" />{m[
                "collaboration.private_title"
              ]()}
            </div>
            <p class="mt-1.5 text-xs leading-5 text-[var(--app-text-muted)]">
              {m["collaboration.private_body"]()}
            </p>
          </div>
          <div class="grid items-start gap-4 sm:grid-cols-2">
            <label class="flex self-start flex-col items-stretch gap-1.5 text-xs font-medium">
              <span class="min-h-4 leading-4">{m["collaboration.default_role"]()}</span>
              <Select.Root
                type="single"
                value={$formData.defaultRole as string}
                onValueChange={(value: string) =>
                  ($formData.defaultRole = value as CollaborationRole)}
              >
                <Select.Trigger class="w-full"
                  ><span
                    >{$formData.defaultRole
                      ? roleLabel($formData.defaultRole as CollaborationRole)
                      : ""}</span
                  ></Select.Trigger
                >
                <Select.Content
                  >{#each ["viewer", "collaborator", "operator", "administrator"] as role}<Select.Item
                      value={role}
                      >{roleLabel(role as CollaborationRole)}</Select.Item
                    >{/each}</Select.Content
                >
              </Select.Root>
              <span class="font-normal leading-4 text-[var(--app-text-muted)]"
                >{roleDescription(
                  $formData.defaultRole as CollaborationRole,
                )}</span
              >
            </label>
            <label class="flex self-start flex-col items-stretch gap-1.5 text-xs font-medium">
              <span class="min-h-4 leading-4">{m["collaboration.expires"]()}</span>
              <Select.Root
                type="single"
                value={String($formData.expiresInMinutes)}
                onValueChange={(value: string) =>
                  ($formData.expiresInMinutes = Number(value))}
              >
                <Select.Trigger class="w-full"
                  ><span>{expiryLabel(Number($formData.expiresInMinutes))}</span
                  ></Select.Trigger
                >
                <Select.Content
                  >{#each [15, 30, 60, 240, 1440] as minutes}<Select.Item
                      value={String(minutes)}
                      >{expiryLabel(minutes)}</Select.Item
                    >{/each}</Select.Content
                >
              </Select.Root>
            </label>
          </div>
          <div class="grid items-start gap-4 sm:grid-cols-[1fr_140px]">
            <label class="flex self-start flex-col items-stretch gap-1.5 text-xs font-medium">
              <span class="min-h-4 leading-4">{m["collaboration.relay"]()}</span><Input
                bind:value={$formData.relayUrl}
                autocomplete="off"
                spellcheck="false"
              />
            </label>
            <label class="flex self-start flex-col items-stretch gap-1.5 text-xs font-medium">
              <span class="min-h-4 leading-4">{m["collaboration.max_peers"]()}</span><Input
                type="number"
                min="1"
                max="5"
                bind:value={$formData.maxPeers}
              />
            </label>
          </div>
          <p class="text-xs leading-5 text-[var(--app-text-muted)]">
            {m["collaboration.relay_help"]()}
          </p>
          <div class="flex justify-end">
            <Button type="submit" disabled={busy}
              >{#if busy}<LoaderCircle class="animate-spin" />{/if}<RadioTower
              />{m["collaboration.start"]()}</Button
            >
          </div>
        </form>
      {:else}
        <Tabs.Root bind:value={activeTab} class="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-0">
          <Tabs.List
            class="mx-5 mt-4 grid grid-cols-3 bg-[var(--app-surface-raised)]"
          >
            <Tabs.Trigger value="invite" class="transition-[background-color,color,box-shadow] data-[state=active]:bg-[var(--app-accent)]! data-[state=active]:text-[var(--app-accent-contrast)]! data-[state=active]:shadow-sm"
              >{m["collaboration.tab_invite"]()}</Tabs.Trigger
            >
            <Tabs.Trigger value="access" class="gap-1.5 transition-[background-color,color,box-shadow] data-[state=active]:bg-[var(--app-accent)]! data-[state=active]:text-[var(--app-accent-contrast)]! data-[state=active]:shadow-sm"
              >{m[
                "collaboration.tab_access"
              ]()}{#if pendingDevices.length}<Badge
                  class="h-4 min-w-4 px-1 text-ui-xs"
                  >{pendingDevices.length}</Badge
                >{/if}</Tabs.Trigger
            >
            <Tabs.Trigger value="activity" class="transition-[background-color,color,box-shadow] data-[state=active]:bg-[var(--app-accent)]! data-[state=active]:text-[var(--app-accent-contrast)]! data-[state=active]:shadow-sm"
              >{m["collaboration.tab_activity"]()}</Tabs.Trigger
            >
          </Tabs.List>

          <Tabs.Content value="invite" class="m-0 min-h-0 overflow-y-auto overscroll-contain p-5">
            <div class="grid gap-5 md:grid-cols-[minmax(0,1fr)_224px]">
              <div>
                <div class="flex items-center gap-2">
                  <Signal size={16} class="text-[var(--app-success)]" />
                  <h2 class="text-sm font-semibold">
                    {m["collaboration.active"]()}
                  </h2>
                </div>
                <p class="mt-2 text-xs leading-5 text-[var(--app-text-muted)]">
                  {m["collaboration.invite_help"]()}
                </p>
                <div class="mt-4 grid grid-cols-2 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-raised)] p-1" role="tablist" aria-label={m["collaboration.invite_target"]()}>
                  <button type="button" role="tab" aria-selected={inviteTarget === "web"} class={`flex min-h-9 items-center justify-center gap-2 rounded-md px-2 text-ui-sm font-medium transition-colors ${inviteTarget === "web" ? "bg-[var(--app-surface)] text-[var(--app-text)] shadow-sm" : "text-[var(--app-text-muted)] hover:text-[var(--app-text)]"}`} onclick={() => { inviteTarget = "web"; copied = false; void renderQr(); }}><MonitorSmartphone size={14} />{m["collaboration.invite_web"]()}</button>
                  <button type="button" role="tab" aria-selected={inviteTarget === "app"} class={`flex min-h-9 items-center justify-center gap-2 rounded-md px-2 text-ui-sm font-medium transition-colors ${inviteTarget === "app" ? "bg-[var(--app-surface)] text-[var(--app-text)] shadow-sm" : "text-[var(--app-text-muted)] hover:text-[var(--app-text)]"}`} onclick={() => { inviteTarget = "app"; copied = false; void renderQr(); }}><AppWindow size={14} />{m["collaboration.invite_app"]()}</button>
                </div>
                <p class="mt-2 text-ui-xs leading-4 text-[var(--app-text-muted)]">{inviteTarget === "web" ? m["collaboration.invite_web_help"]() : m["collaboration.invite_app_help"]()}</p>
                <div
                  class="mt-4 grid grid-cols-2 gap-2 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-raised)] p-3 text-xs"
                >
                  <span class="text-[var(--app-text-muted)]"
                    >{m["collaboration.connected_peers"]()}</span
                  ><strong class="text-right tabular-nums"
                    >{status.transport?.connectedPeers ?? 0} / {status.share
                      .maxPeers}</strong
                  >
                  <span class="text-[var(--app-text-muted)]"
                    >{m["collaboration.expires_at"]()}</span
                  ><strong class="text-right"
                    >{new Date(status.share.expiresAt).toLocaleString(
                      localeState.current,
                    )}</strong
                  >
                </div>
                {#if selectedInviteUri}
                  <div class="mt-4 flex min-w-0 gap-2">
                    <Input
                      readonly
                      value={selectedInviteUri}
                      class="min-w-0 font-mono text-ui-sm"
                    /><Button
                      variant="outline"
                      size="icon"
                      aria-label={m["collaboration.copy_invite"]()}
                      onclick={copyInvite}
                      >{#if copied}<Check />{:else}<Clipboard />{/if}</Button
                    >
                  </div>
                {:else}
                  <div
                    class="mt-4 rounded-lg border border-dashed border-[var(--app-border)] px-4 py-5 text-center text-xs text-[var(--app-text-muted)]"
                  >
                    {m["collaboration.invite_rotated"]()}
                  </div>
                {/if}
                <div class="mt-3 flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onclick={refreshInvite}
                    ><RefreshCw />{m["collaboration.refresh_invite"]()}</Button
                  ><Button
                    variant="destructive"
                    size="sm"
                    onclick={() => (confirmStop = true)}
                    ><ShieldOff />{m["collaboration.stop"]()}</Button
                  >
                </div>
              </div>
              <div
                class="grid min-h-56 place-items-center rounded-lg border border-[var(--app-border)] bg-white p-3"
              >
                {#if qrDataUrl}<img
                    src={qrDataUrl}
                    width="200"
                    height="200"
                    alt={m["collaboration.qr_alt"]()}
                    class="aspect-square w-full"
                  />{:else}<KeyRound size={28} class="text-neutral-400" />{/if}
              </div>
            </div>
          </Tabs.Content>

          <Tabs.Content value="access" class="m-0 min-h-0 space-y-5 overflow-y-auto overscroll-contain p-5">
            <section>
              <h2
                class="text-xs font-semibold uppercase text-[var(--app-text-muted)]"
              >
                {m["collaboration.pending"]()} · {pendingDevices.length}
              </h2>
              <div class="mt-2 space-y-2">
                {#each pendingDevices as device (device.id)}
                  <div
                    class="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--app-warning)]/35 bg-[var(--app-warning)]/5 p-3"
                  >
                    <span
                      class="grid size-8 place-items-center rounded-lg bg-[var(--app-surface-raised)]"
                      ><Laptop size={15} /></span
                    >
                    <div class="min-w-32 flex-1">
                      <p class="text-sm font-medium">{device.displayName}</p>
                      <p
                        class="mt-0.5 font-mono text-ui-xs text-[var(--app-text-muted)]"
                      >
                        {device.fingerprint}
                      </p>
                    </div>
                    <Select.Root
                      type="single"
                      value={roleDrafts[device.id]}
                      onValueChange={(value: string) =>
                        {
                          roleDrafts = {
                            ...roleDrafts,
                            [device.id]: value as CollaborationRole,
                          };
                          if (value !== "administrator") {
                            terminalDrafts = { ...terminalDrafts, [device.id]: false };
                          }
                        }}
                    >
                      <Select.Trigger size="sm"
                        ><span
                          >{roleLabel(
                            roleDrafts[device.id] ?? device.role,
                          )}</span
                        ></Select.Trigger
                      >
                      <Select.Content
                        >{#each ["viewer", "collaborator", "operator", "administrator"] as role}<Select.Item
                            value={role}
                            >{roleLabel(role as CollaborationRole)}</Select.Item
                          >{/each}</Select.Content
                      >
                    </Select.Root>
                    <label class="grid min-w-40 gap-1 text-ui-xs text-[var(--app-text-muted)]">
                      <span>{m["collaboration.design_access"]()}</span>
                      <Select.Root type="single" value={designDrafts[device.id] ?? "inherited"} onValueChange={(value: string) => designDrafts = { ...designDrafts, [device.id]: value as DesignAccess }}>
                        <Select.Trigger size="sm"><span>{designAccessLabel(designDrafts[device.id] ?? "inherited")}</span></Select.Trigger>
                        <Select.Content>{#each ["inherited", "none", "view", "comment", "propose", "edit"] as access}<Select.Item value={access}>{designAccessLabel(access as DesignAccess)}</Select.Item>{/each}</Select.Content>
                      </Select.Root>
                    </label>
                    <label
                      class="flex min-w-40 items-center gap-2 text-ui-xs text-[var(--app-text-muted)]"
                      title={m["collaboration.terminal_access_help"]()}
                    >
                      <Switch
                        checked={terminalDrafts[device.id] ?? false}
                        disabled={busy || roleDrafts[device.id] !== "administrator"}
                        onCheckedChange={(checked: boolean) =>
                          (terminalDrafts = { ...terminalDrafts, [device.id]: checked })}
                        aria-label={m["collaboration.terminal_access"]()}
                      />
                      <span>{m["collaboration.terminal_access"]()}</span>
                    </label>
                    <Button
                      size="sm"
                      disabled={busy}
                      onclick={() => decide(device, true)}
                      ><UserCheck />{m["collaboration.approve"]()}</Button
                    >
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onclick={() => decide(device, false)}
                      ><UserX />{m["collaboration.reject"]()}</Button
                    >
                  </div>
                {:else}<p
                    class="rounded-lg border border-dashed border-[var(--app-border)] p-5 text-center text-xs text-[var(--app-text-muted)]"
                  >
                    {m["collaboration.no_pending"]()}
                  </p>{/each}
              </div>
            </section>
            <section>
              <h2
                class="text-xs font-semibold uppercase text-[var(--app-text-muted)]"
              >
                {m["collaboration.approved"]()} · {approvedDevices.length}
              </h2>
              <div
                class="mt-2 divide-y divide-[var(--app-border)] rounded-lg border border-[var(--app-border)]"
              >
                {#each approvedDevices as device (device.id)}
                  <div class="flex flex-wrap items-center gap-3 p-3">
                    <span class="size-2 rounded-full bg-[var(--app-success)]"
                    ></span>
                    <div class="min-w-32 flex-1">
                      <p class="truncate text-sm font-medium">
                        {device.displayName}
                      </p>
                      <p
                        class="mt-0.5 text-ui-xs text-[var(--app-text-muted)]"
                      >
                        {device.fingerprint}
                      </p>
                    </div>
                    <Select.Root
                      type="single"
                      value={roleDrafts[device.id]}
                      onValueChange={(value: string) =>
                        {
                          roleDrafts = {
                            ...roleDrafts,
                            [device.id]: value as CollaborationRole,
                          };
                          if (value !== "administrator") {
                            terminalDrafts = { ...terminalDrafts, [device.id]: false };
                          }
                        }}
                      ><Select.Trigger size="sm"
                        ><span
                          >{roleLabel(
                            roleDrafts[device.id] ?? device.role,
                          )}</span
                        ></Select.Trigger
                      ><Select.Content
                        >{#each ["viewer", "collaborator", "operator", "administrator"] as role}<Select.Item
                            value={role}
                            >{roleLabel(role as CollaborationRole)}</Select.Item
                          >{/each}</Select.Content
                      ></Select.Root>
                    <label
                      class="flex min-w-40 items-center gap-2 text-ui-xs text-[var(--app-text-muted)]"
                      title={m["collaboration.terminal_access_help"]()}
                    >
                      <Switch
                        checked={terminalDrafts[device.id] ?? false}
                        disabled={busy || roleDrafts[device.id] !== "administrator"}
                        onCheckedChange={(checked: boolean) =>
                          (terminalDrafts = { ...terminalDrafts, [device.id]: checked })}
                        aria-label={m["collaboration.terminal_access"]()}
                      />
                      <span>{m["collaboration.terminal_access"]()}</span>
                    </label>
                    {#if roleDrafts[device.id] !== device.role ||
                    (terminalDrafts[device.id] ?? false) !== device.scopes.includes("terminal.control")}<Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onclick={() => decide(device, true)}
                        >{m["collaboration.update_access"]()}</Button
                      >{/if}<Button
                      variant="ghost"
                      size="sm"
                      onclick={() => (pendingRevoke = device)}
                      >{m["collaboration.revoke"]()}</Button
                    >
                  </div>
                {:else}<p
                    class="p-5 text-center text-xs text-[var(--app-text-muted)]"
                  >
                    {m["collaboration.no_devices"]()}
                  </p>{/each}
              </div>
            </section>
          </Tabs.Content>

          <Tabs.Content value="activity" class="m-0 min-h-0 overflow-y-auto overscroll-contain p-5">
            <div
              class="divide-y divide-[var(--app-border)] rounded-lg border border-[var(--app-border)]"
            >
              {#each status.audit as event (event.id)}
                <div class="flex gap-3 p-3">
                  <Clock3
                    size={14}
                    class="mt-0.5 shrink-0 text-[var(--app-text-muted)]"
                  />
                  <div class="min-w-0 flex-1">
                    <p class="text-xs font-medium">
                      {eventLabel(event.eventType)}
                    </p>
                    <p class="mt-1 text-ui-xs text-[var(--app-text-muted)]">
                      {new Date(event.createdAt).toLocaleString(
                        localeState.current,
                      )}
                    </p>
                  </div>
                </div>
              {:else}<p
                  class="p-6 text-center text-xs text-[var(--app-text-muted)]"
                >
                  {m["collaboration.audit_empty"]()}
                </p>{/each}
            </div>
          </Tabs.Content>
        </Tabs.Root>
      {/if}
    </div>
  </Dialog.Content>
</Dialog.Root>

<AlertDialog.Root
  open={confirmStop}
  onOpenChange={(open) => !open && (confirmStop = false)}
>
  <AlertDialog.Content
    ><AlertDialog.Header
      ><AlertDialog.Title
        >{m["collaboration.stop_confirm_title"]()}</AlertDialog.Title
      ><AlertDialog.Description
        >{m["collaboration.stop_confirm_body"]()}</AlertDialog.Description
      ></AlertDialog.Header
    ><AlertDialog.Footer
      ><AlertDialog.Cancel>{m["settings.cancel"]()}</AlertDialog.Cancel
      ><AlertDialog.Action disabled={busy} onclick={stopSharing}
        >{m["collaboration.stop"]()}</AlertDialog.Action
      ></AlertDialog.Footer
    ></AlertDialog.Content
  >
</AlertDialog.Root>

<AlertDialog.Root
  open={pendingRevoke !== null}
  onOpenChange={(open) => !open && (pendingRevoke = null)}
>
  <AlertDialog.Content
    ><AlertDialog.Header
      ><AlertDialog.Title
        >{m["collaboration.revoke_confirm_title"]()}</AlertDialog.Title
      ><AlertDialog.Description
        >{m["collaboration.revoke_confirm_body"]({
          name: pendingRevoke?.displayName ?? "",
        })}</AlertDialog.Description
      ></AlertDialog.Header
    ><AlertDialog.Footer
      ><AlertDialog.Cancel>{m["settings.cancel"]()}</AlertDialog.Cancel
      ><AlertDialog.Action disabled={busy} onclick={revoke}
        >{m["collaboration.revoke"]()}</AlertDialog.Action
      ></AlertDialog.Footer
    ></AlertDialog.Content
  >
</AlertDialog.Root>
