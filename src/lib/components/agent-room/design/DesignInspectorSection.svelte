<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import { ChevronDown } from '@lucide/svelte';
  import * as Collapsible from '$lib/components/ui/collapsible';

  let {
    id,
    title,
    meta,
    actions,
    children,
    defaultOpen = true,
  }: {
    id: string;
    title: string;
    /** Resumo curto ao lado do titulo (valor atual, contagem) para ler sem abrir. */
    meta?: string;
    actions?: Snippet;
    children: Snippet;
    defaultOpen?: boolean;
  } = $props();

  /**
   * Lido na inicializacao, nao no onMount: comecar sempre aberto e corrigir
   * depois fazia toda secao com defaultOpen={false} piscar aberta a cada
   * montagem do inspector.
   */
  function storedOpen(): boolean {
    if (typeof localStorage === 'undefined') return defaultOpen;
    try {
      const saved = localStorage.getItem(`orkestrai:design-inspector:${id}`);
      return saved === null ? defaultOpen : saved === '1';
    } catch {
      return defaultOpen;
    }
  }

  let open = $state(storedOpen());
  let restored = $state(false);

  onMount(() => {
    restored = true;
  });

  $effect(() => {
    if (restored) localStorage.setItem(`orkestrai:design-inspector:${id}`, open ? '1' : '0');
  });
</script>

<!-- Cabecalho de 32px e conteudo com linhas de 28px espacadas 6px: o mesmo
     ritmo em todas as secoes do inspector, abertas ou recolhidas. -->
<Collapsible.Root bind:open class="border-b border-[var(--app-border)]">
  <div class="flex h-8 items-center gap-1 pr-2 pl-1.5">
    <Collapsible.Trigger class="group/section flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 text-left text-ui-sm font-semibold text-[var(--app-text)] outline-none transition-colors duration-150 hover:bg-[var(--app-hover)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--app-accent)]">
      <ChevronDown size={12} class={`shrink-0 text-[var(--app-text-muted)] transition-transform duration-150 ease-out group-hover/section:text-[var(--app-text-soft)] ${open ? '' : '-rotate-90'}`} />
      <span class="truncate">{title}</span>
      {#if meta}<span class="ml-auto shrink-0 truncate pl-2 text-ui-xs font-normal tabular-nums text-[var(--app-text-muted)]">{meta}</span>{/if}
    </Collapsible.Trigger>
    {#if actions}<div class="flex shrink-0 items-center gap-0.5">{@render actions()}</div>{/if}
  </div>
  <Collapsible.Content class="space-y-1.5 px-3 pb-3 empty:hidden">
    {@render children()}
  </Collapsible.Content>
</Collapsible.Root>
