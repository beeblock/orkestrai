<script lang="ts">
  import { untrack } from 'svelte';
  import { Input } from '$lib/components/ui/input';
  import { Textarea } from '$lib/components/ui/textarea';
  import { Switch } from '$lib/components/ui/switch';
  import * as NativeSelect from '$lib/components/ui/native-select';
  import { Button } from '$lib/components/ui/button';
  import { Code, Plus, Trash2, X } from '@lucide/svelte';
  import ApiCodeEditor from './ApiCodeEditor.svelte';
  import CreativeModelParameter from './CreativeModelParameter.svelte';
  import { concreteSchema, type ModelSchema } from '$lib/modules/creative-media/domain/model-contract.js';
  import * as m from '$lib/paraglide/messages.js';
  import { mediaSlotLabel } from '../creative-media-presentation.js';

  let { name, schema, value, pointer, required = false, managedPointers = [], depth = 0, onChange, onValidityChange }: {
    name: string; schema: ModelSchema; value: unknown; pointer: string; required?: boolean; managedPointers?: string[]; depth?: number;
    onChange: (value: unknown) => void; onValidityChange: (valid: boolean) => void;
  } = $props();
  const prefix = $props.id();
  const id = $derived(`${prefix}-creative-param-${name}`);
  const spec = $derived(concreteSchema(schema));
  const effective = $derived(value === undefined ? spec.default : value);
  const choices = $derived(spec.enum?.filter(item => item === null || ['string', 'number', 'boolean'].includes(typeof item)));
  const examples = $derived((spec.examples ?? []).filter(item => typeof item === 'string' && item.length <= 120) as string[]);
  const managed = $derived(managedPointers.includes(pointer));
  const hasManaged = $derived(managedPointers.some(path => path === pointer || path.startsWith(`${pointer}/`)));
  const object = $derived(effective && typeof effective === 'object' && !Array.isArray(effective) ? effective as Record<string, unknown> : {});
  const items = $derived(Array.isArray(effective) ? effective : []);
  const boundCount = $derived(Math.max(0, ...managedPointers.filter(path => path.startsWith(`${pointer}/`)).map(path => Number(path.slice(pointer.length + 1).split('/')[0]) + 1).filter(Number.isFinite)));
  const count = $derived(Math.min(50, Math.max(items.length, boundCount)));
  let raw = $state(false), invalidJson = $state(false), childErrors = $state<Record<string, boolean>>({});
  const enumMismatch = $derived(value !== undefined && Boolean(spec.enum && !spec.enum.some(choice => JSON.stringify(choice) === JSON.stringify(value))));
  const valid = $derived(!invalidJson && !enumMismatch && !Object.values(childErrors).some(Boolean));
  $effect(() => { const next = valid; untrack(() => onValidityChange(next)); });
  const labels: Record<string, () => string> = {
    duration: m['creative.duration'], resolution: m['creative.resolution'], aspect_ratio: m['creative.ratio'], generate_audio: m['creative.audio'],
    seed: m['creative.seed'], negative_prompt: m['creative.negative_prompt'], start_image_url: m['creative.start_image'], end_image_url: m['creative.end_image'], prompt_expansion_mode: m['creative.prompt_expansion'],
    ratio: m['creative.ratio'], first_image_url: m['creative.start_image'], last_image_url: m['creative.end_image'],
    image_urls: m['creative.reference_images'], video_urls: m['creative.reference_videos'], audio_urls: m['creative.reference_audio'],
    watermark: m['creative.watermark'], return_last_frame: m['creative.return_last_frame'], output_format: m['creative.output_format'],
  };
  const label = $derived(/(?:image|video|audio|voice|mask|reference|file|frame).*url/i.test(pointer)
    ? mediaSlotLabel(pointer) : labels[name]?.() ?? spec.title ?? name);
  function change(next: unknown) { invalidJson = false; onChange(next); }
  function json(source: string) {
    try { change(source.trim() ? JSON.parse(source) : undefined); }
    catch { invalidJson = true; }
  }
  function child(key: string, next: unknown) {
    const output = { ...object };
    if (next === undefined) delete output[key]; else output[key] = next;
    change(output);
  }
  function item(index: number, next: unknown) {
    const output = Array.from({ length: Math.max(count, index + 1) }, (_, i) => items[i] ?? null);
    output[index] = next ?? null; change(output);
  }
  function check(key: string, valid: boolean) {
    if (childErrors[key] !== !valid) childErrors = { ...childErrors, [key]: !valid };
  }
</script>

<div class="min-w-0 space-y-1.5 text-xs" data-model-parameter={pointer}>
  <div class="flex min-w-0 items-center justify-between gap-2">
    <label for={id} class="min-w-0 break-words font-medium" title={name}>{label}{required ? ' *' : ''}</label>
    <div class="flex shrink-0 items-center gap-1">
      {#if !hasManaged}<Button size="icon-sm" variant="ghost" aria-label={m['creative.parameter_json']({ name: label })} title={m['creative.parameter_json']({ name: label })} aria-pressed={raw} onclick={() => { raw = !raw; invalidJson = false; childErrors = {}; }}><Code size={13} /></Button>{/if}
      {#if !required && value !== undefined && !hasManaged}<Button size="icon-sm" variant="ghost" title={m['creative.reset_parameter']()} aria-label={m['creative.reset_parameter']()} onclick={() => { childErrors = {}; change(undefined); }}><X size={12} /></Button>{/if}
    </div>
  </div>
  {#if spec.description}<p id={`${id}-help`} class="whitespace-pre-wrap break-words text-[var(--app-text-muted)]">{spec.description}</p>{/if}
  {#if managed}
    <p class="text-[var(--app-text-muted)]">{m['creative.reference_supplied']()}</p>
  {:else if raw || depth > 6 || spec.anyOf || spec.oneOf || spec.allOf || (spec.type === 'object' && (!spec.properties || spec.additionalProperties)) || (spec.type === 'array' && (!spec.items || items.length > 50)) || !spec.type}
    <div class="h-40 min-w-0"><ApiCodeEditor value={value === undefined ? '' : JSON.stringify(value, null, 2)} language="json" label={label} minHeight={90} onchange={json} /></div>
    {#if invalidJson}<p role="alert" class="text-destructive">{m['creative.invalid_json']()}</p>{/if}
    <details><summary class="cursor-pointer text-[var(--app-text-muted)]">{m['creative.parameter_schema']()}</summary><pre class="max-h-48 overflow-auto whitespace-pre-wrap break-all p-2 text-xs">{JSON.stringify(schema, null, 2)}</pre></details>
  {:else if choices?.length && choices.length === spec.enum?.length}
    <NativeSelect.Root id={id} aria-describedby={`${id}-help`} value={value === undefined ? '' : JSON.stringify(value)} onchange={(event: Event & { currentTarget: HTMLSelectElement }) => change(event.currentTarget.value ? JSON.parse(event.currentTarget.value) : undefined)}>
      <option value="">{m['creative.default_parameter']()}{spec.default !== undefined ? ` (${JSON.stringify(spec.default)})` : ''}</option>
      {#each choices as choice}<option value={JSON.stringify(choice)}>{String(choice)}</option>{/each}
      {#if value !== undefined && !choices.some(choice => choice === value)}<option value={JSON.stringify(value)}>{String(value)}</option>{/if}
    </NativeSelect.Root>
  {:else if spec.type === 'boolean'}
    <Switch id={id} aria-describedby={`${id}-help`} checked={effective === true} onCheckedChange={(checked: boolean) => change(checked)} />
  {:else if spec.type === 'number' || spec.type === 'integer'}
    <Input id={id} aria-describedby={`${id}-help`} type="number" value={value as number ?? ''} placeholder={spec.default === undefined ? '' : String(spec.default)} min={spec.minimum} max={spec.maximum} step={typeof spec.multipleOf === 'number' ? spec.multipleOf : spec.type === 'integer' ? 1 : 'any'} oninput={(event: Event & { currentTarget: HTMLInputElement }) => change(event.currentTarget.value === '' ? undefined : Number(event.currentTarget.value))} />
  {:else if spec.type === 'string'}
    {#if examples.length}
      <NativeSelect.Root aria-label={m['creative.parameter_examples']({ name: label })} value={examples.includes(String(effective)) ? String(effective) : ''} onchange={(event: Event & { currentTarget: HTMLSelectElement }) => { if (event.currentTarget.value) change(event.currentTarget.value); }}>
        <option value="">{m['creative.custom_parameter']()}</option>{#each [...new Set(examples)] as example}<option value={example}>{example}</option>{/each}
      </NativeSelect.Root>
    {/if}
    <Textarea id={id} aria-describedby={`${id}-help`} class="min-h-10 resize-y font-mono text-xs" value={String(value ?? '')} placeholder={typeof spec.default === 'string' ? spec.default : ''} maxlength={Math.min(spec.maxLength ?? 50000, 50000)} oninput={(event: Event & { currentTarget: HTMLTextAreaElement }) => change(event.currentTarget.value || undefined)} />
  {:else if spec.type === 'object'}
    <div class="space-y-3 border-l-2 border-[var(--app-border)] pl-3">
      {#each Object.entries(spec.properties ?? {}) as [key, field] (key)}
        <CreativeModelParameter name={key} schema={field} value={object[key]} pointer={`${pointer}/${key}`} required={spec.required?.includes(key)} {managedPointers} depth={depth + 1} onChange={(next) => child(key, next)} onValidityChange={(valid) => check(key, valid)} />
      {/each}
      {#each Object.keys(object).filter(key => !spec.properties?.[key]) as key}<p class="break-all text-amber-600">{m['creative.unsupported_parameter']({ name: key })}</p>{/each}
    </div>
  {:else if spec.type === 'array'}
    <div class="space-y-3 border-l-2 border-[var(--app-border)] pl-3">
      {#each Array.from({ length: count }) as _, index (index)}
        <div class="min-w-0 space-y-1">
          <CreativeModelParameter name={`${name} [${index + 1}]`} schema={spec.items!} value={items[index]} pointer={`${pointer}/${index}`} {managedPointers} depth={depth + 1} onChange={(next) => item(index, next)} onValidityChange={(valid) => check(String(index), valid)} />
          <Button size="sm" variant="ghost" disabled={hasManaged || items.length <= (spec.minItems ?? 0)} aria-label={m['creative.remove_parameter_item']({ index: index + 1 })} onclick={() => { childErrors = {}; change(items.filter((_, i) => i !== index)); }}><Trash2 size={13} />{m['creative.delete']()}</Button>
        </div>
      {/each}
      <Button size="sm" variant="outline" disabled={count >= Math.min(spec.maxItems ?? 50, 50)} onclick={() => item(count, spec.items?.default ?? (concreteSchema(spec.items ?? {}).type === 'object' ? {} : ''))}><Plus size={13} />{m['creative.add_parameter_item']()}</Button>
    </div>
  {/if}
  {#if spec.default !== undefined}<p class="break-words text-[var(--app-text-muted)]">{m['creative.parameter_default']({ value: JSON.stringify(spec.default).slice(0, 200) })}</p>{/if}
  {#if enumMismatch}<p role="alert" class="text-destructive">{m['creative.unsupported_parameter']({ name: `${name}: ${JSON.stringify(value)}` })}</p>{/if}
  {#if name === 'prompt_expansion_mode' && effective && effective !== 'disabled'}<p role="status" class="text-amber-600 dark:text-amber-400">{m['creative.prompt_expansion_warning']()}</p>{/if}
</div>
