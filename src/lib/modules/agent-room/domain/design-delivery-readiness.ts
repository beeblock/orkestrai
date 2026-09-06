import type { DesignDocument, DesignVariableType } from '../contracts/schemas/designSchemas.js';
import type { DesignExplorationPlatform } from '../contracts/schemas/create-design-exploration.schema.js';

export const DESIGN_DELIVERY_REQUIREMENTS = [
  'responsiveFrames',
  'brandBoard',
  'tokenSystem',
  'tokenBindings',
  'components',
  'prototype',
  'codeArtifact',
  'currentApproval',
] as const;

export type DesignDeliveryRequirement = (typeof DESIGN_DELIVERY_REQUIREMENTS)[number];

export type DesignDeliveryReadiness = {
  completed: DesignDeliveryRequirement[];
  missing: DesignDeliveryRequirement[];
  missingByStage: {
    expansion: DesignDeliveryRequirement[];
    implementation: DesignDeliveryRequirement[];
    delivery: DesignDeliveryRequirement[];
  };
  total: number;
  expansionComplete: boolean;
  implementationComplete: boolean;
  deliveryComplete: boolean;
};

type ExplorationPayload = {
  platform?: DesignExplorationPlatform;
  includeDarkMode?: boolean;
  visualReview?: { status?: string; revision?: number | null };
};

const BRAND_BOARD_NAME = /\b(brand(?:ing)?|marca|identidad)\b/i;

export function designDeliveryReadiness(
  document: DesignDocument,
  payload: ExplorationPayload | null | undefined,
): DesignDeliveryReadiness {
  const brandPageIds = new Set(document.pages.filter((page) => BRAND_BOARD_NAME.test(page.name)).map((page) => page.id));
  const brandFrameIds = new Set(document.elements
    .filter((element) => element.type === 'frame' && BRAND_BOARD_NAME.test(element.name))
    .map((element) => element.id));
  const elementsById = new Map(document.elements.map((element) => [element.id, element]));
  const belongsToBrandFrame = (elementId: string): boolean => {
    let current = elementsById.get(elementId);
    for (let depth = 0; current && depth < 100; depth += 1) {
      if (brandFrameIds.has(current.id)) return true;
      current = current.parentId ? elementsById.get(current.parentId) : undefined;
    }
    return false;
  };
  // Responsive screens can live below a page-sized wrapper. Only exclude the
  // brand board hierarchy so a nested product frame remains valid evidence.
  const productFrames = document.elements.filter((element) => (
    element.visible
    && element.type === 'frame'
    && !brandPageIds.has(element.pageId)
    && !belongsToBrandFrame(element.id)
  ));
  const hasDesktop = productFrames.some((frame) => frame.width >= 768);
  const hasMobile = productFrames.some((frame) => frame.width >= 280 && frame.width <= 600);
  const frameCoverage = payload?.platform === 'desktop'
    ? hasDesktop
    : payload?.platform === 'mobile-web' || payload?.platform === 'native-mobile'
      ? hasMobile
      : hasDesktop && hasMobile;
  const visibleBrandElements = document.elements.filter((element) => (
    element.visible && (brandPageIds.has(element.pageId) || belongsToBrandFrame(element.id))
  ));
  const brandBoard = visibleBrandElements.length >= 3;
  const variableTypes = new Set<DesignVariableType>(document.variables.map((variable) => variable.type));
  const foundationTypes: DesignVariableType[] = ['spacing', 'radius', 'font-size', 'font-weight', 'line-height', 'effect'];
  const modeNames = new Set(document.variableCollections.flatMap((collection) => collection.modes.map((mode) => mode.name.toLocaleLowerCase())));
  const tokenSystem = document.variableCollections.length > 0
    && document.variables.filter((variable) => variable.type === 'color').length >= 3
    && foundationTypes.every((type) => variableTypes.has(type))
    && document.motionTokens.length > 0
    && (!payload?.includeDarkMode || (modeNames.has('light') && modeNames.has('dark')));
  const boundProperties = document.elements.flatMap((element) => Object.entries(element.variableBindings)
    .filter(([, variableId]) => Boolean(variableId))
    .map(([property]) => property));
  const tokenBindings = boundProperties.length >= 4 && new Set(boundProperties).size >= 3;
  const checks: Record<DesignDeliveryRequirement, boolean> = {
    responsiveFrames: frameCoverage,
    brandBoard,
    tokenSystem,
    tokenBindings,
    components: document.components.length > 0,
    prototype: document.prototypeFlows.length > 0 && document.prototypeInteractions.length >= 4,
    codeArtifact: document.codeArtifacts.length > 0,
    currentApproval: payload?.visualReview?.status === 'approved' && payload.visualReview.revision === document.revision,
  };
  const completed = DESIGN_DELIVERY_REQUIREMENTS.filter((requirement) => checks[requirement]);
  const missing = DESIGN_DELIVERY_REQUIREMENTS.filter((requirement) => !checks[requirement]);
  const expansionRequirements: DesignDeliveryRequirement[] = [
    'responsiveFrames',
    'brandBoard',
    'tokenSystem',
    'tokenBindings',
    'components',
    'prototype',
  ];
  const implementationRequirements: DesignDeliveryRequirement[] = [...expansionRequirements, 'codeArtifact'];
  const missingFor = (requirements: DesignDeliveryRequirement[]) => requirements.filter((requirement) => !checks[requirement]);

  return {
    completed,
    missing,
    missingByStage: {
      expansion: missingFor(expansionRequirements),
      implementation: missingFor(implementationRequirements),
      delivery: missing,
    },
    total: DESIGN_DELIVERY_REQUIREMENTS.length,
    expansionComplete: missingFor(expansionRequirements).length === 0,
    implementationComplete: missingFor(implementationRequirements).length === 0,
    deliveryComplete: DESIGN_DELIVERY_REQUIREMENTS.every((requirement) => checks[requirement]),
  };
}
