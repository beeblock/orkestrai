<script lang="ts">
  import { superForm } from 'sveltekit-superforms';
  import { Button, Input, Label, Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, Alert } from '@beeblock/svelar/ui';
  import { page } from '$app/state';

  let { data } = $props();

  // Two-step form: request code, then verify code
  let codeSent = $state(false);
  let email = $state('');

  // svelte-ignore state_referenced_locally
  const { form: requestForm, errors: requestErrors, enhance: requestEnhance, delayed: requestDelayed } = superForm(data.requestForm, {
    onResult: ({ result }) => {
      if (result.type === 'success' && result.data?.codeSent) {
        codeSent = true;
        email = result.data.email;
      }
    },
  });

  // svelte-ignore state_referenced_locally
  const { form: verifyForm, errors: verifyErrors, enhance: verifyEnhance, delayed: verifyDelayed, message: verifyMessage } = superForm(data.verifyForm);
</script>

<svelte:head>
  <title>Sign In with Code</title>
</svelte:head>

<div class="flex items-center justify-center min-h-screen">
  <Card class="w-full max-w-md">
    <CardHeader>
      <CardTitle>Sign In with Code</CardTitle>
      <CardDescription>
        {#if codeSent}
          Enter the 6-digit code sent to {email}
        {:else}
          We'll send a one-time code to your email
        {/if}
      </CardDescription>
    </CardHeader>

    <CardContent class="space-y-4">
      {#if $verifyMessage}
        <Alert variant="destructive">
          <span class="text-sm">{$verifyMessage}</span>
        </Alert>
      {/if}

      {#if !codeSent}
        <form method="POST" action="?/send" use:requestEnhance class="space-y-4">
          <div class="space-y-2">
            <Label for="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              placeholder="you@example.com"
              bind:value={$requestForm.email}
              aria-invalid={$requestErrors.email ? 'true' : undefined}
              disabled={$requestDelayed}
            />
            {#if $requestErrors.email}
              <p class="text-sm text-destructive">{$requestErrors.email[0]}</p>
            {/if}
          </div>

          <Button type="submit" class="w-full" disabled={$requestDelayed}>
            {$requestDelayed ? 'Sending...' : 'Send Code'}
          </Button>
        </form>
      {:else}
        <form method="POST" action="?/verify" use:verifyEnhance class="space-y-4">
          <input type="hidden" name="email" value={email} />

          <div class="space-y-2">
            <Label for="code">Verification Code</Label>
            <Input
              id="code"
              name="code"
              type="text"
              inputmode="numeric"
              pattern="[0-9]*"
              maxlength={6}
              placeholder="000000"
              bind:value={$verifyForm.code}
              aria-invalid={$verifyErrors.code ? 'true' : undefined}
              disabled={$verifyDelayed}
              class="text-center text-2xl tracking-[0.5em] font-mono"
            />
            {#if $verifyErrors.code}
              <p class="text-sm text-destructive">{$verifyErrors.code[0]}</p>
            {/if}
          </div>

          <Button type="submit" class="w-full" disabled={$verifyDelayed}>
            {$verifyDelayed ? 'Verifying...' : 'Verify & Sign In'}
          </Button>

          <button
            type="button"
            class="w-full text-sm text-muted-foreground hover:text-brand hover:underline"
            onclick={() => { codeSent = false; }}
          >
            Use a different email
          </button>
        </form>
      {/if}
    </CardContent>

    <CardFooter class="border-t pt-6">
      <p class="text-sm text-center w-full text-muted-foreground">
        Prefer a password?
        <a href="/login" class="font-medium text-brand hover:underline">Sign in with password</a>
      </p>
    </CardFooter>
  </Card>
</div>
