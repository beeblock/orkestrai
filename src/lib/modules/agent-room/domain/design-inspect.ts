import type { DesignDocument, DesignElement, DesignPaint } from '../contracts/schemas/designSchemas.js';
import { resolveDesignVariableValue } from './design-variables.js';

export type DesignInspectBinding = {
  property: string;
  variableId: string;
  variableName: string;
  resolvedValue: string;
};

function number(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

function colorWithOpacity(color: string, opacity: number): string {
  const match = /^#([\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.exec(color);
  if (!match) return color;
  const hex = match[1];
  const expanded = hex.length <= 4 ? [...hex].map((digit) => `${digit}${digit}`).join('') : hex;
  const rgb = expanded.slice(0, 6);
  const sourceAlpha = expanded.length === 8 ? Number.parseInt(expanded.slice(6), 16) / 255 : 1;
  const effectiveOpacity = Math.max(0, Math.min(1, opacity * sourceAlpha));
  if (effectiveOpacity >= 1) return `#${rgb}`;
  const alpha = Math.round(effectiveOpacity * 255).toString(16).padStart(2, '0');
  return `#${rgb}${alpha}`;
}

function paintCss(paint: DesignPaint | undefined, fallback: string): string {
  if (!paint || !paint.visible) return fallback;
  if (paint.type === 'solid') return colorWithOpacity(paint.color, paint.opacity);
  const stops = [...paint.stops]
    .sort((left, right) => left.offset - right.offset)
    .map((stop) => `${colorWithOpacity(stop.color, stop.opacity * paint.opacity)} ${number(stop.offset * 100)}%`)
    .join(', ');
  if (paint.type === 'linear-gradient') return `linear-gradient(${number(paint.angle)}deg, ${stops})`;
  return `radial-gradient(circle at ${number(paint.centerX * 100)}% ${number(paint.centerY * 100)}%, ${stops})`;
}

function shadowCss(element: DesignElement): string | null {
  const shadows = element.effects.filter((effect) => effect.visible && (effect.type === 'drop-shadow' || effect.type === 'inner-shadow'));
  if (!shadows.length) return null;
  return shadows.map((effect) => `${effect.type === 'inner-shadow' ? 'inset ' : ''}${number(effect.x)}px ${number(effect.y)}px ${number(effect.blur)}px ${number(effect.spread)}px ${effect.color}`).join(', ');
}

export function designInspectCss(element: DesignElement): string {
  const declarations: Array<[string, string | null]> = [
    ['position', 'absolute'],
    ['left', `${number(element.x)}px`],
    ['top', `${number(element.y)}px`],
    ['width', `${number(element.width)}px`],
    ['height', `${number(element.height)}px`],
    ['opacity', element.opacity === 1 ? null : number(element.opacity)],
    ['transform', element.rotation ? `rotate(${number(element.rotation)}deg)` : null],
    ['background', element.type === 'text' || element.type === 'path' ? null : paintCss(element.fills[0], element.fill)],
    ['color', element.type === 'text' ? paintCss(element.fills[0], element.fill) : null],
    ['border', element.strokeWidth > 0 ? `${number(element.strokeWidth)}px solid ${paintCss(element.strokes[0], element.stroke)}` : null],
    ['border-radius', element.cornerRadius ? `${number(element.cornerRadius)}px` : null],
    ['box-shadow', shadowCss(element)],
    ['font-family', element.type === 'text' ? `'${element.fontFamily}', sans-serif` : null],
    ['font-size', element.type === 'text' ? `${number(element.fontSize)}px` : null],
    ['font-weight', element.type === 'text' ? String(element.fontWeight) : null],
    ['font-style', element.type === 'text' && element.fontStyle !== 'normal' ? element.fontStyle : null],
    ['line-height', element.type === 'text' && element.lineHeight ? `${number(element.lineHeight)}px` : null],
    ['letter-spacing', element.type === 'text' && element.letterSpacing ? `${number(element.letterSpacing)}px` : null],
    ['text-align', element.type === 'text' ? element.textAlign : null],
    ['overflow', element.clipContent ? 'hidden' : null],
    ['display', element.layoutMode === 'horizontal' || element.layoutMode === 'vertical' ? 'flex' : element.layoutMode === 'grid' ? 'grid' : null],
    ['flex-direction', element.layoutMode === 'horizontal' ? 'row' : element.layoutMode === 'vertical' ? 'column' : null],
    ['gap', element.layoutMode === 'horizontal' || element.layoutMode === 'vertical' ? `${number(element.layoutGap)}px` : null],
    ['row-gap', element.layoutMode === 'grid' ? `${number(element.layoutRowGap)}px` : null],
    ['column-gap', element.layoutMode === 'grid' ? `${number(element.layoutColumnGap)}px` : null],
    ['grid-template-columns', element.layoutMode === 'grid' ? `repeat(${element.layoutGridColumns}, minmax(0, 1fr))` : null],
    ['padding', element.layoutMode !== 'none' ? `${number(element.layoutPaddingTop)}px ${number(element.layoutPaddingRight)}px ${number(element.layoutPaddingBottom)}px ${number(element.layoutPaddingLeft)}px` : null],
  ];
  return declarations.filter((entry): entry is [string, string] => entry[1] !== null).map(([property, value]) => `${property}: ${value};`).join('\n');
}

function bindingValue(value: ReturnType<typeof resolveDesignVariableValue>): string {
  if (!value) return 'unresolved';
  if (value.kind === 'effect') return `${value.value.length} effect${value.value.length === 1 ? '' : 's'}`;
  return String(value.value);
}

export function designInspectBindings(document: DesignDocument, element: DesignElement): DesignInspectBinding[] {
  return Object.entries(element.variableBindings).flatMap(([property, variableId]) => {
    const variable = document.variables.find((candidate) => candidate.id === variableId);
    if (!variable) return [];
    return [{
      property,
      variableId,
      variableName: variable.name,
      resolvedValue: bindingValue(resolveDesignVariableValue(document, variableId)),
    }];
  });
}

export function designOwningComponent(document: DesignDocument, element: DesignElement | null) {
  let current = element ?? undefined;
  while (current) {
    const componentId = current.componentId ?? (current.instanceOf ? current.instanceOf : null);
    if (componentId) return document.components.find((component) => component.id === componentId) ?? null;
    current = current.parentId ? document.elements.find((candidate) => candidate.id === current?.parentId) : undefined;
  }
  return null;
}
