<script lang="ts">
  import { Card, CardHeader, CardTitle, CardContent, CardFooter, Alert, Button } from '@beeblock/svelar/ui';

  let { data } = $props();
</script>

<svelte:head>
  <title>Verify Email</title>
</svelte:head>

<div class="flex items-center justify-center min-h-screen">
  <Card class="w-full max-w-md">
    <CardHeader>
      <CardTitle>Email Verification</CardTitle>
    </CardHeader>

    <CardContent>
      {#if data.success}
        <Alert variant="default">
          <span class="text-sm">{data.message}</span>
        </Alert>
      {:else}
        <Alert variant="destructive">
          <span class="text-sm">{data.message}</span>
        </Alert>
      {/if}
    </CardContent>

    <CardFooter class="border-t pt-6">
      <div class="w-full text-center">
        {#if data.success}
          <a href="/dashboard">
            <Button class="w-full">Go to Dashboard</Button>
          </a>
        {:else}
          <a href="/login">
            <Button variant="outline" class="w-full">Back to Sign In</Button>
          </a>
        {/if}
      </div>
    </CardFooter>
  </Card>
</div>
