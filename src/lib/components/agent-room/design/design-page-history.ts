import type { DesignDocument, DesignElement, DesignOperation } from '$lib/modules/agent-room/contracts/schemas/designSchemas.js';

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function pageDeleteInverseOperations(document: DesignDocument, pageId: string, maxOperations = 2_000): DesignOperation[] | undefined {
  const page = document.pages.find((candidate) => candidate.id === pageId);
  if (!page) return undefined;
  const pageElements = document.elements.filter((element) => element.pageId === pageId);
  const elementIds = new Set(pageElements.map((element) => element.id));
  const elementById = new Map(pageElements.map((element) => [element.id, element]));
  const depth = (element: DesignElement) => {
    let value = 0;
    let parentId = element.parentId;
    const visited = new Set<string>();
    while (parentId && value < 64 && !visited.has(parentId)) {
      visited.add(parentId);
      value += 1;
      parentId = elementById.get(parentId)?.parentId ?? null;
    }
    return value;
  };
  const orderedElements = [...pageElements].sort((left, right) => depth(left) - depth(right) || left.order - right.order);
  const components = document.components.filter((component) => elementIds.has(component.rootElementId));
  const componentRootIds = new Set(components.map((component) => component.rootElementId));
  const componentIds = new Set(components.map((component) => component.id));
  const externalInstanceRootIds = new Set(document.elements
    .filter((element) => !elementIds.has(element.id) && element.instanceOf && componentIds.has(element.instanceOf) && element.instanceRootId === element.id)
    .map((element) => element.id));
  const externalInstanceElements = document.elements.filter((element) => element.instanceRootId && externalInstanceRootIds.has(element.instanceRootId));
  const externalInstances = [...externalInstanceRootIds].flatMap((instanceId) => {
    const root = externalInstanceElements.find((element) => element.id === instanceId);
    if (!root?.instanceOf) return [];
    return [{
      kind: 'restore-component-instance' as const,
      componentId: root.instanceOf,
      instanceId,
      members: externalInstanceElements
        .filter((element) => element.instanceRootId === instanceId && element.instanceSourceId)
        .map((element) => ({ elementId: element.id, sourceElementId: element.instanceSourceId! })),
      instanceProperties: cloneJson(root.instanceProperties),
      instanceOverrides: cloneJson(root.instanceOverrides),
      slotAssignments: cloneJson(root.slotAssignments),
    }];
  });
  const flows = document.prototypeFlows.filter((flow) => elementIds.has(flow.startFrameId));
  const interactions = document.prototypeInteractions.filter((interaction) => {
    if (elementIds.has(interaction.sourceElementId)) return true;
    if (interaction.action.type === 'navigate' || interaction.action.type === 'open-overlay') return elementIds.has(interaction.action.targetFrameId);
    return interaction.action.type === 'scroll-to' && elementIds.has(interaction.action.targetElementId);
  });
  const artifacts = document.codeArtifacts.filter((artifact) => artifact.elementIds.some((elementId) => elementIds.has(elementId)));
  const operations: DesignOperation[] = [
    { kind: 'create-page', page },
    ...orderedElements.map((element) => ({
      kind: 'create' as const,
      element: componentRootIds.has(element.id) ? { ...element, componentId: null } : element,
    })),
    ...components.map((component) => ({ kind: 'add-component' as const, component })),
    ...externalInstances,
    ...artifacts.map((artifact) => artifact.elementIds.every((elementId) => elementIds.has(elementId))
      ? { kind: 'add-code-artifact' as const, artifact }
      : { kind: 'update-code-artifact' as const, artifactId: artifact.id, changes: { elementIds: artifact.elementIds } }),
    ...flows.map((flow) => ({ kind: 'add-prototype-flow' as const, flow })),
    ...interactions.map((interaction) => ({ kind: 'add-prototype-interaction' as const, interaction })),
    ...document.motionTracks.filter((track) => elementIds.has(track.elementId)).map((track) => ({ kind: 'add-motion-track' as const, track })),
    ...document.comments.filter((comment) => comment.pageId === pageId).map((comment) => ({ kind: 'add-design-comment' as const, comment })),
    { kind: 'update-presentation', changes: { defaultFlowId: document.presentation.defaultFlowId } },
    { kind: 'set-active-page', pageId: document.activePageId },
  ];
  for (const link of document.figmaLinks) {
    if (!Object.values(link.mappings).some((elementId) => elementIds.has(elementId))) continue;
    const { id, fileKey, ...changes } = cloneJson(link);
    void id;
    void fileKey;
    operations.push({ kind: 'update-figma-link', linkId: link.id, changes });
  }
  return operations.length <= maxOperations ? operations : undefined;
}
