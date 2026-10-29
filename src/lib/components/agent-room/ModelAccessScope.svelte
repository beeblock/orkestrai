<script lang="ts">
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { SegmentedControl } from '$lib/components/ui/segmented';
  import * as Select from '$lib/components/ui/select';
  import * as ToggleGroup from '$lib/components/ui/toggle-group';
  import { Check } from '@lucide/svelte';
  import { accessModels, accessEfforts, type AccessScope, type AccessModel } from './model-access-options.js';
  import type { AgentProviderInfo } from '$lib/modules/agent-room/domain/types.js';
  import * as m from '$lib/paraglide/messages.js';

  let { id, label, provider, savedModels = [], scope, onChange }: {
    id: string; label: string; provider?: AgentProviderInfo; savedModels?: AccessModel[];
    scope: AccessScope; onChange: (patch: Partial<AccessScope>) => void;
  } = $props();
  const models = $derived(accessModels(provider, savedModels));
  const efforts = $derived(accessEfforts(models, scope.models));
  const selectedLabels = $derived(models.filter(model => scope.models?.includes(model.value)).map(model => model.label));
  const effortLabels = $derived<Record<string, string>>({
    none: m['model_access.effort_none'](), minimal: m['model_access.effort_minimal'](),
    low: m['dlg.effort_low'](), medium: m['dlg.effort_medium'](), high: m['dlg.effort_high'](),
    xhigh: m['dlg.effort_xhigh'](), max: m['dlg.effort_max'](), ultra: m['dlg.effort_ultra'](),
  });
  function chooseModels(values: string[] | null) {
    const allowed = accessEfforts(models, values);
    onChange({ models: values, efforts: scope.efforts === null ? null : scope.efforts.filter(effort => allowed.includes(effort)) });
  }
</script>

<fieldset class="scope-card" aria-label={label}>
  <legend>{label}</legend>
  <div class="scope-setting">
    <div class="scope-heading"><label for={`${id}-models`}>{m['model_access.models']()}</label></div>
    <Select.Root type="multiple" value={scope.models ?? ['__all__']} onValueChange={values => {
      if (scope.models === null && values.length > 1) chooseModels(values.filter(value => value !== '__all__'));
      else chooseModels(values.includes('__all__') ? null : values);
    }}>
      <Select.Trigger id={`${id}-models`} class="w-full min-w-0" aria-label={`${label} · ${m['model_access.models']()}`}>
        <span class="truncate">{scope.models === null ? m['model_access.all_models']() : selectedLabels.length ? selectedLabels.join(', ') : m['model_access.choose_models']()}</span>
      </Select.Trigger>
      <Select.Content class="max-w-[calc(100vw-3rem)]">
        <Select.Item value="__all__" label={m['model_access.all_models']()} />
        {#each models as model (model.value)}<Select.Item value={model.value} label={model.label} />{/each}
      </Select.Content>
    </Select.Root>
    <p class="scope-help">{!models.length ? m['model_access.models_loading']() : scope.models === null ? m['model_access.models_help']() : m['model_access.models_selection_help']()}</p>
  </div>
  <div class="scope-setting">
    <div class="scope-heading"><span>{m['model_access.efforts']()}</span>
      <SegmentedControl size="sm" label={`${label} · ${m['model_access.efforts']()}`} value={scope.efforts === null ? 'all' : 'choose'}
        options={[{ value: 'all', label: m['model_access.all_efforts']() }, { value: 'choose', label: m['model_access.choose']() }]}
        onValueChange={value => onChange({ efforts: value === 'all' ? null : efforts.filter(effort => effort === 'high') })} />
    </div>
    {#if scope.efforts !== null}
      <ToggleGroup.Root type="multiple" variant="outline" size="sm" spacing={1} class="w-full flex-wrap justify-start" value={scope.efforts}
        aria-label={`${label} · ${m['model_access.efforts']()}`} onValueChange={values => onChange({ efforts: values })}>
        {#each efforts as effort}<ToggleGroup.Item value={effort} aria-label={effortLabels[effort]}><span class="effort-check" aria-hidden="true">{#if scope.efforts?.includes(effort)}<Check size={12} />{/if}</span>{effortLabels[effort]}</ToggleGroup.Item>{/each}
      </ToggleGroup.Root>
    {:else}<p class="scope-help">{m['model_access.efforts_help']()}</p>{/if}
  </div>
  {#if id.startsWith('codex/')}<label class="scope-images"><Checkbox checked={scope.images} onCheckedChange={(checked: boolean) => onChange({ images: checked })} />{m['model_access.images']()}</label>{/if}
</fieldset>

<style>
  .scope-card { min-width:0; border:1px solid var(--app-border); border-radius:10px; padding:14px; background:var(--app-surface-raised); }
  legend { padding:0 5px; font-size:13px; font-weight:600; color:var(--app-text); overflow-wrap:anywhere; }
  .scope-setting + .scope-setting { margin-top:16px; padding-top:14px; border-top:1px solid var(--app-border); }
  .scope-heading { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:8px; font-size:12px; font-weight:500; }
  .scope-help { color:var(--app-text-muted); font-size:12px; line-height:1.5; }
  .scope-images { display:flex; align-items:center; gap:8px; margin-top:16px; padding-top:14px; border-top:1px solid var(--app-border); font-size:12px; }
  .effort-check { width:12px; display:inline-flex; justify-content:center; }
  .scope-card :global([data-slot='toggle-group-item'][data-state='on']) { border-color:var(--app-accent); background:var(--app-accent-soft); color:var(--app-text); }
  @media(max-width:420px) { .scope-heading { align-items:flex-start; flex-direction:column; } }
</style>
