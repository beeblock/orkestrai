<script lang="ts">
  import { defaults, superForm } from 'sveltekit-superforms';
  import { zod } from 'sveltekit-superforms/adapters';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Form from '$lib/components/ui/form';
  import * as Select from '$lib/components/ui/select';
  import { Input } from '$lib/components/ui/input';
  import { Button } from '$lib/components/ui/button';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { Label } from '$lib/components/ui/label';
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

<Dialog.Root {open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title>{provider ? m['dlg.new_agent_title']({ provider: provider.displayName }) : m['dlg.new_terminal_title']()}</Dialog.Title>
      <Dialog.Description>
        {provider ? m['dlg.new_agent_desc']() : m['dlg.new_terminal_desc']()}
      </Dialog.Description>
    </Dialog.Header>

    <form method="POST" use:enhance class="space-y-4">
        <Form.Field {form} name="title">
          <Form.Control>
            {#snippet children({ props })}
              <Form.Label>{m['dlg.name']()}</Form.Label>
              <Input {...props} bind:value={$formData!.title} placeholder={m['ph.agent_title']()} autofocus />
            {/snippet}
          </Form.Control>
          <Form.FieldErrors />
        </Form.Field>

        {#if provider && modelOptions.length}
          <Form.Field {form} name="model">
            <Form.Control>
              {#snippet children({ props })}
                <Form.Label>{m['dlg.model']()}</Form.Label>
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
            <Form.FieldErrors />
          </Form.Field>
        {/if}

        {#if provider && supportsEffort}
          <Form.Field {form} name="effort">
            <Form.Control>
              {#snippet children({ props })}
                <Form.Label>{m['dlg.effort_label']()}</Form.Label>
                <Select.Root type="single" value={$formData!.effort || '__default__'} onValueChange={(value) => ($formData!.effort = (value === '__default__' ? null : value) as AgentCreation['effort'])}>
                  <Select.Trigger {...props} class="w-full">
                    {$formData!.effort ? (EFFORT_LABELS[$formData!.effort] ?? $formData!.effort) : m['dlg.provider_default']()}
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
            <Form.FieldErrors />
          </Form.Field>
        {/if}

        {#if provider && supportsProfiles}
          <Form.Field {form} name="profileId">
            <Form.Control>
              {#snippet children({ props })}
                <Form.Label>{m['dlg.profile_label']()}</Form.Label>
                <Select.Root type="single" value={$formData!.profileId || '__default__'} onValueChange={(value: string) => ($formData!.profileId = value === '__default__' ? null : value)}>
                  <Select.Trigger {...props} class="w-full">
                    {$formData!.profileId ? (profiles.find((item) => item.id === $formData!.profileId)?.name ?? $formData!.profileId) : m['term.profile_default']()}
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
            <Form.FieldErrors />
            {#if profilesLoading}
              <p class="text-xs text-muted-foreground">{m['dlg.profile_loading']()}</p>
            {:else if !profiles.length}
              <p class="text-xs text-muted-foreground">{m['term.profile_empty']()}</p>
            {/if}
          </Form.Field>
        {/if}

        {#if provider}
          <Form.Field {form} name="leader">
            <Form.Control>
              {#snippet children({ props })}
                <div class="flex items-center gap-2">
                  <Checkbox {...props} checked={Boolean($formData!.leader)} onCheckedChange={(checked) => ($formData!.leader = checked === true)} />
                  <Label class="cursor-pointer" onclick={() => ($formData!.leader = !$formData!.leader)}>
                    {m['dlg.leader_label']()}
                  </Label>
                </div>
              {/snippet}
            </Form.Control>
            <Form.Description>{m['dlg.leader_desc']()}</Form.Description>
            <Form.FieldErrors />
          </Form.Field>
        {/if}

        {#if workspace && wsl.supported}
          <div class="space-y-2 rounded-md border border-border/70 bg-muted/20 p-3">
            <label class="text-sm font-medium" for="new-agent-runtime">{m['dlg.runtime_label']()}</label>
            <Select.Root type="single" value={runtimeMode} onValueChange={(value: string) => (runtimeMode = value as typeof runtimeMode)}>
              <Select.Trigger id="new-agent-runtime" class="w-full">
                {runtimeMode === 'default'
                  ? m['term.runtime_default_option']({ runtime: defaultRuntimeLabel })
                  : runtimeMode === 'wsl'
                    ? m['dlg.runtime_wsl']()
                    : m['dlg.runtime_native']()}
              </Select.Trigger>
              <Select.Content>
                <Select.Item value="default">{m['term.runtime_default_option']({ runtime: defaultRuntimeLabel })}</Select.Item>
                <Select.Item value="native">{m['dlg.runtime_native']()}</Select.Item>
                <Select.Item value="wsl">{m['dlg.runtime_wsl']()}</Select.Item>
              </Select.Content>
            </Select.Root>

            {#if runtimeMode === 'wsl'}
              <label class="text-sm font-medium" for="new-agent-wsl-distribution">{m['dlg.wsl_distribution']()}</label>
              <Select.Root type="single" value={wslDistribution} onValueChange={(value: string) => (wslDistribution = value)}>
                <Select.Trigger id="new-agent-wsl-distribution" class="w-full">
                  {wslDistribution || m['dlg.wsl_distribution_placeholder']()}
                </Select.Trigger>
                <Select.Content>
                  {#each wsl.distributions as distribution (distribution.name)}
                    <Select.Item value={distribution.name}>{distribution.name}</Select.Item>
                  {/each}
                </Select.Content>
              </Select.Root>
              {#if !wsl.distributions.length}
                <p class="text-xs text-destructive" role="alert">{wsl.error || m['dlg.wsl_unavailable']()}</p>
              {/if}
              <label class="text-sm font-medium" for="new-agent-wsl-path">{m['dlg.wsl_working_dir']()}</label>
              <Input id="new-agent-wsl-path" bind:value={wslWorkingDir} placeholder="/home/user/project" autocomplete="off" />
              <p class="text-xs text-muted-foreground">{m['term.runtime_path_hint']()}</p>
            {/if}
          </div>
        {/if}

        {#if provider}
          <p class:text-destructive={!selectedProvider?.installed} class="text-xs text-muted-foreground" role="status">
            {runtimeChecking
              ? m['term.runtime_checking_provider']({ provider: provider.displayName })
              : selectedProvider?.installed
                ? m['term.runtime_provider_ready']({ provider: provider.displayName })
                : m['term.runtime_provider_missing']({ provider: provider.displayName })}
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
