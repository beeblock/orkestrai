<script lang="ts">
  import { Save } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Textarea } from '$lib/components/ui/textarea';
  import { Switch } from '$lib/components/ui/switch';
  import { Slider } from '$lib/components/ui/slider';
  import * as Select from '$lib/components/ui/select';
  import { companionProfileSchema, type ComputerReplyGrant } from '$lib/modules/agent-room/contracts/schemas/computer-reply.schema.js';
  import { EMBEDDED_TTS_VOICES } from '$lib/modules/agent-room/domain/voice.js';
  import { localVoiceLabel } from './voice-label.js';
  import * as m from '$lib/paraglide/messages.js';

  let { grant, update, disabled = false }: { grant: ComputerReplyGrant; update: (fields: Partial<ComputerReplyGrant>) => Promise<void>; disabled?: boolean } = $props();
  const defaults = (): NonNullable<ComputerReplyGrant['companion']> => ({ name: '', persona: '', locale: 'pt-BR', voice: 'pt-BR-f1', speed: 1, noEmDash: true, hideOperationalDetails: true, execution: 'agent' });
  let profile = $state(defaults());
  $effect(() => { profile = grant.companion ? { ...grant.companion } : defaults(); });
  const valid = $derived(companionProfileSchema.safeParse(profile).success);
  const languages = $derived([{ id: 'pt-BR', label: m['language.name_pt_br']() }, { id: 'en', label: m['language.name_en']() }, { id: 'es', label: m['language.name_es']() }]);
</script>

<details class="min-w-0 text-xs" data-testid="companion-profile">
  <summary class="cursor-pointer py-2 font-medium">{m['companion.profile_title']()}</summary>
  <div class="grid min-w-0 gap-3 pb-3">
    <label class="grid gap-1"><span>{m['companion.profile_name']()}</span><Input bind:value={profile.name} maxlength={80} {disabled} /></label>
    <label class="grid gap-1"><span>{m['companion.profile_persona']()}</span><Textarea bind:value={profile.persona} rows={5} maxlength={4000} class="min-h-28 resize-y" {disabled} /></label>
    <label class="grid gap-1"><span>{m['companion.profile_locale']()}</span>
      <Select.Root type="single" bind:value={profile.locale}><Select.Trigger class="w-full" {disabled}>{languages.find(locale => locale.id === profile.locale)?.label}</Select.Trigger><Select.Content>{#each languages as locale}<Select.Item value={locale.id}>{locale.label}</Select.Item>{/each}</Select.Content></Select.Root>
    </label>
    <label class="grid gap-1"><span>{m['settings.tts_voice']()}</span>
      <Select.Root type="single" bind:value={profile.voice}><Select.Trigger class="w-full" {disabled}><span class="truncate">{localVoiceLabel(profile.voice)}</span></Select.Trigger><Select.Content>{#each EMBEDDED_TTS_VOICES as voice}<Select.Item value={voice.id}>{localVoiceLabel(voice.id)}</Select.Item>{/each}</Select.Content></Select.Root>
    </label>
    <label class="grid gap-2"><span>{m['settings.tts_speed']()}: {profile.speed.toFixed(2)}x</span><Slider type="single" min={0.75} max={1.5} step={0.05} bind:value={profile.speed} aria-label={m['settings.tts_speed']()} {disabled} /></label>
    <label class="flex items-center justify-between gap-3"><span>{m['companion.profile_no_dash']()}</span><Switch bind:checked={profile.noEmDash} {disabled} /></label>
    <label class="flex items-center justify-between gap-3"><span>{m['companion.profile_hide_operations']()}</span><Switch bind:checked={profile.hideOperationalDetails} {disabled} /></label>
    <label class="grid gap-1"><span>{m['companion.profile_execution']()}</span><Select.Root type="single" bind:value={profile.execution}><Select.Trigger class="w-full" {disabled}>{profile.execution === 'restricted' ? m['companion.profile_restricted']() : m['companion.profile_agent']()}</Select.Trigger><Select.Content><Select.Item value="restricted">{m['companion.profile_restricted']()}</Select.Item><Select.Item value="agent">{m['companion.profile_agent']()}</Select.Item></Select.Content></Select.Root></label>
    <p class="text-[var(--app-warning)]">{profile.execution === 'agent' ? m['companion.profile_shell_warning']() : m['companion.profile_restricted_scope']()}</p>
    <Button size="sm" class="justify-self-start" disabled={disabled || !valid} onclick={() => update({ companion: companionProfileSchema.parse(profile) })}><Save size={14} />{m['companion.profile_save']()}</Button>
  </div>
</details>
