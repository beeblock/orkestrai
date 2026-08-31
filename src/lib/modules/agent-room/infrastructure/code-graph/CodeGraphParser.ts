import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { basename, extname } from 'node:path';
import { parse as parseSvelte } from 'svelte/compiler';
import { Language, Parser, type Node as SyntaxNode } from 'web-tree-sitter';
import type {
  CodeGraphDiagnostic,
  CodeGraphEdgeKind,
  CodeGraphLanguage,
  CodeGraphSymbolKind,
} from '../../domain/code-graph.js';
import type { ParsedCodeFile, ParsedCodeReference, ParsedCodeSymbol, ScannedCodeFile } from './types.js';

const require = createRequire(import.meta.url);
const MAX_AST_NODES = 250_000;
const MAX_SYMBOLS_PER_FILE = 10_000;
const MAX_REFERENCES_PER_FILE = 50_000;

type ScriptLanguage = 'typescript' | 'javascript';
type LocationOffset = { row: number; column: number };
type SvelteScriptBlock = { start: number; content: { start: number; end: number } };

type ParseContext = {
  source: string;
  path: string;
  language: CodeGraphLanguage;
  namespace: string | null;
  moduleKey: string;
  defaultScopeKey: string;
  offset: LocationOffset;
  symbols: ParsedCodeSymbol[];
  references: ParsedCodeReference[];
  symbolCounts: Map<string, number>;
  nodeCount: number;
};

const DECLARATIONS: Record<string, CodeGraphSymbolKind> = {
  function_declaration: 'function',
  generator_function_declaration: 'function',
  function_definition: 'function',
  class_declaration: 'class',
  abstract_class_declaration: 'class',
  interface_declaration: 'interface',
  type_alias_declaration: 'type',
  enum_declaration: 'enum',
  method_definition: 'method',
  method_declaration: 'method',
  method_signature: 'method',
  abstract_method_signature: 'method',
};

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeText(value: string, limit = 260): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > limit ? `${compact.slice(0, limit - 1)}…` : compact;
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  return /^(['"`]).*\1$/s.test(trimmed) ? trimmed.slice(1, -1) : trimmed;
}

function point(node: SyntaxNode, offset: LocationOffset, end = false): { line: number; column: number } {
  const value = end ? node.endPosition : node.startPosition;
  return {
    line: value.row + offset.row + 1,
    column: value.column + (value.row === 0 ? offset.column : 0),
  };
}

function positionAt(source: string, index: number): LocationOffset {
  const before = source.slice(0, index);
  const lines = before.split('\n');
  return { row: lines.length - 1, column: lines.at(-1)?.length ?? 0 };
}

function nodeName(node: SyntaxNode): SyntaxNode | null {
  return node.childForFieldName('name')
    ?? node.childForFieldName('declarator')
    ?? node.namedChildren.find((child) => ['identifier', 'type_identifier', 'property_identifier', 'name'].includes(child.type))
    ?? null;
}

function declarationSignature(node: SyntaxNode, source: string): string | null {
  const body = node.childForFieldName('body');
  const end = body ? body.startIndex : Math.min(node.endIndex, node.startIndex + 500);
  const value = normalizeText(source.slice(node.startIndex, end));
  return value || null;
}

function declarationModifiers(node: SyntaxNode): string[] {
  const prefix = node.text.slice(0, Math.min(node.text.length, 160));
  return ['public', 'protected', 'private', 'static', 'abstract', 'async', 'readonly', 'final']
    .filter((modifier) => new RegExp(`\\b${modifier}\\b`).test(prefix));
}

function declarationDocumentation(node: SyntaxNode, source: string): string | null {
  const wrapper = node.parent?.type === 'export_statement' ? node.parent : node;
  const candidate = node.previousNamedSibling ?? wrapper.previousNamedSibling;
  if (!candidate || !candidate.type.includes('comment')) return null;
  const gap = source.slice(candidate.endIndex, wrapper.startIndex);
  if (gap.split('\n').length > 3 || /[^\s]/.test(gap)) return null;
  const documentation = normalizeText(candidate.text
    .replace(/^\/\*\*?/, '')
    .replace(/\*\/$/, '')
    .replace(/^\s*\/\/\/?/gm, '')
    .replace(/^\s*\*\s?/gm, ''), 1_000);
  return documentation || null;
}

function targetFromCall(node: SyntaxNode): { name: string; qualified: string; receiver: string | null } | null {
  const callable = node.childForFieldName('function')
    ?? node.childForFieldName('name')
    ?? node.namedChildren[0]
    ?? null;
  if (!callable) return null;
  const qualified = normalizeText(callable.text, 180).replace(/\?\./g, '.').replace(/::/g, '.');
  const identifiers = qualified.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) ?? [];
  const name = identifiers.at(-1);
  if (!name) return null;
  return { name, qualified, receiver: identifiers.length > 1 ? identifiers.slice(0, -1).join('.') : null };
}

function directNamedDescendants(node: SyntaxNode, types: Set<string>): SyntaxNode[] {
  const found: SyntaxNode[] = [];
  const stack = [...node.namedChildren];
  while (stack.length) {
    const current = stack.shift()!;
    if (types.has(current.type)) found.push(current);
    else if (!DECLARATIONS[current.type]) stack.unshift(...current.namedChildren);
  }
  return found;
}

function variableFunction(node: SyntaxNode): { nameNode: SyntaxNode; valueNode: SyntaxNode } | null {
  if (node.type !== 'variable_declarator') return null;
  const name = node.childForFieldName('name');
  const value = node.childForFieldName('value');
  if (!name || !value || !['arrow_function', 'function_expression', 'generator_function'].includes(value.type)) return null;
  return { nameNode: name, valueNode: value };
}

function scopeQualifiedName(context: ParseContext, parentKey: string, name: string): string {
  const parent = context.symbols.find((symbol) => symbol.key === parentKey);
  if (parent && parent.kind !== 'module') return `${parent.qualifiedName}.${name}`;
  if (context.namespace) return `${context.namespace}\\${name}`;
  const withoutExtension = context.path.slice(0, -extname(context.path).length);
  return `${withoutExtension}::${name}`;
}

function addSymbol(
  context: ParseContext,
  node: SyntaxNode,
  parentKey: string,
  kind: CodeGraphSymbolKind,
  name: string,
  exported: boolean,
  signatureNode: SyntaxNode = node,
): ParsedCodeSymbol {
  const qualifiedName = scopeQualifiedName(context, parentKey, name);
  const countKey = `${kind}:${qualifiedName}`;
  const occurrence = context.symbolCounts.get(countKey) ?? 0;
  context.symbolCounts.set(countKey, occurrence + 1);
  const start = point(node, context.offset);
  const end = point(node, context.offset, true);
  const fingerprint = hash(`${context.path}:${countKey}:${occurrence}`);
  const symbol: ParsedCodeSymbol = {
    key: `symbol:${fingerprint}`,
    parentKey,
    kind,
    name: name.slice(0, 300),
    qualifiedName: occurrence ? `${qualifiedName}@${start.line}` : qualifiedName,
    signature: declarationSignature(signatureNode, context.source),
    documentation: declarationDocumentation(node, context.source),
    modifiers: declarationModifiers(node),
    exported,
    startLine: start.line,
    startColumn: start.column,
    endLine: end.line,
    endColumn: end.column,
    fingerprint,
  };
  context.symbols.push(symbol);
  return symbol;
}

function addReference(
  context: ParseContext,
  sourceKey: string,
  node: SyntaxNode,
  kind: CodeGraphEdgeKind,
  targetName: string,
  options: Partial<Omit<ParsedCodeReference, 'sourceKey' | 'kind' | 'targetName' | 'siteLine' | 'siteColumn'>> = {},
): void {
  if (context.references.length >= MAX_REFERENCES_PER_FILE) return;
  const site = point(node, context.offset);
  context.references.push({
    sourceKey,
    kind,
    targetName: targetName.slice(0, 300),
    targetQualifiedName: options.targetQualifiedName ?? null,
    targetModule: options.targetModule ?? null,
    confidence: options.confidence ?? 70,
    siteLine: site.line,
    siteColumn: site.column,
    metadata: options.metadata ?? {},
  });
}

function visit(node: SyntaxNode, context: ParseContext, scopeKey: string, exportedContext = false): void {
  context.nodeCount += 1;
  if (context.nodeCount > MAX_AST_NODES || context.symbols.length >= MAX_SYMBOLS_PER_FILE) return;

  if (node.type === 'export_statement') {
    for (const child of node.namedChildren) visit(child, context, scopeKey, true);
    return;
  }

  const variable = variableFunction(node);
  let childScope = scopeKey;
  if (variable) {
    const symbol = addSymbol(context, node, scopeKey, 'function', variable.nameNode.text, exportedContext, variable.valueNode);
    childScope = symbol.key;
  } else {
    const kind = DECLARATIONS[node.type];
    if (kind) {
      const name = nodeName(node)?.text?.trim();
      if (name) {
        const topLevelPhp = context.language === 'php' && (scopeKey === context.defaultScopeKey || scopeKey === context.moduleKey);
        const symbol = addSymbol(context, node, scopeKey, kind, name, exportedContext || topLevelPhp);
        childScope = symbol.key;

        if (kind === 'class' || kind === 'interface') {
          for (const heritage of directNamedDescendants(node, new Set(['extends_clause', 'implements_clause', 'base_clause', 'class_interface_clause']))) {
            const relation: CodeGraphEdgeKind = ['implements_clause', 'class_interface_clause'].includes(heritage.type) ? 'implements' : 'inherits';
            const candidates = heritage.namedChildren.flatMap((child) => child.namedChildren.length ? child.namedChildren : [child]);
            for (const candidate of candidates) {
              const targetName = (candidate.text.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) ?? []).at(-1);
              if (targetName) addReference(context, symbol.key, candidate, relation, targetName, { targetQualifiedName: candidate.text, confidence: 80 });
            }
          }
        }
      }
    }
  }

  if (node.type === 'import_statement') {
    const source = node.childForFieldName('source');
    const moduleName = source ? stripQuotes(source.text) : '';
    if (moduleName) {
      const bindings = node.namedChildren
        .filter((child) => child !== source)
        .flatMap((child) => directNamedDescendants(child, new Set(['import_specifier', 'identifier'])))
        .map((child) => normalizeText(child.text, 120))
        .filter(Boolean)
        .slice(0, 100);
      addReference(context, context.moduleKey, node, 'imports', moduleName.split('/').at(-1) ?? moduleName, {
        targetModule: moduleName,
        confidence: 100,
        metadata: { module: moduleName, bindings },
      });
    }
  } else if (node.type === 'namespace_use_declaration') {
    for (const clause of directNamedDescendants(node, new Set(['namespace_use_clause']))) {
      const qualified = clause.text.trim().replace(/^function\s+|^const\s+/, '').split(/\s+as\s+/i)[0];
      const targetName = qualified.split('\\').at(-1);
      if (targetName) addReference(context, context.moduleKey, clause, 'imports', targetName, {
        targetQualifiedName: qualified,
        targetModule: qualified,
        confidence: 100,
        metadata: { module: qualified },
      });
    }
  } else if (['call_expression', 'function_call_expression', 'member_call_expression', 'scoped_call_expression'].includes(node.type)) {
    const target = targetFromCall(node);
    if (target) addReference(context, childScope, node, 'calls', target.name, {
      targetQualifiedName: target.qualified,
      confidence: target.receiver ? 55 : 75,
      metadata: target.receiver ? { receiver: target.receiver } : {},
    });
  } else if (['new_expression', 'object_creation_expression'].includes(node.type)) {
    const target = targetFromCall(node);
    if (target) addReference(context, childScope, node, 'instantiates', target.name, {
      targetQualifiedName: target.qualified,
      confidence: 80,
    });
  }

  for (const child of node.namedChildren) visit(child, context, childScope, exportedContext);
}

class TreeSitterRuntime {
  private initialized: Promise<void> | null = null;
  private languages = new Map<ScriptLanguage | 'php' | 'tsx', Promise<Language>>();

  private init(): Promise<void> {
    this.initialized ??= Parser.init();
    return this.initialized;
  }

  async language(kind: ScriptLanguage | 'php' | 'tsx'): Promise<Language> {
    await this.init();
    let pending = this.languages.get(kind);
    if (!pending) {
      const file = kind === 'typescript' ? 'tree-sitter-typescript.wasm'
        : kind === 'javascript' ? 'tree-sitter-javascript.wasm'
          : kind === 'tsx' ? 'tree-sitter-tsx.wasm'
            : 'tree-sitter-php.wasm';
      pending = Language.load(require.resolve(`@vscode/tree-sitter-wasm/wasm/${file}`));
      this.languages.set(kind, pending);
    }
    return pending;
  }
}

const runtime = new TreeSitterRuntime();

function phpNamespace(root: SyntaxNode): string | null {
  const definition = root.namedChildren.find((child) => child.type === 'namespace_definition');
  const name = definition?.childForFieldName('name') ?? definition?.namedChildren[0];
  return name?.text?.trim().replace(/\s+/g, '') || null;
}

function moduleSymbol(file: ScannedCodeFile): ParsedCodeSymbol {
  const name = basename(file.relativePath);
  const fingerprint = hash(`${file.relativePath}:module`);
  return {
    key: `module:${file.relativePath}`,
    parentKey: null,
    kind: 'module',
    name,
    qualifiedName: file.relativePath.slice(0, -extname(file.relativePath).length),
    signature: null,
    documentation: null,
    modifiers: [],
    exported: true,
    startLine: 1,
    startColumn: 0,
    endLine: file.content.split('\n').length,
    endColumn: 0,
    fingerprint,
  };
}

export class CodeGraphParser {
  async parse(file: ScannedCodeFile): Promise<ParsedCodeFile> {
    const diagnostics: CodeGraphDiagnostic[] = [];
    const symbols = [moduleSymbol(file)];
    const references: ParsedCodeReference[] = [];
    const scripts = file.language === 'svelte' ? this.svelteScripts(file, diagnostics) : [{
      content: file.content,
      kind: file.language === 'php' ? 'php' as const
        : ['.tsx', '.jsx'].includes(extname(file.relativePath).toLowerCase()) ? 'tsx' as const
          : file.language as ScriptLanguage,
      offset: { row: 0, column: 0 },
    }];

    for (const script of scripts) {
      let parser: Parser | null = null;
      let tree: ReturnType<Parser['parse']> = null;
      try {
        const language = await runtime.language(script.kind);
        parser = new Parser();
        parser.setLanguage(language);
        tree = parser.parse(script.content);
        if (!tree) throw new Error('Tree-sitter cancelled the parse.');
        const namespace = script.kind === 'php' ? phpNamespace(tree.rootNode) : null;
        let defaultScopeKey = symbols[0].key;
        if (namespace && !symbols.some((symbol) => symbol.qualifiedName === namespace)) {
          const fingerprint = hash(`${file.relativePath}:namespace:${namespace}`);
          symbols.push({
            key: `symbol:${fingerprint}`,
            parentKey: symbols[0].key,
            kind: 'namespace',
            name: namespace.split('\\').at(-1) ?? namespace,
            qualifiedName: namespace,
            signature: `namespace ${namespace}`,
            documentation: null,
            modifiers: [],
            exported: true,
            startLine: 1,
            startColumn: 0,
            endLine: 1,
            endColumn: namespace.length,
            fingerprint,
          });
          defaultScopeKey = `symbol:${fingerprint}`;
        }
        const context: ParseContext = {
          source: script.content,
          path: file.relativePath,
          language: file.language,
          namespace,
          moduleKey: symbols[0].key,
          defaultScopeKey,
          offset: script.offset,
          symbols,
          references,
          symbolCounts: new Map(),
          nodeCount: 0,
        };
        visit(tree.rootNode, context, defaultScopeKey);
        if (tree.rootNode.hasError) diagnostics.push({
          path: file.relativePath,
          severity: 'warning',
          code: 'parse_recovered',
          message: 'The parser recovered from syntax errors; some relationships may be incomplete.',
        });
        if (context.nodeCount > MAX_AST_NODES) diagnostics.push({
          path: file.relativePath,
          severity: 'warning',
          code: 'ast_limit',
          message: `AST traversal stopped after ${MAX_AST_NODES} nodes.`,
        });
      } catch (error) {
        diagnostics.push({
          path: file.relativePath,
          severity: 'error',
          code: 'parse_failed',
          message: error instanceof Error ? error.message.slice(0, 300) : 'Source file could not be parsed.',
        });
      } finally {
        tree?.delete();
        parser?.delete();
      }
    }

    return {
      absolutePath: file.absolutePath,
      relativePath: file.relativePath,
      language: file.language,
      contentHash: file.contentHash,
      byteSize: file.byteSize,
      modifiedAt: file.modifiedAt,
      generated: file.generated,
      symbols,
      references,
      diagnostics,
    };
  }

  private svelteScripts(file: ScannedCodeFile, diagnostics: CodeGraphDiagnostic[]): Array<{
    content: string;
    kind: ScriptLanguage;
    offset: LocationOffset;
  }> {
    try {
      const ast = parseSvelte(file.content, { modern: true });
      const blocks = [ast.module, ast.instance].filter(
        (block): block is NonNullable<typeof block> => block != null,
      );
      return blocks.map((rawBlock) => {
        const block = rawBlock as unknown as SvelteScriptBlock;
        const openTag = file.content.slice(block.start, block.content.start);
        return {
          content: file.content.slice(block.content.start, block.content.end),
          kind: /\blang\s*=\s*['"]ts['"]/i.test(openTag) ? 'typescript' : 'javascript',
          offset: positionAt(file.content, block.content.start),
        };
      });
    } catch (error) {
      diagnostics.push({
        path: file.relativePath,
        severity: 'error',
        code: 'svelte_parse_failed',
        message: error instanceof Error ? error.message.slice(0, 300) : 'Svelte component could not be parsed.',
      });
      return [];
    }
  }
}

export const codeGraphParser = new CodeGraphParser();
