<script lang="ts">
  import { defaults, superForm, type FormOptions, type SuperValidated } from 'sveltekit-superforms';
  import { zod } from 'sveltekit-superforms/adapters';
  import { getCsrfToken } from '@beeblock/svelar/http';
  import { toast } from '@beeblock/svelar/ui';
  import { Boxes, Check, CircleAlert, Code2, Gauge, LoaderCircle, Palette, Play, ScanLine, ShieldCheck, Sparkles, SwatchBook, UserRound, Users } from '@lucide/svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Form from '$lib/components/ui/form';
  import * as Select from '$lib/components/ui/select';
  import { Button } from '$lib/components/ui/button';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { Input } from '$lib/components/ui/input';
  import { Textarea } from '$lib/components/ui/textarea';
  import { SegmentedControl } from '$lib/components/ui/segmented';
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

{#snippet fieldError({ errors, errorProps }: { errors: string[]; errorProps: Record<string, unknown> })}
  {#each errors as error (error)}
    <p {...errorProps} class="flex items-center gap-1.5 text-ui-md text-[var(--app-danger)]"><CircleAlert size={13} class="shrink-0" aria-hidden="true" />{error}</p>
  {/each}
{/snippet}

<Dialog.Root {open} onOpenChange={(next) => !next && !submitting && onClose()}>
  <Dialog.Content class="flex max-h-[min(92dvh,860px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1000px]">
    <Dialog.Header class="shrink-0 border-b border-border/70 px-5 pt-5 pb-4 pr-12">
      <Dialog.Title class="text-balance">{m['design.exploration_title']()}</Dialog.Title>
      <Dialog.Description class="max-w-3xl">{m['design.exploration_description']()}</Dialog.Description>
    </Dialog.Header>

    <form method="POST" use:enhance class="flex min-h-0 flex-1 flex-col">
      <div class="grid min-h-0 flex-1 overflow-y-auto overscroll-contain lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)] lg:overflow-hidden">
        <div class="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-6 px-5 py-5 lg:overflow-y-auto lg:overscroll-contain">
          <!-- Grupo 1: o problema (nome e objetivo). -->
          <div class="grid gap-4">
            <Form.Field {form} name="title" class="space-y-1.5">
              <Form.Control>
                {#snippet children({ props })}
                  <Form.Label class="text-[13px]">{m['design.exploration_field_title']()}</Form.Label>
                  <Input {...props} bind:value={$formData.title} autocomplete="off" />
                {/snippet}
              </Form.Control>
              <Form.FieldErrors class="text-[12px] font-normal" children={fieldError} />
            </Form.Field>

            <Form.Field {form} name="objective" class="space-y-1.5">
              <Form.Control>
                {#snippet children({ props })}
                  <Form.Label class="text-[13px]">{m['design.exploration_field_objective']()}</Form.Label>
                  <Textarea {...props} bind:value={$formData.objective} autocomplete="off" rows={4} class="min-h-24 resize-y" placeholder={m['design.exploration_objective_placeholder']()} />
                {/snippet}
              </Form.Control>
              <Form.Description class="text-[12px] text-pretty">{m['design.exploration_objective_hint']()}</Form.Description>
              <Form.FieldErrors class="text-[12px] font-normal" children={fieldError} />
            </Form.Field>
          </div>

          <!-- Grupo 2: para quem, onde roda e em que codigo. -->
          <div class="grid gap-4">
            <div class="grid gap-4 sm:grid-cols-2">
              <Form.Field {form} name="audience" class="space-y-1.5">
                <Form.Control>
                  {#snippet children({ props })}
                    <Form.Label class="text-[13px]">{m['design.exploration_field_audience']()}</Form.Label>
                    <Input {...props} bind:value={$formData.audience} autocomplete="off" placeholder={m['design.exploration_audience_placeholder']()} />
                  {/snippet}
                </Form.Control>
                <Form.FieldErrors class="text-[12px] font-normal" children={fieldError} />
              </Form.Field>
              <div class="grid content-start gap-1.5">
                <label class="text-ui-lg font-medium" for="exploration-code-target">{m['design.exploration_field_code_target']()}</label>
                <Select.Root type="single" value={$formData.codeTarget} onValueChange={selectCodeTarget}>
                  <Select.Trigger id="exploration-code-target" class="w-full"><span class="truncate">{codeTargetLabel($formData.codeTarget)}</span></Select.Trigger>
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
            <div class="grid gap-1.5">
              <span class="text-ui-lg font-medium">{m['design.exploration_field_platform']()}</span>
              <SegmentedControl
                class="max-w-full self-start justify-self-start"
                label={m['design.exploration_field_platform']()}
                value={$formData.platform}
                onValueChange={selectPlatform}
                options={[
                  { value: 'responsive-web', label: m['design.exploration_platform_responsive_web']() },
                  { value: 'desktop', label: m['design.exploration_platform_desktop']() },
                  { value: 'mobile-web', label: m['design.exploration_platform_mobile_web']() },
                  { value: 'native-mobile', label: m['design.exploration_platform_native_mobile']() },
                ]}
              />
            </div>
          </div>

          <!-- Grupo 3: limites e referencias. -->
          <div class="grid gap-4">
            <div class="grid gap-4 sm:grid-cols-2">
              <Form.Field {form} name="constraints" class="space-y-1.5">
                <Form.Control>
                  {#snippet children({ props })}
                    <Form.Label class="text-[13px]">{m['design.exploration_field_constraints']()}</Form.Label>
                    <Textarea {...props} bind:value={$formData.constraints} autocomplete="off" rows={3} class="min-h-20 resize-y" placeholder={m['design.exploration_constraints_placeholder']()} />
                  {/snippet}
                </Form.Control>
                <Form.FieldErrors class="text-[12px] font-normal" children={fieldError} />
              </Form.Field>
              <Form.Field {form} name="references" class="space-y-1.5">
                <Form.Control>
                  {#snippet children({ props })}
                    <Form.Label class="text-[13px]">{m['design.exploration_field_references']()}</Form.Label>
                    <Textarea {...props} bind:value={$formData.references} autocomplete="off" rows={3} class="min-h-20 resize-y" placeholder={m['design.exploration_references_placeholder']()} />
                  {/snippet}
                </Form.Control>
                <Form.FieldErrors class="text-[12px] font-normal" children={fieldError} />
              </Form.Field>
            </div>
            <label class="flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2.5 shadow-[var(--app-shadow-border)] transition-[background-color] duration-150 hover:bg-[var(--app-hover)]">
              <Checkbox class="mt-px" checked={$formData.includeDarkMode} onCheckedChange={(value: boolean | 'indeterminate') => ($formData.includeDarkMode = value === true)} />
              <span class="min-w-0"><span class="block text-ui-lg font-medium leading-snug">{m['design.exploration_dark_mode']()}</span><span class="mt-0.5 block text-ui-md leading-snug text-pretty text-muted-foreground">{m['design.exploration_dark_mode_hint']()}</span></span>
            </label>
          </div>

          <!-- Grupo 4: quem executa. Cartoes de escolha em vez de select. -->
          <fieldset class="grid gap-2">
            <legend class="mb-2 text-ui-lg font-medium">{m['design.exploration_execution']()}</legend>
            <div class="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={m['design.exploration_execution']()}>
              <button type="button" role="radio" aria-checked={$formData.executionMode === 'manual'} class="choice-card" onclick={() => selectExecution('manual')}>
                <span class="choice-icon" aria-hidden="true"><UserRound size={15} /></span><span class="min-w-0"><strong class="block text-ui-lg font-medium">{m['design.exploration_manual']()}</strong><span class="mt-0.5 block text-ui-md leading-snug text-pretty text-muted-foreground">{m['design.exploration_manual_hint']()}</span></span>
              </button>
              <button type="button" role="radio" aria-checked={$formData.executionMode === 'leader'} disabled={!leader} class="choice-card" onclick={() => selectExecution('leader')}>
                <span class="choice-icon" aria-hidden="true"><Users size={15} /></span><span class="min-w-0"><strong class="block text-ui-lg font-medium">{m['design.exploration_leader']()}</strong><span class="mt-0.5 block text-ui-md leading-snug text-pretty text-muted-foreground">{leader ? m['design.exploration_leader_hint']({ leader: leader.title, provider: leader.provider }) : m['design.exploration_no_leader']()}</span></span>
              </button>
            </div>
          </fieldset>

          {#if submitError}<p class="flex items-start gap-2 rounded-lg bg-[var(--app-danger-soft)] px-3 py-2 text-ui-md leading-snug text-[var(--app-danger)]" role="alert"><CircleAlert size={14} class="mt-px shrink-0" aria-hidden="true" /><span>{submitError}</span></p>{/if}
        </div>

        <aside class="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-6 border-t border-border/70 bg-[var(--app-surface-subtle)]/50 px-5 py-5 lg:overflow-y-auto lg:overscroll-contain lg:border-t-0 lg:border-l">
          <section>
            <h3 class="section-label">{m['design.exploration_directions']()}</h3>
            <ul class="mt-3 grid gap-2">
              <li class="direction-row"><span class="direction-icon text-[var(--app-info)]" aria-hidden="true"><ScanLine size={15} /></span><div><strong class="text-ui-lg font-medium">{m['design.exploration_direction_clarity']()}</strong><p class="mt-0.5 text-ui-md leading-snug text-pretty text-muted-foreground">{m['design.exploration_direction_clarity_hint']()}</p></div></li>
              <li class="direction-row"><span class="direction-icon text-[var(--app-accent)]" aria-hidden="true"><Sparkles size={15} /></span><div><strong class="text-ui-lg font-medium">{m['design.exploration_direction_expressive']()}</strong><p class="mt-0.5 text-ui-md leading-snug text-pretty text-muted-foreground">{m['design.exploration_direction_expressive_hint']()}</p></div></li>
              <li class="direction-row"><span class="direction-icon text-[var(--app-success)]" aria-hidden="true"><Gauge size={15} /></span><div><strong class="text-ui-lg font-medium">{m['design.exploration_direction_efficient']()}</strong><p class="mt-0.5 text-ui-md leading-snug text-pretty text-muted-foreground">{m['design.exploration_direction_efficient_hint']()}</p></div></li>
            </ul>
          </section>

          <section>
            <h3 class="section-label">{m['design.exploration_every_direction_delivers']()}</h3>
            <ul class="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 text-ui-lg text-[var(--app-text-soft)]">
              <li class="flex items-center gap-2"><Palette size={14} class="shrink-0 text-muted-foreground" aria-hidden="true" />{m['design.exploration_output_brand']()}</li>
              <li class="flex items-center gap-2"><Palette size={14} class="shrink-0 text-muted-foreground" aria-hidden="true" />{m['design.exploration_output_design']()}</li>
              <li class="flex items-center gap-2"><SwatchBook size={14} class="shrink-0 text-muted-foreground" aria-hidden="true" />{m['design.exploration_output_tokens']()}</li>
              <li class="flex items-center gap-2"><Boxes size={14} class="shrink-0 text-muted-foreground" aria-hidden="true" />{m['design.exploration_output_components']()}</li>
              <li class="flex items-center gap-2"><Play size={14} class="shrink-0 text-muted-foreground" aria-hidden="true" />{m['design.exploration_output_prototype']()}</li>
              <li class="flex items-center gap-2"><Code2 size={14} class="shrink-0 text-muted-foreground" aria-hidden="true" />{m['design.exploration_output_code']()}</li>
              <li class="flex items-center gap-2"><ShieldCheck size={14} class="shrink-0 text-muted-foreground" aria-hidden="true" />{m['design.exploration_output_validation']()}</li>
            </ul>
          </section>

          <p class="flex items-start gap-2.5 rounded-lg bg-[var(--app-warning-soft)] px-3 py-2.5 text-ui-md leading-relaxed text-pretty text-[var(--app-text)]">
            <Check size={14} class="mt-0.5 shrink-0 text-[var(--app-warning)]" aria-hidden="true" />{m['design.exploration_human_gate']()}
          </p>
        </aside>
      </div>

      <Dialog.Footer class="m-0 shrink-0">
        <Button type="button" variant="outline" disabled={submitting} onclick={onClose}>{m['settings.cancel']()}</Button>
        <Button type="submit" disabled={submitting}>
          {#if submitting}<LoaderCircle size={14} class="animate-spin" aria-hidden="true" />{/if}
          {$formData.executionMode === 'leader' ? m['design.exploration_create_and_delegate']() : m['design.exploration_create_manual']()}
        </Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>

<style>
  /* Cartao de escolha: contorno por sombra; selecionado ganha anel de acento. */
  .choice-card {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    min-height: 72px;
    padding: 12px;
    border: 0;
    border-radius: 10px;
    background: transparent;
    box-shadow: var(--app-shadow-border);
    color: var(--app-text);
    text-align: left;
    cursor: pointer;
    transition:
      background-color var(--duration-quick) ease-out,
      box-shadow var(--duration-quick) ease-out;
  }

  .choice-card:hover:not(:disabled) {
    background: var(--app-hover);
  }

  .choice-card[aria-checked='true'] {
    background: var(--app-accent-soft);
    box-shadow: inset 0 0 0 1px var(--app-accent);
  }

  .choice-card:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 2px;
  }

  .choice-card:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .choice-icon,
  .direction-icon {
    display: grid;
    flex-shrink: 0;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 8px;
    background: var(--app-hover);
  }

  .choice-icon {
    color: var(--app-text-soft);
  }

  .choice-card[aria-checked='true'] .choice-icon {
    background: var(--app-accent);
    color: var(--app-accent-contrast);
  }

  .direction-row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 8px 0;
  }
</style>
