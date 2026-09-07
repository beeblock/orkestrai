<script lang="ts">
  import { superForm } from 'sveltekit-superforms';
  import { Button, Input, Label, Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, Alert } from '@beeblock/svelar/ui';

  let { data } = $props();

  // svelte-ignore state_referenced_locally
  const { form, errors, message, enhance, delayed } = superForm(data.form);
</script>

<svelte:head>
  <title>Create Account</title>
</svelte:head>

<div class="flex items-center justify-center min-h-screen">
  <Card class="w-full max-w-md">
    <CardHeader>
      <CardTitle>Create Account</CardTitle>
      <CardDescription>Fill in the details below to get started</CardDescription>
    </CardHeader>

    <CardContent class="space-y-4">
      {#if $message}
        <Alert variant="destructive">
          <span class="text-sm">{$message}</span>
        </Alert>
      {/if}

      <form method="POST" use:enhance class="space-y-4">
        <div class="space-y-2">
          <Label for="name">Name</Label>
          <Input
            id="name"
            name="name"
            type="text"
            placeholder="Your name"
            bind:value={$form.name}
            aria-invalid={$errors.name ? 'true' : undefined}
            disabled={$delayed}
          />
          {#if $errors.name}
            <p class="text-sm text-destructive">{$errors.name[0]}</p>
          {/if}
        </div>

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
            placeholder="At least 8 characters"
            bind:value={$form.password}
            aria-invalid={$errors.password ? 'true' : undefined}
            disabled={$delayed}
          />
          {#if $errors.password}
            <p class="text-sm text-destructive">{$errors.password[0]}</p>
          {/if}
        </div>

        <div class="space-y-2">
          <Label for="password_confirmation">Confirm Password</Label>
          <Input
            id="password_confirmation"
            name="password_confirmation"
            type="password"
            placeholder="Repeat your password"
            bind:value={$form.password_confirmation}
            aria-invalid={$errors.password_confirmation ? 'true' : undefined}
            disabled={$delayed}
          />
          {#if $errors.password_confirmation}
            <p class="text-sm text-destructive">{$errors.password_confirmation[0]}</p>
          {/if}
        </div>

        <Button type="submit" class="w-full" disabled={$delayed}>
          {$delayed ? 'Creating account...' : 'Create Account'}
        </Button>
      </form>
    </CardContent>

    <CardFooter class="border-t pt-6">
      <p class="text-sm text-center w-full text-muted-foreground">
        Already have an account?
        <a href="/login" class="font-medium text-brand hover:underline">Sign in</a>
      </p>
    </CardFooter>
  </Card>
</div>
