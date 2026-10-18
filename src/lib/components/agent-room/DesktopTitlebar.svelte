<script lang="ts">
  import { AppWindow, Bug, CheckCircle2, FileText, FolderOpen, LayoutGrid, LifeBuoy, Maximize2, Minus, MonitorUp, PanelTop, RefreshCw, Search, Settings, SquareTerminal, X } from '@lucide/svelte';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import * as m from '$lib/paraglide/messages.js';
  import { goto } from '$app/navigation';
  import WorkspaceModeSwitch from './WorkspaceModeSwitch.svelte';
  import AttentionCenter from './AttentionCenter.svelte';
  import TitlebarWorkspaceTabs from './TitlebarWorkspaceTabs.svelte';
  import TitlebarPills from './TitlebarPills.svelte';
  import { workspaceContext } from './workspace-context.svelte.js';

  type DesktopBridge = { platform?: string; runMenuCommand?: (action: string) => Promise<unknown> };
  const desktop = (window as unknown as { orkestraiDesktop?: DesktopBridge }).orkestraiDesktop;
  const platform = desktop?.platform ?? null;
  const windows = platform === 'win32';
  const mac = platform === 'darwin';
  const searchKey = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K';

  function run(action: string) {
    void desktop?.runMenuCommand?.(action);
  }

  function openSearch() {
    window.dispatchEvent(new CustomEvent('orkestrai:global-search'));
  }
</script>

<!-- One top bar for every platform: window chrome on desktop, the workspace
     mode switch in the middle, search, attention and the docked microphone on
     the right. -->
<header class="app-topbar" class:desktop={Boolean(desktop)} class:mac class:windows data-dictation-ignore>
  <div class="start">
    {#if mac}<span class="traffic-lights" aria-hidden="true"></span>{/if}

    {#if windows}
      <nav class="menus" aria-label={m['desktop.menu_aria']()}>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger class="menu-trigger">{m['desktop.workspace']()}</DropdownMenu.Trigger>
          <DropdownMenu.Content align="start" class="titlebar-menu">
            <DropdownMenu.Item onclick={() => run('canvas')}><AppWindow size={14} />{m['desktop.canvas']()}<DropdownMenu.Shortcut>Ctrl+1</DropdownMenu.Shortcut></DropdownMenu.Item>
            <DropdownMenu.Item onclick={() => run('terminals')}><SquareTerminal size={14} />{m['workspace_view.workbench']()}<DropdownMenu.Shortcut>Ctrl+Shift+1</DropdownMenu.Shortcut></DropdownMenu.Item>
            <DropdownMenu.Item onclick={() => run('providers')}><PanelTop size={14} />{m['desktop.providers']()}<DropdownMenu.Shortcut>Ctrl+2</DropdownMenu.Shortcut></DropdownMenu.Item>
            <DropdownMenu.Item onclick={() => run('remote')}><MonitorUp size={14} />{m['remote.open']()}</DropdownMenu.Item>
            <DropdownMenu.Item onclick={() => run('new-workspace')}>{m['desktop.new_workspace']()}<DropdownMenu.Shortcut>Ctrl+N</DropdownMenu.Shortcut></DropdownMenu.Item>
            <DropdownMenu.Item onclick={() => run('presets')}>{m['desktop.presets']()}</DropdownMenu.Item>
            <DropdownMenu.Separator />
            <DropdownMenu.Item onclick={() => run('organize')}><LayoutGrid size={14} />{m['desktop.organize']()}<DropdownMenu.Shortcut>Ctrl+Shift+T</DropdownMenu.Shortcut></DropdownMenu.Item>
            <DropdownMenu.Item onclick={() => run('floors')}>{m['desktop.floors']()}</DropdownMenu.Item>
            <DropdownMenu.Item onclick={() => run('roles')}>{m['desktop.roles']()}</DropdownMenu.Item>
            <DropdownMenu.Item onclick={() => run('usage')}>{m['desktop.usage']()}</DropdownMenu.Item>
            <DropdownMenu.Item onclick={() => run('ports')}>{m['desktop.ports']()}</DropdownMenu.Item>
            <DropdownMenu.Separator />
            <DropdownMenu.Item onclick={() => run('settings')}><Settings size={14} />{m['desktop.settings']()}<DropdownMenu.Shortcut>Ctrl+,</DropdownMenu.Shortcut></DropdownMenu.Item>
            <DropdownMenu.Item onclick={() => run('check-updates')}><RefreshCw size={14} />{m['desktop.check_updates']()}</DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>

        <DropdownMenu.Root>
          <DropdownMenu.Trigger class="menu-trigger">{m['desktop.edit']()}</DropdownMenu.Trigger>
          <DropdownMenu.Content align="start" class="titlebar-menu">
            <DropdownMenu.Item onclick={() => run('undo')}>{m['desktop.undo']()}<DropdownMenu.Shortcut>Ctrl+Z</DropdownMenu.Shortcut></DropdownMenu.Item>
            <DropdownMenu.Item onclick={() => run('redo')}>{m['desktop.redo']()}<DropdownMenu.Shortcut>Ctrl+Y</DropdownMenu.Shortcut></DropdownMenu.Item>
            <DropdownMenu.Separator />
            <DropdownMenu.Item onclick={() => run('cut')}>{m['desktop.cut']()}<DropdownMenu.Shortcut>Ctrl+X</DropdownMenu.Shortcut></DropdownMenu.Item>
            <DropdownMenu.Item onclick={() => run('copy')}>{m['desktop.copy']()}<DropdownMenu.Shortcut>Ctrl+C</DropdownMenu.Shortcut></DropdownMenu.Item>
            <DropdownMenu.Item onclick={() => run('paste')}>{m['desktop.paste']()}<DropdownMenu.Shortcut>Ctrl+V</DropdownMenu.Shortcut></DropdownMenu.Item>
            <DropdownMenu.Item onclick={() => run('select-all')}>{m['desktop.select_all']()}<DropdownMenu.Shortcut>Ctrl+A</DropdownMenu.Shortcut></DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>

        <DropdownMenu.Root>
          <DropdownMenu.Trigger class="menu-trigger">{m['desktop.view']()}</DropdownMenu.Trigger>
          <DropdownMenu.Content align="start" class="titlebar-menu">
            <DropdownMenu.Item onclick={() => run('command-palette')}><Search size={14} />{m['desktop.command_palette']()}<DropdownMenu.Shortcut>Ctrl+P</DropdownMenu.Shortcut></DropdownMenu.Item>
            <DropdownMenu.Separator />
            <DropdownMenu.Item onclick={() => run('reload')}>{m['desktop.reload']()}</DropdownMenu.Item>
            <DropdownMenu.Item onclick={() => run('toggle-devtools')}><Bug size={14} />{m['desktop.developer_tools']()}<DropdownMenu.Shortcut>Ctrl+Shift+I</DropdownMenu.Shortcut></DropdownMenu.Item>
            <DropdownMenu.Item onclick={() => run('fullscreen')}>{m['desktop.fullscreen']()}</DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>

        <DropdownMenu.Root>
          <DropdownMenu.Trigger class="menu-trigger">{m['desktop.window']()}</DropdownMenu.Trigger>
          <DropdownMenu.Content align="start" class="titlebar-menu">
            <DropdownMenu.Item onclick={() => run('minimize')}><Minus size={14} />{m['desktop.minimize']()}</DropdownMenu.Item>
            <DropdownMenu.Item onclick={() => run('toggle-maximize')}><Maximize2 size={14} />{m['desktop.maximize']()}</DropdownMenu.Item>
            <DropdownMenu.Separator />
            <DropdownMenu.Item onclick={() => run('close')}><X size={14} />{m['desktop.close']()}<DropdownMenu.Shortcut>Alt+F4</DropdownMenu.Shortcut></DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>

        <DropdownMenu.Root>
          <DropdownMenu.Trigger class="menu-trigger">{m['desktop.help']()}</DropdownMenu.Trigger>
          <DropdownMenu.Content align="start" class="titlebar-menu">
            <DropdownMenu.Item onclick={() => run('docs')}><FileText size={14} />{m['desktop.docs']()}</DropdownMenu.Item>
            <DropdownMenu.Item onclick={() => run('changelog')}><CheckCircle2 size={14} />{m['desktop.changelog']()}</DropdownMenu.Item>
            <DropdownMenu.Item onclick={() => run('open-logs')}><FolderOpen size={14} />{m['desktop.open_logs']()}</DropdownMenu.Item>
            <DropdownMenu.Separator />
            <DropdownMenu.Item onclick={() => run('report-issue')}><LifeBuoy size={14} />{m['desktop.report_issue']()}</DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </nav>
    {/if}
    <TitlebarWorkspaceTabs />
  </div>

  <div class="center">
    {#if workspaceContext.mode}
      <WorkspaceModeSwitch active={workspaceContext.mode} workspaceId={workspaceContext.workspaceId} nodeId={workspaceContext.nodeId} />
    {/if}
  </div>

  <div class="end">
    <TitlebarPills />
    <button type="button" class="search" onclick={openSearch} aria-label={m['topbar.search_label']()}>
      <Search size={13} strokeWidth={2} />
      <span class="search-label">{m['topbar.search']()}</span>
      <kbd>{searchKey}</kbd>
    </button>
    <AttentionCenter workspaceId={workspaceContext.workspaceId} />
    <button type="button" class="ws-icon settings" aria-label={m['desktop.settings']()} title={m['desktop.settings']()} onclick={() => void goto('/settings')}>
      <Settings size={15} strokeWidth={1.8} />
    </button>
    <span class="dock" data-dictation-dock aria-hidden="true"></span>
    {#if windows}<span class="window-controls" aria-hidden="true"></span>{/if}
  </div>
</header>

<style>
  .app-topbar {
    height: 44px;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: 12px;
    padding: 0 0 0 10px;
    background: var(--app-glass-strong);
    -webkit-backdrop-filter: blur(22px) saturate(170%);
    backdrop-filter: blur(22px) saturate(170%);
    border-bottom: 1px solid var(--app-border);
    color: var(--app-text-soft);
    user-select: none;
  }

  .app-topbar.desktop {
    -webkit-app-region: drag;
  }

  .start,
  .end {
    height: 100%;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .end {
    justify-content: flex-end;
  }

  .center {
    display: flex;
    justify-content: center;
    min-width: 0;
  }

  /* macOS draws the traffic lights inside the bar (hiddenInset); keep them clear. */
  .traffic-lights {
    width: 66px;
    flex: none;
  }

  .menus,
  .start > :global(.ws-tabs),
  .center > :global(*),
  .end > :global(*) {
    -webkit-app-region: no-drag;
  }

  .menus {
    height: 100%;
    display: flex;
    align-items: center;
  }

  .search {
    height: 26px;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 0 6px 0 10px;
    border: 1px solid var(--app-glass-line);
    border-radius: 999px;
    background: color-mix(in srgb, var(--app-surface) 50%, transparent);
    color: var(--app-text-muted);
    font-size: 12px;
    cursor: pointer;
    transition: border-color var(--duration-quick) ease-out, color var(--duration-quick) ease-out;
  }

  .search:hover {
    border-color: var(--app-border-strong);
    color: var(--app-text-soft);
  }

  .search:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 1px;
  }

  .search kbd {
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 16px;
    padding: 0 5px;
    border: 1px solid var(--app-border);
    border-radius: 4px;
    color: var(--app-text-soft);
  }

  /* The floating microphone docks here (GlobalDictation centers itself in it). */
  .dock {
    width: 52px;
    height: 100%;
    flex: none;
  }

  .window-controls {
    width: 138px;
    height: 100%;
    flex: none;
  }

  @media (max-width: 760px) {
    .search-label,
    .search kbd {
      display: none;
    }
  }

  :global(.menu-trigger) {
    height: 26px;
    border: 0;
    border-radius: 6px;
    padding: 0 9px;
    background: transparent;
    color: var(--app-text-soft);
    font-size: 12px;
    transition: background-color var(--duration-quick) ease-out, color var(--duration-quick) ease-out;
  }

  :global(.menu-trigger:hover),
  :global(.menu-trigger[data-state='open']) {
    background: var(--app-hover);
    color: var(--app-text);
  }

  :global(.menu-trigger:focus-visible) {
    outline: 2px solid var(--app-accent);
    outline-offset: -2px;
  }

  :global(.titlebar-menu) {
    min-width: 238px;
    border-color: var(--app-border);
    background: var(--app-surface-raised);
    color: var(--app-text);
  }
</style>
