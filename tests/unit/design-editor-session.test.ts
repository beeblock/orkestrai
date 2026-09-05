import { describe, expect, it } from 'vitest';
import {
  readDesignEditorSession,
  writeDesignEditorSession,
  type DesignEditorSession,
} from '$lib/components/agent-room/design/design-editor-session.js';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    values,
  };
}

const session: DesignEditorSession = {
  zoom: 0.8,
  scrollLeft: 420,
  scrollTop: 210,
  selectedIds: ['layer-a', 'layer-b'],
  tool: 'select',
  leftPanel: 'layers',
  rightPanel: 'design',
  leftPanelVisible: true,
  rightPanelVisible: false,
};

describe('Design editor session', () => {
  it('round-trips bounded visual state per workspace and document', () => {
    const storage = memoryStorage();
    writeDesignEditorSession(storage, 'workspace-a', 'design-a', session);

    expect(readDesignEditorSession(storage, 'workspace-a', 'design-a')).toEqual(session);
    expect(readDesignEditorSession(storage, 'workspace-a', 'design-b')).toBeNull();
  });

  it('rejects malformed or unsafe persisted values', () => {
    const storage = memoryStorage();
    storage.setItem('orkestrai.design.editor.v1:workspace-a:design-a', JSON.stringify({
      ...session,
      zoom: 99,
    }));
    expect(readDesignEditorSession(storage, 'workspace-a', 'design-a')).toBeNull();

    storage.setItem('orkestrai.design.editor.v1:workspace-a:design-a', '{');
    expect(readDesignEditorSession(storage, 'workspace-a', 'design-a')).toBeNull();
  });
});
