<script lang="ts">
  import { getCsrfToken } from '@beeblock/svelar/http';
  import { toast } from '@beeblock/svelar/ui';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import * as m from '$lib/paraglide/messages.js';

  let { open = $bindable(false), workspaceId, nodeIds }: { open?: boolean; workspaceId: string; nodeIds: string[] } = $props();

  let name = $state('');
  let saving = $state(false);

  async function save() {
    if (!name.trim() || saving) return;
    saving = true;
    const csrf = getCsrfToken();
    const response = await fetch('/api/agent-room/presets', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
      body: JSON.stringify({ workspaceId, name: name.trim(), nodeIds }),
    }).catch(() => null);
    saving = false;
    if (response?.ok) {
      toast.success(m['scores.saved']({ name: name.trim() }));
      window.dispatchEvent(new CustomEvent('orkestrai:scores-changed'));
      name = '';
      open = false;
    } else {
      const body = response ? await response.json().catch(() => null) : null;
      toast.error(body?.error ?? m['scores.save_failed']());
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-w-md">
    <Dialog.Header>
      <Dialog.Title>{m['scores.save_title']()}</Dialog.Title>
      <Dialog.Description>{m['scores.save_body']({ count: nodeIds.length })}</Dialog.Description>
    </Dialog.Header>
    <form class="grid gap-3" onsubmit={(event) => { event.preventDefault(); void save(); }}>
      <Input bind:value={name} placeholder={m['scores.name_placeholder']()} aria-label={m['scores.name_label']()} />
      <Dialog.Footer>
        <Button type="button" variant="ghost" onclick={() => (open = false)}>{m['always_on.cancel']()}</Button>
        <Button type="submit" disabled={!name.trim() || saving}>{m['scores.save']()}</Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
