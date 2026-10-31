<script lang="ts">
  import { onMount } from 'svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Select from '$lib/components/ui/select';
  import { Button } from '$lib/components/ui/button';
  import { Label } from '$lib/components/ui/label';
  import { Textarea } from '$lib/components/ui/textarea';
  import { LoaderCircle, UsersRound } from '@lucide/svelte';
  import { getCsrfToken } from '@beeblock/svelar/http';
  import { toast } from '@beeblock/svelar/ui';
  import type { LeadershipSnapshot } from '$lib/modules/agent-room/contracts/schemas/leadership.schema.js';
  import * as m from '$lib/paraglide/messages.js';
  let { workspaceId, onClose }: { workspaceId: string; onClose: () => void } = $props();
  let snapshot = $state<LeadershipSnapshot | null>(null);
  let leader = $state('');
  let deputy = $state('__none__');
  let note = $state('');
  let loading = $state(true);
  let saving = $state(false);
  let error = $state('');
  let requestId = crypto.randomUUID();
  let requestSignature = '';
  let generation = 0;
  const valid = $derived(Boolean(leader) && leader !== deputy);
  async function load() {
    const current = ++generation;
    loading = true; error = '';
    try {
      const response = await fetch(`/api/agent-room/workspaces/${workspaceId}/leadership`);
      const result = await response.json();
      if (!response.ok || !result.data) throw new Error();
      if (current !== generation) return;
      snapshot = result.data;
      leader = snapshot!.configuration.leaderNodeId ?? '';
      deputy = snapshot!.configuration.deputyNodeId ?? '__none__';
      requestId = crypto.randomUUID();
    } catch { if (current === generation) error = m['leadership.error'](); }
    finally { if (current === generation) loading = false; }
  }
  async function save() {
    if (!snapshot || !valid || saving) return;
    const current = generation;
    const signature = JSON.stringify([snapshot.configuration.revision, leader, deputy, note]);
    if (signature !== requestSignature) { requestSignature = signature; requestId = crypto.randomUUID(); }
    saving = true; error = '';
    try {
      const response = await fetch(`/api/agent-room/workspaces/${workspaceId}/leadership`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': getCsrfToken() ?? '' }, body: JSON.stringify({ command: 'configure', requestId, expectedRevision: snapshot.configuration.revision, leaderNodeId: leader, deputyNodeId: deputy === '__none__' ? null : deputy, note: note || undefined }) });
      const result = await response.json();
      if (current !== generation) return;
      if (!response.ok) { error = response.status === 409 ? m['leadership.stale']() : m['leadership.error'](); return; }
      toast.success(m['leadership.saved']());
      onClose();
    } catch { if (current === generation) error = m['leadership.error'](); }
    finally { if (current === generation) saving = false; }
  }
  onMount(() => { void load(); return () => { generation++; }; });
</script>
<Dialog.Root open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
  <Dialog.Content class="sm:max-w-lg" onInteractOutside={(event: Event) => { if (saving) event.preventDefault(); }}>
    <Dialog.Header>
      <Dialog.Title class="flex items-center gap-2"><UsersRound size={18} />{m['leadership.title']()}</Dialog.Title>
      <Dialog.Description>{m['leadership.description']()}</Dialog.Description>
    </Dialog.Header>
    {#if loading}<p class="flex items-center gap-2 py-6 text-sm text-muted-foreground" role="status"><LoaderCircle class="animate-spin" size={16}/>{m['leadership.loading']()}</p>
    {:else if snapshot}
      <div class="grid gap-5 py-2">
        <div class="grid gap-2">
          <Label for="leadership-primary">{m['leadership.leader']()}</Label>
          <Select.Root type="single" bind:value={leader} disabled={saving}>
            <Select.Trigger id="leadership-primary" class="w-full"><span class="truncate">{snapshot.agents.find((agent) => agent.id === leader)?.title ?? m['leadership.leader']()}</span></Select.Trigger>
            <Select.Content>{#each snapshot.agents as agent (agent.id)}<Select.Item value={agent.id} label={agent.title}>{agent.title} <span class="text-muted-foreground">· {agent.provider}</span></Select.Item>{/each}</Select.Content>
          </Select.Root>
        </div>
        <div class="grid gap-2">
          <Label for="leadership-deputy">{m['leadership.deputy']()}</Label>
          <Select.Root type="single" bind:value={deputy} disabled={saving}>
            <Select.Trigger id="leadership-deputy" class="w-full"><span class="truncate">{snapshot.agents.find((agent) => agent.id === deputy)?.title ?? m['leadership.none']()}</span></Select.Trigger>
            <Select.Content><Select.Item value="__none__" label={m['leadership.none']()}>{m['leadership.none']()}</Select.Item>{#each snapshot.agents as agent (agent.id)}<Select.Item value={agent.id} label={agent.title} disabled={agent.id === leader}>{agent.title} <span class="text-muted-foreground">· {agent.provider}</span></Select.Item>{/each}</Select.Content>
          </Select.Root>
          <p class="text-xs leading-relaxed text-muted-foreground">{m['leadership.role_description']()}</p>
        </div>
        <div class="grid gap-2"><Label for="leadership-note">{m['leadership.note']()}</Label><Textarea id="leadership-note" bind:value={note} maxlength={8000} rows={3} disabled={saving} /></div>
        {#if leader === deputy}<p class="text-sm text-destructive" role="alert">{m['leadership.distinct']()}</p>{/if}
        {#if snapshot.handoffs[0]}<p class="text-xs text-muted-foreground">{snapshot.handoffs[0].status === 'acknowledged' ? m['leadership.handoff_acknowledged']() : m['leadership.handoff_pending']()}</p>{/if}
      </div>
    {/if}
    {#if error}<p role="alert" class="text-sm text-destructive">{error}</p>{/if}
    <Dialog.Footer>
      <Button variant="outline" disabled={loading || saving} onclick={load}>{m['leadership.retry']()}</Button>
      <Button disabled={loading || saving || !snapshot || !valid} onclick={save}>{#if saving}<LoaderCircle size={15} class="animate-spin" />{/if}{saving ? m['leadership.saving']() : m['leadership.save']()}</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
