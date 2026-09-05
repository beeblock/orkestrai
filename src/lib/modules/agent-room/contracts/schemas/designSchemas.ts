import { z } from 'zod';

export const designElementTypeSchema = z.enum(['frame', 'group', 'rectangle', 'ellipse', 'text', 'path', 'image']);
const legacyDesignPaintSchema = z.string().trim().regex(/^(transparent|#[0-9a-f]{3,8})$/i).default('transparent');
const designColorSchema = z.string().trim().regex(/^#[0-9a-f]{3,8}$/i);

export const designGradientStopSchema = z.object({
  offset: z.number().finite().min(0).max(1),
  color: designColorSchema,
  opacity: z.number().finite().min(0).max(1).default(1),
});

export const designPaintSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('solid'),
    color: designColorSchema,
    opacity: z.number().finite().min(0).max(1).default(1),
    visible: z.boolean().default(true),
  }),
  z.object({
    type: z.literal('linear-gradient'),
    angle: z.number().finite().min(-3600).max(3600).default(0),
    stops: z.array(designGradientStopSchema).min(2).max(32),
    opacity: z.number().finite().min(0).max(1).default(1),
    visible: z.boolean().default(true),
  }),
  z.object({
    type: z.literal('radial-gradient'),
    centerX: z.number().finite().min(0).max(1).default(0.5),
    centerY: z.number().finite().min(0).max(1).default(0.5),
    radius: z.number().finite().min(0.01).max(4).default(0.5),
    stops: z.array(designGradientStopSchema).min(2).max(32),
    opacity: z.number().finite().min(0).max(1).default(1),
    visible: z.boolean().default(true),
  }),
]);

export const designEffectSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.enum(['drop-shadow', 'inner-shadow']),
    color: designColorSchema.default('#00000040'),
    x: z.number().finite().min(-10_000).max(10_000).default(0),
    y: z.number().finite().min(-10_000).max(10_000).default(4),
    blur: z.number().finite().min(0).max(1000).default(12),
    spread: z.number().finite().min(-1000).max(1000).default(0),
    visible: z.boolean().default(true),
  }),
  z.object({
    type: z.enum(['layer-blur', 'background-blur']),
    blur: z.number().finite().min(0).max(1000).default(8),
    visible: z.boolean().default(true),
  }),
]);

export const designVariableTypeSchema = z.enum([
  'color',
  'spacing',
  'radius',
  'font-size',
  'font-weight',
  'line-height',
  'opacity',
  'effect',
  'breakpoint',
  'string',
  'boolean',
]);

export const designVariableValueSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('color'), value: designColorSchema }),
  z.object({ kind: z.literal('number'), value: z.number().finite().min(-100_000).max(100_000) }),
  z.object({ kind: z.literal('string'), value: z.string().max(2_000) }),
  z.object({ kind: z.literal('boolean'), value: z.boolean() }),
  z.object({ kind: z.literal('effect'), value: z.array(designEffectSchema).max(16) }),
  z.object({ kind: z.literal('alias'), variableId: z.string().uuid() }),
]);

export const designVariableModeSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
});

export const designCodeSourceSchema = z.object({
  path: z.string().trim().min(1).max(512),
  format: z.enum(['css', 'tailwind', 'svelte', 'react', 'vue']),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  syncedAt: z.string().datetime(),
});

export const designFigmaSourceSchema = z.object({
  linkId: z.string().uuid(),
  nodeId: z.string().trim().min(1).max(240),
  key: z.string().trim().min(1).max(240).nullable().default(null),
  sourceHash: z.string().regex(/^[0-9a-f]{64}$/),
  syncedAt: z.string().datetime(),
});

export const designVariableCollectionSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  modes: z.array(designVariableModeSchema).min(1).max(16),
  defaultModeId: z.string().uuid(),
  order: z.number().int().min(0).max(10_000),
  libraryId: z.string().uuid().nullable().default(null),
  librarySourceId: z.string().uuid().nullable().default(null),
  codeSource: designCodeSourceSchema.nullable().default(null),
  figmaSource: designFigmaSourceSchema.nullable().optional(),
});

export const designVariableSchema = z.object({
  id: z.string().uuid(),
  collectionId: z.string().uuid(),
  name: z.string().trim().min(1).max(160),
  type: designVariableTypeSchema,
  description: z.string().max(1_000).default(''),
  values: z.record(z.string().uuid(), designVariableValueSchema),
  order: z.number().int().min(0).max(100_000),
  libraryId: z.string().uuid().nullable().default(null),
  librarySourceId: z.string().uuid().nullable().default(null),
  codeSourceKey: z.string().trim().min(1).max(800).nullable().default(null),
  figmaSource: designFigmaSourceSchema.nullable().optional(),
});

export const designBindablePropertySchema = z.enum([
  'fill',
  'stroke',
  'opacity',
  'cornerRadius',
  'strokeWidth',
  'fontSize',
  'fontWeight',
  'layoutGap',
  'layoutRowGap',
  'layoutColumnGap',
  'layoutPaddingTop',
  'layoutPaddingRight',
  'layoutPaddingBottom',
  'layoutPaddingLeft',
  'effects',
]);

export const designComponentPropertyTypeSchema = z.enum(['text', 'boolean', 'slot']);
export const designComponentPropertyValueSchema = z.union([
  z.string().max(20_000),
  z.boolean(),
  z.null(),
]);

export const designComponentPropertySchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  type: designComponentPropertyTypeSchema,
  targetElementId: z.string().uuid(),
  defaultValue: designComponentPropertyValueSchema,
  preferredValues: z.array(z.string().uuid()).max(200).default([]),
  order: z.number().int().min(0).max(10_000),
});

export const designComponentSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(160),
  description: z.string().max(1_000).default(''),
  rootElementId: z.string().uuid(),
  setId: z.string().uuid().nullable().default(null),
  variantValues: z.record(z.string().trim().min(1).max(80), z.string().trim().min(1).max(120)).default({}),
  properties: z.array(designComponentPropertySchema).max(200).default([]),
  key: z.string().trim().min(1).max(240),
  libraryId: z.string().uuid().nullable().default(null),
  librarySourceId: z.string().uuid().nullable().default(null),
  codeConnect: z.object({
    path: z.string().trim().min(1).max(512),
    framework: z.enum(['svelte', 'react', 'vue']),
    exportName: z.string().trim().min(1).max(160),
    props: z.array(z.string().trim().min(1).max(120)).max(200).default([]),
    hash: z.string().regex(/^[0-9a-f]{64}$/),
    syncedAt: z.string().datetime(),
  }).nullable().default(null),
  figmaSource: designFigmaSourceSchema.nullable().optional(),
  updatedAt: z.string().datetime(),
});

export const designComponentSetSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(160),
  propertyNames: z.array(z.string().trim().min(1).max(80)).max(32).default([]),
  order: z.number().int().min(0).max(10_000),
  libraryId: z.string().uuid().nullable().default(null),
  librarySourceId: z.string().uuid().nullable().default(null),
  figmaSource: designFigmaSourceSchema.nullable().optional(),
});

export const designLibraryLinkSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(160),
  sourceWorkspaceId: z.string().uuid(),
  sourceNodeId: z.string().uuid(),
  sourceRevision: z.number().int().min(0),
  mappings: z.record(z.string().uuid(), z.string().uuid()),
  importedAt: z.string().datetime(),
  syncedAt: z.string().datetime(),
});

export const designFigmaLinkSchema = z.object({
  id: z.string().uuid(),
  fileKey: z.string().trim().regex(/^[A-Za-z0-9_-]{6,240}$/),
  fileName: z.string().trim().min(1).max(240),
  url: z.string().url().max(2_000),
  sourceNodeIds: z.array(z.string().trim().min(1).max(240)).min(1).max(500),
  sourceVersion: z.string().trim().max(240).nullable().default(null),
  sourceLastModified: z.string().datetime().nullable().default(null),
  originX: z.number().finite(),
  originY: z.number().finite(),
  mappings: z.record(z.string().min(1).max(240), z.string().uuid()),
  baselineHashes: z.record(z.string().min(1).max(240), z.string().regex(/^[0-9a-f]{64}$/)),
  localHashes: z.record(z.string().min(1).max(240), z.string().regex(/^[0-9a-f]{64}$/)),
  imageRefs: z.record(z.string().min(1).max(240), z.string().min(1).max(500)).default({}),
  pendingPushNodeIds: z.array(z.string().min(1).max(240)).max(2_000).default([]),
  importedAt: z.string().datetime(),
  syncedAt: z.string().datetime(),
});

export const designCodeArtifactSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(180),
  path: z.string().trim().min(1).max(1_024),
  framework: z.enum(['svelar', 'svelte', 'react', 'next', 'vue', 'html']),
  elementIds: z.array(z.string().uuid()).min(1).max(500),
  sourceRevision: z.number().int().min(0),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  componentMappings: z.array(z.object({
    componentId: z.string().uuid(),
    path: z.string().trim().min(1).max(512),
    exportName: z.string().trim().min(1).max(160),
  })).max(500).default([]),
  generatedAt: z.string().datetime(),
});

export const designMotionEasingSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('preset'),
    value: z.enum(['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out']).default('ease-out'),
  }),
  z.object({
    type: z.literal('cubic-bezier'),
    x1: z.number().finite().min(0).max(1),
    y1: z.number().finite().min(-4).max(4),
    x2: z.number().finite().min(0).max(1),
    y2: z.number().finite().min(-4).max(4),
  }),
  z.object({
    type: z.literal('spring'),
    mass: z.number().finite().min(0.1).max(10).default(1),
    stiffness: z.number().finite().min(1).max(1_000).default(170),
    damping: z.number().finite().min(1).max(100).default(26),
    velocity: z.number().finite().min(-100).max(100).default(0),
  }),
]);

export const designPrototypeTransitionSchema = z.object({
  type: z.enum(['instant', 'dissolve', 'slide', 'push', 'smart-animate']).default('dissolve'),
  direction: z.enum(['left', 'right', 'up', 'down']).default('left'),
  durationMs: z.number().int().min(0).max(10_000).default(300),
  easing: designMotionEasingSchema.default({ type: 'preset', value: 'ease-out' }),
});

export const designPrototypeTriggerSchema = z.object({
  type: z.enum(['click', 'hover', 'press', 'after-delay']).default('click'),
  delayMs: z.number().int().min(0).max(60_000).default(0),
});

export const designPrototypeActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('navigate'), targetFrameId: z.string().uuid() }),
  z.object({
    type: z.literal('open-overlay'),
    targetFrameId: z.string().uuid(),
    position: z.enum(['center', 'top', 'right', 'bottom', 'left']).default('center'),
    dismissOnOutside: z.boolean().default(true),
    backgroundColor: designColorSchema.default('#000000'),
    backgroundOpacity: z.number().finite().min(0).max(1).default(0.45),
  }),
  z.object({ type: z.literal('close-overlay') }),
  z.object({ type: z.literal('back') }),
  z.object({ type: z.literal('scroll-to'), targetElementId: z.string().uuid() }),
  z.object({ type: z.literal('set-variable-mode'), collectionId: z.string().uuid(), modeId: z.string().uuid() }),
]);

export const designPrototypeInteractionSchema = z.object({
  id: z.string().uuid(),
  sourceElementId: z.string().uuid(),
  trigger: designPrototypeTriggerSchema,
  action: designPrototypeActionSchema,
  transition: designPrototypeTransitionSchema.default({
    type: 'dissolve',
    direction: 'left',
    durationMs: 300,
    easing: { type: 'preset', value: 'ease-out' },
  }),
  order: z.number().int().min(0).max(100_000),
});

export const designPrototypeFlowSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(1_000).default(''),
  startFrameId: z.string().uuid(),
  order: z.number().int().min(0).max(10_000),
});

export const designMotionTokenSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  durationMs: z.number().int().min(1).max(60_000).default(300),
  easing: designMotionEasingSchema.default({ type: 'preset', value: 'ease-out' }),
  order: z.number().int().min(0).max(10_000),
});

export const designMotionKeyframeValuesSchema = z.object({
  x: z.number().finite().min(-100_000).max(100_000).optional(),
  y: z.number().finite().min(-100_000).max(100_000).optional(),
  width: z.number().finite().min(1).max(100_000).optional(),
  height: z.number().finite().min(1).max(100_000).optional(),
  rotation: z.number().finite().min(-3_600).max(3_600).optional(),
  opacity: z.number().finite().min(0).max(1).optional(),
  cornerRadius: z.number().finite().min(0).max(10_000).optional(),
  fill: designColorSchema.optional(),
});

export const designMotionKeyframeSchema = z.object({
  id: z.string().uuid(),
  timeMs: z.number().int().min(0).max(60_000),
  values: designMotionKeyframeValuesSchema,
});

export const designMotionTrackSchema = z.object({
  id: z.string().uuid(),
  elementId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  durationMs: z.number().int().min(1).max(60_000).default(300),
  delayMs: z.number().int().min(0).max(60_000).default(0),
  iterations: z.number().int().min(1).max(100).default(1),
  direction: z.enum(['normal', 'reverse', 'alternate']).default('normal'),
  fillMode: z.enum(['none', 'forwards', 'both']).default('forwards'),
  tokenId: z.string().uuid().nullable().default(null),
  easing: designMotionEasingSchema.default({ type: 'preset', value: 'ease-out' }),
  keyframes: z.array(designMotionKeyframeSchema).min(2).max(200),
  order: z.number().int().min(0).max(100_000),
});

export const designPresentationSettingsSchema = z.object({
  defaultFlowId: z.string().uuid().nullable().default(null),
  background: designColorSchema.default('#111111'),
  showDeviceFrame: z.boolean().default(true),
  showHotspots: z.boolean().default(false),
  showCursor: z.boolean().default(true),
});

const designInstanceElementOverridesSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  width: z.number().finite().min(1).max(100_000).optional(),
  height: z.number().finite().min(1).max(100_000).optional(),
  rotation: z.number().finite().min(-3600).max(3600).optional(),
  opacity: z.number().finite().min(0).max(1).optional(),
  visible: z.boolean().optional(),
  fill: legacyDesignPaintSchema.optional(),
  stroke: legacyDesignPaintSchema.optional(),
  strokeWidth: z.number().finite().min(0).max(100).optional(),
  fills: z.array(designPaintSchema).max(16).optional(),
  strokes: z.array(designPaintSchema).max(16).optional(),
  effects: z.array(designEffectSchema).max(16).optional(),
  blendMode: z.enum(['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten']).optional(),
  cornerRadius: z.number().finite().min(0).max(10_000).optional(),
  text: z.string().max(20_000).optional(),
  fontSize: z.number().finite().min(4).max(1000).optional(),
  fontWeight: z.number().int().min(100).max(900).optional(),
  textAlign: z.enum(['left', 'center', 'right']).optional(),
  assetId: z.string().uuid().nullable().optional(),
  imageFit: z.enum(['fill', 'contain', 'cover']).optional(),
});

export const designPathPointSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  inX: z.number().finite().nullable().default(null),
  inY: z.number().finite().nullable().default(null),
  outX: z.number().finite().nullable().default(null),
  outY: z.number().finite().nullable().default(null),
  mode: z.enum(['corner', 'mirrored', 'asymmetric', 'disconnected']).default('corner'),
});

export const designAssetSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(180),
  path: z.string().trim().regex(/^\.orkestrai\/designs\/assets\/[A-Za-z0-9._/-]+$/).max(512),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']),
  size: z.number().int().min(1).max(20 * 1024 * 1024),
  width: z.number().int().min(1).max(100_000).nullable().default(null),
  height: z.number().int().min(1).max(100_000).nullable().default(null),
  createdAt: z.string().datetime(),
});

export const designGuideSchema = z.object({
  id: z.string().uuid(),
  axis: z.enum(['x', 'y']),
  position: z.number().finite().min(-100_000).max(100_000),
});

export const designElementSchema = z.object({
  id: z.string().uuid(),
  pageId: z.string().uuid(),
  parentId: z.string().uuid().nullable(),
  type: designElementTypeSchema,
  name: z.string().trim().min(1).max(120),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().min(1).max(100_000),
  height: z.number().finite().min(1).max(100_000),
  rotation: z.number().finite().min(-3600).max(3600).default(0),
  opacity: z.number().finite().min(0).max(1).default(1),
  visible: z.boolean().default(true),
  locked: z.boolean().default(false),
  fill: legacyDesignPaintSchema.default('#ffffff'),
  stroke: legacyDesignPaintSchema,
  strokeWidth: z.number().finite().min(0).max(100).default(0),
  fills: z.array(designPaintSchema).max(16).default([]),
  strokes: z.array(designPaintSchema).max(16).default([]),
  effects: z.array(designEffectSchema).max(16).default([]),
  blendMode: z.enum(['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten']).default('normal'),
  cornerRadius: z.number().finite().min(0).max(10_000).default(0),
  text: z.string().max(20_000).default(''),
  fontSize: z.number().finite().min(4).max(1000).default(16),
  fontWeight: z.number().int().min(100).max(900).default(400),
  textAlign: z.enum(['left', 'center', 'right']).default('left'),
  accessibilityRole: z.enum(['none', 'button', 'link', 'heading', 'image', 'text', 'input', 'navigation', 'region']).default('none'),
  accessibilityLabel: z.string().trim().max(500).nullable().default(null),
  decorative: z.boolean().default(false),
  pathPoints: z.array(designPathPointSchema).max(20_000).default([]),
  pathSubpaths: z.array(z.array(designPathPointSchema).min(2).max(20_000)).max(256).default([]),
  pathClosed: z.boolean().default(false),
  fillRule: z.enum(['nonzero', 'evenodd']).default('nonzero'),
  assetId: z.string().uuid().nullable().default(null),
  imageFit: z.enum(['fill', 'contain', 'cover']).default('cover'),
  maskId: z.string().uuid().nullable().default(null),
  isMask: z.boolean().default(false),
  layoutMode: z.enum(['none', 'horizontal', 'vertical', 'grid']).default('none'),
  layoutWrap: z.boolean().default(false),
  layoutGap: z.number().finite().min(0).max(10_000).default(16),
  layoutRowGap: z.number().finite().min(0).max(10_000).default(16),
  layoutColumnGap: z.number().finite().min(0).max(10_000).default(16),
  layoutPaddingTop: z.number().finite().min(0).max(10_000).default(24),
  layoutPaddingRight: z.number().finite().min(0).max(10_000).default(24),
  layoutPaddingBottom: z.number().finite().min(0).max(10_000).default(24),
  layoutPaddingLeft: z.number().finite().min(0).max(10_000).default(24),
  layoutGridColumns: z.number().int().min(1).max(64).default(2),
  layoutAlign: z.enum(['start', 'center', 'end', 'space-between']).default('start'),
  clipContent: z.boolean().default(false),
  prototypeOverflow: z.enum(['none', 'horizontal', 'vertical', 'both']).default('none'),
  prototypeFixed: z.boolean().default(false),
  constraintHorizontal: z.enum(['left', 'right', 'left-right', 'center', 'scale']).default('left'),
  constraintVertical: z.enum(['top', 'bottom', 'top-bottom', 'center', 'scale']).default('top'),
  variableBindings: z.record(designBindablePropertySchema, z.string().uuid()).default({}),
  componentId: z.string().uuid().nullable().default(null),
  instanceOf: z.string().uuid().nullable().default(null),
  instanceRootId: z.string().uuid().nullable().default(null),
  instanceSourceId: z.string().uuid().nullable().default(null),
  instanceProperties: z.record(z.string().uuid(), designComponentPropertyValueSchema).default({}),
  instanceOverrides: z.record(z.string().uuid(), designInstanceElementOverridesSchema).default({}),
  slotAssignments: z.record(z.string().uuid(), z.array(z.string().uuid()).max(200)).default({}),
  slotName: z.string().trim().min(1).max(120).nullable().default(null),
  figmaSource: designFigmaSourceSchema.nullable().optional(),
  order: z.number().int().min(0).max(1_000_000),
});

export const designPageSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  width: z.number().finite().min(1).max(100_000),
  height: z.number().finite().min(1).max(100_000),
  background: legacyDesignPaintSchema.default('#f7f7f5'),
  order: z.number().int().min(0).max(10_000),
});

export const designCollaboratorSchema = z.object({
  kind: z.enum(['user', 'agent', 'remote']),
  id: z.string().trim().min(1).max(128),
  name: z.string().trim().min(1).max(120),
  color: designColorSchema,
});

export const designCommentMessageSchema = z.object({
  id: z.string().uuid(),
  author: designCollaboratorSchema,
  body: z.string().trim().min(1).max(20_000),
  mentions: z.array(z.string().trim().min(1).max(128)).max(100).default([]),
  createdAt: z.string().datetime(),
});

export const designCommentSchema = z.object({
  id: z.string().uuid(),
  pageId: z.string().uuid(),
  elementId: z.string().uuid().nullable().default(null),
  x: z.number().finite().min(-100_000).max(100_000).nullable().default(null),
  y: z.number().finite().min(-100_000).max(100_000).nullable().default(null),
  status: z.enum(['open', 'resolved']).default('open'),
  messages: z.array(designCommentMessageSchema).min(1).max(500),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable().default(null),
  resolvedBy: designCollaboratorSchema.nullable().default(null),
});

export const designProposalSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(180),
  description: z.string().trim().max(4_000).default(''),
  author: designCollaboratorSchema,
  baseRevision: z.number().int().min(0),
  operations: z.array(z.record(z.string(), z.unknown())).min(1).max(2_000),
  status: z.enum(['pending', 'approved', 'rejected']).default('pending'),
  floorId: z.string().uuid().nullable().default(null),
  councilId: z.string().uuid().nullable().default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  decidedAt: z.string().datetime().nullable().default(null),
  decidedBy: designCollaboratorSchema.nullable().default(null),
  decisionNote: z.string().trim().max(4_000).nullable().default(null),
});

export const designDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().uuid(),
  nodeId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  name: z.string().trim().min(1).max(180),
  revision: z.number().int().min(0),
  activePageId: z.string().uuid(),
  pages: z.array(designPageSchema).min(1).max(100),
  elements: z.array(designElementSchema).max(25_000),
  assets: z.array(designAssetSchema).max(5_000).default([]),
  guides: z.array(designGuideSchema).max(1_000).default([]),
  variableCollections: z.array(designVariableCollectionSchema).max(100).default([]),
  variables: z.array(designVariableSchema).max(5_000).default([]),
  activeVariableModes: z.record(z.string().uuid(), z.string().uuid()).default({}),
  components: z.array(designComponentSchema).max(2_000).default([]),
  componentSets: z.array(designComponentSetSchema).max(500).default([]),
  libraryLinks: z.array(designLibraryLinkSchema).max(200).default([]),
  figmaLinks: z.array(designFigmaLinkSchema).max(100).default([]),
  codeArtifacts: z.array(designCodeArtifactSchema).max(1_000).default([]),
  prototypeFlows: z.array(designPrototypeFlowSchema).max(500).default([]),
  prototypeInteractions: z.array(designPrototypeInteractionSchema).max(5_000).default([]),
  motionTokens: z.array(designMotionTokenSchema).max(500).default([]),
  motionTracks: z.array(designMotionTrackSchema).max(5_000).default([]),
  comments: z.array(designCommentSchema).max(10_000).default([]),
  proposals: z.array(designProposalSchema).max(2_000).default([]),
  presentation: designPresentationSettingsSchema.default({
    defaultFlowId: null,
    background: '#111111',
    showDeviceFrame: true,
    showHotspots: false,
    showCursor: true,
  }),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const designVisualReviewSchema = z.object({
  status: z.enum(['approved', 'changes_requested']),
  revision: z.number().int().min(1),
  note: z.string().trim().max(4_000).default(''),
}).superRefine((value, context) => {
  if (value.status === 'changes_requested' && !value.note) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['note'],
      message: 'Review feedback is required when requesting changes.',
    });
  }
});

export type DesignVisualReviewInput = z.infer<typeof designVisualReviewSchema>;

const designElementChangesSchema = designElementSchema
  .omit({ id: true, pageId: true, parentId: true, type: true })
  .partial();

const designPageChangesSchema = designPageSchema.omit({ id: true, order: true }).partial();
const designVariableCollectionChangesSchema = designVariableCollectionSchema.omit({ id: true }).partial();
const designVariableChangesSchema = designVariableSchema.omit({ id: true }).partial();
const designComponentChangesSchema = designComponentSchema.omit({ id: true, rootElementId: true }).partial();
const designComponentSetChangesSchema = designComponentSetSchema.omit({ id: true }).partial();
const designLibraryLinkChangesSchema = designLibraryLinkSchema.omit({ id: true, sourceWorkspaceId: true, sourceNodeId: true }).partial();
const designFigmaLinkChangesSchema = designFigmaLinkSchema.omit({ id: true, fileKey: true }).partial();
const designCodeArtifactChangesSchema = designCodeArtifactSchema.omit({ id: true }).partial();
const designPrototypeFlowChangesSchema = designPrototypeFlowSchema.omit({ id: true }).partial();
const designPrototypeInteractionChangesSchema = designPrototypeInteractionSchema.omit({ id: true, sourceElementId: true }).partial();
const designMotionTokenChangesSchema = designMotionTokenSchema.omit({ id: true }).partial();
const designMotionTrackChangesSchema = designMotionTrackSchema.omit({ id: true, elementId: true }).partial();

export const designOperationSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('create-page'),
    page: designPageSchema.omit({ id: true, order: true }).extend({
      id: z.string().uuid().optional(),
      order: z.number().int().min(0).max(10_000).optional(),
    }),
  }),
  z.object({ kind: z.literal('update-page'), pageId: z.string().uuid(), changes: designPageChangesSchema }),
  z.object({ kind: z.literal('duplicate-page'), pageId: z.string().uuid(), duplicateId: z.string().uuid().optional(), name: z.string().trim().min(1).max(120).optional() }),
  z.object({ kind: z.literal('delete-page'), pageId: z.string().uuid() }),
  z.object({ kind: z.literal('reorder-page'), pageId: z.string().uuid(), order: z.number().int().min(0).max(10_000) }),
  z.object({
    kind: z.literal('create'),
    element: designElementSchema.omit({ id: true, order: true }).extend({
      id: z.string().uuid().optional(),
      order: z.number().int().min(0).optional(),
    }),
  }),
  z.object({ kind: z.literal('update'), elementId: z.string().uuid(), changes: designElementChangesSchema }),
  z.object({ kind: z.literal('delete'), elementId: z.string().uuid() }),
  z.object({ kind: z.literal('reorder'), elementId: z.string().uuid(), order: z.number().int().min(0).max(1_000_000) }),
  z.object({ kind: z.literal('reparent'), elementId: z.string().uuid(), parentId: z.string().uuid().nullable(), order: z.number().int().min(0).max(1_000_000).optional() }),
  z.object({ kind: z.literal('add-asset'), asset: designAssetSchema }),
  z.object({ kind: z.literal('delete-asset'), assetId: z.string().uuid() }),
  z.object({ kind: z.literal('add-guide'), guide: designGuideSchema }),
  z.object({ kind: z.literal('update-guide'), guideId: z.string().uuid(), position: z.number().finite().min(-100_000).max(100_000) }),
  z.object({ kind: z.literal('delete-guide'), guideId: z.string().uuid() }),
  z.object({ kind: z.literal('add-variable-collection'), collection: designVariableCollectionSchema }),
  z.object({ kind: z.literal('update-variable-collection'), collectionId: z.string().uuid(), changes: designVariableCollectionChangesSchema }),
  z.object({ kind: z.literal('delete-variable-collection'), collectionId: z.string().uuid() }),
  z.object({ kind: z.literal('add-variable'), variable: designVariableSchema }),
  z.object({ kind: z.literal('update-variable'), variableId: z.string().uuid(), changes: designVariableChangesSchema }),
  z.object({ kind: z.literal('delete-variable'), variableId: z.string().uuid() }),
  z.object({ kind: z.literal('set-active-variable-mode'), collectionId: z.string().uuid(), modeId: z.string().uuid() }),
  z.object({ kind: z.literal('bind-variable'), elementId: z.string().uuid(), property: designBindablePropertySchema, variableId: z.string().uuid().nullable() }),
  z.object({ kind: z.literal('add-component'), component: designComponentSchema }),
  z.object({ kind: z.literal('update-component'), componentId: z.string().uuid(), changes: designComponentChangesSchema }),
  z.object({ kind: z.literal('delete-component'), componentId: z.string().uuid() }),
  z.object({ kind: z.literal('add-component-set'), componentSet: designComponentSetSchema }),
  z.object({ kind: z.literal('update-component-set'), componentSetId: z.string().uuid(), changes: designComponentSetChangesSchema }),
  z.object({ kind: z.literal('delete-component-set'), componentSetId: z.string().uuid() }),
  z.object({ kind: z.literal('add-library-link'), link: designLibraryLinkSchema }),
  z.object({ kind: z.literal('update-library-link'), libraryId: z.string().uuid(), changes: designLibraryLinkChangesSchema }),
  z.object({ kind: z.literal('delete-library-link'), libraryId: z.string().uuid() }),
  z.object({ kind: z.literal('add-figma-link'), link: designFigmaLinkSchema }),
  z.object({ kind: z.literal('update-figma-link'), linkId: z.string().uuid(), changes: designFigmaLinkChangesSchema }),
  z.object({ kind: z.literal('delete-figma-link'), linkId: z.string().uuid() }),
  z.object({ kind: z.literal('add-code-artifact'), artifact: designCodeArtifactSchema }),
  z.object({ kind: z.literal('update-code-artifact'), artifactId: z.string().uuid(), changes: designCodeArtifactChangesSchema }),
  z.object({ kind: z.literal('delete-code-artifact'), artifactId: z.string().uuid() }),
  z.object({ kind: z.literal('add-prototype-flow'), flow: designPrototypeFlowSchema }),
  z.object({ kind: z.literal('update-prototype-flow'), flowId: z.string().uuid(), changes: designPrototypeFlowChangesSchema }),
  z.object({ kind: z.literal('delete-prototype-flow'), flowId: z.string().uuid() }),
  z.object({ kind: z.literal('add-prototype-interaction'), interaction: designPrototypeInteractionSchema }),
  z.object({ kind: z.literal('update-prototype-interaction'), interactionId: z.string().uuid(), changes: designPrototypeInteractionChangesSchema }),
  z.object({ kind: z.literal('delete-prototype-interaction'), interactionId: z.string().uuid() }),
  z.object({ kind: z.literal('add-motion-token'), token: designMotionTokenSchema }),
  z.object({ kind: z.literal('update-motion-token'), tokenId: z.string().uuid(), changes: designMotionTokenChangesSchema }),
  z.object({ kind: z.literal('delete-motion-token'), tokenId: z.string().uuid() }),
  z.object({ kind: z.literal('add-motion-track'), track: designMotionTrackSchema }),
  z.object({ kind: z.literal('update-motion-track'), trackId: z.string().uuid(), changes: designMotionTrackChangesSchema }),
  z.object({ kind: z.literal('delete-motion-track'), trackId: z.string().uuid() }),
  z.object({ kind: z.literal('update-presentation'), changes: designPresentationSettingsSchema.partial() }),
  z.object({ kind: z.literal('add-design-comment'), comment: designCommentSchema }),
  z.object({ kind: z.literal('add-design-comment-message'), commentId: z.string().uuid(), message: designCommentMessageSchema }),
  z.object({
    kind: z.literal('set-design-comment-status'),
    commentId: z.string().uuid(),
    status: z.enum(['open', 'resolved']),
    actor: designCollaboratorSchema,
  }),
  z.object({ kind: z.literal('delete-design-comment'), commentId: z.string().uuid() }),
  z.object({ kind: z.literal('add-design-proposal'), proposal: designProposalSchema }),
  z.object({
    kind: z.literal('link-design-proposal'),
    proposalId: z.string().uuid(),
    floorId: z.string().uuid().nullable().optional(),
    councilId: z.string().uuid().nullable().optional(),
  }),
  z.object({
    kind: z.literal('decide-design-proposal'),
    proposalId: z.string().uuid(),
    status: z.enum(['approved', 'rejected']),
    actor: designCollaboratorSchema,
    note: z.string().trim().max(4_000).nullable().default(null),
  }),
  z.object({ kind: z.literal('delete-design-proposal'), proposalId: z.string().uuid() }),
  z.object({
    kind: z.literal('restore-component-instance'),
    componentId: z.string().uuid(),
    instanceId: z.string().uuid(),
    members: z.array(z.object({ elementId: z.string().uuid(), sourceElementId: z.string().uuid() })).min(1).max(25_000),
    instanceProperties: z.record(z.string().uuid(), designComponentPropertyValueSchema),
    instanceOverrides: z.record(z.string().uuid(), designInstanceElementOverridesSchema),
    slotAssignments: z.record(z.string().uuid(), z.array(z.string().uuid()).max(200)),
  }),
  z.object({
    kind: z.literal('create-component-instance'),
    componentId: z.string().uuid(),
    instanceId: z.string().uuid(),
    pageId: z.string().uuid(),
    parentId: z.string().uuid().nullable(),
    x: z.number().finite(),
    y: z.number().finite(),
    order: z.number().int().min(0).max(1_000_000).optional(),
  }),
  z.object({ kind: z.literal('swap-component-instance'), instanceId: z.string().uuid(), componentId: z.string().uuid() }),
  z.object({ kind: z.literal('set-instance-property'), instanceId: z.string().uuid(), propertyId: z.string().uuid(), value: designComponentPropertyValueSchema }),
  z.object({ kind: z.literal('assign-instance-slot'), instanceId: z.string().uuid(), propertyId: z.string().uuid(), elementIds: z.array(z.string().uuid()).max(200) }),
  z.object({ kind: z.literal('detach-component-instance'), instanceId: z.string().uuid() }),
  z.object({ kind: z.literal('set-active-page'), pageId: z.string().uuid() }),
  z.object({ kind: z.literal('rename-document'), name: z.string().trim().min(1).max(180) }),
]);

export const applyDesignOperationsSchema = z.object({
  baseRevision: z.number().int().min(0),
  operations: z.array(designOperationSchema).min(1).max(2_000),
  actor: z.object({
    kind: z.enum(['user', 'agent', 'system']).default('user'),
    id: z.string().trim().max(120).nullable().default(null),
    name: z.string().trim().max(120).nullable().default(null),
    taskId: z.string().uuid().nullable().default(null),
  }).default({ kind: 'user', id: null, name: null, taskId: null }),
  summary: z.string().trim().min(1).max(500),
  collaborationParticipantId: z.string().trim().min(8).max(128).nullable().default(null),
});

export const designPresenceHeartbeatSchema = z.object({
  participant: designCollaboratorSchema,
  pageId: z.string().uuid(),
  elementIds: z.array(z.string().uuid()).max(200).default([]),
  cursor: z.object({
    x: z.number().finite().min(-100_000).max(100_000),
    y: z.number().finite().min(-100_000).max(100_000),
  }).nullable().default(null),
  viewport: z.object({
    x: z.number().finite().min(-1_000_000).max(1_000_000),
    y: z.number().finite().min(-1_000_000).max(1_000_000),
    zoom: z.number().finite().min(0.01).max(10),
  }).nullable().default(null),
  followParticipantId: z.string().trim().min(1).max(128).nullable().default(null),
}).strict();

export const leaveDesignPresenceSchema = z.object({
  participantId: z.string().trim().min(8).max(128),
}).strict();

const nullableDimensionSchema = z.preprocess(
  (value) => value === '' || value === undefined ? null : value,
  z.coerce.number().int().min(1).max(100_000).nullable(),
);

export const importDesignAssetSchema = z.object({
  file: z.custom<File>((value) => {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as File;
    return typeof candidate.name === 'string'
      && typeof candidate.size === 'number'
      && typeof candidate.arrayBuffer === 'function';
  }, 'Select a design asset.'),
  baseRevision: z.coerce.number().int().min(0),
  width: nullableDimensionSchema.default(null),
  height: nullableDimensionSchema.default(null),
});

export const exportDesignPdfSchema = z.object({
  dataUrl: z.string().max(30 * 1024 * 1024).regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/),
  width: z.number().int().min(1).max(20_000),
  height: z.number().int().min(1).max(20_000),
  name: z.string().trim().min(1).max(180),
});

export const uploadDesignThumbnailSchema = z.object({
  file: z.custom<File>((value) => {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as File;
    return candidate.type === 'image/png'
      && typeof candidate.size === 'number'
      && typeof candidate.arrayBuffer === 'function';
  }, 'Select a PNG thumbnail.'),
  revision: z.coerce.number().int().min(0),
});

export type DesignElement = z.infer<typeof designElementSchema>;
export type DesignPage = z.infer<typeof designPageSchema>;
export type DesignPaint = z.infer<typeof designPaintSchema>;
export type DesignEffect = z.infer<typeof designEffectSchema>;
export type DesignPathPoint = z.infer<typeof designPathPointSchema>;
export type DesignAsset = z.infer<typeof designAssetSchema>;
export type DesignGuide = z.infer<typeof designGuideSchema>;
export type DesignVariableType = z.infer<typeof designVariableTypeSchema>;
export type DesignVariableValue = z.infer<typeof designVariableValueSchema>;
export type DesignVariableMode = z.infer<typeof designVariableModeSchema>;
export type DesignCodeSource = z.infer<typeof designCodeSourceSchema>;
export type DesignVariableCollection = z.infer<typeof designVariableCollectionSchema>;
export type DesignVariable = z.infer<typeof designVariableSchema>;
export type DesignBindableProperty = z.infer<typeof designBindablePropertySchema>;
export type DesignComponentPropertyType = z.infer<typeof designComponentPropertyTypeSchema>;
export type DesignComponentPropertyValue = z.infer<typeof designComponentPropertyValueSchema>;
export type DesignComponentProperty = z.infer<typeof designComponentPropertySchema>;
export type DesignComponent = z.infer<typeof designComponentSchema>;
export type DesignComponentSet = z.infer<typeof designComponentSetSchema>;
export type DesignLibraryLink = z.infer<typeof designLibraryLinkSchema>;
export type DesignFigmaSource = z.infer<typeof designFigmaSourceSchema>;
export type DesignFigmaLink = z.infer<typeof designFigmaLinkSchema>;
export type DesignCodeArtifact = z.infer<typeof designCodeArtifactSchema>;
export type DesignMotionEasing = z.infer<typeof designMotionEasingSchema>;
export type DesignPrototypeTransition = z.infer<typeof designPrototypeTransitionSchema>;
export type DesignPrototypeTrigger = z.infer<typeof designPrototypeTriggerSchema>;
export type DesignPrototypeAction = z.infer<typeof designPrototypeActionSchema>;
export type DesignPrototypeInteraction = z.infer<typeof designPrototypeInteractionSchema>;
export type DesignPrototypeFlow = z.infer<typeof designPrototypeFlowSchema>;
export type DesignMotionToken = z.infer<typeof designMotionTokenSchema>;
export type DesignMotionKeyframeValues = z.infer<typeof designMotionKeyframeValuesSchema>;
export type DesignMotionKeyframe = z.infer<typeof designMotionKeyframeSchema>;
export type DesignMotionTrack = z.infer<typeof designMotionTrackSchema>;
export type DesignPresentationSettings = z.infer<typeof designPresentationSettingsSchema>;
export type DesignCollaborator = z.infer<typeof designCollaboratorSchema>;
export type DesignCommentMessage = z.infer<typeof designCommentMessageSchema>;
export type DesignComment = z.infer<typeof designCommentSchema>;
export type DesignProposal = z.infer<typeof designProposalSchema>;
export type DesignDocument = z.infer<typeof designDocumentSchema>;
export type DesignOperation = z.infer<typeof designOperationSchema>;
export type ApplyDesignOperationsInput = z.infer<typeof applyDesignOperationsSchema>;
export type DesignPresenceHeartbeatInput = z.infer<typeof designPresenceHeartbeatSchema>;
export type LeaveDesignPresenceInput = z.infer<typeof leaveDesignPresenceSchema>;
export type ImportDesignAssetInput = z.infer<typeof importDesignAssetSchema>;
export type ExportDesignPdfInput = z.infer<typeof exportDesignPdfSchema>;
export type UploadDesignThumbnailInput = z.infer<typeof uploadDesignThumbnailSchema>;
