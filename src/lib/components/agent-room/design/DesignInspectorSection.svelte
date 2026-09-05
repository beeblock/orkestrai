<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import { ChevronDown } from '@lucide/svelte';
  import * as Collapsible from '$lib/components/ui/collapsible';

  let {
    id,
    title,
    actions,
    children,
    defaultOpen = true,
  }: {
    id: string;
    title: string;
    actions?: Snippet;
    children: Snippet;
    defaultOpen?: boolean;
  } = $props();

  let open = $state(true);
  let restored = $state(false);

  onMount(() => {
    const saved = localStorage.getItem(`orkestrai:design-inspector:${id}`);
    open = saved === null ? defaultOpen : saved === '1';
    restored = true;
  });

  $effect(() => {
    if (restored) localStorage.setItem(`orkestrai:design-inspector:${id}`, open ? '1' : '0');
  });
</script>

<Collapsible.Root bind:open class="border-b border-[var(--app-border)]">
  <div class="flex h-9 items-center gap-1 px-2.5">
    <Collapsible.Trigger class="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[11px] font-semibold text-[var(--app-text-soft)]">
      <ChevronDown size={12} class={`shrink-0 transition-transform ${open ? '' : '-rotate-90'}`} />
      <span class="truncate">{title}</span>
    </Collapsible.Trigger>
    {#if actions}{@render actions()}{/if}
  </div>
  <Collapsible.Content class="px-3 pb-3">
    {@render children()}
  </Collapsible.Content>
</Collapsible.Root>
