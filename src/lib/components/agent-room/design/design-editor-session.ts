export type DesignEditorTool = 'select' | 'hand' | 'frame' | 'rectangle' | 'ellipse' | 'text' | 'path';
export type DesignEditorLeftPanel = 'layers' | 'variables' | 'components';
export type DesignEditorRightPanel = 'design' | 'prototype' | 'inspect';

export type DesignEditorSession = {
  zoom: number;
  scrollLeft: number;
  scrollTop: number;
  selectedIds: string[];
  tool: DesignEditorTool;
  leftPanel: DesignEditorLeftPanel;
  rightPanel: DesignEditorRightPanel;
  leftPanelVisible: boolean;
  rightPanelVisible: boolean;
};

const STORAGE_PREFIX = 'orkestrai.design.editor.v1';
const tools = new Set<DesignEditorTool>(['select', 'hand', 'frame', 'rectangle', 'ellipse', 'text', 'path']);
const leftPanels = new Set<DesignEditorLeftPanel>(['layers', 'variables', 'components']);
const rightPanels = new Set<DesignEditorRightPanel>(['design', 'prototype', 'inspect']);

function key(workspaceId: string, nodeId: string): string {
  return `${STORAGE_PREFIX}:${workspaceId}:${nodeId}`;
}

function finiteNumber(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;
}

export function readDesignEditorSession(
  storage: Pick<Storage, 'getItem'> | null | undefined,
  workspaceId: string,
  nodeId: string,
): DesignEditorSession | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key(workspaceId, nodeId));
    if (!raw || raw.length > 64_000) return null;
    const value = JSON.parse(raw) as Partial<DesignEditorSession>;
    const zoom = finiteNumber(value.zoom, 0.02, 3);
    const scrollLeft = finiteNumber(value.scrollLeft, 0, 10_000_000);
    const scrollTop = finiteNumber(value.scrollTop, 0, 10_000_000);
    const storedRightPanel = value.rightPanel as string | undefined;
    const migratedRightPanel = storedRightPanel === 'collaboration' || storedRightPanel === 'quality'
      ? 'design'
      : storedRightPanel;
    if (
      zoom === null
      || scrollLeft === null
      || scrollTop === null
      || !tools.has(value.tool as DesignEditorTool)
      || !leftPanels.has(value.leftPanel as DesignEditorLeftPanel)
      || !rightPanels.has(migratedRightPanel as DesignEditorRightPanel)
      || typeof value.leftPanelVisible !== 'boolean'
      || typeof value.rightPanelVisible !== 'boolean'
      || !Array.isArray(value.selectedIds)
    ) return null;
    const selectedIds = value.selectedIds
      .filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 128)
      .slice(0, 500);
    return {
      zoom,
      scrollLeft,
      scrollTop,
      selectedIds,
      tool: value.tool as DesignEditorTool,
      leftPanel: value.leftPanel as DesignEditorLeftPanel,
      rightPanel: migratedRightPanel as DesignEditorRightPanel,
      leftPanelVisible: value.leftPanelVisible,
      rightPanelVisible: value.rightPanelVisible,
    };
  } catch {
    return null;
  }
}

export function writeDesignEditorSession(
  storage: Pick<Storage, 'setItem'> | null | undefined,
  workspaceId: string,
  nodeId: string,
  session: DesignEditorSession,
): void {
  if (!storage) return;
  try {
    storage.setItem(key(workspaceId, nodeId), JSON.stringify(session));
  } catch {
    // Editor state is an optional convenience and must never block design work.
  }
}
