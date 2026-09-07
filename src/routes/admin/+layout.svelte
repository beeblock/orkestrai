<script lang="ts">
  import { page } from '$app/stores';
  import type { Snippet } from 'svelte';
  import { Icon } from '@beeblock/svelar/ui';
  import LayoutDashboard from '@lucide/svelte/icons/layout-dashboard';
  import Users from '@lucide/svelte/icons/users';
  import ShieldCheck from '@lucide/svelte/icons/shield-check';
  import Lock from '@lucide/svelte/icons/lock';
  import ListTodo from '@lucide/svelte/icons/list-todo';
  import Clock from '@lucide/svelte/icons/clock';
  import FileText from '@lucide/svelte/icons/file-text';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';

  interface Props {
    data: any;
    children: Snippet;
  }

  let { data, children }: Props = $props();

  const navItems = [
    { tab: 'overview', label: 'Overview', icon: LayoutDashboard },
    { tab: 'users', label: 'Users', icon: Users },
    { tab: 'roles', label: 'Roles', icon: ShieldCheck },
    { tab: 'permissions', label: 'Permissions', icon: Lock },
    { tab: 'queue', label: 'Queue', icon: ListTodo },
    { tab: 'scheduler', label: 'Scheduler', icon: Clock },
    { tab: 'logs', label: 'Logs', icon: FileText },
  ];

  function isActive(tab: string, currentUrl: URL): boolean {
    const activeTab = currentUrl.searchParams.get('tab') ?? 'overview';
    return activeTab === tab;
  }
</script>

<div class="flex min-h-screen">
  <aside class="w-64 border-r border-border bg-muted/50 hidden md:block">
    <div class="p-4 border-b border-border">
      <p class="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">Administration</p>
    </div>
    <nav class="p-4 space-y-1">
      {#each navItems as item}
        {@const active = isActive(item.tab, $page.url)}
        <a
          href="/admin?tab={item.tab}"
          class="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors {active ? 'bg-brand/10 text-brand' : 'text-foreground hover:bg-muted hover:text-foreground'}"
        >
          <Icon icon={item.icon} size={20} class={active ? 'text-brand' : 'text-muted-foreground/70'} />
          {item.label}
        </a>
      {/each}
    </nav>

    <div class="border-t border-border mx-4 my-2"></div>
    <div class="p-4 pt-0">
      <a
        href="/dashboard"
        class="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-foreground hover:bg-muted hover:text-foreground transition-colors"
      >
        <Icon icon={ArrowLeft} size={20} class="text-muted-foreground/70" />
        Back to Dashboard
      </a>
    </div>
  </aside>

  <div class="flex-1 p-6 md:p-8">
    {@render children()}
  </div>
</div>
