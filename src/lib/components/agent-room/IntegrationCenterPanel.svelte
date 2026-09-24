<script lang="ts">
  import { getCsrfToken } from '@beeblock/svelar/http';
  import { toast } from '@beeblock/svelar/ui';
  import {
    Bot, CheckCircle2, CircleAlert, CircleHelp, Clock3, KeyRound, LoaderCircle,
    GitBranch, Mail, MessageCircle, MessagesSquare, Plus, Radio, RefreshCw, Send,
    ShieldCheck, Trash2, Webhook, XCircle,
  } from '@lucide/svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Select from '$lib/components/ui/select';
  import { Button } from '$lib/components/ui/button';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { Input } from '$lib/components/ui/input';
  import { Switch } from '$lib/components/ui/switch';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import NodeEmptyState from './canvas/NodeEmptyState.svelte';
  import type { AutomationIntegration } from '$lib/modules/agent-room/domain/types.js';
  import type { IntegrationType } from '$lib/modules/agent-room/contracts/schemas/integration.schema.js';
  import * as m from '$lib/paraglide/messages.js';
  import { getLocale } from '$lib/paraglide/runtime.js';

  type ManifestAction = { id: string; mutation: boolean; risk: string | null };
  type Manifest = { id: IntegrationType; version: string; auth: string; secretSlots: number; hosts: string[]; actions: ManifestAction[] };
  type IntegrationEvent = { id: string; integrationId: string; kind: string; status: string; error: string | null; createdAt: string; deliveryState?: 'accepted' | 'uncertain' | 'pending' | 'not_submitted' | 'unknown' | null; receipt?: { messageIds: string[]; evidence: 'provider_message_id' | 'http_response' } | null };
  type SecretRefCreated = { id: string; ref: string; storageKey: string };
  type DesktopBridge = {
    saveAutomationSecret?: (key: string, value: string) => Promise<{ stored: boolean }>;
    connectGoogleOAuth?: (input: { clientId: string; permissions: string[]; storageKey: string }) => Promise<{ stored: boolean; accountEmail: string | null }>;
  };

  let { workspaceId, compact = false, onChanged }: { workspaceId: string; compact?: boolean; onChanged?: () => void | Promise<void> } = $props();
  const desktop = typeof window === 'undefined' ? undefined : (window as typeof window & { orkestraiDesktop?: DesktopBridge }).orkestraiDesktop;
  const types: IntegrationType[] = ['gmail', 'slack', 'telegram', 'whatsapp', 'github', 'webhook'];
  const messages = m as unknown as Record<string, (input?: Record<string, string | number>) => string>;

  let loading = $state(true);
  let busy = $state(false);
  let dialogOpen = $state(false);
  let integrations = $state<AutomationIntegration[]>([]);
  let catalog = $state<Manifest[]>([]);
  let events = $state<IntegrationEvent[]>([]);
  let selectedId = $state<string | null>(null);
  let type = $state<IntegrationType>('gmail');
  let name = $state('Gmail');
  let permissions = $state<string[]>([]);
  let secretValue = $state('');
  let clientId = $state('');
  let owner = $state('');
  let repo = $state('');
  let defaultChannel = $state('');
  let defaultChatId = $state('');
  let phoneNumberId = $state('');
  let businessAccountId = $state('');
  let apiVersion = $state('v23.0');
  let defaultRecipient = $state('');
  let webhookUrl = $state('');
  let webhookMethod = $state<'POST' | 'PUT' | 'PATCH'>('POST');
  let authScheme = $state<'none' | 'bearer' | 'header'>('none');
  let authHeader = $state('X-API-Key');

  const selected = $derived(integrations.find((item) => item.id === selectedId) ?? integrations[0] ?? null);
  const selectedEvents = $derived(selected ? events.filter((event) => event.integrationId === selected.id) : events);
  const currentManifest = $derived(catalog.find((item) => item.id === type) ?? null);

  async function api<T>(path: string, init?: RequestInit): Promise<T> {
    const csrf = getCsrfToken();
    const response = await fetch(path, {
      ...init,
      headers: { 'content-type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}), ...(init?.headers ?? {}) },
    });
    const payload = await response.json();
    if (!response.ok || payload.error) throw new Error(payload.error || m['integrations.error']());
    return payload.data as T;
  }

  async function refresh(): Promise<void> {
    loading = true;
    try {
      const [index, history] = await Promise.all([
        api<{ integrations: AutomationIntegration[]; catalog: Manifest[] }>(`/api/agent-room/workspaces/${workspaceId}/integrations`),
        api<IntegrationEvent[]>(`/api/agent-room/workspaces/${workspaceId}/integrations/events?limit=200`),
      ]);
      integrations = index.integrations;
      catalog = index.catalog;
      events = history;
      if (!integrations.some((item) => item.id === selectedId)) selectedId = integrations[0]?.id ?? null;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : m['integrations.error']());
    } finally {
      loading = false;
    }
  }

  function providerLabel(value: IntegrationType): string {
    return ({ gmail: 'Gmail', slack: 'Slack', telegram: 'Telegram', whatsapp: 'WhatsApp', github: 'GitHub', webhook: 'Webhook' })[value];
  }

  function actionLabel(action: string): string {
    return messages[`integrations.action_${action.replaceAll('.', '_')}`]?.() ?? action;
  }

  function providerIcon(value: IntegrationType) {
    return ({ gmail: Mail, slack: MessagesSquare, telegram: Send, whatsapp: MessageCircle, github: GitBranch, webhook: Webhook })[value];
  }

  function statusTone(status: string, enabled: boolean): string {
    if (status === 'connected' && enabled) return 'bg-[var(--app-success-soft)] text-[var(--app-success)]';
    if (status === 'error') return 'bg-[var(--app-danger-soft)] text-[var(--app-danger)]';
    return 'bg-[var(--app-hover)] text-[var(--app-text-soft)]';
  }

  function deliveryTone(state: IntegrationEvent['deliveryState']): string {
    if (state === 'accepted') return 'bg-[var(--app-success-soft)] text-[var(--app-success)]';
    if (state === 'uncertain') return 'bg-[var(--app-warning-soft)] text-[var(--app-warning)]';
    if (state === 'not_submitted') return 'bg-[var(--app-danger-soft)] text-[var(--app-danger)]';
    return 'bg-[var(--app-hover)] text-[var(--app-text-soft)]';
  }

  function resetCreate(nextType: IntegrationType = 'gmail'): void {
    type = nextType;
    name = providerLabel(nextType);
    secretValue = '';
    clientId = '';
    owner = '';
    repo = '';
    defaultChannel = '';
    defaultChatId = '';
    phoneNumberId = '';
    businessAccountId = '';
    apiVersion = 'v23.0';
    defaultRecipient = '';
    webhookUrl = '';
    webhookMethod = 'POST';
    authScheme = 'none';
    authHeader = 'X-API-Key';
    const manifest = catalog.find((item) => item.id === nextType);
    permissions = manifest?.actions.filter((action) => !action.mutation).map((action) => action.id) ?? [];
    if (permissions.length === 0 && manifest?.actions[0]) permissions = [manifest.actions[0].id];
  }

  function togglePermission(action: string, checked: boolean): void {
    permissions = checked ? [...new Set([...permissions, action])] : permissions.filter((item) => item !== action);
  }

  async function createSecretRef(hosts: string[]): Promise<SecretRefCreated> {
    return api<SecretRefCreated>(`/api/agent-room/workspaces/${workspaceId}/secret-refs`, {
      method: 'POST',
      body: JSON.stringify({
        name: `${name} credential`, purpose: m['integrations.credential_purpose']({ provider: providerLabel(type) }), provider: 'desktop',
        bindings: { integrations: [type], operations: ['integration:probe', ...permissions], destinations: hosts },
      }),
    });
  }

  function config(): Record<string, unknown> {
    if (type === 'gmail') return { clientId, accountEmail: null };
    if (type === 'slack') return { defaultChannel: defaultChannel || null };
    if (type === 'telegram') return { defaultChatId: defaultChatId || null };
    if (type === 'whatsapp') return { phoneNumberId, businessAccountId: businessAccountId || null, apiVersion, defaultRecipient: defaultRecipient || null };
    if (type === 'github') return { owner, repo };
    return { url: webhookUrl, method: webhookMethod, authScheme, authHeader: authScheme === 'header' ? authHeader : null };
  }

  async function connect(): Promise<void> {
    if (!currentManifest || permissions.length === 0 || !name.trim()) return;
    busy = true;
    let created: SecretRefCreated | null = null;
    try {
      const requiresSecret = type !== 'webhook' || authScheme !== 'none';
      if (requiresSecret) {
        if (!desktop?.saveAutomationSecret) throw new Error(m['integrations.desktop_required']());
        created = await createSecretRef(type === 'webhook' ? [new URL(webhookUrl).hostname] : currentManifest.hosts);
        if (type === 'gmail') {
          if (!desktop.connectGoogleOAuth) throw new Error(m['integrations.desktop_required']());
          const result = await desktop.connectGoogleOAuth({ clientId, permissions, storageKey: created.storageKey });
          if (!result.stored) throw new Error(m['integrations.oauth_failed']());
          const gmailConfig = config();
          gmailConfig.accountEmail = result.accountEmail;
          await persist(created.ref, gmailConfig);
        } else {
          if (!secretValue) throw new Error(m['integrations.credential_required']());
          await desktop.saveAutomationSecret(created.storageKey, secretValue);
          await persist(created.ref, config());
        }
      } else {
        await persist(null, config());
      }
      dialogOpen = false;
      secretValue = '';
      toast.success(m['integrations.connected']({ provider: providerLabel(type) }));
      await refresh();
      await onChanged?.();
    } catch (error) {
      if (created) await api(`/api/agent-room/workspaces/${workspaceId}/secret-refs/${created.id}`, { method: 'DELETE' }).catch(() => undefined);
      secretValue = '';
      toast.error(error instanceof Error ? error.message : m['integrations.error']());
    } finally {
      busy = false;
    }
  }

  async function persist(secretRef: string | null, integrationConfig: Record<string, unknown>): Promise<void> {
    await api(`/api/agent-room/workspaces/${workspaceId}/integrations`, {
      method: 'POST',
      body: JSON.stringify({ type, name, config: integrationConfig, secretRefs: secretRef ? [secretRef] : [], permissions, enabled: true }),
    });
  }

  async function check(integration: AutomationIntegration): Promise<void> {
    busy = true;
    try {
      await api(`/api/agent-room/workspaces/${workspaceId}/integrations/${integration.id}/check`, { method: 'POST', body: '{}' });
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : m['integrations.error']());
    } finally { busy = false; }
  }

  async function toggle(integration: AutomationIntegration, enabled: boolean): Promise<void> {
    await api(`/api/agent-room/workspaces/${workspaceId}/integrations/${integration.id}`, { method: 'PATCH', body: JSON.stringify({ enabled }) });
    await refresh();
    await onChanged?.();
  }

  async function remove(integration: AutomationIntegration): Promise<void> {
    busy = true;
    try {
      await api(`/api/agent-room/workspaces/${workspaceId}/integrations/${integration.id}`, { method: 'DELETE' });
      await refresh();
      await onChanged?.();
    } finally { busy = false; }
  }

  $effect(() => { workspaceId; void refresh(); });
</script>

{#if loading}
  <div class="grid h-full min-h-52 place-items-center">
    <span class="inline-flex items-center gap-2 rounded-full bg-[var(--app-surface)] px-3 py-1.5 text-ui-sm text-[var(--app-text-muted)] shadow-border" role="status"><LoaderCircle size={13} class="animate-spin text-[var(--app-accent)]" aria-hidden="true" />{m['creative.loading']()}</span>
  </div>
{:else}
  <div class={`grid h-full min-h-0 ${compact ? 'grid-rows-[auto_minmax(0,1fr)]' : 'grid-cols-[220px_minmax(0,1fr)]'}`} data-testid="integration-center">
    <aside class="min-h-0 border-b border-[var(--app-border)] bg-[var(--app-canvas)] p-2 md:border-b-0 md:border-r">
      <div class="mb-1 flex items-center justify-between gap-2 py-1 pl-2">
        <div class="min-w-0"><h2 class="section-label truncate">{m['integrations.accounts']()}</h2><p class="text-ui-xs tabular-nums text-[var(--app-text-muted)]">{m['integrations.account_count']({ count: integrations.length })}</p></div>
        <Tooltip.Root>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <Button {...props} variant="ghost" size="icon-sm" aria-label={m['integrations.add']()} onclick={() => { resetCreate(); dialogOpen = true; }}><Plus size={15} /></Button>
            {/snippet}
          </Tooltip.Trigger>
          <Tooltip.Content>{m['integrations.add']()}</Tooltip.Content>
        </Tooltip.Root>
      </div>
      <div class={`grid gap-0.5 ${compact ? 'max-h-32 grid-cols-2 overflow-y-auto' : ''}`}>
        {#each integrations as integration (integration.id)}
          {@const Icon = providerIcon(integration.type)}
          <button type="button" class="account-row" class:selected={selected?.id === integration.id} aria-current={selected?.id === integration.id ? 'true' : undefined} onclick={() => (selectedId = integration.id)}>
            <span class="grid size-7 shrink-0 place-items-center rounded-lg bg-[var(--app-surface)] text-[var(--app-text-soft)] shadow-border"><Icon size={14} /></span>
            <span class="min-w-0 flex-1"><span class="block truncate text-ui-md font-medium text-[var(--app-text)]">{integration.name}</span><span class="block truncate text-ui-xs text-[var(--app-text-muted)]">{providerLabel(integration.type)}</span></span>
            <span class={`size-2 shrink-0 rounded-full ${integration.status === 'connected' && integration.enabled ? 'bg-[var(--app-success)]' : integration.status === 'error' ? 'bg-[var(--app-danger)]' : 'bg-[var(--app-text-muted)]'}`} aria-hidden="true"></span>
          </button>
        {/each}
        {#if integrations.length === 0}<p class="px-2 py-4 text-pretty text-ui-sm leading-[1.45] text-[var(--app-text-muted)]">{m['integrations.empty']()}</p>{/if}
      </div>
    </aside>

    <main class="min-h-0 overflow-y-auto p-4">
      {#if selected}
        {@const Icon = providerIcon(selected.type)}
        <header class="flex flex-wrap items-start gap-3 pb-4">
          <span class="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--app-surface)] text-[var(--app-text-soft)] shadow-border"><Icon size={17} /></span>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2"><h2 class="font-display text-[14px] font-semibold">{selected.name}</h2><span class={`rounded-md px-1.5 py-px text-ui-xs font-medium ${statusTone(selected.status, selected.enabled)}`}>{messages[`integrations.status_${selected.status}`]?.() ?? selected.status}</span></div>
            <p class="mt-0.5 truncate text-ui-sm text-[var(--app-text-muted)]">{String(selected.config.account ?? selected.config.accountEmail ?? providerLabel(selected.type))}</p>
          </div>
          <div class="flex items-center gap-1">
            <Switch class="mr-1.5" aria-label={m['integrations.enabled']()} checked={selected.enabled} onCheckedChange={(value: boolean) => void toggle(selected, value)} />
            <Tooltip.Root><Tooltip.Trigger>{#snippet child({ props })}<Button {...props} variant="ghost" size="icon-sm" aria-label={m['integrations.check']()} disabled={busy} onclick={() => check(selected)}><RefreshCw size={14} class={busy ? 'animate-spin' : ''} /></Button>{/snippet}</Tooltip.Trigger><Tooltip.Content>{m['integrations.check']()}</Tooltip.Content></Tooltip.Root>
            <Tooltip.Root><Tooltip.Trigger>{#snippet child({ props })}<Button {...props} variant="ghost" size="icon-sm" class="text-[var(--app-text-muted)] hover:bg-[var(--app-danger-soft)] hover:text-[var(--app-danger)]" aria-label={m['integrations.remove']()} disabled={busy} onclick={() => remove(selected)}><Trash2 size={14} /></Button>{/snippet}</Tooltip.Trigger><Tooltip.Content>{m['integrations.remove']()}</Tooltip.Content></Tooltip.Root>
          </div>
        </header>

        {#if selected.error}<div class="flex gap-2 rounded-lg bg-[var(--app-danger-soft)] px-3 py-2 text-ui-sm text-[var(--app-text)]" role="alert"><CircleAlert class="mt-0.5 shrink-0 text-[var(--app-danger)]" size={14} /><span class="min-w-0 break-words">{selected.error}</span></div>{/if}
        <section class="mt-4">
          <div class="mb-2 flex items-center gap-2"><ShieldCheck size={13} class="text-[var(--app-text-muted)]" aria-hidden="true" /><h3 class="section-label">{m['integrations.standing_grant']()}</h3></div>
          <div class="flex flex-wrap gap-1.5">{#each selected.permissions as permission}<span class="rounded-md bg-[var(--app-hover)] px-2 py-0.5 text-ui-sm text-[var(--app-text-soft)]">{actionLabel(permission)}</span>{/each}</div>
          <p class="mt-2 max-w-2xl text-pretty text-ui-sm leading-[1.45] text-[var(--app-text-muted)]">{m['integrations.standing_grant_help']()}</p>
        </section>
        <section class="mt-6">
          <div class="mb-2 flex items-center gap-2"><Radio size={13} class="text-[var(--app-text-muted)]" aria-hidden="true" /><h3 class="section-label">{m['integrations.activity']()}</h3></div>
          {#if selectedEvents.length === 0}
            <div class="grid min-h-40 rounded-xl bg-[var(--app-surface)] shadow-border"><NodeEmptyState compact icon={Radio} title={m['integrations.no_activity']()} /></div>
          {:else}
            <div class="overflow-hidden rounded-xl bg-[var(--app-surface)] shadow-border">
              {#each selectedEvents as event (event.id)}
                <article class="event-row flex items-start gap-3 px-3.5 py-3">
                  {#if event.deliveryState === 'uncertain'}<CircleAlert class="mt-0.5 shrink-0 text-[var(--app-warning)]" size={14} />
                  {:else if event.deliveryState === 'unknown'}<CircleHelp class="mt-0.5 shrink-0 text-[var(--app-text-muted)]" size={14} />
                  {:else if event.status === 'succeeded'}<CheckCircle2 class="mt-0.5 shrink-0 text-[var(--app-success)]" size={14} />
                  {:else if event.status === 'failed'}<XCircle class="mt-0.5 shrink-0 text-[var(--app-danger)]" size={14} />
                  {:else}<Clock3 class="mt-0.5 shrink-0 text-[var(--app-warning)]" size={14} />{/if}
                  <div class="min-w-0 flex-1">
                    <p class="text-ui-md font-medium">{actionLabel(event.kind)}</p>
                    <p class="mt-0.5 text-ui-xs tabular-nums text-[var(--app-text-muted)]">{new Date(event.createdAt).toLocaleString(getLocale())}</p>
                    {#if event.deliveryState}
                      <p class="mt-1.5"><span class={`inline-block rounded-md px-1.5 py-px text-ui-xs font-medium ${deliveryTone(event.deliveryState)}`}>{messages[`integrations.delivery_${event.deliveryState}`]?.() ?? m['integrations.delivery_unknown']()}</span></p>
                    {/if}
                    {#if event.deliveryState === 'uncertain'}
                      <p class="mt-1.5 text-pretty text-ui-sm leading-[1.45] text-[var(--app-warning)]">{m['integrations.delivery_uncertain_help']()}</p>
                    {:else if event.error}<p class="mt-1.5 break-words text-ui-sm leading-[1.45] text-[var(--app-danger)]">{event.deliveryState === 'not_submitted' ? m['integrations.delivery_not_submitted_help']() : event.error}</p>{/if}
                    {#if event.receipt?.messageIds.length}
                      <details class="mt-2 text-ui-sm">
                        <summary class="w-fit cursor-pointer rounded text-[var(--app-text-muted)] transition-colors hover:text-[var(--app-text-soft)]">{m['integrations.delivery_receipt']()}</summary>
                        <ul class="mt-1.5 space-y-1 rounded-md bg-[var(--app-canvas)] px-2.5 py-2 shadow-border">{#each event.receipt.messageIds as id}<li class="break-all font-mono text-ui-xs text-[var(--app-text-soft)]">{id}</li>{/each}</ul>
                      </details>
                    {/if}
                  </div>
                </article>
              {/each}
            </div>
          {/if}
        </section>
      {:else}
        <NodeEmptyState icon={Bot} title={m['integrations.empty_title']()} description={m['integrations.empty_help']()}>
          {#snippet actions()}<Button size="sm" onclick={() => { resetCreate(); dialogOpen = true; }}><Plus size={14} />{m['integrations.add']()}</Button>{/snippet}
        </NodeEmptyState>
      {/if}
    </main>
  </div>
{/if}

<Dialog.Root bind:open={dialogOpen}>
  <Dialog.Content class="max-h-[min(760px,calc(100vh-2rem))] max-w-2xl grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden p-0" showCloseButton={false}>
    <Dialog.Header class="border-b border-[var(--app-border)] px-5 py-4"><Dialog.Title>{m['integrations.add_title']()}</Dialog.Title><Dialog.Description>{m['integrations.add_description']()}</Dialog.Description></Dialog.Header>
    <div class="min-h-0 overflow-y-auto px-5 py-4">
      <div class="grid gap-4 sm:grid-cols-2">
        <label><span class="mb-1.5 block text-ui-md font-medium">{m['integrations.provider']()}</span><Select.Root type="single" value={type} onValueChange={(value) => resetCreate(value as IntegrationType)}><Select.Trigger class="w-full">{providerLabel(type)}</Select.Trigger><Select.Content>{#each types as candidate}<Select.Item value={candidate}>{providerLabel(candidate)}</Select.Item>{/each}</Select.Content></Select.Root></label>
        <label><span class="mb-1.5 block text-ui-md font-medium">{m['integrations.name']()}</span><Input bind:value={name} autocomplete="off" /></label>

        {#if type === 'gmail'}<label class="sm:col-span-2"><span class="mb-1.5 block text-ui-md font-medium">{m['integrations.google_client_id']()}</span><Input bind:value={clientId} autocomplete="off" placeholder="000000000000-....apps.googleusercontent.com" /><span class="mt-1.5 block text-pretty text-ui-sm leading-[1.45] text-[var(--app-text-muted)]">{m['integrations.google_client_help']()}</span></label>{/if}
        {#if type === 'github'}<label><span class="mb-1.5 block text-ui-md font-medium">{m['automation.github_owner']()}</span><Input bind:value={owner} /></label><label><span class="mb-1.5 block text-ui-md font-medium">{m['automation.github_repo']()}</span><Input bind:value={repo} /></label>{/if}
        {#if type === 'slack'}<label class="sm:col-span-2"><span class="mb-1.5 block text-ui-md font-medium">{m['integrations.default_channel']()}</span><Input bind:value={defaultChannel} placeholder="C0123456789" /></label>{/if}
        {#if type === 'telegram'}<label class="sm:col-span-2"><span class="mb-1.5 block text-ui-md font-medium">{m['integrations.default_chat']()}</span><Input bind:value={defaultChatId} /></label>{/if}
        {#if type === 'whatsapp'}<label><span class="mb-1.5 block text-ui-md font-medium">{m['integrations.phone_number_id']()}</span><Input bind:value={phoneNumberId} /></label><label><span class="mb-1.5 block text-ui-md font-medium">{m['integrations.business_account_id']()}</span><Input bind:value={businessAccountId} /></label><label><span class="mb-1.5 block text-ui-md font-medium">{m['integrations.api_version']()}</span><Input bind:value={apiVersion} /></label><label><span class="mb-1.5 block text-ui-md font-medium">{m['integrations.default_recipient']()}</span><Input bind:value={defaultRecipient} placeholder="+5511999999999" /></label>{/if}
        {#if type === 'webhook'}<label class="sm:col-span-2"><span class="mb-1.5 block text-ui-md font-medium">{m['integrations.webhook_url']()}</span><Input bind:value={webhookUrl} placeholder="https://example.com/hooks/orkestrai" /></label><label><span class="mb-1.5 block text-ui-md font-medium">{m['integrations.method']()}</span><Select.Root type="single" value={webhookMethod} onValueChange={(value) => (webhookMethod = value as typeof webhookMethod)}><Select.Trigger class="w-full">{webhookMethod}</Select.Trigger><Select.Content>{#each ['POST','PUT','PATCH'] as method}<Select.Item value={method}>{method}</Select.Item>{/each}</Select.Content></Select.Root></label><label><span class="mb-1.5 block text-ui-md font-medium">{m['integrations.authentication']()}</span><Select.Root type="single" value={authScheme} onValueChange={(value) => (authScheme = value as typeof authScheme)}><Select.Trigger class="w-full">{messages[`integrations.auth_${authScheme}`]()}</Select.Trigger><Select.Content><Select.Item value="none">{m['integrations.auth_none']()}</Select.Item><Select.Item value="bearer">Bearer</Select.Item><Select.Item value="header">{m['integrations.auth_header']()}</Select.Item></Select.Content></Select.Root></label>{#if authScheme === 'header'}<label class="sm:col-span-2"><span class="mb-1.5 block text-ui-md font-medium">{m['integrations.header_name']()}</span><Input bind:value={authHeader} /></label>{/if}{/if}

        {#if type !== 'gmail' && (type !== 'webhook' || authScheme !== 'none')}<label class="sm:col-span-2"><span class="mb-1.5 flex items-center gap-1.5 text-ui-md font-medium"><KeyRound size={13} class="text-[var(--app-text-muted)]" />{m['integrations.credential']()}</span><Input type="password" bind:value={secretValue} autocomplete="new-password" /><span class="mt-1.5 block text-pretty text-ui-sm leading-[1.45] text-[var(--app-text-muted)]">{m['integrations.credential_help']()}</span></label>{/if}
      </div>

      <section class="mt-6 border-t border-[var(--app-border)] pt-5"><h3 class="font-display text-[14px] font-semibold">{m['integrations.permissions']()}</h3><p class="mt-1 text-pretty text-ui-sm leading-[1.45] text-[var(--app-text-muted)]">{m['integrations.permissions_help']()}</p><div class="mt-3 grid gap-2 sm:grid-cols-2">{#each currentManifest?.actions ?? [] as action (action.id)}<label class="permission-option flex cursor-pointer items-start gap-2.5 rounded-lg px-3 py-2.5 shadow-border"><Checkbox class="mt-0.5" checked={permissions.includes(action.id)} onCheckedChange={(checked: boolean) => togglePermission(action.id, checked)} /><span class="min-w-0"><span class="block text-ui-md font-medium">{actionLabel(action.id)}</span><span class={`mt-0.5 block text-ui-sm ${action.mutation ? 'text-[var(--app-warning)]' : 'text-[var(--app-text-muted)]'}`}>{action.mutation ? m['integrations.mutation']() : m['integrations.read_only']()}</span></span></label>{/each}</div></section>
    </div>
    <Dialog.Footer class="border-t border-[var(--app-border)] px-5 py-3"><Button variant="ghost" onclick={() => (dialogOpen = false)}>{m['automation.cancel']()}</Button><Button disabled={busy || permissions.length === 0 || !name.trim()} onclick={connect}>{#if busy}<LoaderCircle class="animate-spin" />{:else if type === 'gmail'}<Mail />{:else}<ShieldCheck />{/if}{type === 'gmail' ? m['integrations.connect_google']() : m['integrations.connect']()}</Button></Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<style>
  /* Conta: selecao neutra com indicador de acento, como as linhas do Workbench. */
  .account-row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    padding: 6px 8px 6px 8px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    text-align: left;
    cursor: pointer;
    transition: background-color var(--duration-quick) ease-out;
  }

  .account-row:hover {
    background: var(--app-hover);
  }

  .account-row.selected {
    background: var(--app-active);
  }

  .account-row.selected::before {
    content: '';
    position: absolute;
    left: 0;
    top: 10px;
    bottom: 10px;
    width: 2px;
    border-radius: 0 2px 2px 0;
    background: var(--app-accent);
  }

  .account-row:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: -2px;
  }

  .event-row + .event-row {
    box-shadow: inset 0 1px 0 var(--app-border);
  }

  .permission-option {
    transition: background-color var(--duration-quick) ease-out, box-shadow var(--duration-quick) ease-out;
  }

  .permission-option:hover {
    background: var(--app-hover);
  }

  .permission-option:has([data-state='checked']) {
    background: var(--app-active);
    box-shadow: var(--app-shadow-border-hover);
  }
</style>
