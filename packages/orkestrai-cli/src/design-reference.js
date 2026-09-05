export const DESIGN_REFERENCE_TOPICS = [
  'quickstart',
  'concept',
  'elements',
  'selection',
  'vectors',
  'layout',
  'typography',
  'pages',
  'tokens',
  'components',
  'prototype',
  'motion',
  'delivery',
  'operations',
];

const commonRules = [
  'Call design_read once and keep its revision and activePageId.',
  'For a visual exploration, create only one representative desktop and one mobile concept first. Apply a visible first revision within five minutes, then stop for human visual review.',
  'Prefer design_import_code with semantic HTML/CSS for a fast native concept, or design_create_elements for a small scene graph. Use design_apply_blueprint only after the current revision is visually approved.',
  'Element x/y coordinates are absolute page coordinates, including children. parentId controls hierarchy, not the coordinate origin.',
  'Use RFC 4122 UUIDs for explicit ids. References between elements, tokens, components and prototypes must use ids from the same batch.',
  'After each successful write, use the returned revision as the next baseRevision. Audit structure and inspect the rendered result; an error-free audit is not visual approval.',
  'Never inspect the Orkestrai application/source, create schema probes, or write scratch scripts merely to discover the design API.',
];

const references = {
  quickstart: {
    workflow: [
      'design_read(nodeId)',
      'For exploration: design_reference(topic="concept"), then design_import_code or a small design_create_elements batch',
      'design_read(nodeId), design_audit(nodeId), visually review the rendered desktop and mobile concept, then wait for reviewStatus=approved',
      'Only after approval: design_apply_blueprint for the complete system and design_generate_code_preview when code is required',
    ],
    rules: commonRules,
    batching: {
      targetTransactions: '1 concept transaction before review; 1-3 expansion transactions only after approval',
      maxOperationsPerTransaction: 2000,
      instruction: 'Build ids and payload in memory. Do not create one layer per tool call.',
    },
  },
  concept: {
    rules: commonRules,
    goal: 'Validate visual direction before investing in exhaustive states and systems.',
    scope: {
      frames: 'One representative desktop frame and one representative mobile frame.',
      usefulLayers: '30-120 total; every layer must contribute visible hierarchy or content.',
      firstRevision: 'Within five minutes of task dispatch.',
      deferUntilApproved: ['complete state catalog', 'token library', 'component catalog', 'prototype', 'motion system', 'generated production code'],
    },
    preferredTool: {
      name: 'design_import_code',
      format: 'html',
      instruction: 'Compose semantic HTML and focused CSS, import it as native editable layers, then inspect the rendered concept.',
    },
    gate: 'Stop after structural audit and visual inspection. The human Review visual gate must approve the current revision before expansion.',
  },
  elements: {
    rules: commonRules,
    required: ['type', 'name', 'x', 'y', 'width', 'height'],
    types: ['frame', 'group', 'rectangle', 'ellipse', 'text', 'path', 'image'],
    commonOptional: [
      'id', 'parentId', 'order', 'rotation', 'opacity', 'visible', 'locked', 'fill', 'stroke', 'strokeWidth',
      'fills', 'strokes', 'effects', 'blendMode', 'cornerRadius', 'text', 'fontSize', 'fontWeight', 'textAlign',
      'accessibilityRole', 'accessibilityLabel', 'decorative', 'assetId', 'imageFit', 'maskId', 'isMask',
      'layoutMode', 'layoutWrap', 'layoutGap', 'layoutRowGap', 'layoutColumnGap', 'layoutPaddingTop',
      'layoutPaddingRight', 'layoutPaddingBottom', 'layoutPaddingLeft', 'layoutGridColumns', 'layoutAlign',
      'clipContent', 'prototypeOverflow', 'prototypeFixed', 'constraintHorizontal', 'constraintVertical', 'slotName',
    ],
    pathOptional: ['pathPoints', 'pathSubpaths', 'pathClosed', 'fillRule'],
    example: {
      nodeId: '<design-node-id>',
      baseRevision: 0,
      pageId: '<active-page-id>',
      summary: 'Create responsive account direction',
      elements: [
        { id: '<frame-uuid>', type: 'frame', name: 'Account / Desktop', x: 80, y: 80, width: 1440, height: 1024, fill: '#ffffff', clipContent: true },
        { id: '<title-uuid>', parentId: '<frame-uuid>', type: 'text', name: 'Page title', x: 144, y: 144, width: 520, height: 52, text: 'Account', fontSize: 40, fontWeight: 700, fill: '#111827', accessibilityRole: 'heading' },
      ],
    },
  },
  selection: {
    rules: commonRules,
    arrangeTool: 'design_arrange_elements',
    modes: ['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom', 'distribute-x', 'distribute-y', 'tidy'],
    behavior: 'The command moves selected roots and their complete descendant hierarchy atomically. Tidy preserves rough rows and applies a stable gap.',
    safety: 'At least two independent, unlocked layers from the same page are required. Distribution requires three. Locked descendants reject the whole transaction.',
  },
  vectors: {
    rules: commonRules,
    editTool: 'design_edit_vector',
    fields: ['pathPoints', 'pathSubpaths', 'pathClosed', 'fillRule'],
    point: { required: ['x', 'y'], optional: ['inX', 'inY', 'outX', 'outY', 'mode'], modes: ['corner', 'mirrored', 'asymmetric', 'disconnected'] },
    behavior: 'Replace vector geometry in one revisioned edit. Use pathSubpaths for compound SVG paths and pathPoints for a single contour.',
  },
  layout: {
    rules: commonRules,
    updateTool: 'design_update_layout',
    applyTool: 'design_apply_auto_layout',
    sizing: ['fixed', 'hug', 'fill'],
    modes: ['none', 'horizontal', 'vertical', 'grid'],
    behavior: 'Configure sizing, bounds, padding, main/cross alignment, wrapping, grids, constraints, and absolute children; then apply the saved frame contract atomically.',
    safety: 'Read the current revision first. Locked frames or affected children reject the complete layout operation.',
  },
  typography: {
    rules: commonRules,
    updateTool: 'design_update_typography',
    fields: ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'paragraphSpacing', 'textAlign', 'textVerticalAlign', 'textDecoration', 'textTransform', 'textAutoResize'],
    behavior: 'Typography stays native, revisioned, rendered in the editor, and reflected in generated code.',
  },
  pages: {
    rules: commonRules,
    operations: [
      { kind: 'create-page', page: { id: '<optional-page-uuid>', name: 'Exploration', width: 1440, height: 1024, background: '#f5f5f3', order: 1 } },
      { kind: 'update-page', pageId: '<page-uuid>', changes: { name: 'Approved direction', background: '#ffffff' } },
      { kind: 'duplicate-page', pageId: '<source-page-uuid>', duplicateId: '<optional-target-page-uuid>', name: 'Direction B' },
      { kind: 'reorder-page', pageId: '<page-uuid>', order: 0 },
      { kind: 'set-active-page', pageId: '<page-uuid>' },
      { kind: 'delete-page', pageId: '<page-uuid>' },
    ],
    safety: 'A document always keeps at least one page. Duplicate remaps page-owned layers, component sources, instances, prototype interactions, and motion. Delete removes dependent references transactionally.',
    preferredTool: 'Use design_manage_page for one page action or design_apply_operations when page and layer changes must share one atomic revision.',
  },
  tokens: {
    rules: commonRules,
    collection: { required: ['id', 'name', 'modes'], modeRequired: ['id', 'name'], optional: ['defaultModeId', 'order'] },
    token: { required: ['id', 'collectionId', 'name', 'type', 'values'], optional: ['description', 'order'] },
    tokenTypes: ['color', 'spacing', 'radius', 'font-size', 'font-weight', 'line-height', 'opacity', 'effect', 'breakpoint', 'string', 'boolean'],
    valueShapes: [
      { kind: 'color', value: '#2563eb' },
      { kind: 'number', value: 16 },
      { kind: 'string', value: 'Inter' },
      { kind: 'boolean', value: true },
      { kind: 'alias', variableId: '<token-uuid>' },
    ],
    binding: { required: ['elementId', 'property', 'variableId'] },
    bindableProperties: ['fill', 'stroke', 'opacity', 'cornerRadius', 'strokeWidth', 'fontSize', 'fontWeight', 'layoutGap', 'layoutRowGap', 'layoutColumnGap', 'layoutPaddingTop', 'layoutPaddingRight', 'layoutPaddingBottom', 'layoutPaddingLeft', 'effects'],
  },
  components: {
    rules: commonRules,
    componentSet: { required: ['id', 'name'], optional: ['propertyNames', 'order'] },
    component: { required: ['id', 'name', 'rootElementId'], optional: ['description', 'setId', 'variantValues', 'properties', 'key'] },
    property: { required: ['id', 'name', 'type', 'targetElementId', 'defaultValue'], types: ['text', 'boolean', 'slot'], optional: ['preferredValues', 'order'] },
    instruction: 'Create every root layer in elements before registering its component in the same blueprint.',
  },
  prototype: {
    rules: commonRules,
    flow: { required: ['id', 'name', 'startFrameId'], optional: ['description', 'order'] },
    interaction: { required: ['id', 'sourceElementId', 'trigger', 'action'], optional: ['transition', 'order'] },
    trigger: { type: ['click', 'hover', 'press', 'after-delay'], optional: ['delayMs'] },
    actions: [
      { type: 'navigate', targetFrameId: '<frame-uuid>' },
      { type: 'open-overlay', targetFrameId: '<frame-uuid>', position: 'center', dismissOnOutside: true },
      { type: 'close-overlay' },
      { type: 'back' },
      { type: 'scroll-to', targetElementId: '<element-uuid>' },
      { type: 'set-variable-mode', collectionId: '<collection-uuid>', modeId: '<mode-uuid>' },
    ],
  },
  motion: {
    rules: commonRules,
    token: { required: ['id', 'name'], optional: ['durationMs', 'easing', 'order'] },
    track: { required: ['id', 'elementId', 'name', 'keyframes'], optional: ['durationMs', 'delayMs', 'iterations', 'direction', 'fillMode', 'tokenId', 'easing', 'order'] },
    keyframe: { required: ['id', 'timeMs', 'values'], values: ['x', 'y', 'width', 'height', 'rotation', 'opacity', 'cornerRadius', 'fill'] },
    easing: [
      { type: 'preset', value: 'ease-out' },
      { type: 'cubic-bezier', x1: 0.2, y1: 0, x2: 0, y2: 1 },
      { type: 'spring', mass: 1, stiffness: 170, damping: 26, velocity: 0 },
    ],
  },
  delivery: {
    rules: commonRules,
    steps: [
      'Confirm the current revision is visually approved, then run design_audit and resolve critical issues.',
      'Call design_generate_code_preview with the approved root element ids and real workspace output path.',
      'Review content, mappings and expectedExistingHash.',
      'Call design_generate_code_apply with that exact hash and the latest design revision.',
    ],
    warning: 'Do not register a fabricated code artifact through raw operations. The apply tool creates a verified artifact after writing the real file.',
  },
  operations: {
    rules: commonRules,
    create: { kind: 'create', element: '<complete element object; id and order may be omitted>' },
    update: { kind: 'update', elementId: '<uuid>', changes: { opacity: 0.8 } },
    delete: { kind: 'delete', elementId: '<uuid>' },
    reorder: { kind: 'reorder', elementId: '<uuid>', order: 10 },
    reparent: { kind: 'reparent', elementId: '<uuid>', parentId: '<uuid-or-null>', order: 10 },
    categories: {
      tokens: ['add-variable-collection', 'add-variable', 'set-active-variable-mode', 'bind-variable'],
      components: ['add-component-set', 'add-component', 'create-component-instance', 'set-instance-property', 'assign-instance-slot', 'detach-component-instance'],
      prototype: ['add-prototype-flow', 'add-prototype-interaction', 'update-presentation'],
      motion: ['add-motion-token', 'add-motion-track'],
      collaboration: ['add-design-comment', 'add-design-proposal', 'decide-design-proposal'],
    },
    instruction: 'For exact complex shapes, prefer the named high-level tools and their inputSchema. Raw operations are the escape hatch, not the discovery path.',
  },
};

export function designReference(topic = 'quickstart') {
  if (!DESIGN_REFERENCE_TOPICS.includes(topic)) {
    throw new Error(`Unknown design reference topic "${topic}". Choose: ${DESIGN_REFERENCE_TOPICS.join(', ')}.`);
  }
  const key = /** @type {keyof typeof references} */ (topic);
  return { topic: key, ...references[key] };
}
