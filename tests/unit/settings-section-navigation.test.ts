import { describe, expect, it } from 'vitest';
import { createSettingsSectionSelection } from '$lib/components/agent-room/settings-section-navigation.js';

describe('Settings section selection', () => {
  it('tracks manual scrolling without an explicit selection', () => {
    const selection = createSettingsSectionSelection();
    expect(selection.update(0, 'autonomy')).toBe('autonomy');
    expect(selection.update(500, 'terminal')).toBe('terminal');
  });

  it('keeps the clicked short section when multiple anchors clamp to the same bottom', () => {
    const selection = createSettingsSectionSelection();
    selection.select('shortcuts', 2000, 1600);
    expect(selection.update(2000, 'language')).toBe('shortcuts');
    selection.select('presets', 2000, 2000);
    expect(selection.update(2000, 'language')).toBe('presets');
    expect(selection.update(2000, 'voice')).toBe('presets');
  });

  it('resumes manual scroll tracking as soon as scrolling away from the clicked position', () => {
    const selection = createSettingsSectionSelection();
    selection.select('presets', 2000, 2000);
    expect(selection.update(1980, 'voice')).toBe('voice');
    expect(selection.update(2000, 'language')).toBe('language');
  });

  it('does not select intermediate sections during asynchronous/smooth anchor scrolling', () => {
    const selection = createSettingsSectionSelection();
    selection.select('updates', 2000, 0);
    expect(selection.update(0, 'autonomy')).toBe('updates');
    expect(selection.update(700, 'terminal')).toBe('updates');
    expect(selection.update(1700, 'voice')).toBe('updates');
    expect(selection.update(2000, 'language')).toBe('updates');
    expect(selection.update(1950, 'voice')).toBe('voice');
  });

  it('replaces a pending selection and handles upward anchors and interrupted navigation', () => {
    const selection = createSettingsSectionSelection();
    selection.select('language', 2000, 500);
    selection.select('autonomy', 0, 700);
    expect(selection.update(200, 'terminal')).toBe('autonomy');
    expect(selection.update(250, 'terminal')).toBe('terminal');
  });

  it('recalculates after a layout resize', () => {
    const selection = createSettingsSectionSelection();
    selection.select('presets', 2000, 2000);
    selection.reset();
    expect(selection.update(2000, 'language')).toBe('language');
  });

  it('releases selection on small cumulative scroll movements, not just large wheel steps', () => {
    const selection = createSettingsSectionSelection();
    selection.select('presets', 2000, 2000);
    selection.update(1999, 'voice');
    expect(selection.update(1998, 'voice')).toBe('voice');
  });
});
