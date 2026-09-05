import { dirname, extname, posix, relative } from 'node:path';
import type {
  DesignCodeArtifact,
  DesignComponent,
  DesignDocument,
  DesignElement,
  DesignVariable,
} from '../contracts/schemas/designSchemas.js';
import type { DesignDeliveryFramework, PreviewDesignDeliveryInput } from '../contracts/schemas/design-delivery.schema.js';

export type GeneratedDesignCode = {
  content: string;
  mappingsUsed: DesignCodeArtifact['componentMappings'];
  warnings: string[];
};

type RenderContext = {
  document: DesignDocument;
  framework: DesignDeliveryFramework;
  outputPath: string;
  children: Map<string | null, DesignElement[]>;
  elementMap: Map<string, DesignElement>;
  componentMap: Map<string, DesignComponent>;
  imports: Map<string, { local: string; exported: string; path: string }>;
  mappings: DesignCodeArtifact['componentMappings'];
  warnings: string[];
};

function safeName(value: string, fallback = 'GeneratedDesign'): string {
  const normalized = value.replace(/[^A-Za-z0-9_$]+/g, ' ').trim().split(/\s+/).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('');
  return /^[A-Za-z_$]/.test(normalized) ? normalized : fallback;
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;');
}

function indent(value: string, depth: number): string {
  const prefix = '  '.repeat(depth);
  return value.split('\n').map((line) => line ? `${prefix}${line}` : line).join('\n');
}

function cssVariableName(variable: DesignVariable): string {
  return variable.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || `token-${variable.id.slice(-8)}`;
}

function boundValue(context: RenderContext, element: DesignElement, property: string, fallback: string): string {
  const variableId = element.variableBindings[property as keyof DesignElement['variableBindings']];
  const variable = variableId ? context.document.variables.find((candidate) => candidate.id === variableId) : null;
  return variable ? `var(--${cssVariableName(variable)})` : fallback;
}

function px(value: number): string {
  return `${Math.round(value * 100) / 100}px`;
}

function layoutClasses(context: RenderContext, element: DesignElement, parent: DesignElement | null): string[] {
  const classes: string[] = [];
  const inLayout = parent && parent.layoutMode !== 'none' && !element.layoutItemAbsolute;
  if (!parent) classes.push('relative');
  else if (!inLayout) classes.push('absolute', `left-[${px(element.x - parent.x)}]`, `top-[${px(element.y - parent.y)}]`);
  if (inLayout && element.widthSizing === 'fill') classes.push(parent?.layoutMode === 'horizontal' ? 'flex-1' : 'w-full');
  else if (inLayout && element.widthSizing === 'hug') classes.push('w-fit');
  else classes.push(`w-[${px(element.width)}]`);
  if (inLayout && element.heightSizing === 'fill') classes.push(parent?.layoutMode === 'vertical' ? 'flex-1' : 'h-full');
  else if (inLayout && element.heightSizing === 'hug') classes.push('h-fit');
  else classes.push(`h-[${px(element.height)}]`);
  if (element.minWidth !== null) classes.push(`min-w-[${px(element.minWidth)}]`);
  if (element.maxWidth !== null) classes.push(`max-w-[${px(element.maxWidth)}]`);
  if (element.minHeight !== null) classes.push(`min-h-[${px(element.minHeight)}]`);
  if (element.maxHeight !== null) classes.push(`max-h-[${px(element.maxHeight)}]`);
  if (element.layoutMode === 'horizontal') classes.push('flex', element.layoutWrap ? 'flex-wrap' : 'flex-nowrap');
  if (element.layoutMode === 'vertical') classes.push('flex', 'flex-col', element.layoutWrap ? 'flex-wrap' : 'flex-nowrap');
  if (element.layoutMode === 'grid') classes.push('grid', `grid-cols-${element.layoutGridColumns}`);
  if (element.layoutMode !== 'none') {
    classes.push(`gap-[${px(element.layoutGap)}]`, `gap-x-[${px(element.layoutColumnGap)}]`, `gap-y-[${px(element.layoutRowGap)}]`, `pt-[${px(element.layoutPaddingTop)}]`, `pr-[${px(element.layoutPaddingRight)}]`, `pb-[${px(element.layoutPaddingBottom)}]`, `pl-[${px(element.layoutPaddingLeft)}]`);
    if (element.layoutAlign === 'center') classes.push('justify-center');
    if (element.layoutAlign === 'end') classes.push('justify-end');
    if (element.layoutAlign === 'space-between') classes.push('justify-between');
    if (element.layoutCrossAlign === 'start') classes.push('items-start');
    if (element.layoutCrossAlign === 'center') classes.push('items-center');
    if (element.layoutCrossAlign === 'end') classes.push('items-end');
    if (element.layoutCrossAlign === 'stretch') classes.push('items-stretch');
  }
  if (element.clipContent) classes.push('overflow-hidden');
  if (element.cornerRadius > 0) classes.push(`rounded-[${px(element.cornerRadius)}]`);
  if (element.opacity < 1) classes.push(`opacity-[${Math.round(element.opacity * 1000) / 1000}]`);
  if (element.rotation) classes.push(`rotate-[${Math.round(element.rotation * 100) / 100}deg]`);
  const fill = element.fills.find((paint) => paint.visible && paint.type === 'solid');
  const fillColor = fill?.type === 'solid' ? fill.color : element.fill;
  if (fillColor !== 'transparent') classes.push(`bg-[${boundValue(context, element, 'fill', fillColor)}]`);
  const stroke = element.strokes.find((paint) => paint.visible && paint.type === 'solid');
  const strokeColor = stroke?.type === 'solid' ? stroke.color : element.stroke;
  if (element.strokeWidth > 0 && strokeColor !== 'transparent') classes.push('border', `border-[${boundValue(context, element, 'stroke', strokeColor)}]`, `border-[length:${px(element.strokeWidth)}]`);
  return classes;
}

function textClasses(context: RenderContext, element: DesignElement): string[] {
  const classes = layoutClasses(context, element, element.parentId ? context.elementMap.get(element.parentId) ?? null : null);
  const color = element.fills.find((paint) => paint.visible && paint.type === 'solid');
  classes.push(`text-[length:${boundValue(context, element, 'fontSize', px(element.fontSize))}]`, `font-[${Math.round(element.fontWeight)}]`, `font-[family-name:${element.fontFamily.replace(/[^A-Za-z0-9_-]+/g, '_')}]`);
  if (element.fontStyle === 'italic') classes.push('italic');
  if (element.lineHeight !== null) classes.push(`leading-[${px(element.lineHeight)}]`);
  if (element.letterSpacing) classes.push(`tracking-[${px(element.letterSpacing)}]`);
  if (element.textDecoration === 'underline') classes.push('underline');
  if (element.textDecoration === 'line-through') classes.push('line-through');
  if (element.textTransform === 'uppercase') classes.push('uppercase');
  if (element.textTransform === 'lowercase') classes.push('lowercase');
  if (element.textTransform === 'capitalize') classes.push('capitalize');
  if (color?.type === 'solid' || element.fill !== 'transparent') classes.push(`text-[${boundValue(context, element, 'fill', color?.type === 'solid' ? color.color : element.fill)}]`, 'bg-transparent');
  if (element.textAlign === 'center') classes.push('text-center');
  if (element.textAlign === 'right') classes.push('text-right');
  return classes;
}

function mappedComponent(context: RenderContext, element: DesignElement): DesignComponent | null {
  if (!element.instanceOf || element.instanceRootId !== element.id) return null;
  const component = context.componentMap.get(element.instanceOf);
  if (!component?.codeConnect) return null;
  const compatible = (context.framework === 'svelar' || context.framework === 'svelte')
    ? component.codeConnect.framework === 'svelte'
    : (context.framework === 'react' || context.framework === 'next')
      ? component.codeConnect.framework === 'react'
      : context.framework === 'vue'
        ? component.codeConnect.framework === 'vue'
        : false;
  return compatible ? component : null;
}

function importPath(outputPath: string, sourcePath: string): string {
  if (sourcePath.startsWith('$') || sourcePath.startsWith('@')) return sourcePath.replace(/\.(svelte|tsx?|jsx?|vue)$/i, '');
  const from = dirname(outputPath);
  let value = relative(from, sourcePath).split('\\').join('/').replace(/\.(svelte|tsx?|jsx?|vue)$/i, '');
  if (!value.startsWith('.')) value = `./${value}`;
  return value;
}

function registerMapping(context: RenderContext, component: DesignComponent): string {
  const source = component.codeConnect!;
  const key = `${source.path}:${source.exportName}`;
  const existing = context.imports.get(key);
  if (existing) return existing.local;
  const base = safeName(source.exportName);
  const used = new Set([...context.imports.values()].map((entry) => entry.local));
  let local = base;
  let index = 2;
  while (used.has(local)) local = `${base}${index++}`;
  context.imports.set(key, { local, exported: source.exportName, path: importPath(context.outputPath, source.path) });
  context.mappings.push({ componentId: component.id, path: source.path, exportName: source.exportName });
  return local;
}

function propertyAttributes(context: RenderContext, element: DesignElement, component: DesignComponent): string[] {
  const values = component.properties.map((property) => ({
    name: property.name.replace(/[^A-Za-z0-9_$-]/g, ''),
    value: element.instanceProperties[property.id] ?? property.defaultValue,
  })).filter((entry) => entry.name && entry.value !== null);
  if (context.framework === 'svelte' || context.framework === 'svelar' || context.framework === 'vue') {
    return values.map(({ name, value }) => typeof value === 'boolean' ? (value ? name : `:${name}={false}`) : `${name}="${escapeAttribute(String(value))}"`);
  }
  return values.map(({ name, value }) => typeof value === 'boolean' ? `${name}={${value}}` : `${name}="${escapeAttribute(String(value))}"`);
}

function renderMapped(context: RenderContext, element: DesignElement, component: DesignComponent, depth: number): string {
  const local = registerMapping(context, component);
  const parent = element.parentId ? context.elementMap.get(element.parentId) ?? null : null;
  const attributes = propertyAttributes(context, element, component);
  attributes.push(`${context.framework === 'react' || context.framework === 'next' ? 'className' : 'class'}="${layoutClasses(context, element, parent).join(' ')}"`);
  return indent(`<${local} ${attributes.join(' ')} />`, depth);
}

function renderElement(context: RenderContext, element: DesignElement, depth: number): string {
  const mapping = mappedComponent(context, element);
  if (mapping) return renderMapped(context, element, mapping, depth);
  const parent = element.parentId ? context.elementMap.get(element.parentId) ?? null : null;
  const isReact = context.framework === 'react' || context.framework === 'next';
  const classAttribute = isReact ? 'className' : 'class';
  const classes = element.type === 'text' ? textClasses(context, element) : layoutClasses(context, element, parent);
  const childElements = context.children.get(element.id) ?? [];
  if (element.type === 'text') return indent(`<p ${classAttribute}="${classes.join(' ')}">${escapeText(element.text)}</p>`, depth);
  if (element.type === 'image') {
    context.warnings.push(`Image layer "${element.name}" needs an application asset mapping.`);
    return indent(`<div ${classAttribute}="${classes.join(' ')}" role="img" aria-label="${escapeAttribute(element.name)}" />`, depth);
  }
  if (element.type === 'path') {
    context.warnings.push(`Vector layer "${element.name}" was emitted as an SVG placeholder. Export its path as an asset for production.`);
    return indent(`<svg ${classAttribute}="${classes.join(' ')}" viewBox="0 0 ${element.width} ${element.height}" aria-label="${escapeAttribute(element.name)}" />`, depth);
  }
  const children = childElements.map((child) => renderElement(context, child, depth + 1)).join('\n');
  const tag = element.type === 'group' ? 'div' : 'section';
  const open = `<${tag} ${classAttribute}="${classes.join(' ')}" data-design-id="${element.id}">`;
  return children ? `${indent(open, depth)}\n${children}\n${indent(`</${tag}>`, depth)}` : indent(`${open}</${tag}>`, depth);
}

function importsFor(context: RenderContext): string {
  const values = [...context.imports.values()];
  if (!values.length) return '';
  if (context.framework === 'svelte' || context.framework === 'svelar' || context.framework === 'vue') {
    return values.map((entry) => `import ${entry.local} from '${entry.path}';`).join('\n');
  }
  return values.map((entry) => `import { ${entry.exported}${entry.local === entry.exported ? '' : ` as ${entry.local}`} } from '${entry.path}';`).join('\n');
}

function wrapOutput(framework: DesignDeliveryFramework, componentName: string, imports: string, body: string): string {
  if (framework === 'svelte' || framework === 'svelar') {
    const script = imports ? `<script lang="ts">\n${indent(imports, 1)}\n</script>\n\n` : '';
    return `${script}${body}\n`;
  }
  if (framework === 'vue') {
    const script = imports ? `<script setup lang="ts">\n${imports}\n</script>\n\n` : '';
    return `${script}<template>\n${indent(body, 1)}\n</template>\n`;
  }
  if (framework === 'react' || framework === 'next') {
    return `${framework === 'next' ? "'use client';\n\n" : ''}${imports}${imports ? '\n\n' : ''}export function ${componentName}() {\n  return (\n${indent(body, 2)}\n  );\n}\n`;
  }
  return `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="utf-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1" />\n    <script src="https://cdn.tailwindcss.com"></script>\n    <title>${escapeText(componentName)}</title>\n  </head>\n  <body>\n${indent(body, 2)}\n  </body>\n</html>\n`;
}

export function generateDesignCode(document: DesignDocument, input: PreviewDesignDeliveryInput): GeneratedDesignCode {
  const elementMap = new Map(document.elements.map((element) => [element.id, element]));
  const selected = input.elementIds.map((id) => elementMap.get(id)).filter((element): element is DesignElement => Boolean(element));
  if (!selected.length) throw new Error('Select at least one existing design layer.');
  const selectedSet = new Set(selected.map((element) => element.id));
  const roots = selected.filter((element) => !element.parentId || !selectedSet.has(element.parentId));
  const included = new Set<string>();
  const queue = [...roots.map((root) => root.id)];
  while (queue.length) {
    const id = queue.shift()!;
    if (included.has(id)) continue;
    included.add(id);
    for (const child of document.elements) if (child.parentId === id) queue.push(child.id);
  }
  const elements = document.elements.filter((element) => included.has(element.id));
  const children = new Map<string | null, DesignElement[]>();
  for (const element of elements) {
    const group = children.get(element.parentId) ?? [];
    group.push(element);
    children.set(element.parentId, group);
  }
  for (const group of children.values()) group.sort((left, right) => left.order - right.order);
  const context: RenderContext = {
    document, framework: input.framework, outputPath: input.outputPath, children,
    elementMap, componentMap: new Map(document.components.map((component) => [component.id, component])),
    imports: new Map(), mappings: [], warnings: [],
  };
  const body = roots.sort((left, right) => left.order - right.order).map((root) => renderElement(context, root, 0)).join('\n');
  const componentName = safeName(input.componentName);
  const content = wrapOutput(input.framework, componentName, importsFor(context), body);
  const extension = extname(input.outputPath).toLowerCase();
  const expected = input.framework === 'svelte' || input.framework === 'svelar' ? '.svelte' : input.framework === 'vue' ? '.vue' : input.framework === 'html' ? '.html' : '.tsx';
  if (extension !== expected) context.warnings.push(`The selected ${input.framework} adapter normally writes ${expected} files.`);
  return { content, mappingsUsed: context.mappings, warnings: [...new Set(context.warnings)] };
}
