<script lang="ts">
  import { superForm } from 'sveltekit-superforms';
  import { Button, Input, Label, Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, Alert } from '@beeblock/svelar/ui';

  let { data } = $props();

  // svelte-ignore state_referenced_locally
  const { form, errors, message, enhance, delayed } = superForm(data.form, {
    onResult: ({ result }) => {
      if (result.type === 'failure') {
        $form.password = '';
      }
    },
  });
</script>

<svelte:head>
  <title>Sign In</title>
</svelte:head>

<div class="flex items-center justify-center min-h-screen">
  <Card class="w-full max-w-md">
    <CardHeader>
      <CardTitle>Sign In</CardTitle>
      <CardDescription>Enter your credentials to access your account</CardDescription>
    </CardHeader>

    <CardContent class="space-y-4">
      {#if $message}
        <Alert variant="destructive">
          <span class="text-sm">{$message}</span>
        </Alert>
      {/if}

      <form method="POST" use:enhance class="space-y-4">
        <div class="space-y-2">
          <Label for="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            placeholder="you@example.com"
            bind:value={$form.email}
            aria-invalid={$errors.email ? 'true' : undefined}
            disabled={$delayed}
          />
          {#if $errors.email}
            <p class="text-sm text-destructive">{$errors.email[0]}</p>
          {/if}
        </div>

        <div class="space-y-2">
          <Label for="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            placeholder="Enter your password"
            bind:value={$form.password}
            aria-invalid={$errors.password ? 'true' : undefined}
            disabled={$delayed}
          />
          {#if $errors.password}
            <p class="text-sm text-destructive">{$errors.password[0]}</p>
          {/if}
        </div>

        <div class="flex items-center justify-between">
          <Button type="submit" class="w-full" disabled={$delayed}>
            {$delayed ? 'Signing in...' : 'Sign In'}
          </Button>
        </div>

        <div class="text-center">
          <a href="/forgot-password" class="text-sm text-muted-foreground hover:text-brand hover:underline">Forgot your password?</a>
        </div>

        {#if data.otpEnabled}
          <div class="text-center">
            <a href="/otp-login" class="text-sm text-muted-foreground hover:text-brand hover:underline">Sign in with a code instead</a>
          </div>
        {/if}
      </form>
    </CardContent>

    <CardFooter class="border-t pt-6">
      <p class="text-sm text-center w-full text-muted-foreground">
        Don't have an account?
        <a href="/register" class="font-medium text-brand hover:underline">Create one</a>
      </p>
    </CardFooter>
  </Card>
</div>
