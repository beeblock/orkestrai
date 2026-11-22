<script lang="ts">
  import { untrack } from 'svelte';
  import { defaults, superForm } from 'sveltekit-superforms';
  import { zod } from 'sveltekit-superforms/adapters';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Select from '$lib/components/ui/select';
  import { Input } from '$lib/components/ui/input';
  import { Textarea } from '$lib/components/ui/textarea';
  import { Button } from '$lib/components/ui/button';
  import { SegmentedControl } from '$lib/components/ui/segmented';
  import { CircleAlert, LoaderCircle } from '@lucide/svelte';
  import ModelCombobox from '../canvas/ModelCombobox.svelte';
  import { personalBotSettingsSchema, type PersonalBotSummary } from '$lib/modules/agent-room/contracts/schemas/personal-bot.schema.js';
  import type { AgentModelOption, ProviderProfile } from '$lib/modules/agent-room/domain/types.js';
  import { botApi, type BotProviderOption } from './bot-api.js';
  import * as m from '$lib/paraglide/messages.js';

  let { workspaceId, providers, bot = null, onSaved, onClose }: {
    workspaceId: string; providers: BotProviderOption[]; bot?: PersonalBotSummary | null;
    onSaved: (bot: PersonalBotSummary) => void; onClose: () => void;
  } = $props();
  let saving = $state(false), error = $state(''), models = $state<AgentModelOption[]>([]), profiles = $state<ProviderProfile[]>([]);
  let metadataLoading = $state(false);
  let advanced = $state(false);
  let providerEfforts = $state<string[]>([]);
  const form = superForm(defaults(zod(personalBotSettingsSchema)), {
    SPA: true, dataType: 'json', validators: zod(personalBotSettingsSchema),
    async onUpdate({ form: validated }) {
      if (!validated.valid || saving) return;
      saving = true; error = '';
      try {
        const result = await botApi<PersonalBotSummary>(`/api/agent-room/workspaces/${workspaceId}/bots`, {
          command: bot ? 'update' : 'create', ...(bot ? { nodeId: bot.id } : {}),
          settings: { ...validated.data, ...(!bot ? { publicRole: validated.data.instructions } : {}) },
        });
        onSaved(result);
      } catch (failure) {
        const code = failure instanceof Error ? failure.message : '';
        error = code === 'AGENT_TRANSPORT_REQUIRES_SLEEP' ? m['bots.sleep_before_edit']()
          : code === 'BOT_ACCOUNT_CHANGE_USE_PROFILE_SWITCH' ? m['bots.account_change']() : m['bots.error']();
      } finally { saving = false; }
    },
  });
  const { form: data, enhance, errors } = form;
  let initialized = false;
  $effect(() => {
    if (initialized) return;
    initialized = true;
    data.set({ title: bot?.title ?? '', instructions: bot?.instructions ?? '', provider: bot?.provider ?? providers[0]?.id ?? '',
      model: bot?.model ?? null, effort: bot?.effort ?? null, profileId: bot?.profileId ?? null, transport: bot?.transport ?? 'structured' });
  });
  // Superforms publishes the whole form store when any field changes. Depend
  // on the scalar provider value so editing a name cannot reload metadata and
  // disable Save between pointerdown and click.
  const providerId = $derived($data.provider);
  const provider = $derived(providers.find(item => item.id === providerId));
  const selectedModel = $derived(models.find(item => item.value === $data.model));
  const efforts = $derived(selectedModel?.efforts ?? providerEfforts);
  $effect(() => {
    const id = providerId;
    const workspace = workspaceId;
    if (!id) return;
    const controller = new AbortController();
    untrack(() => { metadataLoading = true; models = []; profiles = []; });
    void Promise.all([
      botApi<{ models: AgentModelOption[]; efforts: string[] }>(`/api/agent-room/workspaces/${workspace}/bots?providerId=${encodeURIComponent(id)}`, undefined, controller.signal),
      botApi<ProviderProfile[]>(`/api/agent-room/provider-profiles?providerId=${encodeURIComponent(id)}`, undefined, controller.signal),
    ]).then(([status, accounts]) => {
      if (controller.signal.aborted) return;
      models = status.models ?? []; providerEfforts = status.efforts ?? [];
      profiles = accounts;
    }).catch(() => { if (!controller.signal.aborted) error = m['bots.error'](); })
      .finally(() => { if (!controller.signal.aborted) metadataLoading = false; });
    return () => controller.abort();
  });
</script>

<Dialog.Root open onOpenChange={value => !value && onClose()}>
  <Dialog.Content class="max-h-[90dvh] overflow-y-auto sm:max-w-[620px]">
    <Dialog.Header>
      <Dialog.Title>{bot ? m['bots.edit']() : m['bots.create']()}</Dialog.Title>
      <Dialog.Description>{bot ? m['bots.instructions_hint']() : m['bots.simple_setup_hint']()}</Dialog.Description>
    </Dialog.Header>
    <form use:enhance class="grid gap-4" data-testid="bot-editor">
      <label class="grid gap-1.5 text-sm font-medium">{m['bots.name']()}<Input name="title" bind:value={$data.title} maxlength={48} required /></label>
      {#if $errors.title}<p class="text-sm text-[var(--app-danger)]">{$errors.title}</p>{/if}
      {#if !bot}
      <label class="grid gap-1.5 text-sm font-medium">{m['bots.purpose']()}<Textarea name="instructions" bind:value={$data.instructions} rows={3} maxlength={6000} placeholder={m['bots.purpose_example']()} required /></label>
      <p class="text-xs leading-relaxed text-[var(--app-text-muted)]">{m['bots.purpose_public_hint']()}</p>
      {#if $errors.instructions}<p class="text-sm text-[var(--app-danger)]">{$errors.instructions}</p>{/if}
      {/if}
      <div class="grid gap-4 sm:grid-cols-2">
        <div class="grid gap-1.5"><span class="text-sm font-medium">{m['bots.provider']()}</span>
          <Select.Root type="single" value={$data.provider} onValueChange={value => { $data.provider = value; $data.model = null; $data.effort = null; $data.profileId = null; }}>
            <Select.Trigger class="w-full" aria-label={m['bots.provider']()}>{provider?.displayName ?? m['bots.provider']()}</Select.Trigger>
            <Select.Content>{#each providers as option}<Select.Item value={option.id}>{option.displayName}</Select.Item>{/each}</Select.Content>
          </Select.Root>
        </div>
        <div class="grid gap-1.5"><span class="text-sm font-medium">{m['bots.profile']()}</span>
          <Select.Root type="single" value={$data.profileId ?? '__default__'} onValueChange={value => ($data.profileId = value === '__default__' ? null : value)}>
            <Select.Trigger class="w-full" aria-label={m['bots.profile']()}><span class="truncate">{profiles.find(item => item.id === $data.profileId)?.name ?? m['bots.default_profile']()}</span></Select.Trigger>
            <Select.Content><Select.Item value="__default__">{m['bots.default_profile']()}</Select.Item>{#each profiles as account}<Select.Item value={account.id}>{account.name}</Select.Item>{/each}</Select.Content>
          </Select.Root>
        </div>
      </div>
      <Button type="button" variant="ghost" size="sm" class="justify-start" aria-expanded={advanced} onclick={() => (advanced = !advanced)}>{m['bots.advanced']()}</Button>
      {#if advanced}
      {#if bot}<label class="grid gap-1.5 text-sm font-medium">{m['bots.instructions']()}<Textarea name="instructions" bind:value={$data.instructions} rows={4} maxlength={24000} required /></label>{/if}
      <div class="grid gap-4 sm:grid-cols-2">
        <div class="grid gap-1.5"><span class="text-sm font-medium">{m['bots.model']()}</span>
          <ModelCombobox value={$data.model ?? ''} options={models} defaultLabel={m['bots.default_model']()} searchPlaceholder={m['bots.search_models']()} emptyLabel={m['bots.no_models']()} ariaLabel={m['bots.model']()} onValueChange={value => { $data.model = value || null; $data.effort = null; }} />
        </div>
        <div class="grid gap-1.5"><span class="text-sm font-medium">{m['bots.effort']()}</span>
          <Select.Root type="single" value={$data.effort ?? '__default__'} onValueChange={value => ($data.effort = value === '__default__' ? null : value)}>
            <Select.Trigger class="w-full" aria-label={m['bots.effort']()}>{$data.effort ?? m['bots.default_model']()}</Select.Trigger>
            <Select.Content><Select.Item value="__default__">{m['bots.default_model']()}</Select.Item>{#each efforts as effort}<Select.Item value={effort}>{effort}</Select.Item>{/each}</Select.Content>
          </Select.Root>
        </div>
      </div>
      <div class="grid gap-2 border-t border-[var(--app-border)] pt-4">
        <span class="text-sm font-medium">{m['bots.transport']()}</span>
        <SegmentedControl fill label={m['bots.transport']()} value={$data.transport} onValueChange={value => ($data.transport = value)} options={[
          { value: 'structured', label: provider?.transportName ?? m['bots.structured']() }, { value: 'terminal', label: m['bots.terminal']() },
        ]} />
        <p class="text-xs leading-relaxed text-[var(--app-text-muted)]">{m['bots.transport_hint']()}</p>
      </div>
      {/if}
      {#if error}<p class="flex gap-2 text-sm text-[var(--app-danger)]" role="alert"><CircleAlert size={16} />{error}</p>{/if}
      <Dialog.Footer>
        <Button variant="outline" type="button" onclick={onClose}>{m['bots.cancel']()}</Button>
        <Button type="submit" disabled={saving || metadataLoading || !$data.provider}>{#if saving}<LoaderCircle class="animate-spin" size={15} />{/if}{m['bots.save']()}</Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
