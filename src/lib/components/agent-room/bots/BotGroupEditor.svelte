<script lang="ts">
  import { untrack } from 'svelte';
  import { defaults, superForm } from 'sveltekit-superforms';
  import { zod } from 'sveltekit-superforms/adapters';
  import { botGroupSettingsSchema } from '$lib/modules/agent-room/contracts/schemas/personal-bot.schema.js';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Select from '$lib/components/ui/select';
  import { Input } from '$lib/components/ui/input';
  import { Textarea } from '$lib/components/ui/textarea';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { Button } from '$lib/components/ui/button';
  import type { PersonalBotGroup, PersonalBotSummary } from '$lib/modules/agent-room/contracts/schemas/personal-bot.schema.js';
  import { botApi } from './bot-api.js';
  import * as m from '$lib/paraglide/messages.js';
  let { workspaceId, bots, group = null, onSaved, onClose }: {
    workspaceId: string; bots: PersonalBotSummary[]; group?: PersonalBotGroup | null;
    onSaved: (group: PersonalBotGroup) => void; onClose: () => void;
  } = $props();
  const initial = untrack(() => ({ title: group?.title ?? '', instructions: group?.instructions ?? '', memberIds: group?.memberIds ?? [], coordinatorId: group?.coordinatorId ?? '' }));
  let saving = $state(false), error = $state(false);
  const form = superForm(defaults(initial, zod(botGroupSettingsSchema)), {
    SPA: true, dataType: 'json', validators: zod(botGroupSettingsSchema),
    async onUpdate({ form: validated }) {
      if (!validated.valid || saving) return;
      saving = true; error = false;
      try {
        onSaved(await botApi<PersonalBotGroup>(`/api/agent-room/workspaces/${workspaceId}/bots`, {
          command: group ? 'group_update' : 'group_create', ...(group ? { groupId: group.id, revision: group.revision } : {}), settings: validated.data,
        }));
      } catch { error = true; } finally { saving = false; }
    },
  });
  const { form: data, errors, enhance } = form;
  const members = $derived(bots.filter(bot => $data.memberIds.includes(bot.id)));
  function toggle(id: string, checked: boolean) {
    $data.memberIds = checked ? [...new Set([...$data.memberIds, id])] : $data.memberIds.filter(value => value !== id);
    if (!$data.memberIds.includes($data.coordinatorId)) $data.coordinatorId = $data.memberIds[0] ?? '';
  }
</script>
<Dialog.Root open onOpenChange={value => !value && onClose()}>
  <Dialog.Content class="max-h-[90dvh] overflow-y-auto sm:max-w-[540px]">
    <Dialog.Header><Dialog.Title>{group ? m['bots.edit_group']() : m['bots.create_group']()}</Dialog.Title><Dialog.Description>{m['bots.group_hint']()}</Dialog.Description></Dialog.Header>
    <form use:enhance class="grid gap-4">
      <label class="grid gap-1.5 text-sm font-medium">{m['bots.name']()}<Input name="title" bind:value={$data.title} maxlength={120} required /></label>
      <label class="grid gap-1.5 text-sm font-medium">{m['bots.instructions']()}<Textarea name="instructions" bind:value={$data.instructions} rows={3} maxlength={12000} /></label>
      <fieldset class="grid gap-2"><legend class="mb-2 text-sm font-medium">{m['bots.members']()}</legend>
        {#each bots as bot}<label class="flex items-center gap-3 rounded-lg border border-[var(--app-border)] px-3 py-2"><Checkbox checked={$data.memberIds.includes(bot.id)} onCheckedChange={(checked: boolean | 'indeterminate') => toggle(bot.id, checked === true)} /><span class="min-w-0 truncate text-sm">{bot.title}</span></label>{/each}
      </fieldset>
      <div class="grid gap-1.5"><span class="text-sm font-medium">{m['bots.coordinator']()}</span>
        <Select.Root type="single" value={$data.coordinatorId} onValueChange={value => ($data.coordinatorId = value)}>
          <Select.Trigger aria-label={m['bots.coordinator']()}>{members.find(bot => bot.id === $data.coordinatorId)?.title ?? m['bots.choose_members']()}</Select.Trigger>
          <Select.Content>{#each members as bot}<Select.Item value={bot.id}>{bot.title}</Select.Item>{/each}</Select.Content>
        </Select.Root>
      </div>
      {#if $errors.memberIds}<p role="alert" class="text-sm text-[var(--app-danger)]">{$errors.memberIds}</p>{/if}
      {#if error}<p role="alert" class="text-sm text-[var(--app-danger)]">{m['bots.error']()}</p>{/if}
      <Dialog.Footer><Button variant="outline" type="button" onclick={onClose}>{m['bots.cancel']()}</Button><Button type="submit" disabled={saving || !$data.title.trim() || !$data.coordinatorId}>{m['bots.save']()}</Button></Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
