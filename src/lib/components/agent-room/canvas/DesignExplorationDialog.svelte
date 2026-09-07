<script lang="ts">
  import { defaults, superForm, type FormOptions, type SuperValidated } from 'sveltekit-superforms';
  import { zod } from 'sveltekit-superforms/adapters';
  import { getCsrfToken } from '@beeblock/svelar/http';
  import { toast } from '@beeblock/svelar/ui';
  import { Boxes, Check, Code2, Gauge, LoaderCircle, Palette, Play, ScanLine, ShieldCheck, Sparkles, SwatchBook, UserRound, Users } from '@lucide/svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Form from '$lib/components/ui/form';
  import * as Select from '$lib/components/ui/select';
  import { Button } from '$lib/components/ui/button';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { Input } from '$lib/components/ui/input';
  import { Textarea } from '$lib/components/ui/textarea';
  import { localeState } from '$lib/i18n/locale.svelte.js';
  import * as m from '$lib/paraglide/messages.js';
  import {
    createDesignExplorationSchema,
    designExplorationCodeTargetSchema,
    designExplorationPlatformSchema,
    type CreateDesignExplorationInput,
  } from '$lib/modules/agent-room/contracts/schemas/create-design-exploration.schema.js';
  import type { DesignExplorationData } from '$lib/modules/agent-room/interface/http/resources/DesignExplorationResource.js';

  type Props = {
    open: boolean;
    workspaceId: string;
    leader: { id: string; title: string; provider: string } | null;
    onClose: () => void;
    onCreated: (result: DesignExplorationData) => void | Promise<void>;
  };

  let { open, workspaceId, leader, onClose, onCreated }: Props = $props();
  let submitting = $state(false);
  let submitError = $state('');
  let initializedForOpen = false;

  const schema = createDesignExplorationSchema as unknown as Parameters<typeof zod>[0];
  const form = superForm<CreateDesignExplorationInput>(
    defaults({
      title: '',
      objective: '',
      audience: '',
      platform: 'responsive-web',
      codeTarget: 'svelar',
      constraints: '',
      references: '',
      includeDarkMode: true,
      executionMode: 'manual',
      leaderNodeId: null,
      locale: 'en',
    } satisfies CreateDesignExplorationInput, zod(schema)) as SuperValidated<CreateDesignExplorationInput>,
    {
      SPA: true,
      validators: zod(schema) as FormOptions<CreateDesignExplorationInput>['validators'],
      async onUpdate({ form: state }) {
        if (!state.valid || submitting) return;
        submitting = true;
        submitError = '';
        try {
          const input = state.data as CreateDesignExplorationInput;
          const token = getCsrfToken();
          const response = await fetch(`/api/agent-room/workspaces/${workspaceId}/design-explorations`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              ...(token ? { 'X-CSRF-Token': token } : {}),
            },
            body: JSON.stringify({ ...input, locale: localeState.current }),
          });
          const payload = await response.json();
          if (!response.ok || payload.error) throw new Error(createErrorMessage(String(payload.error ?? '')));
          const result = payload.data as DesignExplorationData;
          toast.success(input.executionMode === 'leader'
            ? m['design.exploration_created_dispatched']()
            : m['design.exploration_created_manual']());
          onClose();
          try {
            await onCreated(result);
          } catch {
            toast.error(m['design.exploration_refresh_error']());
          }
        } catch (error) {
          submitError = error instanceof Error ? error.message : m['design.exploration_create_error']();
        } finally {
          submitting = false;
        }
      },
    },
  );

  const { form: formData, enhance } = form;

  $effect(() => {
    if (!open) {
      initializedForOpen = false;
      return;
    }
    if ($formData.locale !== localeState.current) $formData.locale = localeState.current;
    if (!initializedForOpen) {
      initializedForOpen = true;
      if (!$formData.title.trim()) $formData.title = m['design.exploration_default_title']();
    }
    if ($formData.executionMode === 'leader' && leader && $formData.leaderNodeId !== leader.id) {
      $formData.leaderNodeId = leader.id;
    }
    if (!leader && $formData.executionMode === 'leader') {
      $formData.executionMode = 'manual';
      $formData.leaderNodeId = null;
    }
  });

  function selectExecution(mode: 'manual' | 'leader') {
    if (mode === 'leader' && !leader) return;
    $formData.executionMode = mode;
    $formData.leaderNodeId = mode === 'leader' ? leader?.id ?? null : null;
  }

  function platformLabel(platform: CreateDesignExplorationInput['platform']): string {
    switch (platform) {
      case 'desktop': return m['design.exploration_platform_desktop']();
      case 'mobile-web': return m['design.exploration_platform_mobile_web']();
      case 'native-mobile': return m['design.exploration_platform_native_mobile']();
      default: return m['design.exploration_platform_responsive_web']();
    }
  }

  function codeTargetLabel(target: CreateDesignExplorationInput['codeTarget']): string {
    switch (target) {
      case 'svelte': return m['design.exploration_code_svelte']();
      case 'react': return m['design.exploration_code_react']();
      case 'next': return m['design.exploration_code_next']();
      case 'vue': return m['design.exploration_code_vue']();
      case 'html': return m['design.exploration_code_html']();
      default: return m['design.exploration_code_svelar']();
    }
  }

  function selectPlatform(value: string) {
    const parsed = designExplorationPlatformSchema.safeParse(value);
    if (parsed.success) $formData.platform = parsed.data;
  }

  function selectCodeTarget(value: string) {
    const parsed = designExplorationCodeTargetSchema.safeParse(value);
    if (parsed.success) $formData.codeTarget = parsed.data;
  }

  function createErrorMessage(code: string): string {
    if (code === 'workspace_not_found') return m['design.exploration_error_workspace']();
    if (code === 'leader_changed') return m['design.exploration_error_leader_changed']();
    if (code === 'leader_inactive') return m['design.exploration_error_leader_inactive']();
    return m['design.exploration_create_error']();
  }
</script>

<Dialog.Root {open} onOpenChange={(next) => !next && !submitting && onClose()}>
  <Dialog.Content class="grid max-h-[min(92dvh,860px)] w-[min(1040px,calc(100vw-1.5rem))]! max-w-none! grid-rows-[auto_minmax(0,1fr)] gap-0! overflow-hidden rounded-lg p-0!">
    <Dialog.Header class="border-b border-border/70 px-5 py-4 pr-12">
      <Dialog.Title class="text-pretty">{m['design.exploration_title']()}</Dialog.Title>
      <Dialog.Description class="max-w-3xl text-pretty">{m['design.exploration_description']()}</Dialog.Description>
    </Dialog.Header>

    <form method="POST" use:enhance class="grid min-h-0 grid-rows-[minmax(0,1fr)_auto]">
      <div class="grid min-h-0 overflow-y-auto overscroll-contain lg:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)] lg:overflow-hidden">
        <div class="space-y-4 px-5 py-4 lg:overflow-y-auto lg:overscroll-contain">
          <Form.Field {form} name="title">
            <Form.Control>
              {#snippet children({ props })}
                <Form.Label>{m['design.exploration_field_title']()}</Form.Label>
                <Input {...props} bind:value={$formData.title} autocomplete="off" />
              {/snippet}
            </Form.Control>
            <Form.FieldErrors />
          </Form.Field>

          <Form.Field {form} name="objective">
            <Form.Control>
              {#snippet children({ props })}
                <Form.Label>{m['design.exploration_field_objective']()}</Form.Label>
                <Textarea {...props} bind:value={$formData.objective} autocomplete="off" rows={4} class="min-h-24 resize-y" placeholder={m['design.exploration_objective_placeholder']()} />
              {/snippet}
            </Form.Control>
            <Form.Description>{m['design.exploration_objective_hint']()}</Form.Description>
            <Form.FieldErrors />
          </Form.Field>

          <Form.Field {form} name="audience">
            <Form.Control>
              {#snippet children({ props })}
                <Form.Label>{m['design.exploration_field_audience']()}</Form.Label>
                <Input {...props} bind:value={$formData.audience} autocomplete="off" placeholder={m['design.exploration_audience_placeholder']()} />
              {/snippet}
            </Form.Control>
            <Form.FieldErrors />
          </Form.Field>

          <div class="grid gap-4 sm:grid-cols-2">
            <div class="space-y-2">
              <label class="text-sm font-medium leading-none" for="exploration-platform">{m['design.exploration_field_platform']()}</label>
              <Select.Root type="single" value={$formData.platform} onValueChange={selectPlatform}>
                <Select.Trigger id="exploration-platform" class="w-full">{platformLabel($formData.platform)}</Select.Trigger>
                <Select.Content>
                  <Select.Item value="responsive-web">{m['design.exploration_platform_responsive_web']()}</Select.Item>
                  <Select.Item value="desktop">{m['design.exploration_platform_desktop']()}</Select.Item>
                  <Select.Item value="mobile-web">{m['design.exploration_platform_mobile_web']()}</Select.Item>
                  <Select.Item value="native-mobile">{m['design.exploration_platform_native_mobile']()}</Select.Item>
                </Select.Content>
              </Select.Root>
            </div>
            <div class="space-y-2">
              <label class="text-sm font-medium leading-none" for="exploration-code-target">{m['design.exploration_field_code_target']()}</label>
              <Select.Root type="single" value={$formData.codeTarget} onValueChange={selectCodeTarget}>
                <Select.Trigger id="exploration-code-target" class="w-full">{codeTargetLabel($formData.codeTarget)}</Select.Trigger>
                <Select.Content>
                  <Select.Item value="svelar">{m['design.exploration_code_svelar']()}</Select.Item>
                  <Select.Item value="svelte">{m['design.exploration_code_svelte']()}</Select.Item>
                  <Select.Item value="react">{m['design.exploration_code_react']()}</Select.Item>
                  <Select.Item value="next">{m['design.exploration_code_next']()}</Select.Item>
                  <Select.Item value="vue">{m['design.exploration_code_vue']()}</Select.Item>
                  <Select.Item value="html">{m['design.exploration_code_html']()}</Select.Item>
                </Select.Content>
              </Select.Root>
            </div>
          </div>

          <div class="grid gap-4 sm:grid-cols-2">
            <Form.Field {form} name="constraints">
              <Form.Control>
                {#snippet children({ props })}
                  <Form.Label>{m['design.exploration_field_constraints']()}</Form.Label>
                  <Textarea {...props} bind:value={$formData.constraints} autocomplete="off" rows={3} class="min-h-20 resize-y" placeholder={m['design.exploration_constraints_placeholder']()} />
                {/snippet}
              </Form.Control>
              <Form.FieldErrors />
            </Form.Field>
            <Form.Field {form} name="references">
              <Form.Control>
                {#snippet children({ props })}
                  <Form.Label>{m['design.exploration_field_references']()}</Form.Label>
                  <Textarea {...props} bind:value={$formData.references} autocomplete="off" rows={3} class="min-h-20 resize-y" placeholder={m['design.exploration_references_placeholder']()} />
                {/snippet}
              </Form.Control>
              <Form.FieldErrors />
            </Form.Field>
          </div>

          <label class="flex cursor-pointer items-start gap-3 border-y border-border/70 py-3">
            <Checkbox checked={$formData.includeDarkMode} onCheckedChange={(value: boolean | 'indeterminate') => ($formData.includeDarkMode = value === true)} />
            <span class="min-w-0"><span class="block text-sm font-medium">{m['design.exploration_dark_mode']()}</span><span class="mt-1 block text-xs leading-5 text-muted-foreground">{m['design.exploration_dark_mode_hint']()}</span></span>
          </label>

          <fieldset class="space-y-2">
            <legend class="text-sm font-medium">{m['design.exploration_execution']()}</legend>
            <div class="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={m['design.exploration_execution']()}>
              <button type="button" role="radio" aria-checked={$formData.executionMode === 'manual'} class={$formData.executionMode === 'manual' ? 'flex min-h-20 items-start gap-3 rounded-md border border-[var(--app-accent)] bg-[var(--app-accent-soft)] p-3 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none' : 'flex min-h-20 items-start gap-3 rounded-md border border-border bg-transparent p-3 text-left transition-[background-color,border-color] hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'} onclick={() => selectExecution('manual')}>
                <UserRound size={16} class="mt-0.5 shrink-0" aria-hidden="true" /><span><strong class="block text-xs">{m['design.exploration_manual']()}</strong><span class="mt-1 block text-ui-sm leading-4 text-muted-foreground">{m['design.exploration_manual_hint']()}</span></span>
              </button>
              <button type="button" role="radio" aria-checked={$formData.executionMode === 'leader'} disabled={!leader} class={$formData.executionMode === 'leader' ? 'flex min-h-20 items-start gap-3 rounded-md border border-[var(--app-accent)] bg-[var(--app-accent-soft)] p-3 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none' : 'flex min-h-20 items-start gap-3 rounded-md border border-border bg-transparent p-3 text-left transition-[background-color,border-color] hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45'} onclick={() => selectExecution('leader')}>
                <Users size={16} class="mt-0.5 shrink-0" aria-hidden="true" /><span><strong class="block text-xs">{m['design.exploration_leader']()}</strong><span class="mt-1 block text-ui-sm leading-4 text-muted-foreground">{leader ? m['design.exploration_leader_hint']({ leader: leader.title, provider: leader.provider }) : m['design.exploration_no_leader']()}</span></span>
              </button>
            </div>
          </fieldset>

          {#if submitError}<p class="text-sm text-destructive" role="alert" aria-live="polite">{submitError}</p>{/if}
        </div>

        <aside class="border-t border-border/70 bg-muted/15 px-5 py-4 lg:overflow-y-auto lg:overscroll-contain lg:border-t-0 lg:border-l">
          <section>
            <h3 class="text-xs font-semibold uppercase text-muted-foreground">{m['design.exploration_directions']()}</h3>
            <div class="mt-3 divide-y divide-border/70 border-y border-border/70">
              <div class="flex gap-3 py-3"><ScanLine size={16} class="mt-0.5 shrink-0 text-[var(--app-info)]" aria-hidden="true" /><div><strong class="text-xs">{m['design.exploration_direction_clarity']()}</strong><p class="mt-1 text-ui-sm leading-4 text-muted-foreground">{m['design.exploration_direction_clarity_hint']()}</p></div></div>
              <div class="flex gap-3 py-3"><Sparkles size={16} class="mt-0.5 shrink-0 text-[var(--app-accent)]" aria-hidden="true" /><div><strong class="text-xs">{m['design.exploration_direction_expressive']()}</strong><p class="mt-1 text-ui-sm leading-4 text-muted-foreground">{m['design.exploration_direction_expressive_hint']()}</p></div></div>
              <div class="flex gap-3 py-3"><Gauge size={16} class="mt-0.5 shrink-0 text-[var(--app-success)]" aria-hidden="true" /><div><strong class="text-xs">{m['design.exploration_direction_efficient']()}</strong><p class="mt-1 text-ui-sm leading-4 text-muted-foreground">{m['design.exploration_direction_efficient_hint']()}</p></div></div>
            </div>
          </section>

          <section class="mt-5">
            <h3 class="text-xs font-semibold uppercase text-muted-foreground">{m['design.exploration_every_direction_delivers']()}</h3>
            <ul class="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-ui-sm">
              <li class="flex items-center gap-2"><Palette size={14} aria-hidden="true" />{m['design.exploration_output_brand']()}</li>
              <li class="flex items-center gap-2"><Palette size={14} aria-hidden="true" />{m['design.exploration_output_design']()}</li>
              <li class="flex items-center gap-2"><SwatchBook size={14} aria-hidden="true" />{m['design.exploration_output_tokens']()}</li>
              <li class="flex items-center gap-2"><Boxes size={14} aria-hidden="true" />{m['design.exploration_output_components']()}</li>
              <li class="flex items-center gap-2"><Play size={14} aria-hidden="true" />{m['design.exploration_output_prototype']()}</li>
              <li class="flex items-center gap-2"><Code2 size={14} aria-hidden="true" />{m['design.exploration_output_code']()}</li>
              <li class="flex items-center gap-2"><ShieldCheck size={14} aria-hidden="true" />{m['design.exploration_output_validation']()}</li>
            </ul>
          </section>

          <section class="mt-5 border-l-2 border-[var(--app-warning)] bg-[var(--app-warning)]/6 px-3 py-2.5">
            <div class="flex items-start gap-2"><Check size={14} class="mt-0.5 shrink-0 text-[var(--app-warning)]" aria-hidden="true" /><p class="text-ui-sm leading-5">{m['design.exploration_human_gate']()}</p></div>
          </section>
        </aside>
      </div>

      <Dialog.Footer class="m-0! rounded-none rounded-b-lg border-t border-border/70 px-5 py-3">
        <Button type="button" variant="outline" disabled={submitting} onclick={onClose}>{m['settings.cancel']()}</Button>
        <Button type="submit" disabled={submitting}>
          {#if submitting}<LoaderCircle size={14} class="animate-spin" aria-hidden="true" />{/if}
          {$formData.executionMode === 'leader' ? m['design.exploration_create_and_delegate']() : m['design.exploration_create_manual']()}
        </Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
