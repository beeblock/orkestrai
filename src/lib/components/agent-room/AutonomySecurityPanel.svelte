<script lang="ts">
  import { getCsrfToken } from '@beeblock/svelar/http';
  import { toast } from '@beeblock/svelar/ui';
  import { Ban, Check, CircleAlert, Download, KeyRound, LoaderCircle, RefreshCw, Save, ScrollText, ShieldCheck, Trash2, X } from '@lucide/svelte';
  import * as Tabs from '$lib/components/ui/tabs';
  import * as Select from '$lib/components/ui/select';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Textarea } from '$lib/components/ui/textarea';
  import { Switch } from '$lib/components/ui/switch';
  import type { AutonomyCapability, AutonomyMode, AutonomyPolicyDocument, AutonomyRisk, GateRequirement } from '$lib/modules/agent-room/contracts/schemas/autonomy-policy.schema.js';
  import type { ApprovalGateRecord, AutonomyAuditRecord, AutonomyPolicyRecord } from '$lib/modules/agent-room/application/services/AutonomyPolicyService.js';
  import type { SecretRefRecord } from '$lib/modules/agent-room/application/services/SecretRefService.js';
  import * as m from '$lib/paraglide/messages.js';

  type SecretRefCreated = SecretRefRecord & { storageKey: string };
  type DesktopBridge = { saveAutomationSecret?: (key: string, value: string) => Promise<{ stored: boolean }> };

  let { workspaceId, compact = false }: { workspaceId: string; compact?: boolean } = $props();

  const capabilities: AutonomyCapability[] = ['agent', 'browser', 'computer', 'filesystem', 'git', 'integration', 'network', 'notification', 'task', 'tool'];
  const risks: AutonomyRisk[] = ['outside_boundary', 'secret_export', 'bulk_destructive', 'force_push', 'production_deploy', 'purchase', 'external_publication', 'account_permission', 'irreversible'];
  const requirements: GateRequirement[] = ['preapproved', 'user', 'reviewer', 'council'];
  const desktop = typeof window === 'undefined' ? undefined : (window as typeof window & { orkestraiDesktop?: DesktopBridge }).orkestraiDesktop;
  const messages = m as unknown as Record<string, (input?: Record<string, number | string>) => string>;

  let tab = $state('access');
  let loading = $state(true);
  let busy = $state(false);
  let policy = $state<AutonomyPolicyRecord | null>(null);
  let gates = $state<ApprovalGateRecord[]>([]);
  let secrets = $state<SecretRefRecord[]>([]);
  let audit = $state<AutonomyAuditRecord[]>([]);
  let integrity = $state<{ valid: boolean; checked: number; brokenAt: string | null } | null>(null);
  let roots = $state('');
  let excludes = $state('');
  let hosts = $state('');
  let secretName = $state('');
  let secretPurpose = $state('');
  let secretValue = $state('');
  let secretIntegrations = $state('');
  let secretOperations = $state('');
  let secretDestinations = $state('');

  async function api<T>(path: string, init?: RequestInit): Promise<T> {
    const csrf = getCsrfToken();
    const response = await fetch(path, {
      ...init,
      headers: { 'content-type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}), ...(init?.headers ?? {}) },
    });
    const payload = await response.json();
    if (!response.ok || payload.error) throw new Error(payload.error || m['autonomy.error']());
    return payload.data as T;
  }

  function hydrateDraft(record: AutonomyPolicyRecord): void {
    policy = record;
    roots = record.policy.filesystem.map((grant) => grant.root).join('\n');
    excludes = record.policy.filesystem[0]?.excludeGlobs.join('\n') ?? '';
    hosts = record.policy.network.flatMap((grant) => grant.hosts).join('\n');
  }

  async function refresh(): Promise<void> {
    loading = true;
    try {
      const [loadedPolicy, loadedGates, loadedSecrets, loadedAudit] = await Promise.all([
        api<AutonomyPolicyRecord>('/api/agent-room/workspaces/' + workspaceId + '/autonomy'),
        api<ApprovalGateRecord[]>('/api/agent-room/workspaces/' + workspaceId + '/autonomy/gates'),
        api<SecretRefRecord[]>('/api/agent-room/workspaces/' + workspaceId + '/secret-refs'),
        api<{ events: AutonomyAuditRecord[]; integrity: { valid: boolean; checked: number; brokenAt: string | null } }>('/api/agent-room/workspaces/' + workspaceId + '/autonomy/audit'),
      ]);
      hydrateDraft(loadedPolicy);
      gates = loadedGates;
      secrets = loadedSecrets;
      audit = loadedAudit.events;
      integrity = loadedAudit.integrity;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : m['autonomy.error']());
    } finally {
      loading = false;
    }
  }

  function lines(value: string): string[] {
    return [...new Set(value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean))];
  }

  async function savePolicy(): Promise<void> {
    if (!policy) return;
    busy = true;
    try {
      const excludeGlobs = lines(excludes);
      const rootList = lines(roots);
      if (rootList.length === 0) throw new Error(m['autonomy.root_required']());
      const hostList = lines(hosts).map((host) => host.toLowerCase());
      const document: AutonomyPolicyDocument = {
        ...policy.policy,
        filesystem: rootList.map((root) => ({ root, permissions: ['read', 'write', 'create', 'delete'], excludeGlobs, followSymlinks: false, maxFileSize: 50 * 1024 * 1024 })),
        network: hostList.length ? [{ schemes: ['http', 'https'], hosts: hostList, ports: [], methods: ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'], operations: [] }] : [],
      };
      hydrateDraft(await api<AutonomyPolicyRecord>('/api/agent-room/workspaces/' + workspaceId + '/autonomy', {
        method: 'PUT',
        body: JSON.stringify({ enabled: policy.enabled, mode: policy.mode, policy: document }),
      }));
      toast.success(m['autonomy.saved']());
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : m['autonomy.error']());
    } finally {
      busy = false;
    }
  }

  function toggleCapability(capability: AutonomyCapability, enabled: boolean): void {
    if (!policy) return;
    policy = { ...policy, policy: { ...policy.policy, capabilities: enabled ? [...new Set([...policy.policy.capabilities, capability])] : policy.policy.capabilities.filter((item) => item !== capability) } };
  }

  function setGate(risk: AutonomyRisk, requirement: GateRequirement): void {
    if (!policy) return;
    policy = { ...policy, policy: { ...policy.policy, gates: { ...policy.policy.gates, [risk]: requirement } } };
  }

  function updatePolicyNumber(
    field: 'maxConcurrentRuns',
    event: Event,
  ): void {
    if (!policy) return;
    const value = Number((event.currentTarget as HTMLInputElement).value);
    policy = { ...policy, policy: { ...policy.policy, [field]: value } };
  }

  function updateQuietHours(field: 'enabled' | 'start' | 'end', value: boolean | string): void {
    if (!policy) return;
    policy = {
      ...policy,
      policy: { ...policy.policy, quietHours: { ...policy.policy.quietHours, [field]: value } },
    };
  }

  async function resolveGate(gate: ApprovalGateRecord, decision: 'approved' | 'denied'): Promise<void> {
    busy = true;
    try {
      await api('/api/agent-room/workspaces/' + workspaceId + '/autonomy/gates/' + gate.id, { method: 'PATCH', body: JSON.stringify({ decision }) });
      toast.success(decision === 'approved' ? m['autonomy.gate_approved']() : m['autonomy.gate_denied']());
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : m['autonomy.error']());
    } finally {
      busy = false;
    }
  }

  async function createSecret(): Promise<void> {
    if (!secretName.trim() || !secretValue || !desktop?.saveAutomationSecret) return;
    busy = true;
    let created: SecretRefCreated | null = null;
    try {
      created = await api<SecretRefCreated>('/api/agent-room/workspaces/' + workspaceId + '/secret-refs', {
        method: 'POST',
        body: JSON.stringify({
          name: secretName,
          purpose: secretPurpose || null,
          provider: 'desktop',
          bindings: {
            integrations: lines(secretIntegrations),
            operations: lines(secretOperations),
            destinations: lines(secretDestinations),
          },
        }),
      });
      await desktop.saveAutomationSecret(created.storageKey, secretValue);
      secretName = '';
      secretPurpose = '';
      secretValue = '';
      secretIntegrations = '';
      secretOperations = '';
      secretDestinations = '';
      toast.success(m['autonomy.secret_saved']());
      await refresh();
    } catch (error) {
      if (created) await api('/api/agent-room/workspaces/' + workspaceId + '/secret-refs/' + created.id, { method: 'DELETE' }).catch(() => undefined);
      toast.error(error instanceof Error ? error.message : m['autonomy.error']());
    } finally {
      secretValue = '';
      busy = false;
    }
  }

  async function removeSecret(secret: SecretRefRecord): Promise<void> {
    busy = true;
    try {
      await api('/api/agent-room/workspaces/' + workspaceId + '/secret-refs/' + secret.id, { method: 'DELETE' });
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : m['autonomy.error']());
    } finally {
      busy = false;
    }
  }

  async function emergencyStop(): Promise<void> {
    busy = true;
    try {
      await api('/api/agent-room/workspaces/' + workspaceId + '/autonomy/stop', { method: 'POST', body: '{}' });
      toast.success(m['autonomy.stopped']());
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : m['autonomy.error']());
    } finally {
      busy = false;
    }
  }

  const modeLabel = (mode: AutonomyMode) => messages['autonomy.mode_' + mode]();
  const capabilityLabel = (capability: AutonomyCapability) => messages['autonomy.capability_' + capability]();
  const riskLabel = (risk: AutonomyRisk) => messages['autonomy.risk_' + risk]();
  const requirementLabel = (requirement: GateRequirement) => messages['autonomy.requirement_' + requirement]();
  const gateStatusLabel = (status: ApprovalGateRecord['status']) => messages['autonomy.gate_status_' + status]();

  function exportAudit(): void {
    const anchor = document.createElement('a');
    anchor.href = '/api/agent-room/workspaces/' + workspaceId + '/autonomy/audit/export';
    anchor.download = '';
    anchor.click();
  }

  $effect(() => {
    workspaceId;
    void refresh();
  });
</script>

{#if loading}
  <div class="grid min-h-52 place-items-center"><LoaderCircle class="animate-spin text-[var(--app-accent)]" size={20} /></div>
{:else if policy}
  <div class="flex h-full min-h-0 flex-col">
    <div class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[var(--app-border)] px-4 py-3">
      <div class="flex min-w-0 items-center gap-3">
        <span class="grid size-8 shrink-0 place-items-center rounded-md bg-[var(--app-success-soft)] text-[var(--app-success)]"><ShieldCheck size={16} /></span>
        <div class="min-w-0"><h2 class="text-xs font-semibold">{m['autonomy.title']()}</h2><p class="truncate text-ui-xs text-[var(--app-text-muted)]">{m['autonomy.revision']({ revision: policy.revision })}</p></div>
      </div>
      <div class="flex items-center gap-2">
        <Badge variant={policy.enabled ? 'default' : 'outline'}>{policy.enabled ? m['autonomy.enabled']() : m['autonomy.disabled']()}</Badge>
        <Button variant="destructive" size="sm" disabled={busy} onclick={() => void emergencyStop()}><Ban size={13} />{m['autonomy.emergency_stop']()}</Button>
      </div>
    </div>

    <Tabs.Root bind:value={tab} class="grid min-h-0 flex-1 grid-rows-[38px_minmax(0,1fr)]">
      <Tabs.List class="h-[38px] w-full justify-start overflow-x-auto rounded-none border-b border-[var(--app-border)] bg-transparent px-2">
        <Tabs.Trigger value="access" class="h-7 text-ui-xs"><ShieldCheck size={12} />{m['autonomy.access']()}</Tabs.Trigger>
        <Tabs.Trigger value="gates" class="h-7 text-ui-xs"><CircleAlert size={12} />{m['autonomy.gates']()} {#if gates.some((item) => item.status === 'pending')}<Badge>{gates.filter((item) => item.status === 'pending').length}</Badge>{/if}</Tabs.Trigger>
        <Tabs.Trigger value="vault" class="h-7 text-ui-xs"><KeyRound size={12} />{m['autonomy.vault']()}</Tabs.Trigger>
        <Tabs.Trigger value="audit" class="h-7 text-ui-xs"><ScrollText size={12} />{m['autonomy.audit']()}</Tabs.Trigger>
      </Tabs.List>

      <Tabs.Content value="access" class="m-0 min-h-0 overflow-y-auto p-4">
        <div class="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--app-border)] pb-4">
          <div><h3 class="text-xs font-semibold">{m['autonomy.standing_access']()}</h3><p class="mt-1 max-w-2xl text-ui-xs leading-4 text-[var(--app-text-muted)]">{m['autonomy.standing_access_help']()}</p></div>
          <Switch checked={policy.enabled} onCheckedChange={(checked: boolean) => (policy = policy ? { ...policy, enabled: checked } : policy)} />
        </div>
        <div class={compact ? 'grid grid-cols-1 gap-4 py-4' : 'grid grid-cols-2 gap-4 py-4'}>
          <label><span class="mb-1 block text-ui-xs font-medium">{m['autonomy.mode']()}</span><Select.Root type="single" value={policy.mode} onValueChange={(value: string) => (policy = policy ? { ...policy, mode: value as AutonomyMode } : policy)}><Select.Trigger class="w-full">{modeLabel(policy.mode)}</Select.Trigger><Select.Content>{#each ['observe','prepare','ask_mutations','bounded'] as mode}<Select.Item value={mode}>{modeLabel(mode as AutonomyMode)}</Select.Item>{/each}</Select.Content></Select.Root></label>
          <label><span class="mb-1 block text-ui-xs font-medium">{m['autonomy.concurrent_runs']()}</span><Input type="number" min="1" max="64" value={policy.policy.maxConcurrentRuns} oninput={(event: Event) => updatePolicyNumber('maxConcurrentRuns', event)} /></label>
          <div class="grid gap-2 rounded-md border border-[var(--app-border)] p-3">
            <label class="flex items-center justify-between gap-3 text-ui-xs font-medium"><span>{m['autonomy.quiet_hours']()}</span><Switch checked={policy.policy.quietHours.enabled} onCheckedChange={(checked: boolean) => updateQuietHours('enabled', checked)} /></label>
            <div class="grid grid-cols-2 gap-2"><label><span class="mb-1 block text-ui-xs text-[var(--app-text-muted)]">{m['autonomy.quiet_start']()}</span><Input type="time" value={policy.policy.quietHours.start} disabled={!policy.policy.quietHours.enabled} oninput={(event: Event) => updateQuietHours('start', (event.currentTarget as HTMLInputElement).value)} /></label><label><span class="mb-1 block text-ui-xs text-[var(--app-text-muted)]">{m['autonomy.quiet_end']()}</span><Input type="time" value={policy.policy.quietHours.end} disabled={!policy.policy.quietHours.enabled} oninput={(event: Event) => updateQuietHours('end', (event.currentTarget as HTMLInputElement).value)} /></label></div>
          </div>
          <label><span class="mb-1 block text-ui-xs font-medium">{m['autonomy.roots']()}</span><Textarea class="min-h-24 resize-y font-mono text-ui-xs" bind:value={roots} /></label>
          <label><span class="mb-1 block text-ui-xs font-medium">{m['autonomy.excludes']()}</span><Textarea class="min-h-24 resize-y font-mono text-ui-xs" bind:value={excludes} placeholder=".env&#10;node_modules/**" /></label>
          <label class={compact ? '' : 'col-span-2'}><span class="mb-1 block text-ui-xs font-medium">{m['autonomy.hosts']()}</span><Textarea class="min-h-20 resize-y font-mono text-ui-xs" bind:value={hosts} placeholder="api.example.com" /><span class="mt-1 block text-ui-xs text-[var(--app-text-muted)]">{m['autonomy.hosts_help']()}</span></label>
        </div>
        <div class="border-y border-[var(--app-border)] py-4">
          <h3 class="mb-3 text-xs font-semibold">{m['autonomy.capabilities']()}</h3>
          <div class={compact ? 'grid grid-cols-1 gap-x-5 gap-y-2' : 'grid grid-cols-2 gap-x-5 gap-y-2'}>{#each capabilities as capability}<label class="flex items-center justify-between gap-3 text-ui-xs"><span>{capabilityLabel(capability)}</span><Switch checked={policy.policy.capabilities.includes(capability)} onCheckedChange={(checked: boolean) => toggleCapability(capability, checked)} /></label>{/each}</div>
        </div>
        <div class="py-4">
          <h3 class="mb-3 text-xs font-semibold">{m['autonomy.risk_gates']()}</h3>
          <div class="divide-y divide-[var(--app-border)] border-y border-[var(--app-border)]">{#each risks as risk}<div class={compact ? 'grid grid-cols-1 items-center gap-3 py-2' : 'grid grid-cols-[minmax(0,1fr)_180px] items-center gap-3 py-2'}><span class="text-ui-xs">{riskLabel(risk)}</span><Select.Root type="single" value={policy.policy.gates[risk] ?? 'user'} onValueChange={(value) => setGate(risk, value as GateRequirement)}><Select.Trigger class="w-full">{requirementLabel(policy.policy.gates[risk] ?? 'user')}</Select.Trigger><Select.Content>{#each requirements as requirement}<Select.Item value={requirement}>{requirementLabel(requirement)}</Select.Item>{/each}</Select.Content></Select.Root></div>{/each}</div>
        </div>
        <div class="flex justify-end"><Button disabled={busy} onclick={() => void savePolicy()}>{#if busy}<LoaderCircle class="animate-spin" />{:else}<Save size={13} />{/if}{m['autonomy.save']()}</Button></div>
      </Tabs.Content>

      <Tabs.Content value="gates" class="m-0 min-h-0 overflow-y-auto p-4">
        {#if gates.length === 0}
          <div class="grid min-h-48 place-items-center text-center"><div><Check class="mx-auto text-[var(--app-success)]" /><p class="mt-2 text-xs font-medium">{m['autonomy.no_gates']()}</p></div></div>
        {:else}
          <div class="divide-y divide-[var(--app-border)] border-y border-[var(--app-border)]">{#each gates as gate}<article class="grid gap-3 bg-[var(--app-surface)] px-3 py-3"><div class="flex flex-wrap items-center gap-2"><Badge variant={gate.status === 'pending' ? 'default' : 'outline'}>{gateStatusLabel(gate.status)}</Badge><Badge variant="outline">{requirementLabel(gate.requirement)}</Badge><span class="text-ui-xs font-semibold">{riskLabel(gate.risk)}</span></div><p class="break-words text-ui-xs">{gate.summary}</p><p class="text-ui-xs text-[var(--app-text-muted)]">{new Date(gate.createdAt).toLocaleString()}</p>{#if gate.status === 'pending'}{#if gate.requirement === 'reviewer' || gate.requirement === 'council'}<p class="text-ui-xs text-[var(--app-warning)]">{gate.requirement === 'reviewer' ? m['autonomy.reviewer_required']() : m['autonomy.council_required']()}</p>{/if}<div class="flex justify-end gap-2"><Button variant="outline" size="sm" disabled={busy} onclick={() => void resolveGate(gate, 'denied')}><X size={13} />{m['autonomy.deny']()}</Button><Button size="sm" disabled={busy || gate.requirement === 'reviewer' || gate.requirement === 'council'} onclick={() => void resolveGate(gate, 'approved')}><Check size={13} />{m['autonomy.approve']()}</Button></div>{/if}</article>{/each}</div>
        {/if}
      </Tabs.Content>

      <Tabs.Content value="vault" class="m-0 min-h-0 overflow-y-auto p-4">
        <div class="border-b border-[var(--app-border)] pb-4"><h3 class="text-xs font-semibold">{m['autonomy.new_secret']()}</h3><p class="mt-1 text-ui-xs leading-4 text-[var(--app-text-muted)]">{m['autonomy.vault_help']()}</p><div class={compact ? 'mt-3 grid grid-cols-1 gap-3' : 'mt-3 grid grid-cols-2 gap-3'}><Input bind:value={secretName} placeholder={m['autonomy.secret_name']()} /><Input bind:value={secretPurpose} placeholder={m['autonomy.secret_purpose']()} /><Input type="password" autocomplete="new-password" bind:value={secretValue} placeholder={m['autonomy.secret_value']()} /><Textarea class="min-h-10 resize-y" bind:value={secretIntegrations} placeholder={m['autonomy.secret_integrations']()} /><Textarea class="min-h-10 resize-y" bind:value={secretOperations} placeholder={m['autonomy.secret_operations']()} /><Textarea class="min-h-10 resize-y" bind:value={secretDestinations} placeholder={m['autonomy.secret_destinations']()} /></div>{#if !desktop?.saveAutomationSecret}<p class="mt-2 text-ui-xs text-[var(--app-warning)]">{m['autonomy.desktop_required']()}</p>{/if}<div class="mt-3 flex justify-end"><Button size="sm" disabled={busy || !secretName.trim() || !secretValue || !desktop?.saveAutomationSecret} onclick={() => void createSecret()}><KeyRound size={13} />{m['autonomy.store_secret']()}</Button></div></div>
        <div class="divide-y divide-[var(--app-border)]">{#each secrets as secret}<article class="flex items-start justify-between gap-3 py-3"><div class="min-w-0"><p class="truncate text-xs font-semibold">{secret.name}</p><p class="mt-1 truncate font-mono text-ui-xs text-[var(--app-text-muted)]">{secret.ref}</p><p class="mt-1 text-ui-xs text-[var(--app-text-soft)]">{secret.purpose ?? m['autonomy.no_purpose']()}</p></div><Button variant="ghost" size="icon-sm" class="text-[var(--app-danger)]" aria-label={m['autonomy.delete_secret']()} onclick={() => void removeSecret(secret)}><Trash2 size={13} /></Button></article>{/each}</div>
      </Tabs.Content>

      <Tabs.Content value="audit" class="m-0 min-h-0 overflow-y-auto p-4">
        <div class="mb-3 flex items-center justify-between gap-3"><div class="flex items-center gap-2"><Badge variant={integrity?.valid ? 'outline' : 'destructive'}>{integrity?.valid ? m['autonomy.audit_valid']() : m['autonomy.audit_invalid']()}</Badge><span class="text-ui-xs text-[var(--app-text-muted)]">{m['autonomy.events_checked']({ count: integrity?.checked ?? 0 })}</span></div><div class="flex items-center gap-1"><Button variant="ghost" size="icon-sm" aria-label={m['autonomy.export_audit']()} onclick={exportAudit}><Download size={13} /></Button><Button variant="ghost" size="icon-sm" aria-label={m['autonomy.refresh']()} onclick={() => void refresh()}><RefreshCw size={13} /></Button></div></div>
        <div class="divide-y divide-[var(--app-border)] border-y border-[var(--app-border)]">{#each audit as event}<article class="grid grid-cols-[88px_minmax(0,1fr)_auto] items-start gap-3 bg-[var(--app-surface)] px-3 py-2"><Badge variant="outline">{event.eventType}</Badge><div class="min-w-0"><p class="truncate text-ui-xs font-medium">{event.capability} · {event.target ?? event.actorType}</p><p class="mt-1 text-ui-xs text-[var(--app-text-muted)]">{event.certainty === 'semantic' ? m['autonomy.semantic_evidence']() : m['autonomy.inferred_evidence']()}</p></div><time class="text-ui-xs text-[var(--app-text-muted)]">{new Date(event.createdAt).toLocaleTimeString()}</time></article>{/each}</div>
      </Tabs.Content>
    </Tabs.Root>
  </div>
{/if}
