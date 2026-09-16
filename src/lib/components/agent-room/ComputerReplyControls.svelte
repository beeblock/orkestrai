<script lang="ts">
  import { untrack } from 'svelte';
  import { getCsrfToken } from '@beeblock/svelar/http';
  import { ShieldCheck, Trash2, Plus, RefreshCw } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Switch } from '$lib/components/ui/switch';
  import { Slider } from '$lib/components/ui/slider';
  import * as Select from '$lib/components/ui/select';
  import ConversationMemoryPanel from './ConversationMemoryPanel.svelte';
  import ConversationRecovery from './ConversationRecovery.svelte';
  import ComputerMediaControls from './ComputerMediaControls.svelte';
  import CompanionProfileControls from './CompanionProfileControls.svelte';
  import type { AutonomyPolicyInput } from '$lib/modules/agent-room/contracts/schemas/autonomy-policy.schema.js';
  import type { ComputerReplyGrant } from '$lib/modules/agent-room/contracts/schemas/computer-reply.schema.js';
  import type { ComputerAccessibility, ComputerCommandInput, ComputerCommandResult, ComputerWindow } from '$lib/modules/agent-room/contracts/schemas/computer.schema.js';
  import * as m from '$lib/paraglide/messages.js';

  let { workspaceId, nodeId, windows, command, onchange }: { workspaceId: string; nodeId: string; windows: ComputerWindow[]; command: (input: ComputerCommandInput) => Promise<ComputerCommandResult | null>; onchange: () => void } = $props();
  let policy = $state<AutonomyPolicyInput | null>(null);
  let tasks = $state<{ id: string; title: string; assigneeNodeId: string; assigneeTitle: string }[]>([]);
  let tree = $state<ComputerAccessibility | null>(null);
  let windowId = $state('');
  let taskId = $state('');
  let recipientId = $state('');
  let composerId = $state('');
  let sendId = $state('');
  let marker = $state('');
  let maxPerHour = $state(60);
  let busy = $state(false);
  let error = $state('');
  let generation = 0;
  const text = m as unknown as Record<string, () => string>;
  const grants = $derived(policy?.policy.computerReplyGrants.filter(g => g.nodeId === nodeId) ?? []);
  const task = $derived(tasks.find(t => t.id === taskId));
  const ready = $derived(policy?.enabled && policy.mode === 'bounded' && !policy.policy.halted);
  const valid = $derived(ready && tree?.available && !tree.truncated && task && recipientId && composerId && sendId && marker.trim());

  async function api(path: string, method = 'GET', body?: unknown, workspace = workspaceId) {
    const csrf = getCsrfToken();
    const response = await fetch(`/api/agent-room/workspaces/${workspace}/${path}`, { method, headers: { 'content-type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const value = await response.json(); if (!response.ok) throw new Error(text['computer.command_failed']()); return value.data;
  }
  async function load() {
    const workspace = workspaceId, request = ++generation;
    try {
      const nextPolicy = await api('autonomy', 'GET', undefined, workspace), nextTasks = await api('tasks', 'GET', undefined, workspace);
      if (request !== generation || workspace !== workspaceId) return;
      policy = nextPolicy; tasks = nextTasks.filter((t: { status: string; assigneeNodeId: string | null }) => t.status !== 'done' && t.assigneeNodeId); error = '';
    } catch { if (request === generation && workspace === workspaceId) error = text['computer.command_failed'](); }
  }
  async function readWindow() {
    const workspace = workspaceId;
    busy = true; error = ''; tree = null;
    try {
      if (!await command({ command: 'focus', windowId })) return;
      if (workspace !== workspaceId) return;
      const result = await command({ command: 'read', targetId: windowId });
      if (result?.kind === 'accessibility' && workspace === workspaceId) tree = result.tree;
    } finally { busy = false; }
  }
  async function update(grant: ComputerReplyGrant, enabled: boolean | null | Partial<ComputerReplyGrant>) {
    if (!policy) return;
    const workspace = workspaceId;
    busy = true; error = '';
    try {
      const fresh = await api('autonomy', 'GET', undefined, workspace);
      if (workspace !== workspaceId) return;
      const updated = await api('autonomy', 'PUT', { enabled: fresh.enabled, mode: fresh.mode, policy: { ...fresh.policy, computerReplyGrants: fresh.policy.computerReplyGrants.flatMap((g: ComputerReplyGrant) => g.id !== grant.id ? [g] : enabled === null ? [] : [{ ...g, ...(typeof enabled === 'boolean' ? { enabled } : enabled) }]) } }, workspace);
      if (workspace !== workspaceId) return;
      policy = updated;
      onchange();
    } catch { if (workspace === workspaceId) error = text['computer.command_failed'](); }
    finally { busy = false; }
  }
  async function authorize() {
    if (!valid || !tree || !task) return;
    const selector = (id: string) => { const e = tree!.elements.find(e => e.id === id)!; return { id: e.id, role: e.role, name: e.name }; };
    busy = true;
    try {
      const result = await command({ command: 'authorize_replies', grant: { enabled: true, nodeId, agentId: task.assigneeNodeId, taskId, applicationId: windows.find(w => w.id === windowId)!.appId, recipient: selector(recipientId), composer: selector(composerId), send: selector(sendId), incomingMarker: marker.trim(), maxCharacters: 2000, maxPerHour, memoryEnabled: false, memoryRetentionDays: 365, allowProactive: false, allowForegroundSend: false } });
      if (result) { tree = null; await load(); onchange(); }
    } finally { busy = false; }
  }
  $effect(() => { workspaceId; policy = null; tree = null; tasks = []; windowId = ''; taskId = ''; untrack(() => void load()); return () => { generation++; }; });
</script>

<section class="mt-4 space-y-3 border-t border-[var(--app-border)] pt-3" data-testid="computer-reply-controls">
  <div class="flex items-center gap-2"><ShieldCheck size={14} /><h3 class="flex-1 text-xs font-semibold">{text['computer.reply_title']()}</h3><Button size="icon-sm" variant="ghost" aria-label={text['computer.reply_refresh']()} title={text['computer.reply_refresh']()} disabled={busy} onclick={load}><RefreshCw size={14} /></Button></div>
  {#if error}<p role="alert" class="break-words text-xs text-[var(--app-warning)]">{error}</p>{/if}
  {#if !ready}<p class="text-xs text-[var(--app-warning)]">{text['computer.reply_security_required']()}</p>{/if}
  {#each grants as grant (grant.id)}
    <div class="flex min-w-0 items-center gap-2 border-b border-[var(--app-border)] py-2">
      <div class="min-w-0 flex-1 text-xs"><p class="break-words font-medium">{grant.recipient.name}</p><p class="break-words text-[var(--app-text-muted)]">{tasks.find(t => t.id === grant.taskId)?.assigneeTitle ?? grant.agentId} · {grant.applicationId} · {grant.maxPerHour}/h</p></div>
      <Switch checked={grant.enabled} disabled={busy} aria-label={`${text['computer.reply_title']()} ${grant.recipient.name}`} onCheckedChange={(enabled: boolean) => update(grant, enabled)} />
      <Button size="icon-sm" variant="ghost" disabled={busy} aria-label={text['computer.reply_revoke']()} title={text['computer.reply_revoke']()} onclick={() => update(grant, null)}><Trash2 size={14} /></Button>
    </div>
    <CompanionProfileControls {grant} disabled={busy} update={fields => update(grant, fields)} />
    <ConversationMemoryPanel {grant} disabled={busy} {command} update={fields => update(grant, fields)} />
    <ConversationRecovery {grant} {windows} {command} disabled={busy} />
    <ComputerMediaControls {grant} {windows} {command} disabled={busy} update={fields => update(grant, fields)} />
    <label class="flex items-center justify-between gap-3 text-xs"><span>{text['companion.proactive']()}</span><Switch checked={grant.allowProactive} disabled={busy || !grant.enabled} onCheckedChange={(allowProactive: boolean) => update(grant, { allowProactive })} /></label>
    <label class="flex items-center justify-between gap-3 text-xs"><span>{m['computer.reply_foreground']()}</span><Switch checked={grant.allowForegroundSend} disabled={busy || !grant.enabled} onCheckedChange={(allowForegroundSend: boolean) => update(grant, { allowForegroundSend })} /></label>
    <label class="flex items-center justify-between gap-3 text-xs"><span>{m['computer.reply_navigation']()}</span><Switch checked={grant.allowConversationNavigation} disabled={busy || !grant.enabled || !grant.allowForegroundSend} onCheckedChange={(allowConversationNavigation: boolean) => update(grant, { allowConversationNavigation })} /></label>
  {/each}
  <details class="text-xs"><summary class="cursor-pointer py-2 font-medium">{text['computer.reply_add']()}</summary>
    <div class="space-y-3 py-2">
      <label class="block space-y-1"><span>{m['computer.capture_target']()}</span><Select.Root type="single" value={windowId} onValueChange={(v: string) => { windowId = v; tree = null; recipientId = ''; composerId = ''; sendId = ''; }}><Select.Trigger class="w-full" disabled={busy}><span class="truncate">{windows.find(w => w.id === windowId)?.title ?? m['computer.choose_target']()}</span></Select.Trigger><Select.Content>{#each windows as w}<Select.Item value={w.id}>{w.appName} · {w.title}</Select.Item>{/each}</Select.Content></Select.Root></label>
      <Button size="sm" variant="outline" disabled={busy || !windowId || !ready} onclick={readWindow}><RefreshCw size={13} />{text['computer.reply_read']()}</Button>
      <label class="block space-y-1"><span>{m['computer.watch_task']()}</span><Select.Root type="single" bind:value={taskId}><Select.Trigger class="w-full" disabled={busy}><span class="truncate">{task?.title ?? m['computer.choose_target']()}</span></Select.Trigger><Select.Content>{#each tasks as t}<Select.Item value={t.id}>{t.assigneeTitle} · {t.title}</Select.Item>{/each}</Select.Content></Select.Root></label>
      {#each ['recipient', 'composer', 'send'] as kind}
        {@const value = kind === 'recipient' ? recipientId : kind === 'composer' ? composerId : sendId}
        {@const controls = tree?.elements.filter(e => e.name && !e.protected && (kind === 'composer' ? e.actions.includes('fill') : kind === 'send' ? e.actions.includes('press') && !e.actions.includes('fill') : !e.actions.includes('fill'))) ?? []}
        <label class="block min-w-0 space-y-1"><span>{text[`computer.reply_${kind}`]()}</span><Select.Root type="single" {value} onValueChange={(v: string) => { if (kind === 'recipient') recipientId = v; else if (kind === 'composer') composerId = v; else sendId = v; }}><Select.Trigger class="w-full" disabled={busy || !tree}><span class="truncate">{controls.find(e => e.id === value)?.name ?? m['computer.choose_target']()}</span></Select.Trigger><Select.Content>{#each controls as e}<Select.Item value={e.id}>{e.name.slice(0, 100)} · {e.role} · {e.id}</Select.Item>{/each}</Select.Content></Select.Root></label>
      {/each}
      <label class="block space-y-1"><span>{text['computer.reply_marker']()}</span><Input bind:value={marker} disabled={busy} /></label>
      <label class="block space-y-2"><span>{text['computer.reply_limit']()}: {maxPerHour}</span><Slider type="single" min={1} max={120} step={1} bind:value={maxPerHour} aria-label={text['computer.reply_limit']()} disabled={busy} /></label>
      <Button size="sm" disabled={busy || !valid} onclick={authorize}><Plus size={13} />{text['computer.reply_authorize']()}</Button>
    </div>
  </details>
</section>
