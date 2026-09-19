<script lang="ts">
  import { untrack } from 'svelte';
  import { RefreshCw } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import ModelCombobox from './ModelCombobox.svelte';
  import { CREATIVE_MODELS } from '$lib/modules/creative-media/domain/catalog.js';
  import type { FalModelPrice } from '$lib/modules/creative-media/domain/model-contract.js';
  import { creativeApi } from '../creative-media-client.js';
  import * as m from '$lib/paraglide/messages.js';

  let { base, profileId, value, options, onValueChange }: { base: string; profileId: string | null; value: string; options: Array<{ value: string; label: string }>; onValueChange: (id: string) => void } = $props();
  let rates = $state<Record<string, FalModelPrice | null>>({}), loading = $state(false), failed = $state(false);
  let generation = 0, expires = 0;
  const endpoint = (id: string) => CREATIVE_MODELS[id as keyof typeof CREATIVE_MODELS]?.endpoint ?? id;
  const rateText = (price: FalModelPrice) => m['creative.model_rate']({ price: new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 6 }).format(price.unitPrice), unit: price.unit });
  const details = $derived(Object.fromEntries(options.map(option => [option.value, !profileId ? m['creative.price_account_required']() : rates[endpoint(option.value)] ? rateText(rates[endpoint(option.value)]!) : m['creative.price_unavailable']()])));
  const selectedRate = $derived(rates[endpoint(value)]);
  $effect(() => { profileId; base; generation++; rates = {}; failed = false; loading = false; });
  $effect(() => { const id = value, profile = profileId; if (profile && id) untrack(() => void prices([id])); });

  async function prices(ids: string[]) {
    if (!profileId) return;
    if (expires <= Date.now()) { rates = {}; expires = Date.now() + 300000; }
    const stamp = generation, profile = profileId;
    const missing = [...new Set(ids.map(endpoint))].filter(id => !(id in rates));
    if (!missing.length) return;
    // Mark requested IDs immediately to coalesce the selected item and open menu.
    rates = { ...rates, ...Object.fromEntries(missing.map(id => [id, null])) };
    loading = true; failed = false;
    try {
      for (let start = 0; start < missing.length; start += 50) {
        if (stamp !== generation) return;
        const result = await creativeApi<{ prices: FalModelPrice[] }>(`${base}/models?${new URLSearchParams({ profileId: profile, pricingIds: missing.slice(start, start + 50).join(',') })}`);
        if (stamp !== generation) return;
        rates = { ...rates, ...Object.fromEntries(result.prices.map(price => [price.endpointId, price])) };
      }
    } catch { if (stamp === generation) failed = true; }
    finally { if (stamp === generation) loading = false; }
  }
</script>

<div class="min-w-0 space-y-1 text-xs">
  <div class="flex items-center justify-between gap-2"><span>{m['creative.model']()}</span><Button size="icon-sm" variant="ghost" disabled={!profileId || loading} title={m['creative.refresh']()} aria-label={m['creative.refresh']()} onclick={() => { generation++; expires = 0; void prices([value]); }}><RefreshCw size={12} /></Button></div>
  <ModelCombobox {value} {options} {details} {onValueChange} onVisibleOptionsChange={prices} defaultLabel={m['creative.choose_model']()} searchPlaceholder={m['creative.search_models']()} emptyLabel={m['creative.no_models']()} ariaLabel={m['creative.model']()} />
  {#if selectedRate}<p class="font-medium" data-testid="model-unit-price">{rateText(selectedRate)}</p>{/if}
  {#if loading}<p role="status" class="text-[var(--app-text-muted)]">{m['creative.price_loading']()}</p>{:else if failed}<p role="status" class="text-[var(--app-text-muted)]">{m['creative.price_unavailable']()}</p>{/if}
  <p class="text-[var(--app-text-muted)]">{profileId ? m['creative.price_disclaimer']() : m['creative.price_account_required']()}</p>
</div>
