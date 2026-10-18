import { describe, expect, it } from 'vitest';
import {
  nextTerminalTheme,
  normalizeTerminalTheme,
  TERMINAL_THEMES,
  TERMINAL_THEME_ORDER,
} from '$lib/components/agent-room/terminal-themes.js';

describe('terminal themes', () => {
  it('keeps every built-in theme selectable and complete', () => {
    expect(TERMINAL_THEME_ORDER).toHaveLength(16);
    expect(new Set(TERMINAL_THEME_ORDER).size).toBe(TERMINAL_THEME_ORDER.length);

    for (const name of TERMINAL_THEME_ORDER) {
      const theme = TERMINAL_THEMES[name].theme;
      expect(TERMINAL_THEMES[name].label.length).toBeGreaterThan(0);
      expect(theme.background).toMatch(/^#[0-9a-f]{6}$/i);
      expect(theme.foreground).toMatch(/^#[0-9a-f]{6}$/i);
      expect(theme.cursor).toMatch(/^#[0-9a-f]{6}$/i);
      expect(theme.red).toBeTruthy();
      expect(theme.green).toBeTruthy();
      expect(theme.blue).toBeTruthy();
      expect(theme.brightWhite).toBeTruthy();
    }
  });

  it('normalizes legacy values and still supports deterministic cycling', () => {
    expect(normalizeTerminalTheme('tokyo-night')).toBe('tokyo-night');
    expect(normalizeTerminalTheme('unknown')).toBe('dark');
    expect(nextTerminalTheme('dark')).toBe('midnight');
    expect(nextTerminalTheme(TERMINAL_THEME_ORDER.at(-1))).toBe('dark');
  });
});
