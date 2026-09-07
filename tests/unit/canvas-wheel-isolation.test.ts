import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function componentSource(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('Canvas node wheel isolation', () => {
  it('marks every shared node shell as a no-wheel boundary', () => {
    const source = componentSource('src/lib/components/agent-room/canvas/NodeShell.svelte');

    expect(source).toContain('node-shell nowheel');
    expect(source).toContain('overscroll-behavior: contain');
  });

  it.each([
    'src/lib/components/agent-room/canvas/ShapeCanvasNode.svelte',
    'src/lib/components/agent-room/canvas/GroupCanvasNode.svelte',
  ])('covers the standalone node component %s', (path) => {
    expect(componentSource(path)).toContain('nowheel');
  });

  it('keeps terminal wheel gestures inside xterm', () => {
    const source = componentSource('src/lib/components/agent-room/TerminalNode.svelte');

    expect(source).toContain('terminal.attachCustomWheelEventHandler');
    expect(source).toContain('event.stopPropagation()');
    expect(source).toContain('overscroll-behavior: contain');
  });
});
