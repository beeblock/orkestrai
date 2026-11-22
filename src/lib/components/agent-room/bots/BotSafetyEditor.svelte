<script lang="ts">
  import { onMount } from 'svelte';
  import { defaults, superForm } from 'sveltekit-superforms';
  import { zod } from 'sveltekit-superforms/adapters';
  import { ShieldCheck, LoaderCircle, CircleAlert } from '@lucide/svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Select from '$lib/components/ui/select';
  import { Button } from '$lib/components/ui/button';
  import { Textarea } from '$lib/components/ui/textarea';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { botSafetySchema, type BotSafetySettings } from '$lib/modules/agent-room/contracts/schemas/bot-safety.schema.js';
  import type { PersonalBotSummary } from '$lib/modules/agent-room/contracts/schemas/personal-bot.schema.js';
  import { botApi } from './bot-api.js';
  import * as m from '$lib/paraglide/messages.js';

  let { workspaceId, bot, onSaved, onClose }: { workspaceId: string; bot: PersonalBotSummary; onSaved: () => void; onClose: () => void } = $props();
  type Action = { id: string; name: string; revision: number; outputFields: string[] };
  let options = $state<Action[]>([]), loading = $state(false), saving = $state(false), error = $state('');
  let advanced = $state(false), loaded = false;
  const controller = new AbortController();
  const form = superForm(defaults(bot.safety, zod(botSafetySchema)), { SPA: true, dataType: 'json', validators: zod(botSafetySchema),
    async onUpdate({ form: validated }) {
      if (!validated.valid || saving) return;
      saving = true; error = '';
      try {
        await botApi(`/api/agent-room/workspaces/${workspaceId}/bots`, { command: 'safety_update', nodeId: bot.id, revision: bot.safetyRevision, settings: validated.data });
        onSaved();
      } catch (failure) { error = failure instanceof Error && failure.message === 'BOT_PUBLIC_POLICY_CONFLICT' ? m['bots.safety_conflict']() : m['bots.safety_save_failed'](); }
      finally { saving = false; }
    },
  });
  const { form: data, enhance, allErrors } = form;
  onMount(() => () => controller.abort());
  function showAdvanced() {
    advanced = !advanced;
    if (!advanced || loaded || loading) return;
    loading = true;
    void botApi<Action[]>(`/api/agent-room/workspaces/${workspaceId}/bots`, { command: 'safety_options', nodeId: bot.id }, controller.signal)
      .then(items => { if (!controller.signal.aborted) { options = items; loaded = true; } })
      .catch(() => { if (!controller.signal.aborted) error = m['bots.error'](); })
      .finally(() => { if (!controller.signal.aborted) loading = false; });
  }

  function toggleAction(action: Action, enabled: boolean) {
    $data.actions = enabled ? [...$data.actions, { toolId: action.id, revision: action.revision, outputFields: [], artifactFields: [] }]
      : $data.actions.filter(item => item.toolId !== action.id);
  }
  function toggleField(id: string, field: string, enabled: boolean, artifact = false) {
    $data.actions = $data.actions.map(action => {
      if (action.toolId !== id) return action;
      const key: keyof Pick<BotSafetySettings['actions'][number], 'outputFields' | 'artifactFields'> = artifact ? 'artifactFields' : 'outputFields';
      const changed = { ...action, [key]: enabled ? [...action[key], field] : action[key].filter(item => item !== field) };
      if (!artifact && !enabled) changed.artifactFields = changed.artifactFields.filter(item => item !== field);
      return changed;
    });
  }
</script>

<Dialog.Root open onOpenChange={open => !open && onClose()}>
  <Dialog.Content class="flex max-h-[90dvh] flex-col overflow-hidden sm:max-w-[680px]" data-testid="bot-safety-editor">
    <Dialog.Header class="shrink-0">
      <Dialog.Title class="flex items-center gap-2"><ShieldCheck size={19} />{m['bots.safety_title']()}</Dialog.Title>
      <Dialog.Description>{m['bots.safety_description']()}</Dialog.Description>
    </Dialog.Header>
    <form use:enhance class="flex min-h-0 flex-col gap-4">
      <div class="min-h-0 space-y-5 overflow-y-auto px-1 pb-2">
        <p class="text-sm leading-relaxed text-[var(--app-text-muted)]">{m['bots.safety_simple_hint']()}</p>
        {#if bot.transport !== 'structured'}<p role="alert" class="text-sm text-[var(--app-danger)]">{m['bots.safety_structured_required']()}</p>{/if}
        <label class="grid gap-2 text-sm font-medium">{m['bots.safety_scope']()}<Textarea name="publicInstructions" bind:value={$data.publicInstructions} maxlength={6000} rows={5} placeholder={m['bots.safety_scope_example']()} /></label>
        <p class="text-xs leading-relaxed text-[var(--app-text-muted)]">{m['bots.purpose_public_hint']()}</p>
        <label class="grid gap-2 text-sm font-medium">{m['bots.safety_knowledge']()}<Textarea name="publicKnowledge" bind:value={$data.publicKnowledge} maxlength={24000} rows={4} /></label>
        <p class="text-xs leading-relaxed text-[var(--app-text-muted)]">{m['bots.safety_simple_cost']()}</p>
        <Button type="button" variant="ghost" size="sm" class="justify-start" aria-expanded={advanced} onclick={showAdvanced}>{m['bots.advanced']()}</Button>
        {#if advanced}
        <section class="space-y-3 border-t border-[var(--app-border)] pt-4" aria-label={m['bots.safety_actions']()}>
          <h3 class="text-sm font-medium">{m['bots.safety_actions']()}</h3><p class="text-xs leading-relaxed text-[var(--app-text-muted)]">{m['bots.safety_actions_hint']()}</p>
          {#if loading}<LoaderCircle size={18} class="animate-spin" />{:else if !options.length}<p class="text-sm text-[var(--app-text-muted)]">{m['bots.safety_no_actions']()}</p>{/if}
          {#each options as action (action.id)}
            {@const grant = $data.actions.find(item => item.toolId === action.id)}
            <div class="rounded-lg border border-[var(--app-border)] p-3">
              <label class="flex items-center gap-3 text-sm font-medium"><Checkbox checked={!!grant} onCheckedChange={(checked: boolean | "indeterminate") => toggleAction(action, checked === true)} />{action.name}<span class="ml-auto text-xs font-normal text-[var(--app-text-muted)]">r{action.revision}</span></label>
              {#if grant}
                {#if grant.revision !== action.revision}<p role="alert" class="mt-3 text-xs text-[var(--app-danger)]">{m['bots.safety_action_changed']()}</p>{/if}
                <p class="mb-2 mt-3 text-xs text-[var(--app-text-muted)]">{m['bots.safety_fields']()}</p>
                <div class="space-y-3">{#each action.outputFields as field}<div class="flex flex-wrap items-center justify-between gap-3"><label class="flex min-w-0 items-center gap-2 text-sm"><Checkbox checked={grant.outputFields.includes(field)} onCheckedChange={(checked: boolean | "indeterminate") => toggleField(action.id, field, checked === true)} /><span class="break-all font-mono text-xs">{field}</span></label>{#if grant.outputFields.includes(field)}<label class="flex items-center gap-2 text-xs text-[var(--app-text-muted)]"><Checkbox checked={grant.artifactFields.includes(field)} onCheckedChange={(checked: boolean | "indeterminate") => toggleField(action.id, field, checked === true, true)} />{m['bots.safety_file_field']()}</label>{/if}</div>{/each}</div>
              {/if}
            </div>
          {/each}
          {#each $data.actions.filter(grant => !options.some(option => option.id === grant.toolId)) as stale}<div class="flex items-center justify-between gap-3 text-sm"><span>{m['bots.safety_action_changed']()}</span><Button type="button" variant="outline" size="sm" onclick={() => ($data.actions = $data.actions.filter(item => item.toolId !== stale.toolId))}>{m['bots.remove']()}</Button></div>{/each}
        </section>
        <div class="grid gap-4 border-t border-[var(--app-border)] pt-4 sm:grid-cols-3">
          {#each [{ key: 'requestsPerMinute', label: m['bots.safety_rate'](), values: [1, 3, 6, 10, 20, 30] }, { key: 'maxActionsPerTurn', label: m['bots.safety_action_limit'](), values: [0, 1, 3, 5, 10, 20] }, { key: 'maxReplyCharacters', label: m['bots.safety_reply_limit'](), values: [500, 1000, 2000, 4000, 8000] }] as limit}
            <div class="grid gap-2"><span class="text-xs font-medium">{limit.label}</span><Select.Root type="single" value={String($data[limit.key as 'requestsPerMinute'])} onValueChange={value => { if (value) $data[limit.key as 'requestsPerMinute'] = Number(value); }}><Select.Trigger class="w-full" aria-label={limit.label}>{$data[limit.key as 'requestsPerMinute']}</Select.Trigger><Select.Content>{#each [...new Set([...limit.values, $data[limit.key as 'requestsPerMinute']])].sort((a, b) => a - b) as value}<Select.Item value={String(value)}>{value}</Select.Item>{/each}</Select.Content></Select.Root></div>
          {/each}
        </div>
        <p class="text-xs leading-relaxed text-[var(--app-text-muted)]">{m['bots.safety_review_cost']()}</p>
        {/if}
        {#if $allErrors.length}<p role="alert" class="text-sm text-[var(--app-danger)]">{m['bots.safety_invalid']()}</p>{/if}
        {#if error}<p role="alert" class="flex gap-2 text-sm text-[var(--app-danger)]"><CircleAlert size={16} />{error}</p>{/if}
      </div>
      <Dialog.Footer class="shrink-0 border-t border-[var(--app-border)] pt-4"><Button variant="outline" type="button" onclick={onClose}>{m['bots.cancel']()}</Button><Button type="submit" disabled={saving}>{#if saving}<LoaderCircle class="animate-spin" size={15} />{/if}{m['bots.save']()}</Button></Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
