<script lang="ts">
  import { onMount } from 'svelte';
  import QRCode from 'qrcode';
  import { getCsrfToken } from '@beeblock/svelar/http';
  import { toast } from '@beeblock/svelar/ui';
  import { Smartphone } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import * as m from '$lib/paraglide/messages.js';

  type Status = { available: boolean; enabled: boolean; running: boolean; port: number; addresses: string[] };

  let { sectionClass }: { sectionClass: string } = $props();

  let status = $state<Status | null>(null);
  let links = $state<string[]>([]);
  let qr = $state<string | null>(null);
  let busy = $state(false);

  async function call<T>(method: 'GET' | 'POST' | 'DELETE'): Promise<T> {
    const csrf = getCsrfToken();
    const response = await fetch('/api/agent-room/mobile', {
      method,
      headers: { 'content-type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
      ...(method === 'POST' ? { body: '{}' } : {}),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? m['phone_settings.error']());
    return body.data as T;
  }

  async function pair() {
    busy = true;
    try {
      const result = await call<Status & { links: string[] }>('POST');
      status = result;
      links = result.links;
      qr = links[0] ? await QRCode.toDataURL(links[0], { margin: 1, width: 220, color: { dark: '#111111', light: '#ffffff' } }) : null;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : m['phone_settings.error']());
    } finally {
      busy = false;
    }
  }

  async function disable() {
    busy = true;
    try {
      status = await call<Status>('DELETE');
      links = [];
      qr = null;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : m['phone_settings.error']());
    } finally {
      busy = false;
    }
  }

  onMount(() => {
    void call<Status>('GET').then((value) => (status = value)).catch(() => (status = null));
  });
</script>

<section class={sectionClass} id="phone">
  <header class="section-head">
    <span class="icon-chip"><Smartphone size={15} aria-hidden="true" /></span>
    <div class="section-titles">
      <h2>{m['settings.section_phone']()}</h2>
      <p>{m['settings.section_phone_desc']()}</p>
    </div>
  </header>

  {#if status && !status.available}
    <p class="field-hint">{m['phone_settings.unavailable']()}</p>
  {:else}
    <!-- The row renders before the status arrives so the section keeps its height. -->
    <div class="flex flex-wrap items-center gap-3">
      <span class={`text-xs font-medium ${status?.running ? 'text-[var(--app-success)]' : 'text-[var(--app-text-muted)]'}`}>
        {status?.running ? m['phone_settings.on']({ port: String(status.port) }) : m['phone_settings.off']()}
      </span>
      <Button size="sm" class="ml-auto" disabled={busy || !status} onclick={pair}>{status?.enabled ? m['phone_settings.pair_again']() : m['phone_settings.pair']()}</Button>
      {#if status?.enabled}<Button size="sm" variant="outline" disabled={busy} onclick={disable}>{m['phone_settings.turn_off']()}</Button>{/if}
    </div>
    {#if qr}
      <div class="mt-4 flex flex-wrap items-start gap-5">
        <img src={qr} width="220" height="220" alt={m['phone_settings.qr_alt']()} class="rounded-lg" />
        <div class="flex min-w-0 max-w-sm flex-col gap-2">
          <p class="field-hint">{m['phone_settings.scan']()}</p>
          {#each links as link (link)}
            <code class="break-all rounded-md bg-[var(--app-code-bg)] px-2 py-1 text-xs text-[var(--app-code-text)]">{link}</code>
          {/each}
          <p class="field-hint">{m['phone_settings.once']()}</p>
        </div>
      </div>
    {:else if status?.enabled && status.running && !status.addresses.length}
      <p class="field-hint mt-3">{m['phone_settings.no_network']()}</p>
    {/if}
    <p class="field-hint mt-3">{m['phone_settings.safety']()}</p>
  {/if}
</section>

<style>
  /* Same section anatomy as the other Settings sections. */
  .section-head {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .icon-chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border: 1px solid var(--app-border);
    border-radius: 6px;
    background: var(--app-surface-raised);
    color: var(--app-accent);
    flex-shrink: 0;
  }

  .section-titles h2 {
    font-family: 'Sora Variable', 'Sora', 'Inter Variable', 'Inter', sans-serif;
    font-size: 15px;
    font-weight: 650;
    letter-spacing: 0;
    margin: 0;
    color: var(--app-text);
  }

  .section-titles p {
    margin: 1px 0 0;
    font-size: 12px;
    color: var(--app-text-muted);
  }

  .field-hint {
    margin: 0;
    font-size: 11.5px;
    line-height: 1.6;
    color: var(--app-text-muted);
    text-wrap: pretty;
  }
</style>
