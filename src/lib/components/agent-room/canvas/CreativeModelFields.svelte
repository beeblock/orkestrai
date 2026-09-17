<script lang="ts">
  import { Input } from '$lib/components/ui/input';
  import { Textarea } from '$lib/components/ui/textarea';
  import { Switch } from '$lib/components/ui/switch';
  import * as NativeSelect from '$lib/components/ui/native-select';
  import { Button } from '$lib/components/ui/button';
  import { X } from '@lucide/svelte';
  import ApiCodeEditor from './ApiCodeEditor.svelte';
  import { concreteSchema, type ModelSchema } from '$lib/modules/creative-media/domain/model-contract.js';
  import * as m from '$lib/paraglide/messages.js';

  let { schema, value, managedPointers = [], onChange, onValidityChange }: { schema: ModelSchema; value: Record<string, unknown>; managedPointers?: string[]; onChange: (value: Record<string, unknown>) => void; onValidityChange: (valid: boolean) => void } = $props();
  let invalid = $state<string[]>([]);
  const controlPrefix = $props.id();
  const fields = $derived(Object.entries(schema.properties ?? {}).filter(([name]) => !['prompt', 'text_prompt', 'sync_mode'].includes(name)));
  const primary = new Set(['duration', 'resolution', 'aspect_ratio', 'generate_audio', 'image_url', 'start_image_url', 'end_image_url', 'image_urls', 'video_url', 'audio_url']);
  const managed = $derived(new Set(managedPointers.map(pointer => pointer.split('/')[1]).filter(Boolean)));
  function label(name: string) {
    const labels: Record<string, () => string> = { duration: m['creative.duration'], resolution: m['creative.resolution'], aspect_ratio: m['creative.ratio'], generate_audio: m['creative.audio'], seed: m['creative.seed'], negative_prompt: m['creative.negative_prompt'], start_image_url: m['creative.start_image'], end_image_url: m['creative.end_image'] };
    return labels[name]?.() ?? name;
  }
  function set(name: string, next: unknown) {
    const output = { ...value };
    if (next === undefined) delete output[name]; else output[name] = next;
    onChange(output);
  }
  function json(name: string, source: string) {
    try { set(name, source.trim() ? JSON.parse(source) : undefined); invalid = invalid.filter(key => key !== name); }
    catch { if (!invalid.includes(name)) invalid = [...invalid, name]; }
    onValidityChange(invalid.length === 0);
  }
</script>

{#snippet field(name: string, original: ModelSchema)}
  {@const spec = concreteSchema(original)}
  {@const choices = original.enum ?? spec.enum}
  {@const required = schema.required?.includes(name)}
  {@const controlId = `${controlPrefix}-creative-param-${name}`}
  <div class="min-w-0 space-y-1.5 text-xs">
    <div class="flex min-w-0 items-center justify-between gap-2"><label for={controlId} class="break-words" title={name}>{label(name)}{required ? ' *' : ''}</label>{#if !required && value[name] !== undefined}<Button size="icon-sm" variant="ghost" title={m['creative.reset_parameter']()} aria-label={m['creative.reset_parameter']()} onclick={() => { set(name, undefined); invalid = invalid.filter(key => key !== name); onValidityChange(invalid.length === 0); }}><X size={12} /></Button>{/if}</div>
    {#if managed.has(name) && (spec.type === 'string' || (spec.type === 'array' && concreteSchema(spec.items ?? {}).type === 'string')) && value[name] === undefined && !invalid.includes(name)}
      <p class="text-[var(--app-text-muted)]">{m['creative.reference_supplied']()}</p>
    {:else if choices && choices.every(item => ['string', 'number', 'boolean'].includes(typeof item))}
      <NativeSelect.Root id={controlId} value={value[name] === undefined ? '' : JSON.stringify(value[name])} onchange={(event: Event & { currentTarget: HTMLSelectElement }) => set(name, event.currentTarget.value ? JSON.parse(event.currentTarget.value) : undefined)}><option value="">{m['creative.default_parameter']()}</option>{#each choices as choice}<option value={JSON.stringify(choice)}>{String(choice)}</option>{/each}</NativeSelect.Root>
    {:else if spec.type === 'boolean'}
      <Switch id={controlId} checked={value[name] === true} onCheckedChange={(checked: boolean) => set(name, checked)} />
    {:else if spec.type === 'number' || spec.type === 'integer'}
      <Input id={controlId} type="number" value={value[name] as number ?? ''} min={spec.minimum} max={spec.maximum} step={spec.type === 'integer' ? 1 : 'any'} oninput={(event: Event & { currentTarget: HTMLInputElement }) => set(name, event.currentTarget.value === '' ? undefined : Number(event.currentTarget.value))} />
    {:else if spec.type === 'string'}
      <Textarea id={controlId} class="min-h-10 resize-y font-mono text-xs" value={String(value[name] ?? '')} maxlength={Math.min(spec.maxLength ?? 50000, 50000)} oninput={(event: Event & { currentTarget: HTMLTextAreaElement }) => set(name, event.currentTarget.value || undefined)} />
    {:else}
      <div class="h-40 min-w-0"><ApiCodeEditor value={value[name] === undefined ? '' : JSON.stringify(value[name], null, 2)} language="json" label={name} minHeight={90} onchange={(source) => json(name, source)} /></div>
      {#if invalid.includes(name)}<p role="alert" class="text-destructive">{m['creative.invalid_json']()}</p>{/if}
      <details><summary class="cursor-pointer text-[var(--app-text-muted)]">{m['creative.parameter_schema']()}</summary><pre class="max-h-48 overflow-auto whitespace-pre-wrap break-all p-2 text-xs">{JSON.stringify(spec, null, 2)}</pre></details>
    {/if}
  </div>
{/snippet}

<div class="space-y-3">
  {#each fields.filter(([name]) => primary.has(name) || schema.required?.includes(name)) as [name, spec] (name)}{@render field(name, spec)}{/each}
  {#if fields.some(([name]) => !primary.has(name) && !schema.required?.includes(name))}
    <details class="border-t border-[var(--app-border)] pt-2"><summary class="cursor-pointer py-1 text-xs font-medium">{m['creative.model_parameters']()}</summary><div class="space-y-3 py-3">{#each fields.filter(([name]) => !primary.has(name) && !schema.required?.includes(name)) as [name, spec] (name)}{@render field(name, spec)}{/each}</div></details>
  {/if}
</div>
