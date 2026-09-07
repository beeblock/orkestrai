import type { DesignDocument, DesignElement, DesignOperation } from '../contracts/schemas/designSchemas.js';
import { designElementSchema } from '../contracts/schemas/designSchemas.js';
import { createDesignTokenPreset, type DesignTokenPreset } from './design-tokens.js';

export type DesignTemplateId = 'product' | 'marketing' | 'mobile' | 'design-system';
type IdFactory = () => string;

export const designTemplateIds: DesignTemplateId[] = ['product', 'marketing', 'mobile', 'design-system'];

type ElementInput = Partial<DesignElement> & Pick<DesignElement, 'type' | 'name' | 'x' | 'y' | 'width' | 'height'>;

function element(document: DesignDocument, makeId: IdFactory, input: ElementInput, order: number): DesignElement {
  return designElementSchema.parse({
    id: makeId(),
    pageId: document.activePageId,
    parentId: null,
    fill: input.type === 'text' || input.type === 'group' || input.type === 'path' ? 'transparent' : '#ffffff',
    stroke: 'transparent',
    order,
    ...input,
  });
}

function tokens(preset: DesignTokenPreset, makeId: IdFactory): DesignOperation[] {
  const created = createDesignTokenPreset(preset, makeId);
  return [
    { kind: 'add-variable-collection', collection: created.collection },
    ...created.variables.map((variable): DesignOperation => ({ kind: 'add-variable', variable })),
    { kind: 'set-active-variable-mode', collectionId: created.collection.id, modeId: created.collection.defaultModeId },
  ];
}

function createOperations(elements: DesignElement[]): DesignOperation[] {
  return elements.map((created) => ({ kind: 'create', element: created }));
}

function productTemplate(document: DesignDocument, makeId: IdFactory): DesignOperation[] {
  const root = element(document, makeId, { type: 'frame', name: 'Product dashboard', x: 80, y: 80, width: 1280, height: 800, fill: '#f6f7f9', clipContent: true }, 0);
  const sidebar = element(document, makeId, { type: 'frame', name: 'Primary navigation', parentId: root.id, x: 80, y: 80, width: 232, height: 800, fill: '#17191f', accessibilityRole: 'navigation', accessibilityLabel: 'Primary navigation' }, 0);
  const brand = element(document, makeId, { type: 'text', name: 'Product name', parentId: sidebar.id, x: 108, y: 116, width: 160, height: 32, fill: '#ffffff', text: 'Northstar', fontSize: 22, fontWeight: 700, accessibilityRole: 'heading' }, 0);
  const nav = element(document, makeId, { type: 'text', name: 'Navigation links', parentId: sidebar.id, x: 108, y: 188, width: 160, height: 180, fill: '#c7cad1', text: 'Overview\nProjects\nTeam\nReports\nSettings', fontSize: 15 }, 1);
  const title = element(document, makeId, { type: 'text', name: 'Dashboard heading', parentId: root.id, x: 360, y: 124, width: 520, height: 52, fill: '#17191f', text: 'Good morning, Morgan', fontSize: 36, fontWeight: 700, accessibilityRole: 'heading' }, 1);
  const subtitle = element(document, makeId, { type: 'text', name: 'Dashboard summary', parentId: root.id, x: 360, y: 176, width: 620, height: 28, fill: '#666b76', text: 'Here is what needs your attention today.', fontSize: 16 }, 2);
  const cards = ['Revenue|$84,240|+12.4%', 'Active projects|24|5 due this week', 'Team capacity|78%|Healthy'].flatMap((value, index) => {
    const [label, metric, detail] = value.split('|');
    const x = 360 + index * 292;
    const card = element(document, makeId, { type: 'frame', name: `${label} metric card`, parentId: root.id, x, y: 240, width: 268, height: 164, fill: '#ffffff', stroke: '#e1e3e8', strokeWidth: 1, cornerRadius: 8, accessibilityRole: 'region', accessibilityLabel: label }, 3 + index);
    return [
      card,
      element(document, makeId, { type: 'text', name: `${label} label`, parentId: card.id, x: x + 24, y: 264, width: 210, height: 24, fill: '#666b76', text: label, fontSize: 14 }, 0),
      element(document, makeId, { type: 'text', name: `${label} value`, parentId: card.id, x: x + 24, y: 304, width: 210, height: 40, fill: '#17191f', text: metric, fontSize: 30, fontWeight: 700 }, 1),
      element(document, makeId, { type: 'text', name: `${label} detail`, parentId: card.id, x: x + 24, y: 360, width: 210, height: 22, fill: '#247a52', text: detail, fontSize: 13 }, 2),
    ];
  });
  const table = element(document, makeId, { type: 'frame', name: 'Project activity table', parentId: root.id, x: 360, y: 444, width: 852, height: 360, fill: '#ffffff', stroke: '#e1e3e8', strokeWidth: 1, cornerRadius: 8, accessibilityRole: 'region', accessibilityLabel: 'Recent project activity' }, 6);
  const tableTitle = element(document, makeId, { type: 'text', name: 'Project activity heading', parentId: table.id, x: 384, y: 470, width: 340, height: 30, fill: '#17191f', text: 'Recent project activity', fontSize: 20, fontWeight: 650, accessibilityRole: 'heading' }, 0);
  const rows = element(document, makeId, { type: 'text', name: 'Project activity rows', parentId: table.id, x: 384, y: 524, width: 780, height: 220, fill: '#3e424b', text: 'Mobile redesign               In review       Morgan\nDesign system                 In progress     Casey\nSummer campaign               Ready           Alex\nAnalytics dashboard           In progress     Taylor', fontSize: 15 }, 1);
  return [...tokens('product', makeId), ...createOperations([root, sidebar, brand, nav, title, subtitle, ...cards, table, tableTitle, rows])];
}

function marketingTemplate(document: DesignDocument, makeId: IdFactory): DesignOperation[] {
  const root = element(document, makeId, { type: 'frame', name: 'Campaign landing page', x: 80, y: 80, width: 1280, height: 860, fill: '#faf9f7', clipContent: true }, 0);
  const eyebrow = element(document, makeId, { type: 'text', name: 'Campaign eyebrow', parentId: root.id, x: 148, y: 158, width: 480, height: 28, fill: '#d94725', text: 'AUTUMN 2026 COLLECTION', fontSize: 14, fontWeight: 700 }, 0);
  const title = element(document, makeId, { type: 'text', name: 'Campaign headline', parentId: root.id, x: 148, y: 212, width: 620, height: 232, fill: '#171717', text: 'Built for the moments that move you.', fontSize: 64, fontWeight: 750, accessibilityRole: 'heading' }, 1);
  const body = element(document, makeId, { type: 'text', name: 'Campaign value proposition', parentId: root.id, x: 148, y: 456, width: 520, height: 84, fill: '#4a4844', text: 'A focused collection of durable essentials, designed to travel well and feel better with time.', fontSize: 19 }, 2);
  const cta = element(document, makeId, { type: 'rectangle', name: 'Shop collection button', parentId: root.id, x: 148, y: 558, width: 190, height: 52, fill: '#171717', cornerRadius: 6, accessibilityRole: 'link', accessibilityLabel: 'Shop the collection' }, 3);
  const ctaLabel = element(document, makeId, { type: 'text', name: 'Shop collection label', parentId: root.id, x: 178, y: 572, width: 130, height: 24, fill: '#ffffff', text: 'Shop collection', fontSize: 16, fontWeight: 650 }, 4);
  const visual = element(document, makeId, { type: 'frame', name: 'Campaign product visual', parentId: root.id, x: 804, y: 128, width: 468, height: 622, fills: [{ type: 'linear-gradient', angle: 135, stops: [{ offset: 0, color: '#f0b98a', opacity: 1 }, { offset: 1, color: '#d94725', opacity: 1 }], opacity: 1, visible: true }], cornerRadius: 8, accessibilityRole: 'image', accessibilityLabel: 'Campaign product composition' }, 5);
  const visualText = element(document, makeId, { type: 'text', name: 'Campaign visual caption', parentId: visual.id, x: 844, y: 650, width: 380, height: 58, fill: '#ffffff', text: 'Field Notes\nEdition 04', fontSize: 18, fontWeight: 650 }, 0);
  const proof = element(document, makeId, { type: 'text', name: 'Campaign social proof', parentId: root.id, x: 148, y: 778, width: 1060, height: 40, fill: '#65615b', text: '4.9 average rating     Free exchanges     Designed responsibly     Ships worldwide', fontSize: 15 }, 6);
  return [...tokens('marketing', makeId), ...createOperations([root, eyebrow, title, body, cta, ctaLabel, visual, visualText, proof])];
}

function mobileTemplate(document: DesignDocument, makeId: IdFactory): DesignOperation[] {
  const frameNames = ['Welcome screen', 'Activity screen', 'Detail screen'];
  const frames = frameNames.map((name, index) => element(document, makeId, { type: 'frame', name, x: 80 + index * 430, y: 80, width: 390, height: 844, fill: '#ffffff', cornerRadius: 28, clipContent: true }, index));
  const elements: DesignElement[] = [...frames];
  for (const [index, frame] of frames.entries()) {
    elements.push(
      element(document, makeId, { type: 'text', name: `${frame.name} status bar`, parentId: frame.id, x: frame.x + 24, y: 104, width: 342, height: 24, fill: '#111111', text: '9:41                                      ●●●', fontSize: 13, fontWeight: 650 }, 0),
      element(document, makeId, { type: 'text', name: `${frame.name} heading`, parentId: frame.id, x: frame.x + 24, y: 172, width: 330, height: index === 0 ? 88 : 82, fill: '#111111', text: index === 0 ? 'Plan your day with clarity.' : index === 1 ? 'Today' : 'Project review', fontSize: index === 0 ? 36 : 30, fontWeight: 720, accessibilityRole: 'heading' }, 1),
      element(document, makeId, { type: 'text', name: `${frame.name} content`, parentId: frame.id, x: frame.x + 24, y: 280, width: 342, height: index === 0 ? 92 : 310, fill: '#54545a', text: index === 0 ? 'One calm space for priorities, projects, and the people moving them forward.' : index === 1 ? '09:30  Product review\n11:00  Design critique\n14:00  Focus time\n16:30  Team check-in' : 'Review the interaction states, accessibility findings, and implementation handoff before approving this milestone.', fontSize: 17 }, 2),
    );
    const button = element(document, makeId, { type: 'rectangle', name: `${frame.name} primary action`, parentId: frame.id, x: frame.x + 24, y: 824, width: 342, height: 56, fill: '#007aff', cornerRadius: 10, accessibilityRole: 'button', accessibilityLabel: index === 2 ? 'Approve milestone' : 'Continue' }, 3);
    elements.push(button, element(document, makeId, { type: 'text', name: `${frame.name} primary action label`, parentId: frame.id, x: frame.x + 104, y: 841, width: 182, height: 24, fill: '#ffffff', text: index === 2 ? 'Approve milestone' : 'Continue', fontSize: 17, fontWeight: 650, textAlign: 'center' }, 4));
  }
  const flowId = makeId();
  return [
    ...tokens('mobile', makeId),
    ...createOperations(elements),
    { kind: 'add-prototype-flow', flow: { id: flowId, name: 'Mobile happy path', description: 'Welcome to activity to detail', startFrameId: frames[0].id, order: document.prototypeFlows.length } },
    ...frames.slice(0, -1).map((frame, index): DesignOperation => ({
      kind: 'add-prototype-interaction',
      interaction: {
        id: makeId(), sourceElementId: elements.find((candidate) => candidate.name === `${frame.name} primary action`)!.id,
        trigger: { type: 'click', delayMs: 0 }, action: { type: 'navigate', targetFrameId: frames[index + 1].id },
        transition: { type: 'smart-animate', direction: 'left', durationMs: 300, easing: { type: 'preset', value: 'ease-out' } }, order: index,
      },
    })),
    { kind: 'update-presentation', changes: { defaultFlowId: flowId, showDeviceFrame: true } },
  ];
}

function designSystemTemplate(document: DesignDocument, makeId: IdFactory): DesignOperation[] {
  const root = element(document, makeId, { type: 'frame', name: 'Design system foundations', x: 80, y: 80, width: 1280, height: 840, fill: '#ffffff' }, 0);
  const title = element(document, makeId, { type: 'text', name: 'Foundations heading', parentId: root.id, x: 136, y: 132, width: 720, height: 58, fill: '#17191f', text: 'Product foundations', fontSize: 40, fontWeight: 750, accessibilityRole: 'heading' }, 0);
  const sections = ['Color', 'Typography', 'Spacing', 'Components'].map((name, index) => element(document, makeId, { type: 'text', name: `${name} section heading`, parentId: root.id, x: 136, y: 232 + index * 145, width: 220, height: 34, fill: '#17191f', text: name, fontSize: 22, fontWeight: 700, accessibilityRole: 'heading' }, index + 1));
  const swatches = ['#17191f', '#5b5ce2', '#f5f6f8', '#d92d20'].map((fill, index) => element(document, makeId, { type: 'rectangle', name: `Color ${index + 1}`, parentId: root.id, x: 390 + index * 148, y: 222, width: 120, height: 64, fill, cornerRadius: 6, decorative: true }, index + 5));
  const typeSample = element(document, makeId, { type: 'text', name: 'Typography scale', parentId: root.id, x: 390, y: 354, width: 720, height: 86, fill: '#17191f', text: 'Display 40 / 48\nHeading 24 / 32     Body 16 / 24     Label 13 / 18', fontSize: 18 }, 9);
  const spacing = element(document, makeId, { type: 'text', name: 'Spacing scale', parentId: root.id, x: 390, y: 510, width: 720, height: 52, fill: '#545861', text: '4     8     12     16     24     32     48     64', fontSize: 18, fontWeight: 650 }, 10);
  const button = element(document, makeId, { type: 'frame', name: 'Primary button component', parentId: root.id, x: 390, y: 642, width: 200, height: 52, fill: '#5b5ce2', cornerRadius: 8, accessibilityRole: 'button', accessibilityLabel: 'Primary action' }, 11);
  const buttonLabel = element(document, makeId, { type: 'text', name: 'Primary button label', parentId: button.id, x: 426, y: 656, width: 128, height: 24, fill: '#ffffff', text: 'Primary action', fontSize: 15, fontWeight: 650, textAlign: 'center' }, 0);
  const componentId = makeId();
  return [
    ...tokens('product', makeId),
    ...createOperations([root, title, ...sections, ...swatches, typeSample, spacing, button, buttonLabel]),
    { kind: 'add-component', component: { id: componentId, name: 'Button/Primary', description: 'Default primary action', rootElementId: button.id, setId: null, variantValues: {}, properties: [], key: 'button-primary', libraryId: null, librarySourceId: null, codeConnect: null, updatedAt: new Date().toISOString() } },
  ];
}

export function createDesignTemplate(id: DesignTemplateId, document: DesignDocument, makeId: IdFactory): DesignOperation[] {
  if (id === 'product') return productTemplate(document, makeId);
  if (id === 'marketing') return marketingTemplate(document, makeId);
  if (id === 'mobile') return mobileTemplate(document, makeId);
  return designSystemTemplate(document, makeId);
}
