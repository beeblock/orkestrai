<script lang="ts">
  import { enhance } from '$app/forms';
  import { superForm } from 'sveltekit-superforms';
  import { Button, Badge, Card, CardHeader, CardTitle, CardContent, Input, Label, Alert } from '@beeblock/svelar/ui';

  let { data, form: actionData } = $props();
  let apiKeys = $state<any[]>([]);
  let showCreateForm = $state(false);
  let generatedKey = $state('');
  let showCopyAlert = $state(false);

  // svelte-ignore state_referenced_locally
  const {
    form: createKeyForm,
    errors: createKeyErrors,
    enhance: enhanceCreateKey,
    delayed: creatingKey,
  } = superForm(data.createKeyForm, {
    resetForm: true,
  });

  $effect(() => {
    apiKeys = data.apiKeys;
  });

  $effect(() => {
    if (actionData?.plainTextKey) {
      generatedKey = actionData.plainTextKey;
      showCreateForm = false;
    }
  });

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
    showCopyAlert = true;
    setTimeout(() => { showCopyAlert = false; }, 2000);
  }
</script>

<svelte:head>
  <title>API Keys</title>
</svelte:head>

<div class="space-y-8">
  <div>
    <h1 class="text-3xl font-bold text-foreground">API Keys</h1>
    <p class="text-muted-foreground mt-1">Manage your API keys for programmatic access</p>
  </div>

  {#if showCopyAlert}
    <Alert variant="default"><span class="text-sm">Copied to clipboard!</span></Alert>
  {/if}

  {#if actionData?.error}
    <Alert variant="destructive"><span class="text-sm">{actionData.error}</span></Alert>
  {/if}

  {#if generatedKey}
    <Alert variant="default">
      <div class="space-y-2">
        <p class="font-medium">API Key Created</p>
        <p class="text-sm">Copy this key now. You won't be able to see it again.</p>
        <div class="flex gap-2 mt-3">
          <code class="flex-1 bg-muted px-3 py-2 rounded text-sm font-mono break-all">{generatedKey}</code>
          <Button size="sm" variant="outline" onclick={() => copyToClipboard(generatedKey)}>Copy</Button>
        </div>
      </div>
    </Alert>
  {/if}

  {#if showCreateForm}
    <Card>
      <CardHeader><CardTitle>Create New API Key</CardTitle></CardHeader>
      <CardContent>
        <form method="POST" action="?/create" use:enhanceCreateKey novalidate class="space-y-4">
          <div class="space-y-2">
            <Label for="keyName">Key Name</Label>
            <Input
              id="keyName"
              name="name"
              placeholder="My API Key"
              bind:value={$createKeyForm.name}
              aria-invalid={$createKeyErrors.name ? 'true' : undefined}
              disabled={$creatingKey}
            />
            {#if $createKeyErrors.name}<p class="text-xs text-destructive">{$createKeyErrors.name[0]}</p>{/if}
          </div>
          <div class="space-y-2">
            <Label for="permissions">Permissions</Label>
            <Input
              id="permissions"
              name="permissions"
              placeholder="read,write"
              bind:value={$createKeyForm.permissions}
              aria-invalid={$createKeyErrors.permissions ? 'true' : undefined}
              disabled={$creatingKey}
            />
            <p class="text-xs text-muted-foreground">Comma-separated: read, write, admin</p>
            {#if $createKeyErrors.permissions}<p class="text-xs text-destructive">{$createKeyErrors.permissions[0]}</p>{/if}
          </div>
          <div class="flex gap-2">
            <Button type="submit" disabled={$creatingKey}>{$creatingKey ? 'Creating...' : 'Create Key'}</Button>
            <Button type="button" variant="outline" disabled={$creatingKey} onclick={() => { showCreateForm = false; }}>Cancel</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  {:else}
    <Button onclick={() => (showCreateForm = true)}>Create New Key</Button>
  {/if}

  <div class="space-y-4">
    <h2 class="text-xl font-bold text-foreground">Your Keys ({apiKeys.length})</h2>

    {#if apiKeys.length === 0}
      <Card>
        <CardContent class="pt-8 text-center">
          <p class="text-muted-foreground text-sm">No API keys yet. Create one to get started.</p>
        </CardContent>
      </Card>
    {:else}
      <div class="space-y-3">
        {#each apiKeys as key (key.id)}
          <Card>
            <CardContent class="pt-6">
              <div class="flex items-start justify-between gap-4">
                <div class="flex-1">
                  <div class="flex items-center gap-2 mb-2">
                    <h3 class="font-semibold text-foreground">{key.name}</h3>
                    <Badge variant="default">Active</Badge>
                  </div>
                  <p class="font-mono text-xs bg-muted px-2 py-1 rounded inline-block mb-2">{key.prefix}........</p>
                  <div class="flex gap-4 text-xs text-muted-foreground">
                    <span>Created {new Date(key.createdAt).toLocaleDateString()}</span>
                    <span>{key.lastUsedAt ? 'Last used ' + new Date(key.lastUsedAt).toLocaleDateString() : 'Never used'}</span>
                  </div>
                  {#if key.permissions.length > 0}
                    <div class="flex gap-1 mt-2">
                      {#each key.permissions as perm}
                        <Badge variant="secondary" class="text-xs">{perm}</Badge>
                      {/each}
                    </div>
                  {/if}
                </div>
                <form method="POST" action="?/revoke" use:enhance novalidate>
                  <input type="hidden" name="keyId" value={key.id} />
                  <Button size="sm" variant="destructive" type="submit"
                    onclick={(e) => { if (!confirm('Revoke key "' + key.name + '"?')) e.preventDefault(); }}>
                    Revoke
                  </Button>
                </form>
              </div>
            </CardContent>
          </Card>
        {/each}
      </div>
    {/if}
  </div>

  <Card>
    <CardHeader><CardTitle>Usage</CardTitle></CardHeader>
    <CardContent>
      <h4 class="font-medium text-foreground mb-2">Include your API key in the Authorization header</h4>
      <code class="block bg-muted px-4 py-3 rounded text-sm font-mono overflow-x-auto">
        curl -H "Authorization: Bearer sk_your_key_here" https://your-app.com/api/v1/data
      </code>
    </CardContent>
  </Card>
</div>
