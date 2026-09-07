<script lang="ts">
  import { page } from '$app/stores';
  import type { Snippet } from 'svelte';
  import { Icon } from '@beeblock/svelar/ui';
  import LayoutDashboard from '@lucide/svelte/icons/layout-dashboard';
  import KeyRound from '@lucide/svelte/icons/key-round';
  import Users from '@lucide/svelte/icons/users';
  import Settings from '@lucide/svelte/icons/settings';

  interface Props {
    data: any;
    children: Snippet;
  }

  let { data, children }: Props = $props();

  const navItems = [
    { href: '/dashboard', label: 'Overview', exact: true, icon: LayoutDashboard },
    { href: '/dashboard/api-keys', label: 'API Keys', exact: false, icon: KeyRound },
    { href: '/dashboard/team', label: 'Team', exact: false, icon: Users },
  ];

  function isActive(href: string, exact: boolean, pathname: string): boolean {
    return exact ? pathname === href : pathname.startsWith(href);
  }
</script>

<div class="flex min-h-screen">
  <aside class="w-64 border-r border-border bg-muted/50 hidden md:block">
    <nav class="p-4 space-y-1">
      {#each navItems as item}
        {@const active = isActive(item.href, item.exact, $page.url.pathname)}
        <a
          href={item.href}
          class="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors {active ? 'bg-brand/10 text-brand' : 'text-foreground hover:bg-muted hover:text-foreground'}"
        >
          <Icon icon={item.icon} size={20} class={active ? 'text-brand' : 'text-muted-foreground/70'} />
          {item.label}
        </a>
      {/each}
    </nav>

    {#if data.user?.role === 'admin'}
      <div class="border-t border-border mx-4 my-2"></div>
      <div class="p-4 pt-0">
        <a
          href="/admin"
          class="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <Icon icon={Settings} size={20} class="text-muted-foreground/70" />
          Admin Panel
        </a>
      </div>
    {/if}
  </aside>

  <div class="flex-1 p-6 md:p-8">
    {@render children()}
  </div>
</div>
