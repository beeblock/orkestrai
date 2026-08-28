import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('runtime log hygiene', () => {
  it('uses current browser and Electron APIs without known deprecation warnings', () => {
    const audio = readFileSync('src/lib/components/agent-room/audio-pcm.ts', 'utf8');
    const worklet = readFileSync('static/audio/pcm-capture-worklet.js', 'utf8');
    const electron = readFileSync('electron/main.cjs', 'utf8');
    const tasks = readFileSync('src/lib/components/agent-room/canvas/TasksCanvasNode.svelte', 'utf8');
    const tourGuide = readFileSync('src/lib/components/agent-room/tours/TourGuidePanel.svelte', 'utf8');

    expect(audio).not.toContain('createScriptProcessor');
    expect(audio).toContain("audioWorklet.addModule('/audio/pcm-capture-worklet.js')");
    expect(worklet).toContain("registerProcessor('orkestrai-pcm-capture'");
    expect(electron).toContain("on('console-message', (_event, details) =>");
    expect(electron).not.toContain('legacyLevel');
    expect(electron).toContain('autoUpdater.disableWebInstaller = true;');
    expect(tasks).not.toContain('FALLBACK_COLUMNS: BoardColumn[] = $derived');
    expect(tourGuide).not.toContain('const completed = $derived');
  });
});
