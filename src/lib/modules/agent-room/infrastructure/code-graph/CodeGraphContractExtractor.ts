import { createHash } from 'node:crypto';
import { parseDocument } from 'yaml';
import type { CodeGraphEdgeKind } from '../../domain/code-graph.js';
import { normalizeCodeGraphContractPath as normalizeContractPath } from '../../domain/code-graph-contract.js';
import type { ParsedCodeFile, ParsedCodeReference, ParsedCodeSymbol, ScannedCodeFile } from './types.js';

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
const HTTP_METHOD_SET = new Set<string>(HTTP_METHODS);
const MAX_CONTRACTS_PER_FILE = 2_000;

type HttpMethod = (typeof HTTP_METHODS)[number];
type Extraction = Pick<ParsedCodeFile, 'symbols' | 'references' | 'diagnostics'>;

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function lineAt(source: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) if (source.charCodeAt(index) === 10) line += 1;
  return line;
}

function bounded(value: unknown, limit = 500): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function method(value: unknown): HttpMethod | null {
  const normalized = String(value ?? '').toUpperCase();
  return HTTP_METHOD_SET.has(normalized) ? normalized as HttpMethod : null;
}

function joinPaths(prefix: string, path: string): string {
  return normalizeContractPath(`${prefix}/${path}`) ?? path;
}

function containingScope(symbols: ParsedCodeSymbol[], line: number): ParsedCodeSymbol {
  return symbols
    .filter((symbol) => symbol.kind !== 'module' && symbol.startLine != null && symbol.endLine != null && symbol.startLine <= line && symbol.endLine >= line)
    .sort((left, right) => (left.endLine! - left.startLine!) - (right.endLine! - right.startLine!))[0]
    ?? symbols[0];
}

function symbol(
  file: ScannedCodeFile,
  parentKey: string,
  kind: ParsedCodeSymbol['kind'],
  name: string,
  line: number,
  metadata: Record<string, unknown>,
  occurrence = 0,
): ParsedCodeSymbol {
  const identity = `${file.relativePath}:${kind}:${name}:${line}:${occurrence}`;
  const fingerprint = hash(identity);
  return {
    key: `contract:${fingerprint}`,
    parentKey,
    kind,
    name: bounded(name, 300),
    qualifiedName: `contract:${kind}:${bounded(name, 600)}:${file.relativePath}:${line}:${occurrence}`,
    signature: bounded(name, 1_000),
    documentation: null,
    modifiers: file.generated ? ['generated'] : [],
    metadata,
    exported: true,
    startLine: line,
    startColumn: 0,
    endLine: line,
    endColumn: 0,
    fingerprint,
  };
}

function reference(
  sourceKey: string,
  kind: CodeGraphEdgeKind,
  target: ParsedCodeSymbol | string,
  line: number,
  metadata: Record<string, unknown> = {},
  confidence = 90,
): ParsedCodeReference {
  return {
    sourceKey,
    kind,
    targetName: typeof target === 'string' ? bounded(target, 300) : target.name,
    targetQualifiedName: typeof target === 'string' ? null : target.qualifiedName,
    targetModule: null,
    confidence,
    siteLine: line,
    siteColumn: 0,
    metadata,
  };
}

function matchingBrace(source: string, opening: number): number {
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = opening; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'" || character === '`') { quote = character; continue; }
    if (character === '{') depth += 1;
    if (character === '}' && --depth === 0) return index;
  }
  return source.length;
}

function laravelPrefixes(source: string): Array<{ prefix: string; start: number; end: number }> {
  const ranges: Array<{ prefix: string; start: number; end: number }> = [];
  const pattern = /\bRoute::prefix\s*\(\s*(['"])([^'"]{1,300})\1\s*\)\s*->\s*group\s*\([^\{]{0,300}\{/gi;
  for (const match of source.matchAll(pattern)) {
    const opening = (match.index ?? 0) + match[0].lastIndexOf('{');
    const prefix = normalizeContractPath(match[2]);
    if (prefix) ranges.push({ prefix, start: opening, end: matchingBrace(source, opening) });
  }
  return ranges;
}

function prefixesAt(ranges: Array<{ prefix: string; start: number; end: number }>, index: number): string {
  return ranges.filter((range) => range.start < index && range.end > index).map((range) => range.prefix).join('/');
}

function extractHandler(tail: string): { name: string; schema: string | null } | null {
  const php = tail.match(/\[\s*([A-Za-z_$\\][\w$\\]*)::class\s*,\s*['"]([A-Za-z_$][\w$]*)['"]\s*\]/);
  if (php) return { name: php[2], schema: null };
  const candidates = tail.match(/[A-Za-z_$][\w$]*/g) ?? [];
  const schema = candidates.find((candidate) => /(?:Schema|Request|Dto|DTO)$/.test(candidate)) ?? null;
  const handler = [...candidates].reverse().find((candidate) => !/(?:Schema|Request|Dto|DTO|class|function|async)$/.test(candidate));
  return handler ? { name: handler, schema } : schema ? { name: schema, schema } : null;
}

function svelteKitRoute(path: string): string | null {
  const marker = path.lastIndexOf('/routes/');
  const route = marker >= 0 ? path.slice(marker + '/routes'.length) : path.startsWith('routes/') ? path.slice('routes'.length) : null;
  if (!route || !/\+server\.[cm]?[jt]s$/.test(route)) return null;
  const cleaned = route
    .replace(/\/\+server\.[^/]+$/, '')
    .split('/')
    .filter((segment) => segment && !/^\(.+\)$/.test(segment))
    .join('/');
  return normalizeContractPath(cleaned || '/');
}

function codeContracts(file: ScannedCodeFile, baseSymbols: ParsedCodeSymbol[]): Extraction {
  const symbols: ParsedCodeSymbol[] = [];
  const references: ParsedCodeReference[] = [];
  const diagnostics: Extraction['diagnostics'] = [];
  const add = (next: ParsedCodeSymbol) => {
    if (symbols.length < MAX_CONTRACTS_PER_FILE) symbols.push(next);
  };
  const addEndpoint = (verb: HttpMethod, rawPath: string, offset: number, framework: string, tail = '') => {
    const normalized = normalizeContractPath(rawPath);
    if (!normalized || symbols.length >= MAX_CONTRACTS_PER_FILE) return;
    const line = lineAt(file.content, offset);
    const parent = containingScope(baseSymbols, line);
    const next = symbol(file, parent.key, 'endpoint', `${verb} ${normalized}`, line, {
      contractType: 'endpoint', method: verb, path: normalized, framework,
    }, symbols.length);
    add(next);
    const handler = extractHandler(tail);
    if (handler) references.push(reference(next.key, 'handles', handler.name, line, { framework }, 75));
    if (handler?.schema) references.push(reference(next.key, 'validates', handler.schema, line, { framework }, 70));
  };
  const addRequest = (verb: HttpMethod, rawPath: string, offset: number, framework: string) => {
    const normalized = normalizeContractPath(rawPath);
    if (!normalized || symbols.length >= MAX_CONTRACTS_PER_FILE) return;
    const line = lineAt(file.content, offset);
    const parent = containingScope(baseSymbols, line);
    const next = symbol(file, parent.key, 'apiRequest', `${verb} ${normalized}`, line, {
      contractType: 'request', method: verb, path: normalized, framework, generated: file.generated,
    }, symbols.length);
    add(next);
    references.push(reference(parent.key, 'requests', next, line, { framework }, 100));
  };

  const kitPath = svelteKitRoute(file.relativePath);
  if (kitPath) {
    for (const candidate of baseSymbols) {
      const verb = method(candidate.name);
      if (verb && candidate.exported) {
        addEndpoint(verb, kitPath, Math.max(0, file.content.split('\n').slice(0, (candidate.startLine ?? 1) - 1).join('\n').length), 'sveltekit', candidate.name);
      }
    }
  }

  const prefixes = laravelPrefixes(file.content);
  for (const range of prefixes) {
    const line = lineAt(file.content, range.start);
    add(symbol(file, baseSymbols[0].key, 'gateway', `Prefix ${range.prefix}`, line, {
      contractType: 'gateway', pathPrefix: range.prefix, framework: 'laravel',
    }, symbols.length));
  }

  const laravel = /\bRoute::(get|post|put|patch|delete|head|options)\s*\(\s*(['"])([^'"]{1,500})\2\s*,([\s\S]{0,500}?)(?:\);|;)/gi;
  for (const match of file.content.matchAll(laravel)) {
    const verb = method(match[1]);
    const prefix = prefixesAt(prefixes, match.index ?? 0);
    if (verb) addEndpoint(verb, prefix ? joinPaths(prefix, match[3]) : match[3], match.index ?? 0, 'laravel', match[4]);
  }

  const route = /\b(?:app|router|server|fastify)\s*\.\s*(get|post|put|patch|delete|head|options)\s*\(\s*(['"`])([^'"`]{1,500})\2\s*,([\s\S]{0,500}?)(?:\);|;)/gi;
  for (const match of file.content.matchAll(route)) {
    const verb = method(match[1]);
    if (verb) addEndpoint(verb, match[3], match.index ?? 0, 'node', match[4]);
  }

  const mount = /\b(?:app|router|server|fastify)\s*\.\s*use\s*\(\s*(['"`])([^'"`]{1,500})\1\s*,/gi;
  for (const match of file.content.matchAll(mount)) {
    const prefix = normalizeContractPath(match[2]);
    if (!prefix) continue;
    add(symbol(file, baseSymbols[0].key, 'gateway', `Prefix ${prefix}`, lineAt(file.content, match.index ?? 0), {
      contractType: 'gateway', pathPrefix: prefix, framework: 'node',
    }, symbols.length));
  }

  const fetchCall = /\bfetch\s*\(\s*(['"`])([^'"`]{1,1000})\1\s*(?:,\s*\{([\s\S]{0,800}?)\})?/gi;
  for (const match of file.content.matchAll(fetchCall)) {
    const explicit = match[3]?.match(/\bmethod\s*:\s*['"]([A-Za-z]+)['"]/i)?.[1];
    addRequest(method(explicit) ?? 'GET', match[2], match.index ?? 0, 'fetch');
  }
  const clientCall = /\b(?:axios|api|client|http)\s*\.\s*(get|post|put|patch|delete|head|options)\s*\(\s*(['"`])([^'"`]{1,1000})\2/gi;
  for (const match of file.content.matchAll(clientCall)) {
    const verb = method(match[1]);
    if (verb) addRequest(verb, match[3], match.index ?? 0, 'http-client');
  }

  const schemaDeclaration = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:z|v|valibot)\s*\.\s*(?:object|strictObject|union|intersection|array|record|tuple)\s*\(/g;
  for (const match of file.content.matchAll(schemaDeclaration)) {
    const line = lineAt(file.content, match.index ?? 0);
    add(symbol(file, containingScope(baseSymbols, line).key, 'schema', match[1], line, {
      contractType: 'schema', framework: 'zod-valibot',
    }, symbols.length));
  }
  const formRequest = /\bclass\s+([A-Za-z_$][\w$]*)\s+extends\s+(?:\\?[A-Za-z_$][\w$]*\\)*FormRequest\b/g;
  for (const match of file.content.matchAll(formRequest)) {
    const line = lineAt(file.content, match.index ?? 0);
    add(symbol(file, containingScope(baseSymbols, line).key, 'schema', match[1], line, {
      contractType: 'schema', framework: 'laravel',
    }, symbols.length));
  }

  if (symbols.length >= MAX_CONTRACTS_PER_FILE) diagnostics.push({
    path: file.relativePath, severity: 'warning', code: 'contract_limit',
    message: `Contract extraction stopped after ${MAX_CONTRACTS_PER_FILE} entries.`,
  });
  return { symbols, references, diagnostics };
}

function localSchemaRefs(value: unknown, output = new Set<string>(), depth = 0): Set<string> {
  if (depth > 5 || output.size >= 100 || value == null) return output;
  if (Array.isArray(value)) {
    for (const entry of value.slice(0, 100)) localSchemaRefs(entry, output, depth + 1);
  } else if (typeof value === 'object') {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>).slice(0, 100)) {
      if (key === '$ref' && typeof entry === 'string') {
        const name = entry.match(/^#\/(?:components\/schemas|definitions)\/([^/]{1,300})$/)?.[1];
        if (name) output.add(name);
      } else localSchemaRefs(entry, output, depth + 1);
    }
  }
  return output;
}

function openApiContracts(file: ScannedCodeFile, module: ParsedCodeSymbol): Extraction {
  const diagnostics: Extraction['diagnostics'] = [];
  let document: unknown;
  try {
    document = file.language === 'json'
      ? JSON.parse(file.content)
      : parseDocument(file.content, { prettyErrors: false }).toJS({ maxAliasCount: 20 });
  } catch (error) {
    return { symbols: [], references: [], diagnostics: [{
      path: file.relativePath, severity: 'warning', code: 'contract_parse_failed',
      message: error instanceof Error ? error.message.slice(0, 300) : 'OpenAPI document could not be parsed.',
    }] };
  }
  if (!document || typeof document !== 'object') return { symbols: [], references: [], diagnostics };
  const root = document as Record<string, unknown>;
  if (typeof root.openapi !== 'string' && root.swagger !== '2.0') return { symbols: [], references: [], diagnostics };
  const symbols: ParsedCodeSymbol[] = [];
  const references: ParsedCodeReference[] = [];
  const schemaByName = new Map<string, ParsedCodeSymbol>();
  const schemas = ((root.components as Record<string, unknown> | undefined)?.schemas ?? root.definitions) as Record<string, unknown> | undefined;
  for (const [name] of Object.entries(schemas ?? {}).slice(0, 1_000)) {
    const next = symbol(file, module.key, 'schema', bounded(name, 300), 1, {
      contractType: 'schema', framework: 'openapi',
    }, symbols.length);
    symbols.push(next);
    schemaByName.set(name, next);
  }
  const paths = root.paths && typeof root.paths === 'object' ? root.paths as Record<string, unknown> : {};
  for (const [rawPath, pathValue] of Object.entries(paths).slice(0, 1_000)) {
    if (!pathValue || typeof pathValue !== 'object') continue;
    for (const [rawMethod, operation] of Object.entries(pathValue as Record<string, unknown>)) {
      const verb = method(rawMethod);
      const normalized = normalizeContractPath(rawPath);
      if (!verb || !normalized || !operation || typeof operation !== 'object') continue;
      const operationRecord = operation as Record<string, unknown>;
      const next = symbol(file, module.key, 'endpoint', `${verb} ${normalized}`, 1, {
        contractType: 'endpoint', method: verb, path: normalized, framework: 'openapi',
        operationId: bounded(operationRecord.operationId, 300) || null,
      }, symbols.length);
      symbols.push(next);
      for (const schemaName of localSchemaRefs(operationRecord)) {
        const target = schemaByName.get(schemaName);
        if (target) references.push(reference(next.key, 'validates', target, 1, { framework: 'openapi' }, 100));
      }
      if (symbols.length >= MAX_CONTRACTS_PER_FILE) break;
    }
    if (symbols.length >= MAX_CONTRACTS_PER_FILE) break;
  }
  if (symbols.length >= MAX_CONTRACTS_PER_FILE) diagnostics.push({
    path: file.relativePath, severity: 'warning', code: 'contract_limit',
    message: `OpenAPI extraction stopped after ${MAX_CONTRACTS_PER_FILE} entries.`,
  });
  return { symbols, references, diagnostics };
}

export class CodeGraphContractExtractor {
  extract(file: ScannedCodeFile, baseSymbols: ParsedCodeSymbol[]): Extraction {
    if (file.language === 'json' || file.language === 'yaml') return openApiContracts(file, baseSymbols[0]);
    return codeContracts(file, baseSymbols);
  }
}

export const codeGraphContractExtractor = new CodeGraphContractExtractor();
