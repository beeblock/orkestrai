<script lang="ts">
  import { untrack } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { X } from '@lucide/svelte';
  import CreativeModelParameter from './CreativeModelParameter.svelte';
  import type { ModelSchema } from '$lib/modules/creative-media/domain/model-contract.js';
  import * as m from '$lib/paraglide/messages.js';

  let { schema, value, managedPointers = [], onChange, onValidityChange }: { schema: ModelSchema; value: Record<string, unknown>; managedPointers?: string[]; onChange: (value: Record<string, unknown>) => void; onValidityChange: (valid: boolean) => void } = $props();
  let errors = $state<Record<string, boolean>>({});
  const fields = $derived(Object.entries(schema.properties ?? {}).filter(([name]) => !['prompt', 'text_prompt', 'sync_mode'].includes(name)));
  const unknown = $derived(Object.keys(value).filter(name => !schema.properties?.[name] && schema.additionalProperties === false));
  const primary = new Set(['duration', 'resolution', 'aspect_ratio', 'generate_audio', 'prompt_expansion_mode']);
  $effect(() => { const valid = unknown.length === 0 && !Object.values(errors).some(Boolean); untrack(() => onValidityChange(valid)); });
  function set(name: string, next: unknown) {
    const output = { ...value };
    if (next === undefined) delete output[name]; else output[name] = next;
    onChange(output);
  }
  function check(name: string, valid: boolean) { if (errors[name] !== !valid) errors = { ...errors, [name]: !valid }; }
</script>

{#snippet field(name: string, spec: ModelSchema)}
  <CreativeModelParameter {name} schema={spec} value={value[name]} pointer={`/${name}`} required={schema.required?.includes(name)} {managedPointers} onChange={(next) => set(name, next)} onValidityChange={(valid) => check(name, valid)} />
{/snippet}

<div class="space-y-3">
  {#each unknown as name}<div class="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400"><p class="min-w-0 flex-1 break-all" role="alert">{m['creative.unsupported_parameter']({ name })}</p><Button size="icon-sm" variant="ghost" aria-label={m['creative.reset_parameter']()} onclick={() => set(name, undefined)}><X size={12} /></Button></div>{/each}
  {#each fields.filter(([name]) => primary.has(name) || schema.required?.includes(name)) as [name, spec] (name)}{@render field(name, spec)}{/each}
  {#if fields.some(([name]) => !primary.has(name) && !schema.required?.includes(name))}
    <details class="border-t border-[var(--app-border)] pt-2"><summary class="cursor-pointer py-1 text-xs font-medium">{m['creative.model_parameters']()}</summary><div class="space-y-3 py-3">{#each fields.filter(([name]) => !primary.has(name) && !schema.required?.includes(name)) as [name, spec] (name)}{@render field(name, spec)}{/each}</div></details>
  {/if}
</div>
