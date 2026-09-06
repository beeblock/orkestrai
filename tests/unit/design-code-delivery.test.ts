import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { generateDesignCode } from '$lib/modules/agent-room/domain/design-code-generation.js';
import { importMarkupToDesign } from '$lib/modules/agent-room/domain/design-code-import.js';
import { applyDesignOperations } from '$lib/modules/agent-room/application/services/DesignDocumentService.js';
import { designDocumentSchema, type DesignDocument } from '$lib/modules/agent-room/contracts/schemas/designSchemas.js';

const NOW = '2026-08-17T00:00:00.000Z';

function document(): DesignDocument {
  const pageId = randomUUID();
  const frameId = randomUUID();
  const textId = randomUUID();
  const componentId = randomUUID();
  const propertyId = randomUUID();
  return designDocumentSchema.parse({
    schemaVersion: 1,
    id: randomUUID(),
    nodeId: randomUUID(),
    workspaceId: randomUUID(),
    name: 'Checkout',
    revision: 7,
    activePageId: pageId,
    pages: [{ id: pageId, name: 'Page 1', width: 1440, height: 1024, order: 0 }],
    elements: [
      { id: frameId, pageId, parentId: null, type: 'frame', name: 'Checkout card', x: 100, y: 80, width: 420, height: 260, order: 0, layoutMode: 'vertical', layoutGap: 16, componentId },
      { id: textId, pageId, parentId: frameId, type: 'text', name: 'Title', x: 124, y: 104, width: 360, height: 44, order: 0, text: 'Complete purchase', fontSize: 28, fontWeight: 700 },
    ],
    components: [{ id: componentId, name: 'Checkout card', rootElementId: frameId, key: 'checkout-card', properties: [{ id: propertyId, name: 'title', type: 'text', targetElementId: textId, defaultValue: 'Complete purchase', preferredValues: [], order: 0 }], codeConnect: { path: 'src/lib/components/CheckoutCard.svelte', framework: 'svelte', exportName: 'CheckoutCard', props: ['title'], hash: 'a'.repeat(64), syncedAt: NOW }, updatedAt: NOW }],
    createdAt: NOW,
    updatedAt: NOW,
  });
}

describe('Design code delivery domain', () => {
  it('imports HTML, CSS, and Tailwind as editable native hierarchy without executing source', () => {
    const pageId = randomUUID();
    const imported = importMarkupToDesign({
      format: 'html',
      name: 'Pricing card',
      markup: '<section class="flex flex-col gap-4 p-6 rounded-xl bg-[#ffffff]"><h2 class="text-[#112233]">Pro plan</h2><button class="rounded-lg">Start now</button><script>throw new Error("unsafe")</script></section>',
      css: 'section { width: 420px; } h2 { font-size: 28px; font-weight: 700; }',
      pageId,
      parentId: null,
      x: 80,
      y: 90,
      startOrder: 0,
      makeId: randomUUID,
    });

    expect(imported.elements[0]).toMatchObject({ type: 'frame', name: 'Pricing card' });
    expect(imported.elements).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'frame', width: 420, layoutMode: 'vertical', cornerRadius: 12 }),
      expect.objectContaining({ type: 'text', text: 'Pro plan', fontSize: 28, fontWeight: 700 }),
      expect.objectContaining({ type: 'text', text: 'Start now' }),
    ]));
    expect(imported.elements.some((element) => element.text.includes('unsafe'))).toBe(false);
    expect(imported.operations.every((operation) => operation.kind === 'create')).toBe(true);
  });

  it('imports JSX and TSX structure through an ESM-safe parser', () => {
    const imported = importMarkupToDesign({
      format: 'react',
      name: 'React card',
      markup: 'export function Card(): JSX.Element { return <><main className={`grid grid-cols-2 gap-4`}><h1>Hello</h1><UI.Copy>World</UI.Copy></main></> }',
      css: '',
      pageId: randomUUID(),
      parentId: null,
      x: 0,
      y: 0,
      startOrder: 0,
      makeId: randomUUID,
    });

    expect(imported.elements).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'frame', layoutMode: 'grid', layoutGridColumns: 2 }),
      expect.objectContaining({ type: 'text', text: 'Hello' }),
      expect.objectContaining({ type: 'text', text: 'World' }),
    ]));
  });

  it('preserves explicit desktop and mobile widths and resolves default flex rows', () => {
    const imported = importMarkupToDesign({
      format: 'html',
      name: 'Todo directions',
      markup: `
        <div class="canvas">
          <section class="desktop">
            <aside class="rail">Navigation</aside>
            <main class="stage"><header class="head"><h1>Today</h1><span>September 6</span></header></main>
          </section>
          <section class="mobile">Mobile tasks</section>
        </div>
      `,
      css: `
        .canvas { display: flex; gap: 80px; }
        .desktop { display: flex; width: 1440px; height: 1000px; }
        .rail { width: 280px; }
        .stage { flex: 1; }
        .head { display: flex; gap: 16px; }
        .mobile { width: 390px; height: 844px; }
      `,
      pageId: randomUUID(),
      parentId: null,
      x: 40,
      y: 40,
      startOrder: 0,
      makeId: randomUUID,
    });

    const byName = new Map(imported.elements.map((element) => [element.name, element]));
    const canvas = byName.get('canvas')!;
    const desktop = byName.get('desktop')!;
    const rail = byName.get('rail')!;
    const stage = byName.get('stage')!;
    const mobile = byName.get('mobile')!;
    const wrapper = byName.get('Todo directions')!;

    expect(canvas.layoutMode).toBe('horizontal');
    expect(desktop).toMatchObject({ width: 1440, height: 1000, layoutMode: 'horizontal' });
    expect(mobile).toMatchObject({ width: 390, height: 844 });
    expect(stage.width).toBeGreaterThan(1000);
    expect(stage.x).toBeGreaterThan(rail.x + rail.width);
    expect(mobile.x).toBeGreaterThan(desktop.x + desktop.width);
    expect(canvas.width).toBeGreaterThanOrEqual(1910);
    expect(wrapper.width).toBeGreaterThan(canvas.width);
    expect(wrapper.clipContent).toBe(false);
  });

  it('positions absolute mobile navigation and actions inside their frame', () => {
    const imported = importMarkupToDesign({
      format: 'html',
      name: 'Mobile direction',
      markup: `
        <section class="mobile">
          <main class="content">Tasks</main>
          <button class="fab">+</button>
          <nav class="tabs">Today Upcoming</nav>
        </section>
      `,
      css: `
        .mobile { position: relative; display: flex; flex-direction: column; width: 390px; height: 844px; padding: 24px 20px 0; }
        .content { flex: 1; }
        .fab { position: absolute; right: 20px; bottom: 96px; width: 60px; height: 60px; }
        .tabs { position: absolute; left: 0; right: 0; bottom: 0; height: 76px; }
      `,
      pageId: randomUUID(),
      parentId: null,
      x: 40,
      y: 40,
      startOrder: 0,
      makeId: randomUUID,
    });

    const byName = new Map(imported.elements.map((element) => [element.name, element]));
    const mobile = byName.get('mobile')!;
    const content = byName.get('content')!;
    const fab = byName.get('fab')!;
    const tabs = byName.get('tabs')!;

    expect(content.y).toBe(mobile.y + 24);
    expect(tabs).toMatchObject({ x: mobile.x, y: mobile.y + mobile.height - 76, width: 390, height: 76 });
    expect(fab).toMatchObject({ x: mobile.x + mobile.width - 20 - 60, y: mobile.y + mobile.height - 96 - 60, width: 60, height: 60 });
    expect(tabs.y + tabs.height).toBe(mobile.y + mobile.height);
  });

  it('preserves scoped selectors, CSS box padding, hugging controls, and mixed inline text', () => {
    const imported = importMarkupToDesign({
      format: 'html',
      name: 'Todo details',
      markup: `
        <section class="mobile">
          <div class="filters"><button class="chip active">All</button><button class="chip">Upcoming</button></div>
          <div class="toast">Task complete <span class="undo">Undo</span></div>
          <h1 class="title">Today <span class="count">5</span></h1>
          <span class="outside">Other</span>
        </section>
      `,
      css: `
        .mobile { width: 390px; padding: 24px 20px 0; color: #202124; }
        .filters { display: flex; gap: 8px; }
        .chip { padding: 8px 16px; background: #eeeeee; }
        .chip.active { background: #111111; color: #ffffff; }
        .toast { display: flex; gap: 8px; padding: 12px 16px; }
        .title { font-size: 32px; }
        .title > span { color: #777777; font-size: 20px; }
      `,
      pageId: randomUUID(),
      parentId: null,
      x: 40,
      y: 40,
      startOrder: 0,
      makeId: randomUUID,
    });

    const named = (name: string) => imported.elements.find((element) => element.name === name)!;
    const mobile = named('mobile');
    const filters = named('filters');
    const chips = imported.elements.filter((element) => element.parentId === filters.id && element.name === 'chip');
    const activeLabel = imported.elements.find((element) => element.parentId === chips[0].id && element.text === 'All')!;
    const toast = named('toast');
    const toastLabel = imported.elements.find((element) => element.parentId === toast.id && element.text === 'Task complete')!;
    const undo = imported.elements.find((element) => element.parentId === toast.id && element.text === 'Undo')!;
    const title = named('title');
    const count = imported.elements.find((element) => element.parentId === title.id && element.text === '5')!;
    const outside = named('outside');

    expect(mobile).toMatchObject({ layoutPaddingTop: 24, layoutPaddingRight: 20, layoutPaddingBottom: 0, layoutPaddingLeft: 20 });
    expect(chips).toHaveLength(2);
    expect(chips[0].width).toBeLessThan(100);
    expect(chips[1].width).toBeLessThan(150);
    expect(chips[1].x).toBe(chips[0].x + chips[0].width + 8);
    expect(activeLabel.fill).toBe('#ffffff');
    expect(undo.x).toBe(toastLabel.x + toastLabel.width + 8);
    expect(title).toMatchObject({ type: 'frame', fill: 'transparent' });
    expect(count).toMatchObject({ fontSize: 20, fill: '#777777' });
    expect(outside).toMatchObject({ fontSize: 16, fill: '#202124' });
  });

  it('generates Svelar code and reuses a connected real component', () => {
    const source = document();
    const root = source.elements[0];
    const instanceId = randomUUID();
    const instance = applyDesignOperations(source, [{ kind: 'create-component-instance', componentId: source.components[0].id, instanceId, pageId: root.pageId, parentId: null, x: 600, y: 80 }], NOW);
    const generated = generateDesignCode(instance, { framework: 'svelar', elementIds: [instanceId], outputPath: 'src/routes/checkout/CheckoutPreview.svelte', componentName: 'CheckoutPreview' });

    expect(generated.content).toContain("import CheckoutCard from '../../lib/components/CheckoutCard';");
    expect(generated.content).toContain('<CheckoutCard');
    expect(generated.content).toContain('title="Complete purchase"');
    expect(generated.mappingsUsed).toEqual([expect.objectContaining({ componentId: source.components[0].id, exportName: 'CheckoutCard' })]);
  });

  it('tracks generated artifacts through the shared command bus', () => {
    const source = document();
    const artifact = { id: randomUUID(), name: 'Checkout', path: 'src/Checkout.svelte', framework: 'svelar' as const, elementIds: [source.elements[0].id], sourceRevision: source.revision, contentHash: 'b'.repeat(64), componentMappings: [], generatedAt: NOW };
    const added = applyDesignOperations(source, [{ kind: 'add-code-artifact', artifact }], NOW);
    const updated = applyDesignOperations(added, [{ kind: 'update-code-artifact', artifactId: artifact.id, changes: { contentHash: 'c'.repeat(64) } }], NOW);
    const removed = applyDesignOperations(updated, [{ kind: 'delete-code-artifact', artifactId: artifact.id }], NOW);

    expect(added.codeArtifacts).toEqual([artifact]);
    expect(updated.codeArtifacts[0].contentHash).toBe('c'.repeat(64));
    expect(removed.codeArtifacts).toEqual([]);
  });
});
