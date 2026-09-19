<script lang="ts">
  import { ChevronsUpDown } from '@lucide/svelte';
  import { tick, untrack } from 'svelte';
  import * as m from '$lib/paraglide/messages.js';
  import { Button } from '$lib/components/ui/button';
  import * as Command from '$lib/components/ui/command';
  import * as Popover from '$lib/components/ui/popover';

  type ModelOption = { value: string; label: string };

  type Props = {
    value: string;
    options: ModelOption[];
    defaultLabel: string;
    searchPlaceholder: string;
    emptyLabel: string;
    ariaLabel: string;
    onValueChange: (value: string) => void;
    fieldProps?: Record<string, unknown>;
    details?: Record<string, string>;
    onVisibleOptionsChange?: (ids: string[]) => void;
  };

  let { value, options, defaultLabel, searchPlaceholder, emptyLabel, ariaLabel, onValueChange, fieldProps = {}, details = {}, onVisibleOptionsChange }: Props = $props();
  let open = $state(false);
  let query = $state(''), limit = $state(50);
  const filtered = $derived(options.filter(option => `${option.label} ${option.value}`.toLowerCase().includes(query.toLowerCase())));
  const visible = $derived(onVisibleOptionsChange ? filtered.slice(0, limit) : filtered);
  $effect(() => { query; open; limit = 50; });
  $effect(() => {
    if (!open || !onVisibleOptionsChange) return;
    const ids = visible.map(option => option.value);
    const timer = setTimeout(() => untrack(() => onVisibleOptionsChange?.(ids)), 250);
    return () => clearTimeout(timer);
  });
  let triggerRef = $state<HTMLButtonElement>(null!);

  const currentLabel = $derived(options.find((option) => option.value === value)?.label ?? (value || defaultLabel));

  async function choose(next: string) {
    onValueChange(next === '__default__' ? '' : next);
    open = false;
    await tick();
    triggerRef.focus();
  }
</script>

<Popover.Root bind:open>
  <Popover.Trigger bind:ref={triggerRef}>
    {#snippet child({ props })}
      <Button
        {...fieldProps}
        {...props}
        variant="outline"
        class="w-full min-w-0 justify-between"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
      >
        <span class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{currentLabel}</span>
        <ChevronsUpDown class="size-3.5 shrink-0 opacity-50" aria-hidden="true" />
      </Button>
    {/snippet}
  </Popover.Trigger>
  <Popover.Content
    side="bottom"
    align="start"
    sideOffset={6}
    collisionPadding={12}
    avoidCollisions={true}
    class="w-(--bits-popover-anchor-width) min-w-[min(260px,calc(100vw-24px))] max-w-[calc(100vw-24px)] max-h-(--bits-popover-content-available-height) overflow-hidden p-0!"
  >
    <Command.Root value={value || '__default__'} shouldFilter={false} class="h-auto min-h-0 min-w-0">
      <Command.Input bind:value={query} placeholder={searchPlaceholder} autofocus />
      <Command.List class="min-h-0">
        <Command.Empty>{emptyLabel}</Command.Empty>
        <Command.Group value="models">
          <Command.Item value="__default__" keywords={[defaultLabel]} onSelect={() => choose('__default__')}>
            {defaultLabel}
          </Command.Item>
          {#each visible as option (option.value)}
            <Command.Item value={option.value} keywords={[option.label]} onSelect={() => choose(option.value)}>
              <span class="min-w-0 flex-1"><span class="block truncate">{option.label}</span>{#if details[option.value]}<span class="block whitespace-normal break-words text-xs text-[var(--app-text-muted)]">{details[option.value]}</span>{/if}</span>
            </Command.Item>
          {/each}
        </Command.Group>
      </Command.List>
      {#if visible.length < filtered.length}<Button size="sm" variant="ghost" onclick={() => limit += 50}>{m['creative.more_models']({ count: filtered.length - visible.length })}</Button>{/if}
    </Command.Root>
  </Popover.Content>
</Popover.Root>
