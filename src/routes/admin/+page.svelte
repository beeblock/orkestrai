<script lang="ts">
  import { page } from '$app/stores';
  import { superForm } from 'sveltekit-superforms';
  import { Button, Card, CardHeader, CardTitle, CardDescription, CardContent, Alert, Input, Label } from '@beeblock/svelar/ui';
  // Badge do app (shadcn gerado): o Badge do svelar so tem pastel de tema claro.
  import { Badge } from '$lib/components/ui/badge';

  let { data, form: actionData }: { data: any; form?: any } = $props();
  let users = $state<any[]>([]);
  let message = $state('');
  let messageType = $state<'success' | 'error'>('success');

  // Real data from server
  let queueCounts = $state({ waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, total: 0 });
  let scheduledTasks = $state<any[]>([]);
  let recentLogs = $state<any[]>([]);
  let logStats = $state<{
    totalEntries: number;
    byLevel: Record<string, number>;
    byChannel: Record<string, number>;
  }>({ totalEntries: 0, byLevel: {}, byChannel: {} });
  let health = $state({ status: 'ok', uptime: 0, memoryUsedMB: 0, memoryTotalMB: 0, memoryPercent: 0 });

  // Roles & Permissions
  let roles = $state<any[]>([]);
  let permissions = $state<any[]>([]);
  let rolePermissionsMap = $state<Record<number, number[]>>({});
  let userRolesMap = $state<Record<number, { id: number; name: string }[]>>({});
  let userDirectPermsMap = $state<Record<number, { id: number; name: string }[]>>({});

  let showRoleForm = $state(false);
  let showPermForm = $state(false);

  let logFilter = $state<'all' | 'info' | 'warn' | 'error'>('all');

  const activeTab = $derived($page.url.searchParams.get('tab') ?? 'overview');

  const filteredLogs = $derived(
    logFilter === 'all' ? recentLogs : recentLogs.filter((log: any) => log.level === logFilter)
  );

  // svelte-ignore state_referenced_locally
  const {
    form: createRoleForm,
    errors: createRoleErrors,
    enhance: enhanceCreateRole,
    delayed: creatingRole,
  } = superForm(data.createRoleForm, {
    resetForm: true,
  });

  // svelte-ignore state_referenced_locally
  const {
    form: createPermissionForm,
    errors: createPermissionErrors,
    enhance: enhanceCreatePermission,
    delayed: creatingPermission,
  } = superForm(data.createPermissionForm, {
    resetForm: true,
  });

  $effect(() => {
    users = data.users;
    queueCounts = data.queueCounts;
    scheduledTasks = data.scheduledTasks;
    recentLogs = data.recentLogs;
    logStats = data.logStats;
    health = data.health;
    roles = data.roles ?? [];
    permissions = data.permissions ?? [];
    rolePermissionsMap = data.rolePermissionsMap ?? {};
    userRolesMap = data.userRolesMap ?? {};
    userDirectPermsMap = data.userDirectPermsMap ?? {};
  });

  $effect(() => {
    if (actionData?.message) {
      flash(actionData.message);
      showRoleForm = false;
      showPermForm = false;
    }
    if (actionData?.error) {
      flash(actionData.error, 'error');
    }
  });

  function flash(msg: string, type: 'success' | 'error' = 'success') {
    message = msg;
    messageType = type;
  }

  function getCookie(name: string): string | null {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : null;
  }

  function csrfHeaders(extra: Record<string, string> = {}): HeadersInit {
    const token = getCookie('XSRF-TOKEN');
    return token ? { ...extra, 'X-CSRF-Token': token } : extra;
  }

  async function apiError(res: Response, fallback: string): Promise<string> {
    try {
      const body = await res.json();
      return body.error || body.message || fallback;
    } catch {
      return fallback;
    }
  }

  function submitAdminAction(action: string, fields: Record<string, string | number>) {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = action;
    form.hidden = true;
    for (const [name, value] of Object.entries(fields)) {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      input.value = String(value);
      form.append(input);
    }
    document.body.append(form);
    form.requestSubmit();
  }

  async function refreshDashboard() {
    try {
      const res = await fetch('/api/admin/stats');
      if (res.ok) {
        const stats = await res.json();
        if (stats.queue) {
          queueCounts = stats.queue.queues?.default ?? queueCounts;
        }
      }
    } catch { /* ignore refresh errors */ }
  }

  function updateUserRole(userId: number, newRole: string) {
    submitAdminAction('?/updateUserRole', { userId, role: newRole });
  }

  function deleteUser(userId: number, userName: string) {
    if (!confirm(`Are you sure you want to delete ${userName}? This cannot be undone.`)) {
      return;
    }
    submitAdminAction('?/deleteUser', { userId });
  }

  async function retryJob(jobId: string) {
    try {
      const res = await fetch(`/api/admin/queue/${jobId}/retry`, {
        method: 'POST',
        headers: csrfHeaders(),
      });
      if (res.ok) {
        flash('Job queued for retry');
        await refreshQueue();
      } else {
        flash(await apiError(res, 'Failed to retry job'), 'error');
      }
    } catch {
      flash('Failed to retry job', 'error');
    }
  }

  async function refreshQueue() {
    try {
      const res = await fetch('/api/admin/queue');
      if (res.ok) {
        const data = await res.json();
        queueCounts = data.counts;
      }
    } catch { /* ignore */ }
  }

  async function runTask(taskName: string) {
    try {
      const res = await fetch(`/api/admin/scheduler/${taskName}/run`, {
        method: 'POST',
        headers: csrfHeaders(),
      });
      if (res.ok) {
        flash(`Task '${taskName}' completed`);
        await refreshScheduler();
      } else {
        flash(await apiError(res, 'Failed to run task'), 'error');
      }
    } catch {
      flash('Failed to run task', 'error');
    }
  }

  async function refreshScheduler() {
    try {
      const res = await fetch('/api/admin/scheduler');
      if (res.ok) {
        const data = await res.json();
        scheduledTasks = data.tasks ?? scheduledTasks;
      }
    } catch { /* ignore */ }
  }

  async function toggleTask(taskName: string, enabled: boolean) {
    try {
      const res = await fetch(`/api/admin/scheduler/${taskName}/toggle`, {
        method: 'POST',
        headers: csrfHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ enabled }),
      });
      if (res.ok) {
        scheduledTasks = scheduledTasks.map((t: any) =>
          t.name === taskName ? { ...t, enabled } : t
        );
        flash(`Task '${taskName}' ${enabled ? 'enabled' : 'disabled'}`);
      } else {
        flash(await apiError(res, 'Failed to toggle task'), 'error');
      }
    } catch {
      flash('Failed to toggle task', 'error');
    }
  }

  // -- Roles CRUD --

  function deleteRole(name: string) {
    if (!confirm(`Delete role "${name}"? This will remove it from all users.`)) return;
    submitAdminAction('?/deleteRole', { name });
  }

  // -- Permissions CRUD --

  function deletePermission(name: string) {
    if (!confirm(`Delete permission "${name}"? This will revoke it from all roles and users.`)) return;
    submitAdminAction('?/deletePermission', { name });
  }

  // -- Role <-> Permission --

  function toggleRolePermission(roleId: number, permissionId: number) {
    const current = rolePermissionsMap[roleId] ?? [];
    const has = current.includes(permissionId);
    submitAdminAction(has ? '?/detachRolePermission' : '?/attachRolePermission', { roleId, permissionId });
  }

  // -- User <-> Role --

  function assignRoleToUser(userId: number, roleId: number) {
    submitAdminAction('?/assignUserRole', { userId, roleId });
  }

  function removeRoleFromUser(userId: number, roleId: number) {
    submitAdminAction('?/removeUserRole', { userId, roleId });
  }

  // -- User <-> Direct Permission --

  function grantPermToUser(userId: number, permissionId: number) {
    submitAdminAction('?/grantUserPermission', { userId, permissionId });
  }

  function revokePermFromUser(userId: number, permissionId: number) {
    submitAdminAction('?/revokeUserPermission', { userId, permissionId });
  }

  function formatDate(date: string | null): string {
    if (!date) return 'Never';
    try {
      return new Date(date).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
      return date;
    }
  }

  function formatUptime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  function getLogBadgeVariant(level: string): 'default' | 'secondary' | 'destructive' {
    return level === 'error' || level === 'fatal' ? 'destructive' : level === 'warn' ? 'secondary' : 'default';
  }


</script>

<svelte:head>
  <title>Admin Dashboard</title>
</svelte:head>

<div class="space-y-8">
  <div class="flex justify-between items-center">
    <div>
      <h1 class="text-3xl font-bold text-foreground">Admin Dashboard</h1>
      <p class="text-muted-foreground mt-1">System health, queue monitoring, and task management</p>
    </div>
    <Button variant="outline" onclick={refreshDashboard}>Refresh</Button>
  </div>

  {#if message}
    <Alert variant={messageType === 'error' ? 'destructive' : 'success'}>
      <span class="text-sm">{message}</span>
    </Alert>
  {/if}

  <!-- Overview -->
  {#if activeTab === 'overview'}
    <div class="space-y-6">
      <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent class="pt-6">
            <div>
              <p class="text-sm text-muted-foreground">Total Users</p>
              <p class="text-3xl font-bold text-[var(--color-brand)] mt-2">{data.stats.userCount}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent class="pt-6">
            <div>
              <p class="text-sm text-muted-foreground">Total Posts</p>
              <p class="text-3xl font-bold text-[var(--color-brand)] mt-2">{data.stats.postCount}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent class="pt-6">
            <div>
              <p class="text-sm text-muted-foreground">Queue Pending</p>
              <p class="text-3xl font-bold text-yellow-600 mt-2">{queueCounts.waiting}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent class="pt-6">
            <div>
              <p class="text-sm text-muted-foreground">Failed Jobs</p>
              <p class="text-3xl font-bold text-destructive mt-2">{queueCounts.failed}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>System Health</CardTitle>
        </CardHeader>
        <CardContent class="space-y-4">
          <div class="flex justify-between text-sm">
            <span>Status</span>
            <Badge variant="default">{health.status}</Badge>
          </div>
          <div class="flex justify-between text-sm">
            <span>Uptime</span>
            <span class="font-medium">{formatUptime(health.uptime)}</span>
          </div>
          <div class="space-y-2">
            <div class="flex justify-between text-sm">
              <span>Memory Usage</span>
              <Badge variant={health.memoryPercent > 90 ? 'destructive' : health.memoryPercent > 70 ? 'secondary' : 'default'}>
                {health.memoryUsedMB} MB / {health.memoryTotalMB} MB ({health.memoryPercent}%)
              </Badge>
            </div>
            <div class="h-2 bg-muted rounded-full overflow-hidden">
              <div
                class="h-full transition-all"
                class:bg-green-500={health.memoryPercent <= 70}
                class:bg-yellow-500={health.memoryPercent > 70 && health.memoryPercent <= 90}
                class:bg-red-500={health.memoryPercent > 90}
                style="width: {health.memoryPercent}%"
              ></div>
            </div>
          </div>
          <div class="flex justify-between text-sm">
            <span>Queue Throughput</span>
            <span class="font-medium">{queueCounts.total} total jobs</span>
          </div>
          <div class="flex justify-between text-sm">
            <span>Log Entries</span>
            <span class="font-medium">{logStats.totalEntries} entries ({logStats.byLevel?.error ?? 0} errors)</span>
          </div>
        </CardContent>
      </Card>
    </div>
  {/if}

  <!-- Users -->
  {#if activeTab === 'users'}
    <Card>
      <CardHeader>
        <CardTitle>User Management</CardTitle>
        <CardDescription>Manage user roles and permissions ({data.stats.userCount} users)</CardDescription>
      </CardHeader>
      <CardContent>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-border">
                <th class="text-left py-3 px-4 font-semibold text-foreground">Name</th>
                <th class="text-left py-3 px-4 font-semibold text-foreground">Email</th>
                <th class="text-left py-3 px-4 font-semibold text-foreground">Column Role</th>
                <th class="text-left py-3 px-4 font-semibold text-foreground">Assigned Roles</th>
                <th class="text-left py-3 px-4 font-semibold text-foreground">Direct Permissions</th>
                <th class="text-left py-3 px-4 font-semibold text-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {#each users as user (user.id)}
                <tr class="border-b border-border hover:bg-muted/50">
                  <td class="py-3 px-4 font-medium text-foreground">{user.name}</td>
                  <td class="py-3 px-4 text-muted-foreground">{user.email}</td>
                  <td class="py-3 px-4">
                    <Badge variant={user.role === 'admin' ? 'default' : 'secondary'}>
                      {user.role}
                    </Badge>
                  </td>
                  <td class="py-3 px-4">
                    <div class="flex flex-wrap gap-1">
                      {#each (userRolesMap[user.id] ?? []) as role (role.id)}
                        <Badge variant="secondary">
                          {role.name}
                          <button
                            type="button"
                            class="hover:text-destructive font-bold"
                            onclick={() => removeRoleFromUser(user.id, role.id)}
                          >&times;</button>
                        </Badge>
                      {/each}
                      {#if roles.length > 0}
                        <select
                          class="text-xs border border-border rounded px-1 py-0.5"
                          onchange={(e) => {
                            const val = Number((e.target as HTMLSelectElement).value);
                            if (val) { assignRoleToUser(user.id, val); (e.target as HTMLSelectElement).value = ''; }
                          }}
                        >
                          <option value="">+ role</option>
                          {#each roles.filter((r) => !(userRolesMap[user.id] ?? []).some((ur) => ur.id === r.id)) as role (role.id)}
                            <option value={role.id}>{role.name}</option>
                          {/each}
                        </select>
                      {/if}
                    </div>
                  </td>
                  <td class="py-3 px-4">
                    <div class="flex flex-wrap gap-1">
                      {#each (userDirectPermsMap[user.id] ?? []) as perm (perm.id)}
                        <Badge variant="outline">
                          {perm.name}
                          <button
                            type="button"
                            class="hover:text-destructive font-bold"
                            onclick={() => revokePermFromUser(user.id, perm.id)}
                          >&times;</button>
                        </Badge>
                      {/each}
                      {#if permissions.length > 0}
                        <select
                          class="text-xs border border-border rounded px-1 py-0.5"
                          onchange={(e) => {
                            const val = Number((e.target as HTMLSelectElement).value);
                            if (val) { grantPermToUser(user.id, val); (e.target as HTMLSelectElement).value = ''; }
                          }}
                        >
                          <option value="">+ perm</option>
                          {#each permissions.filter((p) => !(userDirectPermsMap[user.id] ?? []).some((up) => up.id === p.id)) as perm (perm.id)}
                            <option value={perm.id}>{perm.name}</option>
                          {/each}
                        </select>
                      {/if}
                    </div>
                  </td>
                  <td class="py-3 px-4">
                    <div class="flex gap-2">
                      {#if user.role === 'user'}
                        <Button size="sm" variant="outline" onclick={() => updateUserRole(user.id, 'admin')}>
                          Make Admin
                        </Button>
                      {:else if data.stats.roleDistribution.admin > 1}
                        <Button size="sm" variant="outline" onclick={() => updateUserRole(user.id, 'user')}>
                          Demote
                        </Button>
                      {/if}
                      {#if user.id !== data.user.id}
                        <Button size="sm" variant="destructive" onclick={() => deleteUser(user.id, user.name)}>
                          Delete
                        </Button>
                      {/if}
                    </div>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  {/if}

  <!-- Roles -->
  {#if activeTab === 'roles'}
    <div class="space-y-6">
      <Card>
        <CardHeader>
          <div class="flex justify-between items-start">
            <div>
              <CardTitle>Roles</CardTitle>
              <CardDescription>{roles.length} roles defined</CardDescription>
            </div>
            <Button size="sm" onclick={() => (showRoleForm = !showRoleForm)}>
              {showRoleForm ? 'Cancel' : 'Create Role'}
            </Button>
          </div>
        </CardHeader>
        {#if showRoleForm}
          <CardContent>
            <form
              method="POST"
              action="?/createRole"
              use:enhanceCreateRole
              novalidate
              class="flex flex-wrap gap-3 items-end border-b border-border pb-4 mb-4"
            >
              <div class="flex-1 min-w-[200px]">
                <Label for="role-name">Name</Label>
                <Input
                  id="role-name"
                  name="name"
                  bind:value={$createRoleForm.name}
                  placeholder="e.g. editor"
                  aria-invalid={$createRoleErrors.name ? 'true' : undefined}
                  disabled={$creatingRole}
                />
                {#if $createRoleErrors.name}<p class="mt-1 text-xs text-destructive">{$createRoleErrors.name[0]}</p>{/if}
              </div>
              <div class="flex-1 min-w-[140px]">
                <Label for="role-guard">Guard</Label>
                <Input
                  id="role-guard"
                  name="guard"
                  bind:value={$createRoleForm.guard}
                  placeholder="web"
                  disabled={$creatingRole}
                />
              </div>
              <div class="flex-1 min-w-[200px]">
                <Label for="role-desc">Description (optional)</Label>
                <Input
                  id="role-desc"
                  name="description"
                  bind:value={$createRoleForm.description}
                  placeholder="Can edit content"
                  aria-invalid={$createRoleErrors.description ? 'true' : undefined}
                  disabled={$creatingRole}
                />
                {#if $createRoleErrors.description}<p class="mt-1 text-xs text-destructive">{$createRoleErrors.description[0]}</p>{/if}
              </div>
              <Button type="submit" size="sm" disabled={$creatingRole}>{$creatingRole ? 'Creating...' : 'Create'}</Button>
            </form>
          </CardContent>
        {/if}
        <CardContent>
          {#if roles.length > 0}
            <div class="space-y-4">
              {#each roles as role (role.id)}
                <div class="border border-border rounded-lg p-4">
                  <div class="flex items-center justify-between mb-3">
                    <div>
                      <span class="font-medium text-foreground">{role.name}</span>
                      <Badge variant="secondary" class="ml-2">{role.guard}</Badge>
                      {#if role.description}
                        <p class="text-xs text-muted-foreground mt-1">{role.description}</p>
                      {/if}
                    </div>
                    <Button size="sm" variant="destructive" onclick={() => deleteRole(role.name)}>Delete</Button>
                  </div>
                  <div>
                    <p class="text-xs font-semibold text-muted-foreground uppercase mb-2">Permissions</p>
                    <div class="flex flex-wrap gap-2">
                      {#each permissions as perm (perm.id)}
                        {@const has = (rolePermissionsMap[role.id] ?? []).includes(perm.id)}
                        <button
                          type="button"
                          class="px-2 py-1 rounded text-xs border transition-colors {has
                            ? 'bg-[var(--color-brand)] text-white border-[var(--color-brand)]'
                            : 'bg-background text-muted-foreground border-border hover:border-foreground/30'}"
                          onclick={() => toggleRolePermission(role.id, perm.id)}
                        >
                          {perm.name}
                        </button>
                      {/each}
                      {#if permissions.length === 0}
                        <span class="text-xs text-muted-foreground/70">No permissions defined yet</span>
                      {/if}
                    </div>
                  </div>
                </div>
              {/each}
            </div>
          {:else}
            <p class="text-sm text-muted-foreground py-4 text-center">
              No roles defined. Create one to start assigning permissions.
            </p>
          {/if}
        </CardContent>
      </Card>
    </div>
  {/if}

  <!-- Permissions -->
  {#if activeTab === 'permissions'}
    <div class="space-y-6">
      <Card>
        <CardHeader>
          <div class="flex justify-between items-start">
            <div>
              <CardTitle>Permissions</CardTitle>
              <CardDescription>{permissions.length} permissions defined</CardDescription>
            </div>
            <Button size="sm" onclick={() => (showPermForm = !showPermForm)}>
              {showPermForm ? 'Cancel' : 'Create Permission'}
            </Button>
          </div>
        </CardHeader>
        {#if showPermForm}
          <CardContent>
            <form
              method="POST"
              action="?/createPermission"
              use:enhanceCreatePermission
              novalidate
              class="flex flex-wrap gap-3 items-end border-b border-border pb-4 mb-4"
            >
              <div class="flex-1 min-w-[200px]">
                <Label for="perm-name">Name</Label>
                <Input
                  id="perm-name"
                  name="name"
                  bind:value={$createPermissionForm.name}
                  placeholder="e.g. manage-users"
                  aria-invalid={$createPermissionErrors.name ? 'true' : undefined}
                  disabled={$creatingPermission}
                />
                {#if $createPermissionErrors.name}<p class="mt-1 text-xs text-destructive">{$createPermissionErrors.name[0]}</p>{/if}
              </div>
              <div class="flex-1 min-w-[140px]">
                <Label for="perm-guard">Guard</Label>
                <Input
                  id="perm-guard"
                  name="guard"
                  bind:value={$createPermissionForm.guard}
                  placeholder="web"
                  disabled={$creatingPermission}
                />
              </div>
              <div class="flex-1 min-w-[200px]">
                <Label for="perm-desc">Description (optional)</Label>
                <Input
                  id="perm-desc"
                  name="description"
                  bind:value={$createPermissionForm.description}
                  placeholder="Can manage user accounts"
                  aria-invalid={$createPermissionErrors.description ? 'true' : undefined}
                  disabled={$creatingPermission}
                />
                {#if $createPermissionErrors.description}<p class="mt-1 text-xs text-destructive">{$createPermissionErrors.description[0]}</p>{/if}
              </div>
              <Button type="submit" size="sm" disabled={$creatingPermission}>{$creatingPermission ? 'Creating...' : 'Create'}</Button>
            </form>
          </CardContent>
        {/if}
        <CardContent>
          {#if permissions.length > 0}
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b border-border">
                    <th class="text-left py-3 px-4 font-semibold text-foreground">Name</th>
                    <th class="text-left py-3 px-4 font-semibold text-foreground">Guard</th>
                    <th class="text-left py-3 px-4 font-semibold text-foreground">Description</th>
                    <th class="text-left py-3 px-4 font-semibold text-foreground">Used by Roles</th>
                    <th class="text-left py-3 px-4 font-semibold text-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {#each permissions as perm (perm.id)}
                    {@const usedBy = roles.filter((r) => (rolePermissionsMap[r.id] ?? []).includes(perm.id))}
                    <tr class="border-b border-border hover:bg-muted/50">
                      <td class="py-3 px-4 font-medium text-foreground">{perm.name}</td>
                      <td class="py-3 px-4">
                        <Badge variant="secondary">{perm.guard}</Badge>
                      </td>
                      <td class="py-3 px-4 text-muted-foreground">{perm.description || '---'}</td>
                      <td class="py-3 px-4">
                        <div class="flex flex-wrap gap-1">
                          {#each usedBy as role (role.id)}
                            <Badge variant="outline">{role.name}</Badge>
                          {/each}
                          {#if usedBy.length === 0}
                            <span class="text-xs text-muted-foreground/70">None</span>
                          {/if}
                        </div>
                      </td>
                      <td class="py-3 px-4">
                        <Button size="sm" variant="destructive" onclick={() => deletePermission(perm.name)}>Delete</Button>
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {:else}
            <p class="text-sm text-muted-foreground py-4 text-center">
              No permissions defined. Create one to start building your authorization system.
            </p>
          {/if}
        </CardContent>
      </Card>
    </div>
  {/if}

  <!-- Queue -->
  {#if activeTab === 'queue'}
    <div class="space-y-6">
      <div class="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card>
          <CardContent class="pt-6">
            <div>
              <p class="text-sm text-muted-foreground">Waiting</p>
              <p class="text-3xl font-bold text-yellow-600 mt-2">{queueCounts.waiting}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent class="pt-6">
            <div>
              <p class="text-sm text-muted-foreground">Active</p>
              <p class="text-3xl font-bold text-blue-600 mt-2">{queueCounts.active}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent class="pt-6">
            <div>
              <p class="text-sm text-muted-foreground">Failed</p>
              <p class="text-3xl font-bold text-destructive mt-2">{queueCounts.failed}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent class="pt-6">
            <div>
              <p class="text-sm text-muted-foreground">Completed</p>
              <p class="text-3xl font-bold text-green-600 mt-2">{queueCounts.completed}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent class="pt-6">
            <div>
              <p class="text-sm text-muted-foreground">Delayed</p>
              <p class="text-3xl font-bold text-muted-foreground mt-2">{queueCounts.delayed}</p>
            </div>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Queue Actions</CardTitle>
          <CardDescription>Manage job queue</CardDescription>
        </CardHeader>
        <CardContent class="flex gap-3">
          <Button variant="outline" onclick={refreshQueue}>Refresh Counts</Button>
        </CardContent>
      </Card>
    </div>
  {/if}

  <!-- Scheduler -->
  {#if activeTab === 'scheduler'}
    <Card>
      <CardHeader>
        <CardTitle>Scheduled Tasks</CardTitle>
        <CardDescription>
          {scheduledTasks.length > 0
            ? `${scheduledTasks.length} registered tasks`
            : 'No tasks registered. Configure your scheduler to see tasks here.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {#if scheduledTasks.length > 0}
          <div class="space-y-3">
            {#each scheduledTasks as task (task.name)}
              <div class="flex items-center justify-between p-4 border border-border rounded-lg hover:bg-muted/50">
                <div class="flex-1">
                  <p class="font-medium text-foreground">{task.name}</p>
                  <p class="text-sm text-muted-foreground">Schedule: {task.humanReadable}</p>
                  <p class="text-xs text-muted-foreground mt-1">Last run: {formatDate(task.lastRun)}</p>
                  <p class="text-xs text-muted-foreground">Next run: {formatDate(task.nextRun)}</p>
                </div>
                <div class="flex items-center gap-3">
                  {#if task.lastStatus}
                    <Badge variant={task.lastStatus === 'success' ? 'default' : 'destructive'}>
                      {task.lastStatus}
                    </Badge>
                  {/if}
                  <Badge variant={task.enabled ? 'default' : 'secondary'}>
                    {task.enabled ? 'enabled' : 'disabled'}
                  </Badge>
                  <Button size="sm" variant="outline" onclick={() => runTask(task.name)}>Run Now</Button>
                  <Button size="sm" variant="outline" onclick={() => toggleTask(task.name, !task.enabled)}>
                    {task.enabled ? 'Disable' : 'Enable'}
                  </Button>
                </div>
              </div>
            {/each}
          </div>
        {:else}
          <p class="text-sm text-muted-foreground py-4 text-center">
            No scheduled tasks found. Configure the Scheduler in your app.ts to register tasks.
          </p>
        {/if}
      </CardContent>
    </Card>
  {/if}

  <!-- Logs -->
  {#if activeTab === 'logs'}
    <Card>
      <CardHeader>
        <CardTitle>Application Logs</CardTitle>
        <CardDescription>
          {logStats.totalEntries} total entries
          {#if logStats.byLevel?.error}
            ({logStats.byLevel.error} errors)
          {/if}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div class="flex gap-2 mb-4">
          <Button size="sm" variant={logFilter === 'all' ? 'default' : 'outline'} onclick={() => (logFilter = 'all')}>
            All ({logStats.totalEntries})
          </Button>
          <Button size="sm" variant={logFilter === 'info' ? 'default' : 'outline'} onclick={() => (logFilter = 'info')}>
            Info ({logStats.byLevel?.info ?? 0})
          </Button>
          <Button size="sm" variant={logFilter === 'warn' ? 'default' : 'outline'} onclick={() => (logFilter = 'warn')}>
            Warning ({logStats.byLevel?.warn ?? 0})
          </Button>
          <Button size="sm" variant={logFilter === 'error' ? 'default' : 'outline'} onclick={() => (logFilter = 'error')}>
            Error ({logStats.byLevel?.error ?? 0})
          </Button>
        </div>

        {#if filteredLogs.length > 0}
          <div class="space-y-2 max-h-96 overflow-y-auto">
            {#each filteredLogs as log, i (i)}
              <div class="flex items-start gap-3 p-3 border border-border rounded bg-muted/50 text-sm">
                <Badge variant={getLogBadgeVariant(log.level)} class="mt-0.5">
                  {log.level.toUpperCase()}
                </Badge>
                <div class="flex-1">
                  <p class="text-foreground">{log.message}</p>
                  <p class="text-xs text-muted-foreground mt-1">
                    {formatDate(log.timestamp)}
                    {#if log.channel && log.channel !== 'default'}
                      <span class="ml-2 text-muted-foreground/70">[{log.channel}]</span>
                    {/if}
                  </p>
                </div>
              </div>
            {/each}
          </div>
        {:else}
          <p class="text-sm text-muted-foreground py-4 text-center">
            No log entries found. Logs appear here as your application runs.
          </p>
        {/if}
      </CardContent>
    </Card>
  {/if}
</div>
