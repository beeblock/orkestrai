import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import postcss, { type Declaration, type Rule } from 'postcss';
import { parse as parseJavaScript } from '@babel/parser';
import { designElementSchema, type DesignElement } from '../contracts/schemas/designSchemas.js';
import type { DesignImportResult, DesignMarkupFormat } from '../contracts/schemas/design-delivery.schema.js';

type MarkupNode = {
  tag: string;
  attrs: Record<string, string>;
  text: string;
  children: MarkupNode[];
};

type StyleMap = Record<string, string>;
type SyntaxNode = { type: string; start?: number | null; end?: number | null; [key: string]: unknown };
type ImportOptions = {
  format: DesignMarkupFormat;
  name: string;
  markup: string;
  css: string;
  pageId: string;
  parentId: string | null;
  x: number;
  y: number;
  startOrder: number;
  makeId: () => string;
};

const CONTAINER_TAGS = new Set(['article', 'aside', 'button', 'div', 'fieldset', 'footer', 'form', 'header', 'li', 'main', 'nav', 'section', 'ul', 'ol']);
const TEXT_TAGS = new Set(['a', 'blockquote', 'caption', 'code', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'label', 'legend', 'p', 'pre', 'small', 'span', 'strong']);
const IGNORED_TAGS = new Set(['head', 'link', 'meta', 'script', 'style', 'title']);

function attributes(node: DefaultTreeAdapterMap['element']): Record<string, string> {
  return Object.fromEntries((node.attrs ?? []).map((attribute) => [attribute.name, attribute.value]));
}

function parse5Node(node: DefaultTreeAdapterMap['node']): MarkupNode | null {
  if (node.nodeName === '#text') return null;
  if (!('tagName' in node) || IGNORED_TAGS.has(node.tagName)) return null;
  const children = ('childNodes' in node ? node.childNodes : [])
    .map(parse5Node)
    .filter((candidate): candidate is MarkupNode => Boolean(candidate));
  const text = ('childNodes' in node ? node.childNodes : [])
    .filter((candidate) => candidate.nodeName === '#text')
    .map((candidate) => 'value' in candidate ? candidate.value : '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { tag: node.tagName.toLowerCase(), attrs: attributes(node), text, children };
}

function extractTemplate(markup: string, format: DesignMarkupFormat): string {
  if (format === 'vue') return markup.match(/<template(?:\s[^>]*)?>([\s\S]*?)<\/template>/i)?.[1] ?? markup;
  if (format === 'svelte') return markup.replace(/<script(?:\s[^>]*)?>[\s\S]*?<\/script>/gi, '').replace(/<style(?:\s[^>]*)?>[\s\S]*?<\/style>/gi, '');
  return markup;
}

function htmlNodes(markup: string, format: Exclude<DesignMarkupFormat, 'react'>): MarkupNode[] {
  const fragment = parseFragment(extractTemplate(markup, format));
  return fragment.childNodes.map(parse5Node).filter((candidate): candidate is MarkupNode => Boolean(candidate));
}

function syntaxNode(value: unknown): SyntaxNode | null {
  return value && typeof value === 'object' && 'type' in value && typeof (value as { type?: unknown }).type === 'string'
    ? value as SyntaxNode
    : null;
}

function jsxName(value: unknown): string {
  const node = syntaxNode(value);
  if (!node) return 'div';
  if (node.type === 'JSXIdentifier') return String(node.name ?? 'div');
  if (node.type === 'JSXNamespacedName') return `${jsxName(node.namespace)}:${jsxName(node.name)}`;
  if (node.type === 'JSXMemberExpression') return `${jsxName(node.object)}.${jsxName(node.property)}`;
  return 'div';
}

function sourceText(node: SyntaxNode | null, source: string): string {
  if (!node || typeof node.start !== 'number' || typeof node.end !== 'number') return '';
  return source.slice(node.start, node.end);
}

function staticExpressionText(value: unknown, source: string): string {
  const node = syntaxNode(value);
  if (!node) return '';
  if (node.type === 'StringLiteral' || node.type === 'NumericLiteral' || node.type === 'BooleanLiteral') return String(node.value ?? '');
  if (node.type === 'TemplateLiteral' && Array.isArray(node.expressions) && node.expressions.length === 0) {
    const quasi = Array.isArray(node.quasis) ? syntaxNode(node.quasis[0]) : null;
    const cooked = quasi && typeof quasi.value === 'object' && quasi.value !== null ? (quasi.value as { cooked?: unknown }).cooked : '';
    return String(cooked ?? '');
  }
  return sourceText(node, source).replace(/^['"`]|['"`]$/g, '');
}

function jsxAttributes(opening: SyntaxNode, source: string): Record<string, string> {
  const result: Record<string, string> = {};
  const attributes = Array.isArray(opening.attributes) ? opening.attributes : [];
  for (const value of attributes) {
    const attribute = syntaxNode(value);
    if (!attribute || attribute.type !== 'JSXAttribute') continue;
    const name = jsxName(attribute.name);
    const initializer = syntaxNode(attribute.value);
    if (!initializer) result[name] = 'true';
    else if (initializer.type === 'StringLiteral') result[name] = String(initializer.value ?? '');
    else if (initializer.type === 'JSXExpressionContainer') result[name] = staticExpressionText(initializer.expression, source);
  }
  return result;
}

function jsxElement(node: SyntaxNode, source: string): MarkupNode {
  const opening = syntaxNode(node.openingElement);
  const children: MarkupNode[] = [];
  const text: string[] = [];
  for (const value of Array.isArray(node.children) ? node.children : []) {
    const child = syntaxNode(value);
    if (!child) continue;
    if (child.type === 'JSXElement') children.push(jsxElement(child, source));
    else if (child.type === 'JSXFragment') {
      for (const fragmentValue of Array.isArray(child.children) ? child.children : []) {
        const fragmentChild = syntaxNode(fragmentValue);
        if (fragmentChild?.type === 'JSXElement') children.push(jsxElement(fragmentChild, source));
      }
    } else if (child.type === 'JSXText') text.push(String(child.value ?? ''));
    else if (child.type === 'JSXExpressionContainer') {
      const expression = syntaxNode(child.expression);
      if (expression?.type === 'StringLiteral' || expression?.type === 'TemplateLiteral') text.push(staticExpressionText(expression, source));
    }
  }
  return {
    tag: jsxName(opening?.name),
    attrs: opening ? jsxAttributes(opening, source) : {},
    text: text.join(' ').replace(/\s+/g, ' ').trim(),
    children,
  };
}

function syntaxChildren(node: SyntaxNode): SyntaxNode[] {
  const children: SyntaxNode[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'errors' || key === 'comments' || key === 'tokens') continue;
    if (Array.isArray(value)) {
      for (const entry of value) {
        const child = syntaxNode(entry);
        if (child) children.push(child);
      }
    } else {
      const child = syntaxNode(value);
      if (child) children.push(child);
    }
  }
  return children;
}

function reactNodes(markup: string): MarkupNode[] {
  const source = parseJavaScript(markup, { sourceType: 'unambiguous', plugins: ['jsx', 'typescript'] });
  const result: MarkupNode[] = [];
  const visit = (node: SyntaxNode, parentType = '') => {
    if (node.type === 'JSXElement') {
      if (parentType !== 'JSXElement' && parentType !== 'JSXFragment') result.push(jsxElement(node, markup));
      return;
    }
    if (node.type === 'JSXFragment') {
      if (parentType !== 'JSXElement' && parentType !== 'JSXFragment') {
        for (const value of Array.isArray(node.children) ? node.children : []) {
          const child = syntaxNode(value);
          if (child?.type === 'JSXElement') result.push(jsxElement(child, markup));
        }
      }
      return;
    }
    for (const child of syntaxChildren(node)) visit(child, node.type);
  };
  visit(source.program as unknown as SyntaxNode);
  return result;
}

function classNames(node: MarkupNode): string[] {
  return (node.attrs.class ?? node.attrs.className ?? '').split(/\s+/).filter(Boolean);
}

function parseCss(css: string): Array<{ selector: string; declarations: StyleMap }> {
  if (!css.trim()) return [];
  const result: Array<{ selector: string; declarations: StyleMap }> = [];
  const root = postcss.parse(css);
  root.walkRules((rule: Rule) => {
    const declarations: StyleMap = {};
    rule.walkDecls((declaration: Declaration) => { declarations[declaration.prop.toLowerCase()] = declaration.value; });
    for (const selector of rule.selectors) result.push({ selector: selector.trim(), declarations });
  });
  return result;
}

function matchesSimpleSelector(node: MarkupNode, selector: string): boolean {
  const simple = selector.replace(/:[\w()-]+/g, '');
  if (!simple || simple.includes('[')) return false;
  const id = simple.match(/#([\w-]+)/)?.[1];
  if (id && node.attrs.id !== id) return false;
  const classes = [...simple.matchAll(/\.([\w-]+)/g)].map((match) => match[1]);
  if (classes.some((value) => !classNames(node).includes(value))) return false;
  const tag = simple.match(/^[A-Za-z][\w-]*/)?.[0];
  return !tag || tag.toLowerCase() === node.tag.toLowerCase();
}

function matchesSelector(node: MarkupNode, selector: string, ancestors: MarkupNode[]): boolean {
  if (/[+~\[]/.test(selector)) return false;
  const tokens = selector.replace(/\s*>\s*/g, ' > ').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length || !matchesSimpleSelector(node, tokens.at(-1)!)) return false;
  let tokenIndex = tokens.length - 2;
  let ancestorIndex = ancestors.length - 1;
  while (tokenIndex >= 0) {
    const childCombinator = tokens[tokenIndex] === '>';
    if (childCombinator) tokenIndex -= 1;
    const simple = tokens[tokenIndex];
    if (!simple) return false;
    if (childCombinator) {
      if (ancestorIndex < 0 || !matchesSimpleSelector(ancestors[ancestorIndex], simple)) return false;
      ancestorIndex -= 1;
    } else {
      while (ancestorIndex >= 0 && !matchesSimpleSelector(ancestors[ancestorIndex], simple)) ancestorIndex -= 1;
      if (ancestorIndex < 0) return false;
      ancestorIndex -= 1;
    }
    tokenIndex -= 1;
  }
  return true;
}

function parseInlineStyle(value: string): StyleMap {
  if (!value.trim()) return {};
  const root = postcss.parse(`a{${value}}`);
  const styles: StyleMap = {};
  root.walkDecls((declaration) => { styles[declaration.prop.toLowerCase()] = declaration.value; });
  return styles;
}

function tailwindStyles(classes: string[]): StyleMap {
  const styles: StyleMap = {};
  const spacing = (value: string) => `${Number(value) * 4}px`;
  for (const name of classes) {
    if (name === 'flex') styles.display = 'flex';
    else if (name === 'grid') styles.display = 'grid';
    else if (name === 'flex-col') styles['flex-direction'] = 'column';
    else if (name === 'flex-row') styles['flex-direction'] = 'row';
    else if (name === 'flex-wrap') styles['flex-wrap'] = 'wrap';
    else if (name === 'items-center') styles['align-items'] = 'center';
    else if (name === 'items-end') styles['align-items'] = 'end';
    else if (name === 'justify-center') styles['justify-content'] = 'center';
    else if (name === 'justify-between') styles['justify-content'] = 'space-between';
    else if (/^grid-cols-\d+$/.test(name)) styles['grid-template-columns'] = `repeat(${name.split('-').at(-1)}, minmax(0, 1fr))`;
    else if (/^gap-\d+(?:\.5)?$/.test(name)) styles.gap = spacing(name.slice(4));
    else if (/^p-\d+(?:\.5)?$/.test(name)) styles.padding = spacing(name.slice(2));
    else if (/^px-\d+(?:\.5)?$/.test(name)) styles['padding-inline'] = spacing(name.slice(3));
    else if (/^py-\d+(?:\.5)?$/.test(name)) styles['padding-block'] = spacing(name.slice(3));
    else if (/^rounded(?:-(sm|md|lg|xl|2xl|full))?$/.test(name)) styles['border-radius'] = ({ sm: '2px', md: '6px', lg: '8px', xl: '12px', '2xl': '16px', full: '9999px' } as Record<string, string>)[name.split('-').slice(1).join('-')] ?? '4px';
    else if (name === 'font-bold') styles['font-weight'] = '700';
    else if (name === 'font-semibold') styles['font-weight'] = '600';
    else if (name === 'text-center') styles['text-align'] = 'center';
    else if (name === 'border') { styles['border-width'] = '1px'; styles['border-color'] = '#d4d4d8'; }
    else {
      const arbitrary = name.match(/^(w|h|bg|text|rounded|gap|p)-\[(.+)]$/);
      if (!arbitrary) continue;
      const [, property, value] = arbitrary;
      if (property === 'w') styles.width = value;
      else if (property === 'h') styles.height = value;
      else if (property === 'bg') styles['background-color'] = value;
      else if (property === 'text') styles.color = value;
      else if (property === 'rounded') styles['border-radius'] = value;
      else if (property === 'gap') styles.gap = value;
      else if (property === 'p') styles.padding = value;
    }
  }
  return styles;
}

const INHERITED_PROPERTIES = [
  'color', 'font-family', 'font-size', 'font-style', 'font-weight', 'letter-spacing',
  'line-height', 'text-align', 'text-decoration', 'text-transform',
] as const;

function resolvedStyle(node: MarkupNode, rules: ReturnType<typeof parseCss>, ancestors: MarkupNode[] = [], inherited: StyleMap = {}): StyleMap {
  const style: StyleMap = {};
  for (const property of INHERITED_PROPERTIES) if (inherited[property] !== undefined) style[property] = inherited[property];
  for (const rule of rules) if (matchesSelector(node, rule.selector, ancestors)) Object.assign(style, rule.declarations);
  Object.assign(style, tailwindStyles(classNames(node)), parseInlineStyle(node.attrs.style ?? ''));
  return style;
}

function numberValue(value: string | undefined, fallback: number, relative = 0): number {
  if (!value) return fallback;
  const numeric = Number.parseFloat(value);
  if (!Number.isFinite(numeric)) return fallback;
  if (value.endsWith('rem')) return numeric * 16;
  if (value.endsWith('%') && relative > 0) return relative * numeric / 100;
  return numeric;
}

type BoxValues = { top: number; right: number; bottom: number; left: number };

function boxShorthand(value: string, fallback: number, relative: number): BoxValues {
  const parts = value.trim().split(/\s+/).filter(Boolean).slice(0, 4).map((part) => numberValue(part, fallback, relative));
  const [top = fallback, right = top, bottom = top, left = right] = parts;
  if (parts.length === 2) return { top, right, bottom: top, left: right };
  if (parts.length === 3) return { top, right, bottom, left: right };
  return { top, right, bottom, left };
}

function paddingValues(style: StyleMap, fallback: number, relative: number): BoxValues {
  let values = style.padding
    ? boxShorthand(style.padding, fallback, relative)
    : { top: fallback, right: fallback, bottom: fallback, left: fallback };
  if (style['padding-block']) {
    const block = boxShorthand(style['padding-block'], fallback, relative);
    values = { ...values, top: block.top, bottom: block.right };
  }
  if (style['padding-inline']) {
    const inline = boxShorthand(style['padding-inline'], fallback, relative);
    values = { ...values, left: inline.top, right: inline.right };
  }
  if (style['padding-top']) values.top = numberValue(style['padding-top'], values.top, relative);
  if (style['padding-right']) values.right = numberValue(style['padding-right'], values.right, relative);
  if (style['padding-bottom']) values.bottom = numberValue(style['padding-bottom'], values.bottom, relative);
  if (style['padding-left']) values.left = numberValue(style['padding-left'], values.left, relative);
  return values;
}

function flexGrow(style: StyleMap): number {
  const raw = style['flex-grow'] ?? style.flex;
  if (!raw) return 0;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function textContentWidth(node: MarkupNode, style: StyleMap, availableWidth: number): number {
  const fontSize = Math.max(4, numberValue(style['font-size'], /^h[1-6]$/.test(node.tag) ? 40 - Number(node.tag[1]) * 4 : 16));
  const content = node.text || node.attrs.placeholder || node.attrs['aria-label'] || node.tag;
  return Math.min(availableWidth, Math.max(8, Math.ceil(content.length * fontSize * 0.58)));
}

function intrinsicTextWidth(node: MarkupNode, style: StyleMap, availableWidth: number): number {
  const padding = paddingValues(style, 0, availableWidth);
  return Math.min(availableWidth, Math.max(40, textContentWidth(node, style, availableWidth) + padding.left + padding.right));
}

function color(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const normalized = value.trim();
  if (/^#[0-9a-f]{3,8}$/i.test(normalized)) return normalized;
  const rgb = normalized.match(/^rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)/i);
  if (!rgb) return fallback;
  return `#${[rgb[1], rgb[2], rgb[3]].map((entry) => Number(entry).toString(16).padStart(2, '0')).join('')}`;
}

function elementBase(options: ImportOptions, type: DesignElement['type'], name: string, parentId: string | null, x: number, y: number, order: number): DesignElement {
  return designElementSchema.parse({
    id: options.makeId(), pageId: options.pageId, parentId, type, name: name.slice(0, 120), x, y,
    width: type === 'text' ? 240 : 320, height: type === 'text' ? 32 : 120,
    fill: type === 'text' || type === 'group' ? 'transparent' : '#ffffff', stroke: 'transparent', strokeWidth: 0,
    cornerRadius: 0, text: '', fontSize: 16, fontWeight: 400, order,
  });
}

function humanName(node: MarkupNode, index: number): string {
  const named = node.attrs['aria-label'] ?? node.attrs.id ?? classNames(node)[0] ?? '';
  const tag = node.tag.includes('.') ? node.tag.split('.').at(-1)! : node.tag;
  return (named || `${tag.charAt(0).toUpperCase()}${tag.slice(1)} ${index + 1}`).slice(0, 120);
}

export function importMarkupToDesign(options: ImportOptions): DesignImportResult {
  const roots = options.format === 'react' ? reactNodes(options.markup) : htmlNodes(options.markup, options.format);
  if (!roots.length) throw new Error('No supported visual markup was found.');
  const rules = parseCss(options.css);
  const elements: DesignElement[] = [];
  const warnings: string[] = [];
  let order = options.startOrder;

  const build = (
    node: MarkupNode,
    parentId: string | null,
    x: number,
    y: number,
    availableWidth: number,
    index: number,
    assignedWidth?: number,
    ancestors: MarkupNode[] = [],
    inherited: StyleMap = {},
  ): DesignElement | null => {
    const style = resolvedStyle(node, rules, ancestors, inherited);
    const tag = node.tag.toLowerCase();
    const textTag = TEXT_TAGS.has(tag);
    const decoratedText = Boolean(
      style['background-color']
      || style.background
      || style['border-width']
      || style.padding
      || style['padding-inline']
      || style['padding-block']
      || style['padding-top']
      || style['padding-right']
      || style['padding-bottom']
      || style['padding-left']
      || style.display === 'flex'
      || style.display === 'grid',
    );
    const isText = textTag && node.children.length === 0 && !decoratedText;
    const supported = textTag || CONTAINER_TAGS.has(tag) || tag === 'img' || /^[A-Z]/.test(node.tag);
    if (!supported) {
      warnings.push(`Skipped unsupported <${node.tag}> element.`);
      return null;
    }
    const element = elementBase(options, isText ? 'text' : tag === 'img' ? 'rectangle' : 'frame', humanName(node, index), parentId, x, y, order++);
    const padding = paddingValues(style, textTag ? 0 : 16, availableWidth);
    const gap = numberValue(style.gap, 12);
    const explicitWidth = Boolean(style.width?.trim());
    const fallbackWidth = assignedWidth
      ?? (isText ? intrinsicTextWidth(node, style, availableWidth) : availableWidth);
    const width = Math.max(40, numberValue(style.width, fallbackWidth, availableWidth));
    const positionedHeight = Math.max(24, numberValue(style.height, element.height));
    const direction = style.display === 'grid'
      ? 'grid'
      : style.display === 'flex' && style['flex-direction'] !== 'column'
        ? 'horizontal'
        : textTag && node.children.length > 0
          ? 'horizontal'
        : 'vertical';
    element.width = width;
    element.layoutMode = style.display === 'grid'
      ? 'grid'
      : style.display === 'flex' || node.children.length > 0 || Boolean(node.text)
        ? direction
        : 'none';
    element.layoutWrap = style['flex-wrap'] === 'wrap';
    element.layoutGap = gap;
    element.layoutRowGap = gap;
    element.layoutColumnGap = gap;
    element.layoutGridColumns = Math.max(1, Number(style['grid-template-columns']?.match(/repeat\((\d+)/)?.[1] ?? 2));
    element.layoutPaddingTop = padding.top;
    element.layoutPaddingRight = padding.right;
    element.layoutPaddingBottom = padding.bottom;
    element.layoutPaddingLeft = padding.left;
    element.layoutAlign = style['justify-content'] === 'space-between' ? 'space-between' : style['justify-content'] === 'center' ? 'center' : style['justify-content'] === 'end' ? 'end' : 'start';
    element.fill = color(style['background-color'] ?? style.background, tag === 'button' ? '#2563eb' : textTag ? 'transparent' : '#ffffff');
    element.stroke = color(style['border-color'], style['border-width'] ? '#d4d4d8' : 'transparent');
    element.strokeWidth = numberValue(style['border-width'], 0);
    element.cornerRadius = numberValue(style['border-radius'], node.tag === 'button' ? 6 : 0);
    element.opacity = Math.max(0, Math.min(1, numberValue(style.opacity, 1)));
    if (isText) {
      element.text = node.text || node.attrs.placeholder || humanName(node, index);
      element.fill = color(style.color, '#18181b');
      element.fontSize = Math.max(4, numberValue(style['font-size'], /^h[1-6]$/.test(node.tag) ? 40 - Number(node.tag[1]) * 4 : 16));
      element.fontWeight = Math.max(100, Math.min(900, Math.round(numberValue(style['font-weight'], /^h[1-6]$|strong/.test(node.tag) ? 700 : 400) / 100) * 100));
      element.textAlign = style['text-align'] === 'center' ? 'center' : style['text-align'] === 'right' ? 'right' : 'left';
      element.height = Math.max(24, numberValue(style.height, element.fontSize * 1.5));
      elements.push(element);
      return element;
    }
    elements.push(element);
    const childStartX = x + padding.left;
    let childX = childStartX;
    let childY = y + padding.top;
    let rowHeight = 0;
    const childWidth = Math.max(40, width - padding.left - padding.right);
    const childAncestors = [...ancestors, node];
    const childLayouts = node.children.map((child) => {
      const childStyle = resolvedStyle(child, rules, childAncestors, style);
      const childIsLeafText = child.children.length === 0 && Boolean(child.text || child.attrs.placeholder || child.attrs['aria-label']);
      const explicit = Boolean(childStyle.width?.trim());
      const grow = flexGrow(childStyle);
      const positioned = childStyle.position === 'absolute' || childStyle.position === 'fixed';
      const left = childStyle.left === undefined ? null : numberValue(childStyle.left, 0, width);
      const right = childStyle.right === undefined ? null : numberValue(childStyle.right, 0, width);
      const fixedWidth = explicit
        ? Math.max(40, numberValue(childStyle.width, childWidth, childWidth))
        : positioned && left !== null && right !== null
          ? Math.max(40, width - left - right)
        : childIsLeafText && grow === 0
          ? intrinsicTextWidth(child, childStyle, childWidth)
          : null;
      return { child, childStyle, fixedWidth, grow, positioned, left, right };
    });
    const flowLayouts = childLayouts.filter((child) => !child.positioned);
    const directTextCount = node.text ? 1 : 0;
    const flowItemCount = flowLayouts.length + directTextCount;
    const horizontalGap = Math.max(0, flowItemCount - 1) * gap;
    const directTextWidth = node.text ? textContentWidth(node, style, childWidth) : 0;
    const fixedWidth = flowLayouts.reduce((total, child) => total + (child.fixedWidth ?? 0), 0);
    const flexibleWeight = flowLayouts.reduce((total, child) => total + (child.fixedWidth === null ? (child.grow || 1) : 0), 0);
    const flexibleSpace = Math.max(40, childWidth - fixedWidth - directTextWidth - horizontalGap);
    const builtChildren: DesignElement[] = [];
    if (node.text) {
      const text = elementBase(options, 'text', `${element.name} label`, element.id, childX, childY, order++);
      text.text = node.text;
      text.fill = color(style.color, tag === 'button' ? '#ffffff' : '#18181b');
      text.fontSize = Math.max(4, numberValue(style['font-size'], /^h[1-6]$/.test(tag) ? 40 - Number(tag[1]) * 4 : 16));
      text.fontWeight = Math.max(100, Math.min(900, Math.round(numberValue(style['font-weight'], tag === 'button' || /^h[1-6]$|strong/.test(tag) ? 700 : 400) / 100) * 100));
      text.textAlign = style['text-align'] === 'center' ? 'center' : style['text-align'] === 'right' ? 'right' : 'left';
      text.width = direction === 'horizontal' ? directTextWidth : childWidth;
      text.height = Math.max(24, numberValue(style['line-height'], text.fontSize * 1.5));
      elements.push(text);
      builtChildren.push(text);
      if (direction === 'horizontal') {
        childX += text.width + gap;
        rowHeight = Math.max(rowHeight, text.height);
      } else {
        childY += text.height + gap;
      }
    }
    for (const [childIndex, layout] of childLayouts.entries()) {
      const allocatedWidth = layout.positioned
        ? layout.fixedWidth ?? childWidth
        : direction === 'horizontal'
          ? layout.fixedWidth ?? flexibleSpace * ((layout.grow || 1) / Math.max(1, flexibleWeight))
          : undefined;
      const childHeight = Math.max(24, numberValue(layout.childStyle.height, 120));
      const top = layout.childStyle.top === undefined ? null : numberValue(layout.childStyle.top, 0, positionedHeight);
      const bottom = layout.childStyle.bottom === undefined ? null : numberValue(layout.childStyle.bottom, 0, positionedHeight);
      const positionedX = layout.left !== null
        ? x + layout.left
        : layout.right !== null
          ? x + width - layout.right - (allocatedWidth ?? childWidth)
          : childX;
      const positionedY = top !== null
        ? y + top
        : bottom !== null
          ? y + positionedHeight - bottom - childHeight
          : childY;
      const built = build(
        layout.child,
        element.id,
        layout.positioned ? positionedX : childX,
        layout.positioned ? positionedY : childY,
        childWidth,
        childIndex,
        allocatedWidth,
        childAncestors,
        style,
      );
      if (!built) continue;
      if (layout.positioned) continue;
      builtChildren.push(built);
      if (direction === 'horizontal') {
        childX += built.width + gap;
        rowHeight = Math.max(rowHeight, built.height);
      } else if (direction === 'grid') {
        const columns = element.layoutGridColumns;
        const column = childIndex % columns;
        const row = Math.floor(childIndex / columns);
        const cellWidth = (childWidth - gap * (columns - 1)) / columns;
        built.width = Math.max(40, cellWidth);
        built.x = childStartX + column * (cellWidth + gap);
        built.y = y + padding.top + row * (built.height + gap);
        childY = Math.max(childY, built.y + built.height + gap);
      } else childY += built.height + gap;
    }
    if (!explicitWidth && assignedWidth === undefined && direction === 'horizontal' && builtChildren.length) {
      element.width = Math.max(
        element.width,
        padding.left + padding.right + builtChildren.reduce((total, child) => total + child.width, 0) + Math.max(0, builtChildren.length - 1) * gap,
      );
    }
    const naturalHeight = direction === 'horizontal'
      ? padding.top + padding.bottom + Math.max(32, rowHeight)
      : Math.max(48, childY - y - gap + padding.bottom);
    element.height = Math.max(24, numberValue(style.height, naturalHeight));
    return element;
  };

  const wrapper = elementBase(options, 'frame', options.name, options.parentId, options.x, options.y, order++);
  wrapper.width = 800;
  wrapper.height = 120;
  wrapper.layoutMode = 'vertical';
  wrapper.layoutGap = 24;
  wrapper.layoutPaddingTop = wrapper.layoutPaddingRight = wrapper.layoutPaddingBottom = wrapper.layoutPaddingLeft = 24;
  wrapper.fill = '#f8fafc';
  wrapper.stroke = '#d4d4d8';
  wrapper.strokeWidth = 1;
  wrapper.clipContent = false;
  elements.push(wrapper);
  let rootY = options.y + 24;
  let rootRight = options.x + wrapper.width;
  for (const [index, node] of roots.entries()) {
    const child = build(node, wrapper.id, options.x + 24, rootY, wrapper.width - 48, index);
    if (!child) continue;
    rootRight = Math.max(rootRight, child.x + child.width + 24);
    rootY += child.height + 24;
  }
  wrapper.width = Math.max(wrapper.width, rootRight - options.x);
  wrapper.height = Math.max(120, rootY - options.y);
  return {
    rootIds: [wrapper.id],
    elements,
    operations: elements.map((element) => ({ kind: 'create' as const, element })),
    warnings: [...new Set(warnings)].slice(0, 200),
  };
}
