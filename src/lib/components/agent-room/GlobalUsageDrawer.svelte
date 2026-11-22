<script lang="ts">
  import { onMount } from 'svelte';
  import * as Sheet from '$lib/components/ui/sheet';
  import UsagePanel from './canvas/UsagePanel.svelte';
  import { workspaceContext } from './workspace-context.svelte.js';
  import * as m from '$lib/paraglide/messages.js';

  let open = $state(false), workspaceId = $state<string | null>(null);
  onMount(() => {
    const show = (event: Event) => {
      const detail = (event as CustomEvent<{ workspaceId?: string | null }>).detail;
      workspaceId = detail?.workspaceId ?? workspaceContext.workspaceId;
      open = true;
    };
    window.addEventListener('orkestrai:open-usage', show);
    return () => window.removeEventListener('orkestrai:open-usage', show);
  });
</script>

<Sheet.Root bind:open>
  <Sheet.Content side="right" showCloseButton={false} class="gap-0 overflow-hidden p-0" data-testid="global-usage-drawer">
    <Sheet.Title class="sr-only">{m['usage.title']()}</Sheet.Title>
    <Sheet.Description class="sr-only">{m['usage.title']()}</Sheet.Description>
    {#if open}<UsagePanel {workspaceId} embedded onClose={() => (open = false)} />{/if}
  </Sheet.Content>
</Sheet.Root>
