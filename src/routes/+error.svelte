<script lang="ts">
  import { page } from '$app/state';
  import { Button } from '@beeblock/svelar/ui';
</script>

<svelte:head>
  <title>{page.status} — Error</title>
</svelte:head>

<div class="flex items-center justify-center min-h-screen px-4">
  <div class="text-center max-w-md">
    <h1 class="text-7xl font-bold text-muted mb-4">{page.status}</h1>
    <p class="text-xl font-semibold text-foreground mb-2">
      {page.status === 404 ? 'Page Not Found' : page.status === 403 ? 'Forbidden' : page.status === 401 ? 'Unauthorized' : 'Something Went Wrong'}
    </p>
    <p class="text-muted-foreground mb-8">
      {page.error?.message || 'An unexpected error occurred. Please try again.'}
    </p>
    <div class="flex gap-3 justify-center">
      <Button href="/">Go Home</Button>
      <Button variant="outline" onclick={() => history.back()}>Go Back</Button>
    </div>
  </div>
</div>
