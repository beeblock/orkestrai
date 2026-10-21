import * as m from '$lib/paraglide/messages.js';
import { isTerminalThemeName, TERMINAL_THEMES } from './terminal-themes.js';

export function terminalThemeLabel(name: string): string {
  if (name === 'dark') return 'Orkestrai';
  if (name === 'midnight') return m['terminal_theme.midnight']();
  if (name === 'light') return m['terminal_theme.paper']();
  return isTerminalThemeName(name) ? TERMINAL_THEMES[name].label : name;
}
