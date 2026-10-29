<script lang="ts">
  import { onMount } from 'svelte';
  import { getCsrfToken } from '@beeblock/svelar/http';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Textarea } from '$lib/components/ui/textarea';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import * as Select from '$lib/components/ui/select';
  import * as Dialog from '$lib/components/ui/dialog';
  import { ArrowDownLeft, ArrowUpRight, Copy, KeyRound, Plus, ShieldCheck, RefreshCw } from '@lucide/svelte';
  import { createModelAccessSchema, joinModelAccessSchema } from '$lib/modules/model-access/contracts/schemas/model-access.schema.js';
  import type { ModelAccessGrant, ModelAccessConnection } from '$lib/modules/model-access/domain/types.js';
  import type { ModelAccessPeer } from '$lib/modules/model-access/contracts/schemas/model-access.schema.js';
  import type { ProviderProfile } from '$lib/modules/agent-room/domain/types.js';
  import * as m from '$lib/paraglide/messages.js';
  import { getLocale } from '$lib/paraglide/runtime.js';

  type Grant = ModelAccessGrant & { state: string; pending: ModelAccessPeer[]; running: number; queued: number };
  let grants = $state<Grant[]>([]), connections = $state<Array<ModelAccessConnection & { state: string }>>([]), profiles = $state<ProviderProfile[]>([]);
  let busy = $state(false), error = $state(''), dialog = $state<'create' | 'join' | null>(null), editing = $state<Grant | null>(null);
  let name = $state(''), relayUrl = $state('wss://relay.orkestrai.app/v1/inference'), duration = $state('1440'), concurrency = $state('1'), rate = $state('10'), maximum = $state('');
  let scopes = $state<Record<string, { models: string; efforts: string[]; images: boolean }>>({});
  let accounts = $state<string[]>([]), invitation = $state(''), createdInvite = $state(''), fingerprint = $state('');
  const allEfforts = ['low','medium','high','xhigh','max','ultra'];
  const accountOptions = $derived([
    ...['claude','codex'].map(provider => ({ id: `${provider}/default`, provider, profileId: null as string | null, label: `${provider === 'claude' ? 'Claude' : 'Codex'} · ${m['model_access.default']()}` })),
    ...profiles.filter(profile => ['claude','codex'].includes(profile.providerId)).map(profile => ({ id: `${profile.providerId}/${profile.id}`, provider: profile.providerId, profileId: profile.id, label: `${profile.providerId === 'claude' ? 'Claude' : 'Codex'} · ${profile.name}` })),
  ]);
  const stateLabel = (state: string) => ((m as unknown as Record<string, () => string>)[`model_access.state_${state}`] ?? m['model_access.state_error'])();
  const date = (value: string) => new Intl.DateTimeFormat(getLocale(), { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
  function scopeFor(id: string) { return scopes[id] ?? { models: '', efforts: [], images: false }; }
  function changeScope(id: string, patch: Partial<{ models: string; efforts: string[]; images: boolean }>) { scopes = { ...scopes, [id]: { ...scopeFor(id), ...patch } }; }
  function toggle(values: string[], value: string, checked: boolean) { return checked ? [...new Set([...values, value])] : values.filter(item => item !== value); }
  async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const response = await fetch(path, { method, headers: { 'content-type': 'application/json', 'X-CSRF-Token': getCsrfToken() ?? '' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const payload = await response.json(); if (!response.ok || payload.error) throw new Error(payload.error ?? 'MODEL_ACCESS_REQUEST_FAILED'); return payload.data;
  }
  async function refresh() {
    try { const state = await api<{ grants: Grant[]; connections: Array<ModelAccessConnection & { state: string }> }>('/api/model-access'); grants = state.grants; connections = state.connections; }
    catch { error = m['model_access.error'](); }
  }
  onMount(() => {
    void refresh(); void api<ProviderProfile[]>('/api/agent-room/provider-profiles').then(value => profiles = value).catch(() => {});
    const events = new EventSource('/api/model-access/events'); let timer: ReturnType<typeof setTimeout>;
    events.addEventListener('changed', () => { clearTimeout(timer); timer = setTimeout(() => { if (!document.hidden) void refresh(); }, 150); });
    const visible = () => { if (!document.hidden) void refresh(); }; document.addEventListener('visibilitychange', visible);
    return () => { clearTimeout(timer); events.close(); document.removeEventListener('visibilitychange', visible); };
  });
  function openCreate(grant?: Grant) {
    editing = grant ?? null; name = grant?.name ?? ''; accounts = grant?.policy.offerings.map(item => `${item.providerId}/${item.profileId ?? 'default'}`) ?? [];
    scopes = Object.fromEntries((grant?.policy.offerings ?? []).map(item => [`${item.providerId}/${item.profileId ?? 'default'}`, { models: item.models?.join(', ') ?? '', efforts: item.efforts ?? [], images: item.images }]));
    duration = '1440'; concurrency = String(grant?.policy.concurrency ?? 1); rate = String(grant?.policy.requestsPerMinute ?? 10); maximum = grant?.policy.maxRequests ? String(grant.policy.maxRequests) : '';
    if (grant) relayUrl = grant.relayUrl; createdInvite = ''; error = ''; dialog = 'create';
  }
  async function perform(fn: () => Promise<void>) { if (busy) return; busy = true; error = ''; try { await fn(); await refresh(); } catch (value) { error = value instanceof Error && value.message.includes('SECURE_STORAGE') ? m['model_access.secure_error']() : value instanceof Error && /CLI_VERSION_UNVERIFIED/.test(value.message) ? m['model_access.version_error']() : value instanceof Error && /ACCOUNT|SUBSCRIPTION|AUTH/.test(value.message) ? m['model_access.account_error']() : value instanceof Error && /MANAGED_SETTINGS/.test(value.message) ? m['model_access.managed_error']() : m['model_access.error'](); } finally { busy = false; } }
  async function save() { await perform(async () => {
    const parsed = createModelAccessSchema.safeParse({ name, relayUrl, expiresInMinutes: Number(duration), concurrency: Number(concurrency), requestsPerMinute: Number(rate), maxRequests: maximum ? Number(maximum) : null,
      offerings: accountOptions.filter(item => accounts.includes(item.id)).map(item => { const scope = scopes[item.id] ?? { models: '', efforts: [], images: false }; return { providerId: item.provider, profileId: item.profileId, models: scope.models.trim() ? scope.models.split(',').map(value => value.trim()).filter(Boolean) : null, efforts: scope.efforts.length ? scope.efforts : null, images: item.provider === 'codex' && scope.images }; }) });
    if (!parsed.success) throw new Error('MODEL_ACCESS_VALIDATION');
    if (editing) { const { relayUrl: _relay, ...value } = parsed.data; await api(`/api/model-access/${editing.id}`, 'PUT', { ...value, revision: editing.revision }); dialog = null; }
    else { const grant = await api<Grant>('/api/model-access','POST',parsed.data); createdInvite = (await api<{ invite: string }>(`/api/model-access/${grant.id}`, 'POST', { action: 'invite' })).invite; }
  }); }
  async function join() { await perform(async () => {
    let parsedRelay: string; try { parsedRelay = new URL(invitation.trim()).searchParams.get('relay') ?? ''; } catch { throw new Error('MODEL_ACCESS_INVALID_INVITE'); }
    const parsed = joinModelAccessSchema.safeParse({ invite: invitation.trim(), displayName: name, relayUrl: parsedRelay }); if (!parsed.success) throw new Error('MODEL_ACCESS_VALIDATION');
    const connection = await api<{ fingerprint: string }>('/api/model-access/join','POST',parsed.data); fingerprint = connection.fingerprint; invitation = '';
  }); }
</script>

<section class="access-panel" data-tour="model-access" aria-labelledby="model-access-heading">
  <header class="access-heading"><div><h2 id="model-access-heading"><KeyRound size={18} aria-hidden="true" />{m['model_access.title']()}</h2><p>{m['model_access.subtitle']()}</p></div><Button variant="ghost" size="icon" aria-label={m['model_access.refresh']()} onclick={refresh}><RefreshCw size={16} /></Button></header>
  {#if error}<p class="access-error" role="alert">{error}</p>{/if}
  <div class="access-columns">
    <div><div class="access-column-heading"><h3><ArrowUpRight size={15} aria-hidden="true" />{m['model_access.owned']()}</h3><Button size="sm" variant="outline" onclick={() => openCreate()}><Plus size={14} />{m['model_access.create']()}</Button></div>
      {#if !grants.length}<p class="access-empty">{m['model_access.empty_owned']()}</p>{/if}
      {#each grants as grant (grant.id)}
        <article class="access-card"><div class="access-card-heading"><strong>{grant.name}</strong><span class:connected={grant.state === 'connected'}>{stateLabel(grant.status === 'draft' || ['revoked','expired'].includes(grant.status) ? grant.status : grant.state)}</span></div>
          <p>{m['model_access.expires']({ date: date(grant.expiresAt) })}</p><p>{m['model_access.usage']({ count: grant.requestsUsed })}</p>{#if grant.running || grant.queued}<p>{m['model_access.queue']({running:grant.running,queued:grant.queued})}</p>{/if}
          <div class="account-tags">{#each grant.policy.offerings as offering}<span>{offering.label}</span>{/each}</div>
          {#each grant.pending as peer (peer.id)}
            <div class="pending-device"><strong>{peer.name}</strong><p>{m['model_access.approval_help']()}</p><code aria-label={m['model_access.fingerprint']()}>{peer.fingerprint}</code><div class="access-actions"><Button size="sm" disabled={busy} onclick={() => perform(async () => { await api(`/api/model-access/${grant.id}/approve`, 'POST', { revision: grant.revision, guestId: peer.id, fingerprint: peer.fingerprint, approved: true }); })}>{m['model_access.approve']()}</Button><Button variant="ghost" size="sm" disabled={busy} onclick={() => perform(async () => { await api(`/api/model-access/${grant.id}/approve`, 'POST', { revision: grant.revision, guestId: peer.id, fingerprint: peer.fingerprint, approved: false }); })}>{m['model_access.deny']()}</Button></div></div>
          {/each}
          {#if ['draft','active'].includes(grant.status)}<div class="access-actions">
            {#if grant.status === 'draft'}<Button size="sm" variant="ghost" disabled={busy} onclick={() => perform(async () => { createdInvite = (await api<{ invite: string }>(`/api/model-access/${grant.id}`, 'POST', { action: 'invite' })).invite; dialog = 'create'; })}><Copy size={13} />{m['model_access.copy']()}</Button>{/if}
            <Button size="sm" variant="ghost" onclick={() => openCreate(grant)}>{m['model_access.edit']()}</Button><Button size="sm" variant="ghost" disabled={busy} onclick={() => perform(async () => { await api(`/api/model-access/${grant.id}`, 'POST', { action: 'revoke', revision: grant.revision }); })}>{m['model_access.revoke']()}</Button>
          </div>{/if}
        </article>
      {/each}
    </div>
    <div><div class="access-column-heading"><h3><ArrowDownLeft size={15} aria-hidden="true" />{m['model_access.received']()}</h3><Button size="sm" variant="outline" onclick={() => { dialog = 'join'; name = ''; invitation = ''; fingerprint = ''; error = ''; }}>{m['model_access.join']()}</Button></div>
      {#if !connections.length}<p class="access-empty">{m['model_access.empty_received']()}</p>{/if}
      {#each connections as connection (connection.id)}<article class="access-card"><div class="access-card-heading"><strong>{connection.name}</strong><span class:connected={connection.state === 'connected'}>{stateLabel(['revoked','expired'].includes(connection.status) ? connection.status : connection.state)}</span></div>
        {#if connection.expiresAt}<p>{m['model_access.expires']({ date: date(connection.expiresAt) })}</p>{/if}
        {#if connection.policy}<div class="account-tags">{#each connection.policy.offerings as offering}<span>{offering.label}</span>{/each}</div><p>{m['model_access.select_agent']()}</p>{/if}
        {#if ['pending','active'].includes(connection.status)}<Button size="sm" variant="ghost" disabled={busy} onclick={() => perform(async () => { await api(`/api/model-access/${connection.id}`, 'POST', { action: 'disconnect' }); })}>{m['model_access.disconnect']()}</Button>{/if}
      </article>{/each}
    </div>
  </div>
  <p class="access-privacy"><ShieldCheck size={15} aria-hidden="true" />{m['model_access.privacy']()}</p>
</section>

<Dialog.Root open={dialog !== null} onOpenChange={open => { if (!open) { dialog = null; createdInvite = ''; invitation = ''; } }}>
  <Dialog.Content class="max-h-[85vh] overflow-y-auto sm:max-w-xl">
    <Dialog.Header><Dialog.Title>{dialog === 'join' ? m['model_access.join']() : editing ? m['model_access.edit']() : m['model_access.create']()}</Dialog.Title><Dialog.Description>{dialog === 'join' ? m['model_access.guest_privacy']() : m['model_access.privacy']()}</Dialog.Description></Dialog.Header>
    {#if error}<p class="access-error" role="alert">{error}</p>{/if}
    {#if createdInvite}
      <p>{m['model_access.invite_help']()}</p><Textarea readonly value={createdInvite} aria-label={m['model_access.invite']()} class="font-mono text-xs" />
      <Button onclick={() => navigator.clipboard.writeText(createdInvite)}><Copy size={14} />{m['model_access.copy']()}</Button>
    {:else if dialog === 'join'}
      {#if fingerprint}<p>{m['model_access.state_waiting_approval']()}</p><p>{m['model_access.fingerprint']()}</p><code class="break-all">{fingerprint}</code>
      {:else}<label class="access-field">{m['model_access.guest_name']()}<Input bind:value={name} maxlength={100} /></label><label class="access-field">{m['model_access.invite']()}<Textarea bind:value={invitation} autocomplete="off" spellcheck={false} /></label><Button disabled={busy || !name.trim() || !invitation.trim()} onclick={join}>{m['model_access.join']()}</Button>{/if}
    {:else}
      <form onsubmit={event => { event.preventDefault(); void save(); }} class="access-form">
        <label class="access-field">{m['model_access.name']()}<Input bind:value={name} maxlength={100} required /></label>
        <fieldset><legend>{m['model_access.accounts']()}</legend><div class="access-account-options">{#each accountOptions as account (account.id)}<label><Checkbox checked={accounts.includes(account.id)} onCheckedChange={(checked: boolean) => accounts = toggle(accounts, account.id, checked)} />{account.label}</label>{/each}</div></fieldset>
        {#each accountOptions.filter(item => accounts.includes(item.id)) as account (account.id)}
          {@const scope = scopeFor(account.id)}
          <fieldset class="pending-device"><legend>{account.label}</legend>
            <label class="access-field">{m['model_access.models']()}<Input value={scope.models} oninput={(event: Event & { currentTarget: HTMLInputElement }) => changeScope(account.id, { models: event.currentTarget.value })} placeholder={m['model_access.all_models']()} /></label>
            <div class="access-field" style="margin-top:.75rem"><span>{m['model_access.efforts']()} — {!scope.efforts.length ? m['model_access.all_efforts']() : ''}</span><div class="effort-options">{#each allEfforts as effort}<label><Checkbox checked={scope.efforts.includes(effort)} onCheckedChange={(checked: boolean) => changeScope(account.id, { efforts: toggle(scope.efforts, effort, checked) })} />{effort}</label>{/each}</div></div>
            {#if account.provider === 'codex'}<label class="access-check" style="margin-top:.75rem"><Checkbox checked={scope.images} onCheckedChange={(checked: boolean) => changeScope(account.id, { images: checked })} />{m['model_access.images']()}</label>{/if}
          </fieldset>
        {/each}
        <div class="access-form-grid"><div class="access-field"><label for="access-duration">{m['model_access.duration']()}</label><Select.Root type="single" bind:value={duration}><Select.Trigger id="access-duration" class="w-full">{({'60': m['model_access.hour'](), '1440': m['model_access.day'](), '10080': m['model_access.week'](), '43200': m['model_access.month']()} as Record<string,string>)[duration]}</Select.Trigger><Select.Content>{#each [['60',m['model_access.hour']()],['1440',m['model_access.day']()],['10080',m['model_access.week']()],['43200',m['model_access.month']()]] as item}<Select.Item value={item[0]}>{item[1]}</Select.Item>{/each}</Select.Content></Select.Root></div>
          <div class="access-field"><label for="access-concurrency">{m['model_access.concurrency']()}</label><Select.Root type="single" bind:value={concurrency}><Select.Trigger id="access-concurrency" class="w-full">{concurrency}</Select.Trigger><Select.Content>{#each ['1','2','3','4'] as value}<Select.Item {value}>{value}</Select.Item>{/each}</Select.Content></Select.Root></div></div>
        <div class="access-form-grid"><label class="access-field">{m['model_access.rate']()}<Input inputmode="numeric" pattern="[0-9]+" bind:value={rate} /></label><label class="access-field">{m['model_access.max_requests']()}<Input inputmode="numeric" pattern="[0-9]*" bind:value={maximum} placeholder={m['model_access.unlimited']()} /></label></div>
        <label class="access-field">{m['model_access.relay']()}<Input bind:value={relayUrl} disabled={!!editing} type="url" required /></label><p class="access-muted">{m['model_access.relay_help']()}</p>
        <Button type="submit" disabled={busy || !accounts.length}>{m['model_access.save']()}</Button>
      </form>
    {/if}
  </Dialog.Content>
</Dialog.Root>

<style>
  .access-panel { margin: 0 auto 14px; padding: 16px 18px; border-radius: 12px; background: var(--app-surface); box-shadow: var(--app-shadow-border); color: var(--app-text); }
  .access-heading,.access-card-heading,.access-column-heading,.access-actions { display: flex; align-items: center; gap: .65rem; justify-content: space-between; }
  .access-heading { align-items: flex-start; margin-bottom: 1.25rem; } .access-heading h2 { display: flex; align-items: center; gap: .5rem; font-size: 1rem; font-weight: 650; }
  .access-heading p,.access-card p,.pending-device p,.access-empty { color: var(--app-text-muted); font-size: .8125rem; line-height: 1.55; margin-top: .4rem; }
  .access-columns { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 1.25rem; } .access-column-heading { margin-bottom: .75rem; } .access-column-heading h3 { display:flex; align-items:center; gap:.35rem; font-size:.8125rem; font-weight:600; }
  .access-card { border: 1px solid var(--app-border); border-radius: .75rem; padding: 1rem; margin-bottom: .75rem; } .access-card-heading strong { font-size: .875rem; overflow-wrap: anywhere; } .access-card-heading span { font-size: .7rem; color:var(--app-text-muted); } .access-card-heading .connected { color:var(--app-success, #31825a); }
  .account-tags,.access-actions { display:flex; gap:.4rem; flex-wrap:wrap; justify-content:flex-start; margin-top:.75rem; } .account-tags span { padding:.15rem .45rem; border-radius:.35rem; background:var(--app-surface-raised); font-size:.7rem; }
  .access-privacy { display:flex; align-items:flex-start; gap:.5rem; margin-top:1rem; color:var(--app-text-muted); font-size:.75rem; line-height:1.5; } .access-privacy :global(svg) { flex-shrink:0; }
  .pending-device { margin-top:.75rem; padding:.75rem; border:1px solid var(--app-border-strong); border-radius:.5rem; } .pending-device code { display:block; margin-top:.5rem; font-size:.75rem; overflow-wrap:anywhere; }
  .access-form { display:grid; gap:1rem; } .access-field { display:flex; flex-direction:column; gap:.4rem; font-size:.8125rem; } fieldset legend { font-size:.8125rem; margin-bottom:.6rem; } .access-account-options { display:grid; gap:.6rem; } .access-account-options label,.effort-options label,.access-check { display:flex; align-items:center; gap:.5rem; font-size:.8125rem; } .effort-options { display:flex; gap:1rem; flex-wrap:wrap; } .access-form-grid { display:grid; grid-template-columns:1fr 1fr; gap:.75rem; } .access-muted { color:var(--app-text-muted); font-size:.75rem; line-height:1.5; } .access-error { color:var(--app-danger, #c44747); font-size:.8125rem; margin-bottom:.75rem; }
  @media(max-width:760px) { .access-columns { grid-template-columns:1fr; } .access-heading { gap:.5rem; } }
</style>
