<script lang="ts">
  import { enhance } from '$app/forms';
  import { superForm } from 'sveltekit-superforms';
  import { Button, Badge, Card, CardHeader, CardTitle, CardDescription, CardContent, Input, Label, Alert } from '@beeblock/svelar/ui';

  let { data, form: actionData } = $props();
  let members = $state<any[]>([]);
  let invitations = $state<any[]>([]);
  let showInviteForm = $state(false);
  let alertMessage = $state('');
  let alertType = $state<'success' | 'error'>('success');

  // svelte-ignore state_referenced_locally
  const {
    form: inviteForm,
    errors: inviteErrors,
    enhance: enhanceInvite,
    delayed: inviting,
  } = superForm(data.inviteForm, {
    resetForm: true,
  });

  // svelte-ignore state_referenced_locally
  const {
    form: teamForm,
    errors: teamErrors,
    enhance: enhanceUpdateTeam,
    delayed: updatingTeam,
  } = superForm(data.updateTeamForm);

  $effect(() => {
    members = data.members;
    invitations = data.invitations;
    if (data.team) {
      $inviteForm.teamId = data.team.id;
      $teamForm.teamId = data.team.id;
      $teamForm.name = data.team.name ?? '';
    }
  });

  $effect(() => {
    if (actionData?.invited) { alertMessage = 'Invitation sent to ' + actionData.invited; alertType = 'success'; showInviteForm = false; }
    if (actionData?.removed) { alertMessage = 'Member removed'; alertType = 'success'; }
    if (actionData?.cancelled) { alertMessage = 'Invitation cancelled'; alertType = 'success'; }
    if (actionData?.updated) { alertMessage = 'Team updated'; alertType = 'success'; }
    if (actionData?.error) { alertMessage = actionData.error; alertType = 'error'; }
  });
</script>

<svelte:head>
  <title>Team</title>
</svelte:head>

<div class="space-y-8">
  <div>
    <h1 class="text-3xl font-bold text-foreground">Team</h1>
    <p class="text-muted-foreground mt-1">Manage your team members and invitations</p>
  </div>

  {#if alertMessage}
    <Alert variant={alertType === 'error' ? 'destructive' : 'default'}>
      <span class="text-sm">{alertMessage}</span>
    </Alert>
  {/if}

  {#if data.team}
    <Card>
      <CardHeader><CardTitle>Team Info</CardTitle></CardHeader>
      <CardContent>
        <form method="POST" action="?/updateTeam" use:enhanceUpdateTeam novalidate class="space-y-4">
          <input type="hidden" name="teamId" bind:value={$teamForm.teamId} />
          <div>
            <Label for="teamName">Team Name</Label>
            <div class="flex gap-2 mt-2">
              <Input
                id="teamName"
                name="name"
                bind:value={$teamForm.name}
                aria-invalid={$teamErrors.name ? 'true' : undefined}
                disabled={$updatingTeam}
                class="flex-1"
              />
              <Button type="submit" disabled={$updatingTeam}>{$updatingTeam ? 'Saving...' : 'Save'}</Button>
            </div>
            {#if $teamErrors.name}<p class="mt-1 text-xs text-destructive">{$teamErrors.name[0]}</p>{/if}
          </div>
        </form>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Invite Member</CardTitle>
        <CardDescription>Invite someone to join your team</CardDescription>
      </CardHeader>
      <CardContent>
        {#if showInviteForm}
          <form method="POST" action="?/invite" use:enhanceInvite novalidate class="space-y-4">
            <input type="hidden" name="teamId" bind:value={$inviteForm.teamId} />
            <div>
              <Label for="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="member@example.com"
                bind:value={$inviteForm.email}
                aria-invalid={$inviteErrors.email ? 'true' : undefined}
                disabled={$inviting}
                class="mt-2"
              />
              {#if $inviteErrors.email}<p class="mt-1 text-xs text-destructive">{$inviteErrors.email[0]}</p>{/if}
            </div>
            <div>
              <Label for="role">Role</Label>
              <select
                id="role"
                name="role"
                bind:value={$inviteForm.role}
                disabled={$inviting}
                class="mt-2 w-full px-3 py-2 border border-border rounded-md text-sm"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div class="flex gap-2">
              <Button type="submit" disabled={$inviting}>{$inviting ? 'Sending...' : 'Send Invite'}</Button>
              <Button type="button" variant="outline" disabled={$inviting} onclick={() => (showInviteForm = false)}>Cancel</Button>
            </div>
          </form>
        {:else}
          <Button onclick={() => (showInviteForm = true)}>Invite Member</Button>
        {/if}
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Members</CardTitle>
        <CardDescription>{members.length} member(s)</CardDescription>
      </CardHeader>
      <CardContent>
        {#if members.length > 0}
          <div class="space-y-3">
            {#each members as member (member.id)}
              <div class="flex items-center justify-between p-3 border border-border rounded-lg">
                <div>
                  <p class="font-medium text-foreground">
                    {member.userId == data.user.id ? data.user.name + ' (you)' : 'User #' + member.userId}
                  </p>
                  <p class="text-xs text-muted-foreground">Joined {new Date(member.joinedAt).toLocaleDateString()}</p>
                </div>
                <div class="flex items-center gap-2">
                  <Badge variant={member.role === 'owner' ? 'destructive' : 'default'}>
                    {member.role.charAt(0).toUpperCase() + member.role.slice(1)}
                  </Badge>
                  {#if member.role !== 'owner' && member.userId != data.user.id}
                    <form method="POST" action="?/removeMember" use:enhance novalidate>
                      <input type="hidden" name="teamId" value={data.team.id} />
                      <input type="hidden" name="userId" value={member.userId} />
                      <Button size="sm" variant="destructive" type="submit"
                        onclick={(e) => { if (!confirm('Remove this member?')) e.preventDefault(); }}>
                        Remove
                      </Button>
                    </form>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {:else}
          <p class="text-sm text-muted-foreground text-center py-4">No members yet</p>
        {/if}
      </CardContent>
    </Card>

    {#if invitations.length > 0}
      <Card>
        <CardHeader>
          <CardTitle>Pending Invitations</CardTitle>
          <CardDescription>{invitations.length} pending</CardDescription>
        </CardHeader>
        <CardContent>
          <div class="space-y-2">
            {#each invitations as inv (inv.id)}
              <div class="flex items-center justify-between p-3 border border-border rounded-lg bg-muted/50">
                <div>
                  <p class="font-medium text-foreground">{inv.email}</p>
                  <p class="text-xs text-muted-foreground">Expires {new Date(inv.expiresAt).toLocaleDateString()}</p>
                </div>
                <div class="flex items-center gap-2">
                  <Badge variant="secondary">{inv.role}</Badge>
                  <form method="POST" action="?/cancelInvitation" use:enhance novalidate>
                    <input type="hidden" name="invitationId" value={inv.id} />
                    <Button size="sm" variant="outline" type="submit">Cancel</Button>
                  </form>
                </div>
              </div>
            {/each}
          </div>
        </CardContent>
      </Card>
    {/if}
  {:else}
    <Card>
      <CardContent class="pt-8 text-center">
        <p class="text-muted-foreground">Could not load team data. Try refreshing the page.</p>
      </CardContent>
    </Card>
  {/if}
</div>
