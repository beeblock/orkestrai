<script lang="ts">
  import { tick } from 'svelte';
  import { Check, ChevronsUpDown } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Command from '$lib/components/ui/command';
  import * as Popover from '$lib/components/ui/popover';

  let {
    value,
    options,
    emptyValue = '',
    emptyLabel,
    searchPlaceholder,
    noResultsLabel,
    ariaLabel,
    onValueChange,
  }: {
    value: string;
    options: Array<{ value: string; label: string }>;
    emptyValue?: string;
    emptyLabel: string;
    searchPlaceholder: string;
    noResultsLabel: string;
    ariaLabel: string;
    onValueChange: (value: string) => void;
  } = $props();

  let open = $state(false);
  let trigger = $state<HTMLButtonElement>(null!);
  const currentLabel = $derived(options.find((option) => option.value === value)?.label ?? emptyLabel);

  async function choose(next: string) {
    onValueChange(next);
    open = false;
    await tick();
    trigger.focus();
  }
</script>

<Popover.Root bind:open>
  <Popover.Trigger bind:ref={trigger}>
    {#snippet child({ props })}
      <Button {...props} variant="outline" size="sm" class="h-8 w-full min-w-0 justify-between gap-2 px-2 text-ui-xs" role="combobox" aria-label={ariaLabel} aria-expanded={open}>
        <span class="min-w-0 flex-1 truncate text-left">{currentLabel}</span>
        <ChevronsUpDown size={12} class="shrink-0 opacity-50" />
      </Button>
    {/snippet}
  </Popover.Trigger>
  <Popover.Content align="start" sideOffset={5} class="z-[150] w-(--bits-popover-anchor-width) min-w-60 overflow-hidden p-0!">
    <Command.Root value={value || emptyValue} class="h-auto min-w-0">
      <Command.Input placeholder={searchPlaceholder} autofocus />
      <Command.List class="max-h-64">
        <Command.Empty>{noResultsLabel}</Command.Empty>
        <Command.Group value="design-variables">
          <Command.Item value={emptyValue || '__empty__'} keywords={[emptyLabel]} onSelect={() => choose(emptyValue)}>
            <Check size={12} class={value === emptyValue ? 'opacity-100' : 'opacity-0'} />
            <span class="truncate">{emptyLabel}</span>
          </Command.Item>
          {#each options as option (option.value)}
            <Command.Item value={option.value} keywords={[option.label]} onSelect={() => choose(option.value)}>
              <Check size={12} class={value === option.value ? 'opacity-100' : 'opacity-0'} />
              <span class="truncate">{option.label}</span>
            </Command.Item>
          {/each}
        </Command.Group>
      </Command.List>
    </Command.Root>
  </Popover.Content>
</Popover.Root>
