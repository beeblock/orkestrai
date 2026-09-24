<script lang="ts">
  import { getCsrfToken } from '@beeblock/svelar/http';
  import { toast } from '@beeblock/svelar/ui';
  import { Ban, Check, ChevronRight, CircleAlert, Download, KeyRound, LoaderCircle, RefreshCw, Save, ScrollText, ShieldCheck, Trash2, X } from '@lucide/svelte';
  import * as Tabs from '$lib/components/ui/tabs';
  import * as Select from '$lib/components/ui/select';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Textarea } from '$lib/components/ui/textarea';
  import { Switch } from '$lib/components/ui/switch';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { Slider } from '$lib/components/ui/slider';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import NodeEmptyState from './canvas/NodeEmptyState.svelte';
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
  let hosts = $state('');
  let allowedApps = $state('');
  let secretName = $state('');
  let secretPurpose = $state('');
  let secretValue = $state('');
  let secretIntegrations = $state('');
  let secretOperations = $state('');
  let secretDestinations = $state('');
  let agents = $state<Array<{ id: string; title: string }>>([]);

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
    hosts = record.policy.network.flatMap((grant) => grant.hosts).join('\n');
    allowedApps = record.policy.allowedApps.join('\n');
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
      const nodes = await api<Array<{ id: string; title: string; type: string }>>('/api/agent-room/workspaces/' + workspaceId + '/nodes');
      agents = nodes.filter((node) => node.type === 'terminal');
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
      const rootList = lines(roots);
      if (rootList.length === 0) throw new Error(m['autonomy.root_required']());
      const hostList = lines(hosts).map((host) => host.toLowerCase());
      const network: AutonomyPolicyDocument['network'] = policy.policy.network
        .map((grant) => ({ ...grant, hosts: grant.hosts.filter((host) => hostList.includes(host)) }))
        .filter((grant) => grant.hosts.length > 0);
      for (const host of hostList) {
        if (!network.some((grant) => grant.hosts.includes(host))) network.push({ schemes: ['https'], hosts: [host], ports: [], methods: ['GET', 'HEAD'], operations: [] });
      }
      const document: AutonomyPolicyDocument = {
        ...policy.policy,
        filesystem: rootList.map((root) => rootGrant(root)),
        network,
        allowedApps: lines(allowedApps),
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

  function publication<K extends keyof AutonomyPolicyDocument['toolPublication']>(key: K, value: AutonomyPolicyDocument['toolPublication'][K]) {
    if (!policy) return;
    policy = { ...policy, policy: { ...policy.policy, toolPublication: { ...policy.policy.toolPublication, [key]: value } } };
  }

  function rootPermission(root:string, permission:'read'|'write'|'create'|'delete', enabled:boolean) {
    if (!policy) return;
    const grant = rootGrant(root);
    grant.permissions=enabled?[...new Set([...grant.permissions,permission])]:grant.permissions.filter((value)=>value!==permission);
    policy={...policy,policy:{...policy.policy,filesystem:[...policy.policy.filesystem.filter((value)=>value.root!==root),grant]}};
  }

  function rootGrant(root: string): AutonomyPolicyDocument['filesystem'][number] {
    return { ...(policy?.policy.filesystem.find((grant) => grant.root === root) ?? {
      root, permissions: ['read'], excludeGlobs: ['.env', '.env.*', '**/.env', '**/.env.*'],
      followSymlinks: false, maxFileSize: 50 * 1024 * 1024,
    }) };
  }

  function rootExcludes(root: string, value: string): void {
    if (!policy) return;
    const grant = { ...rootGrant(root), excludeGlobs: lines(value) };
    policy = { ...policy, policy: { ...policy.policy, filesystem: [...policy.policy.filesystem.filter((item) => item.root !== root), grant] } };
  }

  function networkGrant(host:string, field:'methods'|'schemes', value:string, enabled:boolean) {
    if (!policy) return;
    const existing = policy.policy.network.find((grant)=>grant.hosts.includes(host));
    const grant = { ...(existing ?? { schemes:['https'],ports:[],methods:['GET','HEAD'],operations:[] }), hosts:[host] } as AutonomyPolicyDocument['network'][number];
    const selected = enabled ? [...new Set([...grant[field],value])] : grant[field].filter((item)=>item!==value);
    if (!selected.length) return;
    if (field==='methods') grant.methods = selected as typeof grant.methods;
    else grant.schemes = selected as typeof grant.schemes;
    policy = {...policy,policy:{...policy.policy,network:[...policy.policy.network.map((item)=>({...item,hosts:item.hosts.filter((item)=>item!==host)})).filter((item)=>item.hosts.length),grant]}};
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

  // Adaptador do Slider para o mesmo handler do campo numerico (que le currentTarget.value).
  function sliderEvent(value: number): Event {
    return { currentTarget: { value: String(value) } } as unknown as Event;
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
  const auditEventLabel = (eventType: string) => messages['autonomy.event_' + eventType]?.() ?? eventType;

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

  $effect(() => {
    const id = workspaceId;
    const timer = setInterval(async () => {
      try {
        const [nextGates, nextAudit] = await Promise.all([
          api<ApprovalGateRecord[]>('/api/agent-room/workspaces/' + id + '/autonomy/gates'),
          api<{ events: AutonomyAuditRecord[]; integrity: typeof integrity }>('/api/agent-room/workspaces/' + id + '/autonomy/audit'),
        ]);
        if (id !== workspaceId) return;
        gates = nextGates; audit = nextAudit.events; integrity = nextAudit.integrity;
      } catch { /* Keep the editable policy intact while offline. */ }
    }, 5000);
    return () => clearInterval(timer);
  });
</script>

{#if loading}
  <div class="grid min-h-52 place-items-center">
    <span class="inline-flex items-center gap-2 rounded-full bg-[var(--app-surface)] px-3 py-1.5 text-ui-sm text-[var(--app-text-muted)] shadow-border" role="status"><LoaderCircle size={13} class="animate-spin text-[var(--app-accent)]" aria-hidden="true" />{m['creative.loading']()}</span>
  </div>
{:else if policy}
  <div class="flex h-full min-h-0 flex-col">
    <div class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[var(--app-border)] px-4 py-3">
      <div class="flex min-w-0 items-center gap-3">
        <span class="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--app-success-soft)] text-[var(--app-success)]" aria-hidden="true"><ShieldCheck size={16} /></span>
        <div class="min-w-0"><h2 class="truncate font-display text-[14px] font-semibold">{m['autonomy.title']()}</h2><p class="truncate font-mono text-[11px] tabular-nums text-[var(--app-text-muted)]">{m['autonomy.revision']({ revision: policy.revision })}</p></div>
      </div>
      <div class="flex items-center gap-2">
        {#if policy.policy.halted}<span class="rounded-md bg-[var(--app-danger-soft)] px-1.5 py-px text-ui-xs font-medium text-[var(--app-danger)]">{m['autonomy.halted']()}</span>{/if}
        <span class={`inline-flex items-center gap-1.5 rounded-md px-1.5 py-px text-ui-xs font-medium ${policy.enabled ? 'bg-[var(--app-success-soft)] text-[var(--app-success)]' : 'bg-[var(--app-hover)] text-[var(--app-text-soft)]'}`}><span class="size-1.5 rounded-full bg-current" aria-hidden="true"></span>{policy.enabled ? m['autonomy.enabled']() : m['autonomy.disabled']()}</span>
        <Button variant="destructive" size="sm" disabled={busy} onclick={() => void emergencyStop()}><Ban size={13} />{m['autonomy.emergency_stop']()}</Button>
      </div>
    </div>

    <Tabs.Root bind:value={tab} class="grid min-h-0 flex-1 grid-rows-[40px_minmax(0,1fr)] gap-0">
      <Tabs.List variant="line" class="h-10 w-full justify-start gap-0.5 overflow-x-auto rounded-none border-b border-[var(--app-border)] bg-transparent px-2">
        <Tabs.Trigger value="access" class="autonomy-tab"><ShieldCheck size={13} />{m['autonomy.access']()}</Tabs.Trigger>
        <Tabs.Trigger value="gates" class="autonomy-tab"><CircleAlert size={13} />{m['autonomy.gates']()} {#if gates.some((item) => item.status === 'pending')}<span class="rounded-full bg-[var(--app-warning-soft)] px-1.5 font-mono text-[11px] leading-4 tabular-nums text-[var(--app-warning)]">{gates.filter((item) => item.status === 'pending').length}</span>{/if}</Tabs.Trigger>
        <Tabs.Trigger value="vault" class="autonomy-tab"><KeyRound size={13} />{m['autonomy.vault']()}</Tabs.Trigger>
        <Tabs.Trigger value="audit" class="autonomy-tab"><ScrollText size={13} />{m['autonomy.audit']()}</Tabs.Trigger>
      </Tabs.List>

      <Tabs.Content value="access" class="m-0 flex min-h-0 flex-col">
        <div class="min-h-0 flex-1 overflow-y-auto p-4">
          {#if policy.policy.halted}
            <div class="mb-4 flex items-center justify-between gap-3 rounded-lg bg-[var(--app-warning-soft)] px-3 py-2.5 text-ui-md" role="alert"><span class="flex min-w-0 items-start gap-2"><CircleAlert size={14} class="mt-0.5 shrink-0 text-[var(--app-warning)]" aria-hidden="true" />{m['autonomy.halted_help']()}</span><Button variant="outline" size="sm" class="shrink-0" onclick={() => { if (policy) policy = { ...policy, policy: { ...policy.policy, halted: false } }; }}>{m['autonomy.resume_access']()}</Button></div>
          {/if}
          <label class="flex cursor-pointer items-center justify-between gap-4 rounded-xl bg-[var(--app-surface)] px-4 py-3.5 shadow-border">
            <span class="min-w-0"><span class="block text-ui-lg font-semibold">{m['autonomy.standing_access']()}</span><span class="mt-1 block max-w-2xl text-pretty text-ui-sm leading-[1.45] text-[var(--app-text-muted)]">{m['autonomy.standing_access_help']()}</span></span>
            <Switch checked={policy.enabled} onCheckedChange={(checked: boolean) => (policy = policy ? { ...policy, enabled: checked } : policy)} />
          </label>
          <div class={compact ? 'grid grid-cols-1 gap-4 py-5' : 'grid grid-cols-2 gap-4 py-5'}>
            <label><span class="mb-1.5 block text-ui-md font-medium">{m['autonomy.mode']()}</span><Select.Root type="single" value={policy.mode} onValueChange={(value: string) => (policy = policy ? { ...policy, mode: value as AutonomyMode } : policy)}><Select.Trigger class="w-full">{modeLabel(policy.mode)}</Select.Trigger><Select.Content>{#each ['observe','prepare','ask_mutations','bounded'] as mode}<Select.Item value={mode}>{modeLabel(mode as AutonomyMode)}</Select.Item>{/each}</Select.Content></Select.Root></label>
            <!-- Faixa natural (1-64): controle deslizante com valor visivel, no mesmo handler do campo. -->
            <div>
              <div class="mb-1.5 flex items-center justify-between gap-2"><span class="text-ui-md font-medium" id="autonomy-concurrent-runs">{m['autonomy.concurrent_runs']()}</span><span class="rounded-md bg-[var(--app-hover)] px-1.5 font-mono text-ui-sm leading-5 tabular-nums">{policy.policy.maxConcurrentRuns}</span></div>
              <div class="flex h-8 items-center"><Slider type="single" min={1} max={64} step={1} value={policy.policy.maxConcurrentRuns} onValueChange={(value: number) => updatePolicyNumber('maxConcurrentRuns', sliderEvent(value))} aria-label={m['autonomy.concurrent_runs']()} /></div>
            </div>
            <div class="grid gap-3 rounded-xl bg-[var(--app-surface)] p-3.5 shadow-border">
              <label class="flex cursor-pointer items-center justify-between gap-3 text-ui-md font-medium"><span>{m['autonomy.quiet_hours']()}</span><Switch checked={policy.policy.quietHours.enabled} onCheckedChange={(checked: boolean) => updateQuietHours('enabled', checked)} /></label>
              <div class="grid grid-cols-2 gap-2"><label><span class="mb-1 block text-ui-sm text-[var(--app-text-muted)]">{m['autonomy.quiet_start']()}</span><Input type="time" class="tabular-nums" value={policy.policy.quietHours.start} disabled={!policy.policy.quietHours.enabled} oninput={(event: Event) => updateQuietHours('start', (event.currentTarget as HTMLInputElement).value)} /></label><label><span class="mb-1 block text-ui-sm text-[var(--app-text-muted)]">{m['autonomy.quiet_end']()}</span><Input type="time" class="tabular-nums" value={policy.policy.quietHours.end} disabled={!policy.policy.quietHours.enabled} oninput={(event: Event) => updateQuietHours('end', (event.currentTarget as HTMLInputElement).value)} /></label></div>
            </div>
            <label><span class="mb-1.5 block text-ui-md font-medium">{m['autonomy.roots']()}</span><Textarea class="min-h-24 resize-y font-mono text-ui-sm" bind:value={roots} /></label>
            <label class={compact ? '' : 'col-span-2'}><span class="mb-1.5 block text-ui-md font-medium">{m['autonomy.hosts']()}</span><Textarea class="min-h-20 resize-y font-mono text-ui-sm" bind:value={hosts} placeholder="api.example.com" /><span class="mt-1.5 block text-pretty text-ui-sm leading-[1.45] text-[var(--app-text-muted)]">{m['autonomy.hosts_help']()}</span></label>
          </div>
          <div class="border-t border-[var(--app-border)] py-5">
            <label class="mb-5 block"><span class="mb-1.5 block text-ui-md font-medium">{m['autonomy.allowed_apps']()}</span><Textarea class="min-h-16 font-mono text-ui-sm" bind:value={allowedApps} /></label>
            {#if lines(hosts).length}
              <div class="mb-5 grid gap-2">{#each lines(hosts) as host (host)}<fieldset class="grid gap-2 rounded-lg bg-[var(--app-surface)] px-3 py-2.5 shadow-border"><legend class="float-left mb-1 w-full break-all font-mono text-ui-sm text-[var(--app-text)]">{host}</legend><div class="flex flex-wrap gap-1.5">{#each ['https','http'] as scheme}<label class="grant-chip"><Checkbox class="size-3.5" checked={(policy.policy.network.find((grant)=>grant.hosts.includes(host))?.schemes ?? ['https']).includes(scheme as never)} onCheckedChange={(checked:boolean)=>networkGrant(host,'schemes',scheme,checked)} />{scheme.toUpperCase()}</label>{/each}<span class="mx-1 w-px self-stretch bg-[var(--app-border)]" aria-hidden="true"></span>{#each ['GET','HEAD','OPTIONS','POST','PUT','PATCH','DELETE'] as method}<label class="grant-chip font-mono"><Checkbox class="size-3.5" checked={(policy.policy.network.find((grant)=>grant.hosts.includes(host))?.methods ?? ['GET','HEAD']).includes(method as never)} onCheckedChange={(checked:boolean)=>networkGrant(host,'methods',method,checked)} />{method}</label>{/each}</div></fieldset>{/each}</div>
            {/if}
            <div class="mb-5 grid gap-2">{#each lines(roots) as root (root)}<fieldset class="grid gap-2.5 rounded-lg bg-[var(--app-surface)] px-3 py-2.5 shadow-border"><legend class="float-left mb-1 w-full break-all font-mono text-ui-sm text-[var(--app-text)]">{root}</legend><div class="flex flex-wrap gap-1.5">{#each ['read','write','create','delete'] as permission}<label class="grant-chip"><Checkbox class="size-3.5" checked={(policy.policy.filesystem.find((grant)=>grant.root===root)?.permissions ?? ['read']).includes(permission as never)} onCheckedChange={(checked: boolean)=>rootPermission(root,permission as 'read'|'write'|'create'|'delete',checked)} />{messages['autonomy.fs_' + permission]()}</label>{/each}</div><label class="grid gap-1.5 text-ui-sm text-[var(--app-text-muted)]">{m['autonomy.excludes']()}<Textarea class="min-h-16 font-mono text-ui-sm text-[var(--app-text)]" value={rootGrant(root).excludeGlobs.join('\n')} oninput={(event: Event) => rootExcludes(root, (event.currentTarget as HTMLTextAreaElement).value)} /></label></fieldset>{/each}</div>
            <h3 class="section-label mb-2">{m['autonomy.capabilities']()}</h3>
            <div class={`overflow-hidden rounded-xl bg-[var(--app-surface)] shadow-border ${compact ? 'grid grid-cols-1' : 'grid grid-cols-2'}`}>{#each capabilities as capability}<label class="capability-row"><span class="min-w-0 truncate">{capabilityLabel(capability)}</span><Switch checked={policy.policy.capabilities.includes(capability)} onCheckedChange={(checked: boolean) => toggleCapability(capability, checked)} /></label>{/each}</div>
          </div>
          <fieldset class="grid gap-3 border-t border-[var(--app-border)] py-5">
            <legend class="float-left mb-1 w-full section-label">{m['autonomy.tool_publication']()}</legend>
            <label class="flex cursor-pointer items-center justify-between gap-3 text-ui-md font-medium"><span>{m['autonomy.tool_publication_enable']()}</span><Switch checked={policy.policy.toolPublication.enabled} onCheckedChange={(value: boolean) => publication('enabled', value)} /></label>
            <p class="text-pretty text-ui-sm leading-[1.45] text-[var(--app-text-muted)]">{m['autonomy.tool_publication_help']()}</p>
            {#if policy.policy.toolPublication.enabled}
              <div class="flex flex-wrap gap-1.5">{#each agents as agent (agent.id)}<label class="grant-chip"><Checkbox class="size-3.5" checked={policy.policy.toolPublication.agentIds.includes(agent.id)} onCheckedChange={(checked: boolean) => publication('agentIds', checked ? [...new Set([...policy!.policy.toolPublication.agentIds, agent.id])] : policy!.policy.toolPublication.agentIds.filter((id) => id !== agent.id))} />{agent.title}</label>{/each}</div>
              <div class="flex flex-wrap gap-1.5">{#each ['transform','browser','http','integration'] as kind}<label class="grant-chip"><Checkbox class="size-3.5" checked={policy.policy.toolPublication.kinds.includes(kind as never)} onCheckedChange={(checked: boolean) => publication('kinds', (checked ? [...new Set([...policy!.policy.toolPublication.kinds, kind])] : policy!.policy.toolPublication.kinds.filter((value) => value !== kind)) as AutonomyPolicyDocument['toolPublication']['kinds'])} />{messages['tool_workshop.executor_' + kind]()}</label>{/each}</div>
              <div class="grid grid-cols-2 gap-3"><label class="grid gap-1.5 text-ui-md font-medium">{m['tool_workshop.timeout']()}<Input type="number" class="tabular-nums" min="100" max="300000" value={policy.policy.toolPublication.maxTimeoutMs} oninput={(event: Event) => publication('maxTimeoutMs', Number((event.currentTarget as HTMLInputElement).value))} /></label><label class="grid gap-1.5 text-ui-md font-medium">{m['tool_workshop.max_output']()}<Input type="number" class="tabular-nums" min="1024" max="10485760" value={policy.policy.toolPublication.maxOutputBytes} oninput={(event: Event) => publication('maxOutputBytes', Number((event.currentTarget as HTMLInputElement).value))} /></label></div>
            {/if}
          </fieldset>
          <div class="border-t border-[var(--app-border)] pt-5">
            <h3 class="section-label mb-2">{m['autonomy.risk_gates']()}</h3>
            <div class="overflow-hidden rounded-xl bg-[var(--app-surface)] shadow-border">{#each risks as risk}<div class={`gate-row ${compact ? 'grid grid-cols-1 gap-2' : 'grid grid-cols-[minmax(0,1fr)_200px] items-center gap-3'}`}><span class="text-ui-md">{riskLabel(risk)}</span><Select.Root type="single" value={policy.policy.gates[risk] ?? 'user'} onValueChange={(value) => setGate(risk, value as GateRequirement)}><Select.Trigger class="w-full" aria-label={riskLabel(risk)}>{requirementLabel(policy.policy.gates[risk] ?? 'user')}</Select.Trigger><Select.Content>{#each requirements as requirement}<Select.Item value={requirement}>{requirementLabel(requirement)}</Select.Item>{/each}</Select.Content></Select.Root></div>{/each}</div>
          </div>
        </div>
        <!-- Salvar fixo no rodape: a acao principal nao se perde no fim de um formulario longo. -->
        <div class="flex shrink-0 justify-end border-t border-[var(--app-border)] bg-[var(--app-surface)] px-4 py-2.5"><Button disabled={busy} onclick={() => void savePolicy()}>{#if busy}<LoaderCircle class="animate-spin" />{:else}<Save size={13} />{/if}{m['autonomy.save']()}</Button></div>
      </Tabs.Content>

      <Tabs.Content value="gates" class="m-0 min-h-0 overflow-y-auto p-4">
        {#if gates.length === 0}
          <div class="grid min-h-56 rounded-xl bg-[var(--app-surface)] shadow-border"><NodeEmptyState icon={Check} title={m['autonomy.no_gates']()} /></div>
        {:else}
          <div class="space-y-2">{#each gates as gate}<article class="grid gap-2.5 rounded-xl bg-[var(--app-surface)] px-3.5 py-3 shadow-border"><div class="flex flex-wrap items-center gap-2"><span class={`rounded-md px-1.5 py-px text-ui-xs font-medium ${gate.status === 'pending' ? 'bg-[var(--app-warning-soft)] text-[var(--app-warning)]' : gate.status === 'approved' ? 'bg-[var(--app-success-soft)] text-[var(--app-success)]' : gate.status === 'denied' ? 'bg-[var(--app-danger-soft)] text-[var(--app-danger)]' : 'bg-[var(--app-hover)] text-[var(--app-text-soft)]'}`}>{gateStatusLabel(gate.status)}</span><span class="rounded-md bg-[var(--app-hover)] px-1.5 py-px text-ui-xs font-medium text-[var(--app-text-soft)]">{requirementLabel(gate.requirement)}</span><span class="text-ui-md font-semibold">{riskLabel(gate.risk)}</span></div><p class="break-words text-ui-md leading-5 text-[var(--app-text-soft)]">{gate.summary}</p><p class="text-ui-xs tabular-nums text-[var(--app-text-muted)]">{new Date(gate.createdAt).toLocaleString()}</p>{#if gate.status === 'pending'}{#if gate.requirement === 'reviewer' || gate.requirement === 'council'}<p class="flex items-start gap-1.5 text-ui-sm text-[var(--app-text-soft)]"><CircleAlert size={13} class="mt-0.5 shrink-0 text-[var(--app-warning)]" aria-hidden="true" />{gate.requirement === 'reviewer' ? m['autonomy.reviewer_required']() : m['autonomy.council_required']()}</p>{/if}<div class="flex justify-end gap-2"><Button variant="ghost" size="sm" disabled={busy} onclick={() => void resolveGate(gate, 'denied')}><X size={13} />{m['autonomy.deny']()}</Button><Button size="sm" disabled={busy || gate.requirement === 'reviewer' || gate.requirement === 'council'} onclick={() => void resolveGate(gate, 'approved')}><Check size={13} />{m['autonomy.approve']()}</Button></div>{/if}</article>{/each}</div>
        {/if}
      </Tabs.Content>

      <Tabs.Content value="vault" class="m-0 min-h-0 overflow-y-auto p-4">
        <div class="rounded-xl bg-[var(--app-surface)] p-4 shadow-border">
          <h3 class="font-display text-[14px] font-semibold">{m['autonomy.new_secret']()}</h3>
          <p class="mt-1 text-pretty text-ui-sm leading-[1.45] text-[var(--app-text-muted)]">{m['autonomy.vault_help']()}</p>
          <div class={compact ? 'mt-4 grid grid-cols-1 gap-3' : 'mt-4 grid grid-cols-2 gap-3'}>
            <label><span class="mb-1.5 block text-ui-md font-medium">{m['autonomy.secret_name']()}</span><Input bind:value={secretName} autocomplete="off" /></label>
            <label><span class="mb-1.5 block text-ui-md font-medium">{m['autonomy.secret_purpose']()}</span><Input bind:value={secretPurpose} autocomplete="off" /></label>
            <label class={compact ? '' : 'col-span-2'}><span class="mb-1.5 flex items-center gap-1.5 text-ui-md font-medium"><KeyRound size={13} class="text-[var(--app-text-muted)]" aria-hidden="true" />{m['autonomy.secret_value']()}</span><Input type="password" autocomplete="new-password" bind:value={secretValue} /></label>
            <label><span class="mb-1.5 block text-ui-md font-medium">{m['autonomy.secret_integrations']()}</span><Textarea class="min-h-16 resize-y font-mono text-ui-sm" bind:value={secretIntegrations} /></label>
            <label><span class="mb-1.5 block text-ui-md font-medium">{m['autonomy.secret_operations']()}</span><Textarea class="min-h-16 resize-y font-mono text-ui-sm" bind:value={secretOperations} /></label>
            <label class={compact ? '' : 'col-span-2'}><span class="mb-1.5 block text-ui-md font-medium">{m['autonomy.secret_destinations']()}</span><Textarea class="min-h-16 resize-y font-mono text-ui-sm" bind:value={secretDestinations} /></label>
          </div>
          <div class="mt-4 flex flex-wrap items-center justify-end gap-3">
            {#if !desktop?.saveAutomationSecret}<p class="mr-auto flex items-start gap-1.5 text-pretty text-ui-sm text-[var(--app-text-soft)]"><CircleAlert size={13} class="mt-0.5 shrink-0 text-[var(--app-warning)]" aria-hidden="true" />{m['autonomy.desktop_required']()}</p>{/if}
            <Button size="sm" disabled={busy || !secretName.trim() || !secretValue || !desktop?.saveAutomationSecret} onclick={() => void createSecret()}><KeyRound size={13} />{m['autonomy.store_secret']()}</Button>
          </div>
        </div>
        {#if secrets.length}
          <div class="mt-4 overflow-hidden rounded-xl bg-[var(--app-surface)] shadow-border">
            {#each secrets as secret}
              <article class="secret-row flex items-start justify-between gap-3 px-3.5 py-3">
                <div class="min-w-0"><p class="truncate text-ui-lg font-semibold">{secret.name}</p><p class="mt-0.5 truncate font-mono text-[11px] text-[var(--app-text-muted)]" title={secret.ref}>{secret.ref}</p><p class="mt-1 text-ui-sm text-[var(--app-text-soft)]">{secret.purpose ?? m['autonomy.no_purpose']()}</p></div>
                <Tooltip.Root><Tooltip.Trigger>{#snippet child({ props })}<Button {...props} variant="ghost" size="icon-sm" class="secret-delete shrink-0 text-[var(--app-text-muted)] hover:bg-[var(--app-danger-soft)] hover:text-[var(--app-danger)]" aria-label={m['autonomy.delete_secret']()} onclick={() => void removeSecret(secret)}><Trash2 size={14} /></Button>{/snippet}</Tooltip.Trigger><Tooltip.Content>{m['autonomy.delete_secret']()}</Tooltip.Content></Tooltip.Root>
              </article>
            {/each}
          </div>
        {:else}
          <p class="mt-4 px-1 text-ui-sm text-[var(--app-text-muted)]">{m['autonomy.no_secrets']()}</p>
        {/if}
      </Tabs.Content>

      <Tabs.Content value="audit" class="m-0 min-h-0 overflow-y-auto p-4">
        <div class="mb-3 flex items-center justify-between gap-3">
          <div class="flex min-w-0 items-center gap-2">
            <span class={`inline-flex items-center gap-1.5 rounded-md px-1.5 py-px text-ui-xs font-medium ${integrity?.valid ? 'bg-[var(--app-success-soft)] text-[var(--app-success)]' : 'bg-[var(--app-danger-soft)] text-[var(--app-danger)]'}`}>{#if integrity?.valid}<ShieldCheck size={12} aria-hidden="true" />{:else}<CircleAlert size={12} aria-hidden="true" />{/if}{integrity?.valid ? m['autonomy.audit_valid']() : m['autonomy.audit_invalid']()}</span>
            <span class="truncate text-ui-sm tabular-nums text-[var(--app-text-muted)]">{m['autonomy.events_checked']({ count: integrity?.checked ?? 0 })}</span>
          </div>
          <div class="flex items-center gap-0.5">
            <Tooltip.Root><Tooltip.Trigger>{#snippet child({ props })}<Button {...props} variant="ghost" size="icon-sm" aria-label={m['autonomy.export_audit']()} onclick={exportAudit}><Download size={14} /></Button>{/snippet}</Tooltip.Trigger><Tooltip.Content>{m['autonomy.export_audit']()}</Tooltip.Content></Tooltip.Root>
            <Tooltip.Root><Tooltip.Trigger>{#snippet child({ props })}<Button {...props} variant="ghost" size="icon-sm" aria-label={m['autonomy.refresh']()} onclick={() => void refresh()}><RefreshCw size={14} /></Button>{/snippet}</Tooltip.Trigger><Tooltip.Content>{m['autonomy.refresh']()}</Tooltip.Content></Tooltip.Root>
          </div>
        </div>
        {#if audit.length}
          <div class="overflow-hidden rounded-xl bg-[var(--app-surface)] shadow-border">
            {#each audit as event (event.id)}
              <details class="audit-row group min-w-0 px-3.5 py-2.5">
                <summary class="flex cursor-pointer list-none flex-wrap items-center gap-2.5 text-ui-sm">
                  <ChevronRight size={13} class="shrink-0 text-[var(--app-text-muted)] transition-transform duration-250 ease-smooth-out group-open:rotate-90" aria-hidden="true" />
                  <span class={`shrink-0 rounded-md px-1.5 py-px text-ui-xs font-medium ${['denied','failed'].includes(event.eventType) ? 'bg-[var(--app-danger-soft)] text-[var(--app-danger)]' : event.eventType === 'gated' ? 'bg-[var(--app-warning-soft)] text-[var(--app-warning)]' : 'bg-[var(--app-hover)] text-[var(--app-text-soft)]'}`}>{auditEventLabel(event.eventType)}</span>
                  <span class="min-w-0 flex-1 break-all font-mono text-ui-xs text-[var(--app-text)]">{event.metadata.operation ?? event.capability} · {event.target ?? event.actorType}</span>
                  <time class="shrink-0 text-ui-xs tabular-nums text-[var(--app-text-muted)]">{new Date(event.createdAt).toLocaleString()}</time>
                </summary>
                <p class="mt-2 text-ui-sm text-[var(--app-text-muted)]">{event.certainty === 'semantic' ? m['autonomy.semantic_evidence']() : m['autonomy.inferred_evidence']()}</p>
                <dl class="mt-3 grid gap-3 text-ui-sm sm:grid-cols-2">
                  <div><dt class="section-label">{m['tool_workshop.actor']()}</dt><dd class="mt-0.5 break-all font-mono text-ui-xs text-[var(--app-text-soft)]">{event.actorId ?? event.actorType}</dd></div>
                  <div><dt class="section-label">{m['autonomy.revision']({ revision: event.policyRevision })}</dt><dd class="mt-0.5 break-all font-mono text-ui-xs text-[var(--app-text-soft)]">{event.runId ?? event.correlationId}</dd></div>
                </dl>
                <pre aria-label={m['autonomy.audit_details']()} class="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-md bg-[var(--app-canvas)] p-3 font-mono text-ui-xs text-[var(--app-text-soft)] shadow-border">{JSON.stringify(event.metadata, null, 2)}</pre>
              </details>
            {/each}
          </div>
        {:else}
          <div class="grid min-h-56 rounded-xl bg-[var(--app-surface)] shadow-border"><NodeEmptyState icon={ScrollText} title={m['autonomy.no_audit']()} /></div>
        {/if}
      </Tabs.Content>
    </Tabs.Root>
  </div>
{/if}

<style>
  /* Abas em linha: rotulo neutro, ativa com texto forte e sublinhado de acento. */
  :global(.autonomy-tab) {
    flex: none;
    height: 28px;
    padding: 0 10px;
    font-size: 12px;
    color: var(--app-text-muted);
  }

  :global(.autonomy-tab[data-state='active']) {
    color: var(--app-text);
  }

  :global(.autonomy-tab[data-state='active'] svg) {
    color: var(--app-accent);
  }

  /* Sublinhado proprio: o primitivo nao marca data-active, so data-state. */
  :global(.autonomy-tab::after) {
    content: '';
    position: absolute;
    left: 10px;
    right: 10px;
    bottom: -5px;
    height: 2px;
    border-radius: 2px;
    background: var(--app-accent);
    opacity: 0;
    transition: opacity var(--duration-fast) ease-out;
  }

  :global(.autonomy-tab[data-state='active']::after) {
    opacity: 1;
  }

  /* Permissao compacta: o chip inteiro alterna o checkbox. */
  .grant-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 9px 0 7px;
    border-radius: 999px;
    box-shadow: var(--app-shadow-border);
    color: var(--app-text-soft);
    font-size: 11.5px;
    cursor: pointer;
    transition: background-color var(--duration-quick) ease-out, color var(--duration-quick) ease-out;
  }

  .grant-chip:hover {
    background: var(--app-hover);
    color: var(--app-text);
  }

  .grant-chip:has(:global([data-state='checked'])) {
    background: var(--app-active);
    color: var(--app-text);
  }

  .capability-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 40px;
    padding: 0 14px;
    box-shadow: inset 0 -1px 0 var(--app-border);
    font-size: 12.5px;
    cursor: pointer;
    transition: background-color var(--duration-quick) ease-out;
  }

  .capability-row:hover,
  .gate-row:hover,
  .secret-row:hover,
  .audit-row:hover {
    background: var(--app-hover);
  }

  .gate-row {
    padding: 8px 14px;
    transition: background-color var(--duration-quick) ease-out;
  }

  .gate-row + .gate-row,
  .secret-row + .secret-row,
  .audit-row + .audit-row {
    box-shadow: inset 0 1px 0 var(--app-border);
  }

  .secret-row,
  .audit-row {
    transition: background-color var(--duration-quick) ease-out;
  }

  .audit-row summary::-webkit-details-marker {
    display: none;
  }

  .audit-row summary:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 2px;
    border-radius: 4px;
  }

  /* Excluir credencial so aparece ao apontar/focar a linha. */
  .secret-row :global(.secret-delete) {
    opacity: 0;
    transition: opacity var(--duration-quick) ease-out, background-color var(--duration-quick) ease-out, color var(--duration-quick) ease-out;
  }

  .secret-row:hover :global(.secret-delete),
  .secret-row:focus-within :global(.secret-delete) {
    opacity: 1;
  }

  @media (hover: none) {
    .secret-row :global(.secret-delete) {
      opacity: 1;
    }
  }
</style>
