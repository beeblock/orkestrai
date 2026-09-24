<script lang="ts">
  import { defaults, superForm } from 'sveltekit-superforms';
  import { zod } from 'sveltekit-superforms/adapters';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Form from '$lib/components/ui/form';
  import * as Select from '$lib/components/ui/select';
  import { Input } from '$lib/components/ui/input';
  import { Button } from '$lib/components/ui/button';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { SegmentedControl } from '$lib/components/ui/segmented';
  import { CircleAlert, CircleCheck, LoaderCircle } from '@lucide/svelte';
  import ModelCombobox from './ModelCombobox.svelte';
  import { createAgentNodeSchema } from '$lib/modules/agent-room/contracts/schemas/schemas.js';
  import type { AgentProviderInfo, ProviderProfile, Workspace, WorkspaceExecutionRuntime } from '$lib/modules/agent-room/domain/types.js';
  import { workspaceExecutionRuntime } from '$lib/modules/agent-room/domain/runtime.js';
  import * as m from '$lib/paraglide/messages.js';

  export type AgentCreation = {
    title: string;
    model: string | null;
    effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra' | null;
    leader: boolean;
    executionRuntime: WorkspaceExecutionRuntime | null;
    profileId: string | null;
  };

  type Props = {
    open: boolean;
    /** Provider do agente (null = shell puro). */
    provider: AgentProviderInfo | null;
    workspace: Workspace | null;
    /** Pre-marca "Lider" (primeiro agente do workspace — fluxo zero-config). */
    defaultLeader?: boolean;
    onConfirm: (creation: AgentCreation) => void;
    onCancel: () => void;
  };

  let { open, provider, workspace, defaultLeader = false, onConfirm, onCancel }: Props = $props();
  let runtimeMode = $state<'default' | 'native' | 'wsl'>('default');
  let wslDistribution = $state('');
  let wslWorkingDir = $state('');
  let runtimeProvider = $state<AgentProviderInfo | null>(null);
  let runtimeChecking = $state(false);
  let profiles = $state<ProviderProfile[]>([]);
  let profilesLoading = $state(false);
  let profileLoadGeneration = 0;
  let wsl = $state<{ supported: boolean; distributions: Array<{ name: string }>; inferred: { distribution: string; linuxWorkingDir: string } | null; error: string | null }>({
    supported: false,
    distributions: [],
    inferred: null,
    error: null,
  });
  const defaultRuntime = $derived(workspace ? workspaceExecutionRuntime(workspace) : { kind: 'native' as const });
  const defaultRuntimeLabel = $derived(defaultRuntime.kind === 'wsl' ? `WSL · ${defaultRuntime.distribution}` : m['dlg.runtime_native']());

  const EFFORT_LABELS: Record<string, string> = {
    low: m['dlg.effort_low'](),
    medium: m['dlg.effort_medium'](),
    high: m['dlg.effort_high'](),
    xhigh: m['dlg.effort_xhigh'](),
    max: m['dlg.effort_max'](),
    ultra: m['dlg.effort_ultra'](),
  };

  const selectedProvider = $derived(runtimeProvider ?? provider);
  const modelOptions = $derived(selectedProvider?.models ?? []);

  // Esforcos do modelo selecionado (quando informado); sem selecao, usa a
  // capacidade declarada pelo adapter. Providers sem effort ficam ocultos.
  const effortOptions = $derived.by(() => {
    if (!selectedProvider) return [];
    const selected = modelOptions.find((option) => option.value === ($formData?.model ?? ''));
    const efforts = selected?.efforts?.length ? selected.efforts : (selectedProvider.efforts ?? []);
    return efforts.map((value) => ({ value, label: EFFORT_LABELS[value] ?? value }));
  });
  const supportsEffort = $derived(effortOptions.length > 0);
  const supportsProfiles = $derived(Boolean(selectedProvider?.profileStrategy && selectedProvider.profileStrategy.kind !== 'unsupported'));

  async function loadProfiles(providerId: string) {
    const generation = ++profileLoadGeneration;
    profilesLoading = true;
    profiles = [];
    try {
      const response = await fetch(`/api/agent-room/provider-profiles?providerId=${encodeURIComponent(providerId)}`);
      const payload = await response.json() as { data?: unknown; error?: string };
      if (!response.ok) throw new Error(payload.error || 'Profile request failed.');
      if (generation !== profileLoadGeneration) return;
      profiles = Array.isArray(payload.data)
        ? payload.data.filter((item): item is ProviderProfile => (
            Boolean(item)
            && typeof item === 'object'
            && typeof (item as ProviderProfile).id === 'string'
            && typeof (item as ProviderProfile).name === 'string'
            && (item as ProviderProfile).providerId === providerId
          )).slice(0, 100)
        : [];
    } catch {
      if (generation === profileLoadGeneration) profiles = [];
    } finally {
      if (generation === profileLoadGeneration) profilesLoading = false;
    }
  }

  const schema = createAgentNodeSchema as unknown as Parameters<typeof zod>[0];

  const form = superForm(defaults(zod(schema)), {
    SPA: true,
    validators: zod(schema),
    async onUpdate({ form: f }) {
      if (!f.valid) return;
      onConfirm({
        title: f.data.title,
        model: f.data.model || null,
        effort: (f.data.effort as AgentCreation['effort']) ?? null,
        leader: Boolean(f.data.leader),
        executionRuntime: runtimeMode === 'default'
          ? null
          : runtimeMode === 'native'
            ? { kind: 'native' }
            : { kind: 'wsl', distribution: wslDistribution, linuxWorkingDir: wslWorkingDir.trim() },
        profileId: f.data.profileId ?? null,
      });
    },
  });

  const { form: formData, enhance, errors } = form;

  // Preenche o nome padrao do provider a cada abertura do dialogo.
  let lastOpen = false;
  $effect(() => {
    if (open && !lastOpen) {
      formData.set({
        title: provider?.displayName ?? 'Shell',
        model: '',
        effort: null,
        profileId: null,
        leader: provider ? defaultLeader : false,
      });
      runtimeMode = 'default';
      runtimeProvider = provider;
      wslDistribution = defaultRuntime.kind === 'wsl' ? defaultRuntime.distribution : '';
      wslWorkingDir = defaultRuntime.kind === 'wsl' ? defaultRuntime.linuxWorkingDir : '';
      if (provider?.profileStrategy && provider.profileStrategy.kind !== 'unsupported') {
        void loadProfiles(provider.id);
      } else {
        profileLoadGeneration += 1;
        profiles = [];
        profilesLoading = false;
      }
      if (workspace) void loadWslAvailability(workspace.workingDir);
    } else if (!open && lastOpen) {
      profileLoadGeneration += 1;
      profilesLoading = false;
    }
    lastOpen = open;
  });

  $effect(() => {
    if (!open || !workspace || !provider) return;
    const mode = runtimeMode;
    const distribution = wslDistribution;
    const path = wslWorkingDir;
    if (mode === 'default') {
      runtimeProvider = provider;
      runtimeChecking = false;
      return;
    }
    if (mode === 'wsl' && !distribution) {
      runtimeChecking = false;
      return;
    }
    runtimeChecking = true;
    const timer = setTimeout(() => void refreshRuntimeProvider(mode, distribution, path), 250);
    return () => clearTimeout(timer);
  });

  async function refreshRuntimeProvider(mode: 'default' | 'native' | 'wsl', distribution: string, path: string) {
    if (!workspace || !provider || (mode === 'wsl' && !distribution)) return;
    runtimeChecking = true;
    try {
      const params = new URLSearchParams({ workspaceId: workspace.id, runtimeMode: mode });
      if (mode === 'wsl') {
        params.set('wslDistribution', distribution);
        if (path.trim()) params.set('wslWorkingDir', path.trim());
      }
      const response = await fetch(`/api/agent-room/status?${params}`);
      const result = await response.json();
      if (!response.ok || result.error) throw new Error(result.error || 'Provider check failed.');
      const detected: AgentProviderInfo = (result.data?.providers ?? [])
        .find((item: AgentProviderInfo) => item.id === provider?.id) ?? provider;
      runtimeProvider = detected;
      if ($formData!.model && !detected.models?.some((model) => model.value === $formData!.model)) {
        $formData!.model = '';
        $formData!.effort = null;
      }
    } catch {
      runtimeProvider = { ...provider, installed: false };
    } finally {
      runtimeChecking = false;
    }
  }

  async function loadWslAvailability(path: string) {
    try {
      const response = await fetch(`/api/agent-room/runtimes/wsl?path=${encodeURIComponent(path)}`);
      wsl = (await response.json()).data ?? wsl;
      if (!wslDistribution && wsl.inferred) wslDistribution = wsl.inferred.distribution;
      if (!wslWorkingDir && wsl.inferred) wslWorkingDir = wsl.inferred.linuxWorkingDir;
    } catch {
      wsl = { supported: false, distributions: [], inferred: null, error: null };
    }
  }
</script>

<!-- Erros de campo com o mesmo desenho em todos os dialogos: icone + mensagem. -->
{#snippet fieldError({ errors, errorProps }: { errors: string[]; errorProps: Record<string, unknown> })}
  {#each errors as error (error)}
    <p {...errorProps} class="flex items-center gap-1.5 text-ui-md text-[var(--app-danger)]"><CircleAlert size={13} class="shrink-0" aria-hidden="true" />{error}</p>
  {/each}
{/snippet}

<Dialog.Root {open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
  <Dialog.Content class={provider ? 'sm:max-w-[560px]' : 'sm:max-w-[420px]'}>
    <Dialog.Header>
      <Dialog.Title>{provider ? m['dlg.new_agent_title']({ provider: provider.displayName }) : m['dlg.new_terminal_title']()}</Dialog.Title>
      <Dialog.Description>
        {provider ? m['dlg.new_agent_desc']() : m['dlg.new_terminal_desc']()}
      </Dialog.Description>
    </Dialog.Header>

    <form method="POST" use:enhance class="grid gap-5">
      <Form.Field {form} name="title" class="space-y-1.5">
        <Form.Control>
          {#snippet children({ props })}
            <Form.Label class="text-[13px]">{m['dlg.name']()}</Form.Label>
            <Input {...props} bind:value={$formData!.title} placeholder={m['ph.agent_title']()} autocomplete="off" autofocus />
          {/snippet}
        </Form.Control>
        <Form.FieldErrors class="text-[12px] font-normal" children={fieldError} />
      </Form.Field>

      {#if provider && (modelOptions.length || supportsEffort || supportsProfiles)}
        <!-- Modelo, esforco e perfil formam um grupo: o "como" o agente pensa. -->
        <div class="grid gap-3">
          {#if modelOptions.length || supportsEffort}
            <div class="grid gap-3 sm:grid-cols-2">
              {#if modelOptions.length}
                <Form.Field {form} name="model" class="min-w-0 space-y-1.5">
                  <Form.Control>
                    {#snippet children({ props })}
                      <Form.Label class="text-[13px]">{m['dlg.model']()}</Form.Label>
                      <ModelCombobox
                        fieldProps={props}
                        value={String($formData!.model ?? '')}
                        options={modelOptions}
                        defaultLabel={m['dlg.provider_default']()}
                        searchPlaceholder={m['dlg.search_models']()}
                        emptyLabel={m['dlg.no_models']()}
                        ariaLabel={m['dlg.model']()}
                        onValueChange={(value) => ($formData!.model = value)}
                      />
                    {/snippet}
                  </Form.Control>
                  <Form.FieldErrors class="text-[12px] font-normal" children={fieldError} />
                </Form.Field>
              {/if}

              {#if supportsEffort}
                <Form.Field {form} name="effort" class="min-w-0 space-y-1.5">
                  <Form.Control>
                    {#snippet children({ props })}
                      <Form.Label class="text-[13px]">{m['dlg.effort_label']()}</Form.Label>
                      <Select.Root type="single" value={$formData!.effort || '__default__'} onValueChange={(value) => ($formData!.effort = (value === '__default__' ? null : value) as AgentCreation['effort'])}>
                        <Select.Trigger {...props} class="w-full">
                          <span class="truncate">{$formData!.effort ? (EFFORT_LABELS[$formData!.effort] ?? $formData!.effort) : m['dlg.provider_default']()}</span>
                        </Select.Trigger>
                        <Select.Content>
                          <Select.Item value="__default__" label={m['dlg.provider_default']()} />
                          {#each effortOptions as option (option.value)}
                            <Select.Item value={option.value} label={option.label} />
                          {/each}
                        </Select.Content>
                      </Select.Root>
                    {/snippet}
                  </Form.Control>
                  <Form.FieldErrors class="text-[12px] font-normal" children={fieldError} />
                </Form.Field>
              {/if}
            </div>
          {/if}

          {#if supportsProfiles}
            <Form.Field {form} name="profileId" class="space-y-1.5">
              <Form.Control>
                {#snippet children({ props })}
                  <Form.Label class="text-[13px]">{m['dlg.profile_label']()}</Form.Label>
                  <Select.Root type="single" value={$formData!.profileId || '__default__'} onValueChange={(value: string) => ($formData!.profileId = value === '__default__' ? null : value)}>
                    <Select.Trigger {...props} class="w-full">
                      <span class="truncate">{$formData!.profileId ? (profiles.find((item) => item.id === $formData!.profileId)?.name ?? $formData!.profileId) : m['term.profile_default']()}</span>
                    </Select.Trigger>
                    <Select.Content>
                      <Select.Item value="__default__" label={m['term.profile_default']()} />
                      {#each profiles as profileOption (profileOption.id)}
                        <Select.Item value={profileOption.id} label={profileOption.name} />
                      {/each}
                    </Select.Content>
                  </Select.Root>
                {/snippet}
              </Form.Control>
              <Form.FieldErrors class="text-[12px] font-normal" children={fieldError} />
              {#if profilesLoading}
                <p class="flex items-center gap-1.5 text-ui-md text-muted-foreground"><LoaderCircle size={12} class="animate-spin" aria-hidden="true" />{m['dlg.profile_loading']()}</p>
              {:else if !profiles.length}
                <p class="text-ui-md text-muted-foreground">{m['term.profile_empty']()}</p>
              {/if}
            </Form.Field>
          {/if}
        </div>
      {/if}

      {#if provider}
        <!-- Linha inteira clicavel: o rotulo aponta para o checkbox. -->
        <Form.Field {form} name="leader" class="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-1 space-y-0 rounded-lg px-3 py-2.5 shadow-[var(--app-shadow-border)] transition-[background-color] duration-150 hover:bg-[var(--app-hover)]">
          <Form.Control>
            {#snippet children({ props })}
              <Checkbox {...props} class="row-span-2 mt-px" checked={Boolean($formData!.leader)} onCheckedChange={(checked) => ($formData!.leader = checked === true)} />
              <Form.Label class="cursor-pointer text-[13px] leading-snug">{m['dlg.leader_label']()}</Form.Label>
            {/snippet}
          </Form.Control>
          <Form.Description class="col-start-2 text-[12px] leading-relaxed text-pretty">{m['dlg.leader_desc']()}</Form.Description>
          <Form.FieldErrors class="col-start-2 text-[12px] font-normal" children={fieldError} />
        </Form.Field>
      {/if}

      {#if workspace && wsl.supported}
        <section class="grid gap-3 border-t border-[var(--app-border)] pt-4" aria-labelledby="new-agent-runtime-label">
          <div class="grid gap-1.5">
            <span id="new-agent-runtime-label" class="text-ui-lg font-medium">{m['dlg.runtime_label']()}</span>
            <SegmentedControl
              class="w-fit max-w-full"
              label={m['dlg.runtime_label']()}
              value={runtimeMode}
              onValueChange={(value) => (runtimeMode = value)}
              options={[
                { value: 'default', label: m['term.runtime_default_option']({ runtime: defaultRuntimeLabel }) },
                { value: 'native', label: m['dlg.runtime_native']() },
                { value: 'wsl', label: m['dlg.runtime_wsl']() },
              ]}
            />
          </div>

          {#if runtimeMode === 'wsl'}
            <div class="grid gap-3 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
              <div class="grid min-w-0 content-start gap-1.5">
                <label class="text-ui-lg font-medium" for="new-agent-wsl-distribution">{m['dlg.wsl_distribution']()}</label>
                <Select.Root type="single" value={wslDistribution} onValueChange={(value: string) => (wslDistribution = value)}>
                  <Select.Trigger id="new-agent-wsl-distribution" class="w-full">
                    <span class="truncate">{wslDistribution || m['dlg.wsl_distribution_placeholder']()}</span>
                  </Select.Trigger>
                  <Select.Content>
                    {#each wsl.distributions as distribution (distribution.name)}
                      <Select.Item value={distribution.name}>{distribution.name}</Select.Item>
                    {/each}
                  </Select.Content>
                </Select.Root>
              </div>
              <div class="grid min-w-0 content-start gap-1.5">
                <label class="text-ui-lg font-medium" for="new-agent-wsl-path">{m['dlg.wsl_working_dir']()}</label>
                <Input id="new-agent-wsl-path" bind:value={wslWorkingDir} placeholder="/home/user/project" autocomplete="off" spellcheck={false} class="font-mono text-[13px]" />
              </div>
              <p class="text-ui-md text-muted-foreground sm:col-span-2">{m['term.runtime_path_hint']()}</p>
            </div>
            {#if !wsl.distributions.length}
              <p class="flex items-start gap-2 rounded-lg bg-[var(--app-danger-soft)] px-3 py-2 text-ui-md leading-snug text-[var(--app-danger)]" role="alert"><CircleAlert size={14} class="mt-px shrink-0" aria-hidden="true" /><span>{wsl.error || m['dlg.wsl_unavailable']()}</span></p>
            {/if}
          {/if}
        </section>
      {/if}

      {#if provider}
        <!-- Disponibilidade do provider: estado com icone, nao so cor. -->
        <p
          class="flex items-start gap-2 text-ui-md leading-snug"
          class:text-muted-foreground={runtimeChecking || selectedProvider?.installed}
          class:provider-missing={!runtimeChecking && !selectedProvider?.installed}
          role="status"
        >
          {#if runtimeChecking}
            <LoaderCircle size={14} class="mt-px shrink-0 animate-spin" aria-hidden="true" />
          {:else if selectedProvider?.installed}
            <CircleCheck size={14} class="mt-px shrink-0 text-[var(--app-success)]" aria-hidden="true" />
          {:else}
            <CircleAlert size={14} class="mt-px shrink-0" aria-hidden="true" />
          {/if}
          <span class="text-pretty">
            {runtimeChecking
              ? m['term.runtime_checking_provider']({ provider: provider.displayName })
              : selectedProvider?.installed
                ? m['term.runtime_provider_ready']({ provider: provider.displayName })
                : m['term.runtime_provider_missing']({ provider: provider.displayName })}
          </span>
        </p>
      {/if}

      <Dialog.Footer>
        <Button type="button" variant="outline" onclick={onCancel}>{m['dlg.cancel']()}</Button>
        <Button
          type="submit"
          disabled={(runtimeMode === 'wsl' && !wslDistribution) || Boolean(provider && (runtimeChecking || !selectedProvider?.installed))}
        >{m['dlg.create_agent']()}</Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>

<style>
  /* Provider ausente bloqueia a criacao: mesmo bloco de alerta dos dialogos. */
  .provider-missing {
    padding: 8px 12px;
    border-radius: 8px;
    background: var(--app-danger-soft);
    color: var(--app-danger);
  }
</style>
