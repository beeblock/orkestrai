<script lang="ts">
  import { untrack } from 'svelte';
  import { defaults, superForm } from 'sveltekit-superforms';
  import { zod } from 'sveltekit-superforms/adapters';
  import { Check, CircleAlert, ExternalLink, KeyRound, LoaderCircle, Plus, RefreshCw, Save, Search, Trash2 } from '@lucide/svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import * as Tabs from '$lib/components/ui/tabs';
  import * as NativeSelect from '$lib/components/ui/native-select';
  import { Input } from '$lib/components/ui/input';
  import { Button } from '$lib/components/ui/button';
  import { Switch } from '$lib/components/ui/switch';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { CREATIVE_MODELS } from '$lib/modules/creative-media/domain/catalog.js';
  import { CREATIVE_PROVIDERS, type CreativeProviderId } from '$lib/modules/creative-media/domain/providers.js';
  import type { FalModelSummary } from '$lib/modules/creative-media/domain/model-contract.js';
  import { creativePolicySchema, creativePolicySaveSchema, creativeProfileSaveSchema, type CreativePolicy, type CreativeProfileSave } from '$lib/modules/creative-media/contracts/schemas/creative-media.schema.js';
  import type { CreativeProfile, CreativeWorkspacePolicy } from '$lib/modules/creative-media/domain/types.js';
  import { creativeApi, creativeError } from './creative-media-client.js';
  import * as m from '$lib/paraglide/messages.js';

  let { open = $bindable(false), workspaceId, onSaved }: { open?: boolean; workspaceId: string; onSaved: () => void | Promise<void> } = $props();
  let profiles = $state<CreativeProfile[]>([]), policies = $state<CreativeWorkspacePolicy[]>([]);
  let profileId = $state(''), name = $state('fal.ai'), credential = $state(''), enabled = $state(false);
  let provider = $state<CreativeProviderId>('fal');
  let policy = $state(creativePolicySchema.parse({}));
  let runUsd = $state(0), dayUsd = $state(0), revision = $state<number | undefined>(), policyRevision = $state<number | undefined>();
  let busy = $state(false), error = $state(''), saved = $state(false), tab = $state('account');
  let confirmDelete = $state(false);
  let loading = $state(true), ready = $state(false), loadSequence = 0;
  let models = $state<FalModelSummary[]>([]), modelQuery = $state(''), modelError = $state(''), modelsLoading = $state(false);
  const allModels = $derived([...(provider === 'fal' ? Object.values(CREATIVE_MODELS).map(model => ({ id: model.id, name: model.name })) : []), ...models]);
  const filteredModels = $derived(allModels.filter(model => `${model.name} ${model.id}`.toLowerCase().includes(modelQuery.toLowerCase())));
  async function loadModels(refresh = false) {
    const requested = provider;
    modelsLoading = true; modelError = '';
    try { const result = await creativeApi<{ models: FalModelSummary[] }>(`/api/agent-room/workspaces/${workspaceId}/creative-media/models?provider=${requested}&limit=5000${refresh ? '&refresh=true' : ''}`); if (provider === requested) models = result.models; }
    catch (cause) { if (provider === requested) modelError = (cause as Error).message; }
    finally { if (provider === requested) modelsLoading = false; }
  }
  const accountAdapter = zod(creativeProfileSaveSchema as unknown as Parameters<typeof zod>[0]);
  const policyAdapter = zod(creativePolicySaveSchema as unknown as Parameters<typeof zod>[0]);
  const instanceId = $props.id();
  const accountForm = superForm<CreativeProfileSave>(defaults({ name: 'fal.ai', provider: 'fal', enabled: false }, accountAdapter) as never, { id: `creative-account-${instanceId}`, SPA: true, validators: accountAdapter as never });
  const policyForm = superForm<CreativePolicy & { revision?: number }>(defaults(creativePolicySchema.parse({}), policyAdapter) as never, { id: `creative-policy-${instanceId}`, SPA: true, validators: policyAdapter as never });
  const { errors: accountErrors } = accountForm;
  const { errors: policyErrors } = policyForm;

  function clearCredential() {
    credential = '';
    accountForm.form.update(value => ({ ...value, credential: undefined }), { taint: false });
  }

  function select(id: string) {
    profileId = id; clearCredential(); error = ''; saved = false;
    accountForm.errors.set({}); policyForm.errors.set({});
    const profile = profiles.find(item => item.id === id);
    provider = profile?.provider ?? 'fal';
    name = profile?.name ?? 'fal.ai'; enabled = profile?.enabled ?? false; revision = profile?.revision;
    const grant = policies.find(item => item.profileId === id);
    policy = creativePolicySchema.parse(grant ? { enabled: grant.enabled, allowAgents: grant.allowAgents, allowExternalMedia: grant.allowExternalMedia, modelIds: grant.modelIds, maxRunCents: grant.maxRunCents, maxDayCents: grant.maxDayCents, maxConcurrentRuns: grant.maxConcurrentRuns } : {});
    policyRevision = grant?.revision; runUsd = policy.maxRunCents / 100; dayUsd = policy.maxDayCents / 100;
  }
  async function load(selected = profileId) {
    const sequence = ++loadSequence, requestedWorkspace = workspaceId;
    loading = true; ready = false;
    try {
      const data = await creativeApi<{ profiles: CreativeProfile[]; policies: CreativeWorkspacePolicy[] }>(`/api/agent-room/workspaces/${requestedWorkspace}/creative-media`);
      if (!open || sequence !== loadSequence || workspaceId !== requestedWorkspace) return;
      profiles = data.profiles; policies = data.policies;
      select(selected || profiles[0]?.id || '');
      ready = true;
    } catch (cause) {
      if (open && sequence === loadSequence && workspaceId === requestedWorkspace) throw cause;
    } finally { if (sequence === loadSequence) loading = false; }
  }
  function reload() { void load().catch(cause => { error = String(cause.message); }); }
  const dialogContext = $derived(open ? workspaceId : '');
  $effect(() => {
    if (dialogContext) untrack(() => { reload(); });
    else untrack(() => { loadSequence++; loading = true; ready = false; clearCredential(); });
  });
  $effect(() => { if (open) { provider; untrack(() => { models = []; void loadModels(); }); } });
  async function saveAccount() {
    busy = true; error = ''; saved = false;
    try {
      accountForm.form.set({ name, provider, enabled, ...(revision ? { revision } : {}), ...(credential ? { credential } : {}) });
      const validated = await accountForm.validateForm({ update: true });
      if (!validated.valid) return;
      if (!profileId && !credential) { accountForm.errors.set({ credential: ['required'] }); return; }
      const value = await creativeApi<CreativeProfile>(`/api/agent-room/creative-media/profiles${profileId ? `/${profileId}` : ''}`, profileId ? 'PUT' : 'POST', validated.data);
      clearCredential(); await load(value.id); saved = true; tab = 'workspace'; await onSaved();
    } catch (cause) { error = (cause as Error).message; } finally { busy = false; }
  }
  async function savePolicy() {
    busy = true; error = ''; saved = false;
    try {
      policyForm.form.set({ ...policy, maxRunCents: Math.round(Number(runUsd) * 100), maxDayCents: Math.round(Number(dayUsd) * 100), ...(policyRevision ? { revision: policyRevision } : {}) });
      const validated = await policyForm.validateForm({ update: true });
      if (!validated.valid) return;
      await creativeApi(`/api/agent-room/workspaces/${workspaceId}/creative-media/policies/${profileId}`, 'PUT', validated.data);
      await load(profileId); saved = true; await onSaved();
    } catch (cause) { error = (cause as Error).message; } finally { busy = false; }
  }
  async function remove() {
    busy = true; error = '';
    try { await creativeApi(`/api/agent-room/creative-media/profiles/${profileId}`, 'DELETE'); await load(''); await onSaved(); }
    catch (cause) { error = (cause as Error).message; } finally { busy = false; }
  }
  function modelChecked(id: string, checked: boolean) {
    policy.modelIds = checked ? [...new Set([...policy.modelIds, id])] : policy.modelIds.filter(value => value !== id);
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="flex h-[min(760px,calc(100dvh-32px))] max-h-[calc(100dvh-32px)] flex-col gap-4 overflow-hidden sm:max-w-[560px] [&_[data-slot=native-select-wrapper]]:w-full">
    <Dialog.Header class="shrink-0 pr-8"><Dialog.Title>{m['creative.providers']()}</Dialog.Title><Dialog.Description>{m['creative.key_help']()}</Dialog.Description></Dialog.Header>
    {#if loading}<p role="status" class="flex shrink-0 items-center gap-2 self-start rounded-full bg-[var(--app-hover)] px-3 py-1 text-ui-md text-[var(--app-text-soft)]"><LoaderCircle size={13} class="animate-spin" aria-hidden="true" />{m['creative.loading']()}</p>{/if}
    <fieldset disabled={busy || !ready} aria-busy={loading} class="min-h-0 min-w-0 flex-1 overflow-hidden disabled:opacity-70">
    <!-- Fieldset's anonymous content box cannot constrain nested flex scroll areas. -->
    <div class="flex h-full min-h-0 flex-col gap-3">
    <div class="flex min-w-0 shrink-0 items-center gap-2">
      <NativeSelect.Root class="min-w-0 flex-1" value={profileId} onchange={(event: Event & { currentTarget: HTMLSelectElement }) => select(event.currentTarget.value)} aria-label={m['creative.account']()}>
        <option value="">{m['creative.new_account']()}</option>
        {#each profiles as profile}<option value={profile.id}>{profile.name}</option>{/each}
      </NativeSelect.Root>
      <Button variant="outline" size="icon" title={m['creative.new_account']()} aria-label={m['creative.new_account']()} onclick={() => { select(''); tab = 'account'; }}><Plus size={16} /></Button>
    </div>
    <Tabs.Root bind:value={tab} class="flex min-h-0 flex-1 flex-col">
      <Tabs.List class="grid h-9 w-full shrink-0 grid-cols-2 rounded-lg bg-[var(--app-hover)] p-0.5"><Tabs.Trigger value="account" class="h-8 rounded-md text-[13px] data-[state=active]:bg-[var(--app-surface-raised)] data-[state=active]:text-[var(--app-text)] data-[state=active]:shadow-[var(--app-shadow-border)] dark:data-[state=active]:border-transparent dark:data-[state=active]:bg-[var(--app-surface-raised)] dark:data-[state=active]:text-[var(--app-text)]">{m['creative.account']()}</Tabs.Trigger><Tabs.Trigger value="workspace" disabled={!profileId} class="h-8 rounded-md text-[13px] data-[state=active]:bg-[var(--app-surface-raised)] data-[state=active]:text-[var(--app-text)] data-[state=active]:shadow-[var(--app-shadow-border)] dark:data-[state=active]:border-transparent dark:data-[state=active]:bg-[var(--app-surface-raised)] dark:data-[state=active]:text-[var(--app-text)]">{m['creative.permissions']()}</Tabs.Trigger></Tabs.List>
      <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain py-4">
        <Tabs.Content value="account" class="grid gap-4">
          <label class="grid gap-1.5"><span class="text-ui-lg font-medium">{m['creative.provider']()}</span><NativeSelect.Root value={provider} disabled={Boolean(profileId)} onchange={(event: Event & { currentTarget: HTMLSelectElement }) => { provider = event.currentTarget.value as CreativeProviderId; name = CREATIVE_PROVIDERS.find(item => item.id === provider)!.name; clearCredential(); }}>{#each CREATIVE_PROVIDERS as item}<option value={item.id}>{item.name}</option>{/each}</NativeSelect.Root></label>
          <label class="grid gap-1.5"><span class="text-ui-lg font-medium">{m['creative.account_name']()}</span><Input name="name" bind:value={name} maxlength={80} aria-invalid={Boolean($accountErrors.name)} /></label>
          {#if $accountErrors.name}<p role="alert" class="flex items-center gap-1.5 text-ui-md text-[var(--app-danger)]"><CircleAlert size={13} class="shrink-0" aria-hidden="true" />{m['creative.field_invalid']()}</p>{/if}
          <div class="grid gap-1.5">
            <div class="flex items-baseline justify-between gap-3"><label class="text-ui-lg font-medium" for={`creative-credential-${instanceId}`}>{m['creative.api_key']()}</label><a class="text-ui-md text-[var(--app-text-soft)] underline underline-offset-4 hover:text-[var(--app-text)]" href={CREATIVE_PROVIDERS.find(item => item.id === provider)!.url} target="_blank" rel="noreferrer">{m['creative.provider_console']()}<ExternalLink size={11} class="ml-1 inline" aria-hidden="true" /></a></div>
            <Input id={`creative-credential-${instanceId}`} name="credential" type="password" bind:value={credential} autocomplete="off" spellcheck={false} maxlength={512} class="font-mono" aria-invalid={Boolean($accountErrors.credential)} />
            {#if $accountErrors.credential}<p role="alert" class="flex items-center gap-1.5 text-ui-md text-[var(--app-danger)]"><CircleAlert size={13} class="shrink-0" aria-hidden="true" />{m['creative.error_credential']()}</p>{/if}
            {#if profiles.find(item => item.id === profileId)?.hasCredential}<p class="flex items-center gap-1.5 text-ui-md text-[var(--app-text-muted)]"><KeyRound size={12} class="shrink-0 text-[var(--app-success)]" aria-hidden="true" />{m['creative.key_saved']()}</p>{/if}
            {#if provider === 'higgsfield'}<p class="text-ui-md leading-snug text-pretty text-[var(--app-text-muted)]">{m['creative.higgsfield_key_help']()}</p>{/if}
          </div>
          <label class="setting-row"><span class="text-ui-lg">{m['creative.account_enabled']()}</span><Switch bind:checked={enabled} /></label>
        </Tabs.Content>
        <Tabs.Content value="workspace" class="grid gap-5">
          <div class="grid">
            <label class="setting-row"><span class="text-ui-lg">{m['creative.workspace_enabled']()}</span><Switch bind:checked={policy.enabled} /></label>
            <label class="setting-row"><span class="text-ui-lg">{m['creative.agents_allowed']()}</span><Switch bind:checked={policy.allowAgents} /></label>
            <label class="setting-row"><span class="text-ui-lg text-pretty">{m['creative.external_allowed']()}</span><Switch bind:checked={policy.allowExternalMedia} /></label>
          </div>
          <fieldset class="grid gap-2"><legend class="mb-2 flex items-center gap-2 text-ui-lg font-medium">{m['creative.allowed_models']()}<span class="rounded-full bg-[var(--app-hover)] px-1.5 font-mono text-[11px] font-normal text-[var(--app-text-soft)] tabular-nums">{policy.modelIds.length}</span></legend>
            <div class="relative"><Search size={14} class="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-[var(--app-text-muted)]" aria-hidden="true" /><Input bind:value={modelQuery} class="h-8 pl-8 text-[13px]" placeholder={m['creative.search_models']()} aria-label={m['creative.search_models']()} /></div>
            {#if modelsLoading}<p role="status" class="flex items-center gap-2 text-ui-md text-[var(--app-text-muted)]"><LoaderCircle size={12} class="animate-spin" aria-hidden="true" />{m['creative.catalog_loading']()}</p>{/if}
            {#if modelError}<p role="alert" class="flex items-start gap-2 rounded-lg bg-[var(--app-danger-soft)] px-3 py-2 text-ui-md leading-snug text-[var(--app-danger)]"><CircleAlert size={14} class="mt-px shrink-0" aria-hidden="true" /><span class="min-w-0 flex-1">{creativeError(modelError)}</span><Button size="xs" variant="outline" class="shrink-0" onclick={() => loadModels(true)}><RefreshCw aria-hidden="true" />{m['creative.refresh']()}</Button></p>{/if}
            <div class="flex flex-wrap gap-2"><Button size="sm" variant="outline" onclick={() => policy.modelIds = [...new Set([...policy.modelIds, ...filteredModels.filter(model => !('status' in model) || model.status === 'active').map(model => model.id)])]}>{m['creative.allow_filtered']()}</Button><Button size="sm" variant="ghost" onclick={() => policy.modelIds = policy.modelIds.filter(id => !filteredModels.some(model => model.id === id))}>{m['creative.deny_filtered']()}</Button></div>
            <div class="max-h-52 overflow-y-auto overscroll-contain rounded-lg p-1 shadow-[var(--app-shadow-border)]">{#each filteredModels as model (model.id)}<label class="model-row"><Checkbox class="mt-0.5" checked={policy.modelIds.includes(model.id)} disabled={'status' in model && model.status === 'deprecated'} onCheckedChange={(checked: boolean | 'indeterminate') => modelChecked(model.id, checked === true)} /><span class="min-w-0 break-words text-ui-lg">{model.name}<span class="block font-mono text-[10.5px] break-all text-[var(--app-text-muted)]">{model.id}</span></span></label>{/each}</div>
          </fieldset>
          <div class="grid gap-3 border-t border-[var(--app-border)] pt-4">
            <div class="grid grid-cols-2 gap-3">
              <label class="grid content-start gap-1.5"><span class="text-ui-md font-medium">{m['creative.run_budget']()}</span><span class="money-input"><span aria-hidden="true">$</span><Input name="maxRunCents" type="number" min={0} max={1000} step={0.01} bind:value={runUsd} aria-invalid={Boolean($policyErrors.maxRunCents)} /></span>{#if $policyErrors.maxRunCents}<span role="alert" class="flex items-center gap-1.5 text-ui-md text-[var(--app-danger)]"><CircleAlert size={13} class="shrink-0" aria-hidden="true" />{m['creative.field_invalid']()}</span>{/if}</label>
              <label class="grid content-start gap-1.5"><span class="text-ui-md font-medium">{m['creative.day_budget']()}</span><span class="money-input"><span aria-hidden="true">$</span><Input name="maxDayCents" type="number" min={0} max={10000} step={0.01} bind:value={dayUsd} aria-invalid={Boolean($policyErrors.maxDayCents)} /></span>{#if $policyErrors.maxDayCents}<span role="alert" class="flex items-center gap-1.5 text-ui-md text-[var(--app-danger)]"><CircleAlert size={13} class="shrink-0" aria-hidden="true" />{m['creative.field_invalid']()}</span>{/if}</label>
            </div>
            <label class="setting-row"><span class="text-ui-lg">{m['creative.concurrency']()}</span><span class="w-24 shrink-0"><NativeSelect.Root value={String(policy.maxConcurrentRuns)} onchange={(event: Event & { currentTarget: HTMLSelectElement }) => policy.maxConcurrentRuns = Number(event.currentTarget.value)}>{#each [1,2,3,4] as value}<option value={String(value)}>{value}</option>{/each}</NativeSelect.Root></span></label>
            <p class="text-ui-md leading-relaxed text-pretty text-[var(--app-text-muted)]">{m['creative.budget_help']()}</p>
          </div>
        </Tabs.Content>
      </div>
    </Tabs.Root>
    </div>
    </fieldset>
    {#if error}<div role="alert" class="flex shrink-0 items-start gap-2 rounded-lg bg-[var(--app-danger-soft)] px-3 py-2 text-ui-md leading-snug text-[var(--app-danger)]"><CircleAlert size={14} class="mt-px shrink-0" aria-hidden="true" /><span class="min-w-0 flex-1">{creativeError(error)}<span class="mt-1 block font-mono text-[10.5px] break-all opacity-80">{error.startsWith('creative_') ? error : ''}</span></span>{#if !ready && !loading}<Button size="xs" variant="outline" class="shrink-0" onclick={reload}><RefreshCw aria-hidden="true" />{m['creative.refresh']()}</Button>{/if}</div>{:else if !ready && !loading}<Button variant="outline" class="self-start" onclick={reload}><RefreshCw aria-hidden="true" />{m['creative.refresh']()}</Button>{/if}
    <Dialog.Footer class="grid shrink-0 grid-cols-[auto_1fr] items-center gap-2">
      <div>{#if profileId && tab === 'account'}<Button variant="ghost" class="text-[var(--app-danger)] hover:text-[var(--app-danger)]" disabled={busy || !ready} onclick={() => confirmDelete = true}><Trash2 size={14} aria-hidden="true" />{m['creative.delete']()}</Button>{/if}</div>
      <div class="flex items-center justify-end gap-2">{#if saved}<span role="status" class="flex items-center gap-1.5 text-ui-md text-[var(--app-success)]"><Check size={13} aria-hidden="true" />{m['creative.saved']()}</span>{/if}<Button variant="outline" onclick={() => open = false}>{m['creative.close']()}</Button><Button disabled={busy || !ready || (tab === 'workspace' && !profileId)} onclick={tab === 'account' ? saveAccount : savePolicy}><Save size={14} aria-hidden="true" />{m['creative.save']()}</Button></div>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
<AlertDialog.Root bind:open={confirmDelete}><AlertDialog.Content><AlertDialog.Header><AlertDialog.Title>{m['creative.delete']()}</AlertDialog.Title><AlertDialog.Description>{m['creative.delete_account_help']()}</AlertDialog.Description></AlertDialog.Header><AlertDialog.Footer><AlertDialog.Cancel>{m['dlg.cancel']()}</AlertDialog.Cancel><AlertDialog.Action variant="destructive" onclick={remove}>{m['creative.delete']()}</AlertDialog.Action></AlertDialog.Footer></AlertDialog.Content></AlertDialog.Root>

<style>
  .setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    min-height: 44px;
    padding: 6px 0;
    border-top: 1px solid var(--app-border);
  }

  .setting-row:first-child {
    border-top: 0;
  }

  .model-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 6px 8px;
    border-radius: 6px;
    cursor: pointer;
    transition: background-color var(--duration-quick) ease-out;
  }

  .model-row:hover {
    background: var(--app-hover);
  }

  /* Valor monetario: simbolo dentro do campo, digitos tabulares. */
  .money-input {
    position: relative;
    display: block;
  }

  .money-input > span {
    position: absolute;
    top: 50%;
    left: 10px;
    transform: translateY(-50%);
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--app-text-muted);
    pointer-events: none;
  }

  .money-input :global(input) {
    padding-left: 24px;
    font-variant-numeric: tabular-nums;
  }
</style>
