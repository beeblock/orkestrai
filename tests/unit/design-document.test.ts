import { describe, expect, it } from 'vitest';
import { applyDesignOperations } from '$lib/modules/agent-room/application/services/DesignDocumentService.js';
import { designDocumentSchema, designOperationSchema, uploadDesignThumbnailSchema, type DesignDocument } from '$lib/modules/agent-room/contracts/schemas/designSchemas.js';

const WORKSPACE_ID = '00000000-0000-7000-8000-000000000001';
const NODE_ID = '00000000-0000-7000-8000-000000000002';
const DOCUMENT_ID = '00000000-0000-7000-8000-000000000003';
const PAGE_ID = '00000000-0000-7000-8000-000000000004';
const FRAME_ID = '00000000-0000-7000-8000-000000000005';
const TEXT_ID = '00000000-0000-7000-8000-000000000006';
const ASSET_ID = '00000000-0000-7000-8000-000000000007';
const GUIDE_ID = '00000000-0000-7000-8000-000000000008';
const GROUP_ID = '00000000-0000-7000-8000-000000000009';
const SECOND_PAGE_ID = '00000000-0000-7000-8000-000000000010';
const THIRD_PAGE_ID = '00000000-0000-7000-8000-000000000011';
const ARTIFACT_ID = '00000000-0000-7000-8000-000000000012';
const REMOVED_ARTIFACT_ID = '00000000-0000-7000-8000-000000000013';
const NOW = '2026-08-16T12:00:00.000Z';

function document(): DesignDocument {
  return designDocumentSchema.parse({
    schemaVersion: 1,
    id: DOCUMENT_ID,
    nodeId: NODE_ID,
    workspaceId: WORKSPACE_ID,
    name: 'Checkout',
    revision: 0,
    activePageId: PAGE_ID,
    pages: [{ id: PAGE_ID, name: 'Page 1', width: 1440, height: 1024, background: '#f5f5f3', order: 0 }],
    elements: [],
    createdAt: NOW,
    updatedAt: NOW,
  });
}

describe('documento de Design', () => {
  it('aplica criacao e atualizacao tipadas sem perder defaults', () => {
    const created = applyDesignOperations(document(), [designOperationSchema.parse({
      kind: 'create',
      element: {
        id: FRAME_ID,
        pageId: PAGE_ID,
        parentId: null,
        type: 'frame',
        name: 'Mobile',
        x: 20,
        y: 20,
        width: 390,
        height: 844,
      },
    })], NOW);

    expect(created.elements[0]).toMatchObject({ id: FRAME_ID, fill: '#ffffff', visible: true, order: 0 });
    const updated = applyDesignOperations(created, [{
      kind: 'update',
      elementId: FRAME_ID,
      changes: { x: 48, cornerRadius: 24 },
    }], NOW);
    expect(updated.elements[0]).toMatchObject({ x: 48, cornerRadius: 24 });
  });

  it('remove descendentes junto com o elemento pai', () => {
    const populated = designDocumentSchema.parse({
      ...document(),
      elements: [
        { id: FRAME_ID, pageId: PAGE_ID, parentId: null, type: 'frame', name: 'Frame', x: 0, y: 0, width: 300, height: 500, order: 0 },
        { id: TEXT_ID, pageId: PAGE_ID, parentId: FRAME_ID, type: 'text', name: 'Title', x: 20, y: 20, width: 200, height: 40, order: 0, text: 'Hello' },
      ],
    });
    const deleted = applyDesignOperations(populated, [{ kind: 'delete', elementId: FRAME_ID }], NOW);
    expect(deleted.elements).toEqual([]);
  });

  it('mantem grupos como pais tipados e restaura filhos ao desagrupar', () => {
    const grouped = applyDesignOperations(document(), [
      designOperationSchema.parse({ kind: 'create', element: { id: GROUP_ID, pageId: PAGE_ID, parentId: null, type: 'group', name: 'Icon', x: 10, y: 20, width: 120, height: 80 } }),
      designOperationSchema.parse({ kind: 'create', element: { id: TEXT_ID, pageId: PAGE_ID, parentId: GROUP_ID, type: 'path', name: 'Curve', x: 10, y: 20, width: 120, height: 80, pathPoints: [{ x: 0, y: 0 }, { x: 120, y: 80 }] } }),
    ], NOW);

    expect(grouped.elements.find((element) => element.id === TEXT_ID)?.parentId).toBe(GROUP_ID);
    const ungrouped = applyDesignOperations(grouped, [
      { kind: 'reparent', elementId: TEXT_ID, parentId: null, order: 0 },
      { kind: 'delete', elementId: GROUP_ID },
    ], NOW);
    expect(ungrouped.elements).toHaveLength(1);
    expect(ungrouped.elements[0]).toMatchObject({ id: TEXT_ID, parentId: null, type: 'path' });
  });

  it('protege elementos bloqueados contra mutacoes acidentais', () => {
    const populated = designDocumentSchema.parse({
      ...document(),
      elements: [
        { id: FRAME_ID, pageId: PAGE_ID, parentId: null, type: 'frame', name: 'Locked', x: 0, y: 0, width: 300, height: 500, order: 0, locked: true },
      ],
    });
    expect(() => applyDesignOperations(populated, [{
      kind: 'update',
      elementId: FRAME_ID,
      changes: { x: 10 },
    }], NOW)).toThrow('locked');
    expect(() => applyDesignOperations(populated, [{
      kind: 'reorder',
      elementId: FRAME_ID,
      order: 4,
    }], NOW)).toThrow('locked');
  });

  it('permite filhos somente dentro de frames da mesma pagina', () => {
    const populated = designDocumentSchema.parse({
      ...document(),
      elements: [
        { id: TEXT_ID, pageId: PAGE_ID, parentId: null, type: 'text', name: 'Title', x: 20, y: 20, width: 200, height: 40, order: 0, text: 'Hello' },
      ],
    });
    expect(() => applyDesignOperations(populated, [designOperationSchema.parse({
      kind: 'create',
      element: { pageId: PAGE_ID, parentId: TEXT_ID, type: 'rectangle', name: 'Invalid child', x: 0, y: 0, width: 20, height: 20 },
    })], NOW)).toThrow('Only frames');
  });

  it('renomeia o documento sem alterar o conteudo visual', () => {
    const renamed = applyDesignOperations(document(), [{ kind: 'rename-document', name: 'Design system' }], NOW);

    expect(renamed.name).toBe('Design system');
    expect(renamed.elements).toEqual([]);
    expect(renamed.updatedAt).toBe(NOW);
  });

  it('gerencia paginas pelo mesmo command bus revisionado', () => {
    let current = applyDesignOperations(document(), [designOperationSchema.parse({
      kind: 'create-page',
      page: { id: SECOND_PAGE_ID, name: 'Components', width: 1920, height: 1080, background: '#ffffff' },
    })], NOW);
    expect(current.activePageId).toBe(SECOND_PAGE_ID);
    expect(current.pages.map((page) => page.name)).toEqual(['Page 1', 'Components']);

    current = applyDesignOperations(current, [
      { kind: 'update-page', pageId: SECOND_PAGE_ID, changes: { name: 'Library', background: '#111111' } },
      { kind: 'reorder-page', pageId: SECOND_PAGE_ID, order: 0 },
      { kind: 'reorder-page', pageId: PAGE_ID, order: 1 },
    ], NOW);
    expect(current.pages.map((page) => page.name)).toEqual(['Library', 'Page 1']);
    expect(current.pages[0].background).toBe('#111111');

    current = applyDesignOperations(current, [{ kind: 'set-active-page', pageId: PAGE_ID }], NOW);
    expect(current.activePageId).toBe(PAGE_ID);
    expect(() => applyDesignOperations(document(), [{ kind: 'delete-page', pageId: PAGE_ID }], NOW)).toThrow('at least one page');
  });

  it('duplica a hierarquia da pagina com ids independentes', () => {
    const populated = designDocumentSchema.parse({
      ...document(),
      elements: [
        { id: FRAME_ID, pageId: PAGE_ID, parentId: null, type: 'frame', name: 'Frame', x: 0, y: 0, width: 300, height: 500, order: 0 },
        { id: TEXT_ID, pageId: PAGE_ID, parentId: FRAME_ID, type: 'text', name: 'Title', x: 20, y: 20, width: 200, height: 40, order: 0, text: 'Hello' },
      ],
    });
    const duplicated = applyDesignOperations(populated, [{
      kind: 'duplicate-page',
      pageId: PAGE_ID,
      duplicateId: SECOND_PAGE_ID,
      name: 'Page 1 copy',
    }], NOW);
    const copies = duplicated.elements.filter((element) => element.pageId === SECOND_PAGE_ID);
    const copiedFrame = copies.find((element) => element.type === 'frame')!;
    const copiedText = copies.find((element) => element.type === 'text')!;
    expect(duplicated.activePageId).toBe(SECOND_PAGE_ID);
    expect(copies).toHaveLength(2);
    expect(copiedFrame.id).not.toBe(FRAME_ID);
    expect(copiedText).toMatchObject({ name: 'Title', parentId: copiedFrame.id });
  });

  it('remove uma pagina e suas referencias sem tocar no conteudo restante', () => {
    const populated = designDocumentSchema.parse({
      ...document(),
      pages: [
        ...document().pages,
        { id: SECOND_PAGE_ID, name: 'Archive', width: 1440, height: 1024, background: '#ffffff', order: 1 },
        { id: THIRD_PAGE_ID, name: 'Keep', width: 1440, height: 1024, background: '#ffffff', order: 2 },
      ],
      elements: [
        { id: FRAME_ID, pageId: PAGE_ID, parentId: null, type: 'frame', name: 'Delete', x: 0, y: 0, width: 300, height: 500, order: 0 },
        { id: TEXT_ID, pageId: THIRD_PAGE_ID, parentId: null, type: 'text', name: 'Keep', x: 20, y: 20, width: 200, height: 40, order: 0, text: 'Hello' },
      ],
      prototypeFlows: [{ id: GROUP_ID, name: 'Delete flow', description: '', startFrameId: FRAME_ID, order: 0 }],
      codeArtifacts: [
        { id: ARTIFACT_ID, name: 'Shared view', path: 'src/shared.svelte', framework: 'svelte', elementIds: [FRAME_ID, TEXT_ID], sourceRevision: 0, contentHash: 'a'.repeat(64), generatedAt: NOW },
        { id: REMOVED_ARTIFACT_ID, name: 'Deleted view', path: 'src/deleted.svelte', framework: 'svelte', elementIds: [FRAME_ID], sourceRevision: 0, contentHash: 'b'.repeat(64), generatedAt: NOW },
      ],
      presentation: { defaultFlowId: GROUP_ID, background: '#111111', showDeviceFrame: true, showHotspots: false, showCursor: true },
    });
    const deleted = applyDesignOperations(populated, [{ kind: 'delete-page', pageId: PAGE_ID }], NOW);
    expect(deleted.pages.map((page) => page.id)).toEqual([SECOND_PAGE_ID, THIRD_PAGE_ID]);
    expect(deleted.elements.map((element) => element.id)).toEqual([TEXT_ID]);
    expect(deleted.prototypeFlows).toEqual([]);
    expect(deleted.codeArtifacts).toHaveLength(1);
    expect(deleted.codeArtifacts[0]).toMatchObject({ id: ARTIFACT_ID, elementIds: [TEXT_ID] });
    expect(deleted.presentation.defaultFlowId).toBeNull();
    expect(deleted.activePageId).toBe(SECOND_PAGE_ID);
  });

  it('mantem paints, efeitos, paths e layout retrocompativeis no schema v1', () => {
    const parsed = designDocumentSchema.parse({
      ...document(),
      elements: [{
        id: FRAME_ID,
        pageId: PAGE_ID,
        parentId: null,
        type: 'path',
        name: 'Gradient path',
        x: 10,
        y: 20,
        width: 100,
        height: 80,
        order: 0,
        pathClosed: true,
        pathPoints: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 80 }],
        fills: [{
          type: 'linear-gradient',
          angle: 45,
          stops: [{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#0000ff' }],
        }],
        effects: [{ type: 'drop-shadow', color: '#00000040', x: 0, y: 4, blur: 12 }],
      }],
    });

    expect(parsed.elements[0]).toMatchObject({ type: 'path', pathClosed: true, layoutMode: 'none' });
    expect(parsed.elements[0].fills[0]).toMatchObject({ type: 'linear-gradient', angle: 45, opacity: 1 });
    expect(parsed.elements[0].effects[0]).toMatchObject({ type: 'drop-shadow', visible: true });
  });

  it('controla assets, guias e reparent pelo mesmo command bus', () => {
    const asset = {
      id: ASSET_ID,
      name: 'hero.png',
      path: `.orkestrai/designs/assets/${NODE_ID}/${ASSET_ID}-hero.png`,
      mimeType: 'image/png' as const,
      size: 1024,
      width: 640,
      height: 480,
      createdAt: NOW,
    };
    const populated = applyDesignOperations(document(), [
      { kind: 'add-asset', asset },
      { kind: 'add-guide', guide: { id: GUIDE_ID, axis: 'x', position: 120 } },
      designOperationSchema.parse({ kind: 'create', element: { id: FRAME_ID, pageId: PAGE_ID, parentId: null, type: 'frame', name: 'Frame', x: 0, y: 0, width: 300, height: 500 } }),
      designOperationSchema.parse({ kind: 'create', element: { id: TEXT_ID, pageId: PAGE_ID, parentId: null, type: 'image', name: 'Hero', x: 20, y: 20, width: 200, height: 120, assetId: ASSET_ID } }),
      { kind: 'reparent', elementId: TEXT_ID, parentId: FRAME_ID },
    ], NOW);

    expect(populated.assets).toEqual([asset]);
    expect(populated.guides[0]).toMatchObject({ axis: 'x', position: 120 });
    expect(populated.elements.find((element) => element.id === TEXT_ID)?.parentId).toBe(FRAME_ID);
    expect(() => applyDesignOperations(populated, [{ kind: 'delete-asset', assetId: ASSET_ID }], NOW)).toThrow('still used');
  });

  it('aceita apenas thumbnails PNG associados a uma revisao', () => {
    const parsed = uploadDesignThumbnailSchema.parse({
      file: new File([new Uint8Array([137, 80, 78, 71])], 'preview.png', { type: 'image/png' }),
      revision: '4',
    });

    expect(parsed.revision).toBe(4);
    expect(parsed.file.type).toBe('image/png');
    expect(() => uploadDesignThumbnailSchema.parse({
      file: new File(['svg'], 'preview.svg', { type: 'image/svg+xml' }),
      revision: 4,
    })).toThrow();
  });
});
