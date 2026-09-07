<script lang="ts">
  import { superForm } from 'sveltekit-superforms';
  import { Button, Input, Label, Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, Alert } from '@beeblock/svelar/ui';

  let { data } = $props();

  // svelte-ignore state_referenced_locally
  const { form, errors, message, enhance, delayed } = superForm(data.form);

  // Track if form was submitted successfully
  let submitted = $derived($message && !$errors.email);
</script>

<svelte:head>
  <title>Forgot Password</title>
</svelte:head>

<div class="flex items-center justify-center min-h-screen">
  <Card class="w-full max-w-md">
    <CardHeader>
      <CardTitle>Forgot Password</CardTitle>
      <CardDescription>Enter your email and we'll send you a reset link</CardDescription>
    </CardHeader>

    <CardContent class="space-y-4">
      {#if $message}
        <Alert variant="default">
          <span class="text-sm">{$message}</span>
        </Alert>
      {/if}

      {#if !submitted}
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

          <Button type="submit" class="w-full" disabled={$delayed}>
            {$delayed ? 'Sending...' : 'Send Reset Link'}
          </Button>
        </form>
      {/if}
    </CardContent>

    <CardFooter class="border-t pt-6">
      <p class="text-sm text-center w-full text-muted-foreground">
        Remember your password?
        <a href="/login" class="font-medium text-brand hover:underline">Sign in</a>
      </p>
    </CardFooter>
  </Card>
</div>
