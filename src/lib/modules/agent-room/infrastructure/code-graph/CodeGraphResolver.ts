import { createHash } from 'node:crypto';
import { dirname, extname, join, normalize } from 'node:path/posix';
import type { CodeGraphEdgeKind } from '../../domain/code-graph.js';
import type {
  ParsedCodeFile,
  ParsedCodeReference,
  ParsedCodeSymbol,
  ResolvedCodeEdge,
  ResolvedCodeGraph,
} from './types.js';

const MODULE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.svelte', '.php'];

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function withoutExtension(path: string): string {
  const extension = extname(path);
  return extension ? path.slice(0, -extension.length) : path;
}

function moduleAliases(path: string): string[] {
  const clean = withoutExtension(path);
  return clean.endsWith('/index') ? [clean, clean.slice(0, -'/index'.length)] : [clean];
}

function relativeImportCandidates(sourcePath: string, specifier: string): string[] {
  if (!specifier.startsWith('.')) return [];
  const base = normalize(join(dirname(sourcePath), specifier));
  const candidates = new Set<string>([withoutExtension(base), base]);
  for (const extension of MODULE_EXTENSIONS) {
    candidates.add(withoutExtension(`${base}${extension}`));
    candidates.add(withoutExtension(`${base}/index${extension}`));
  }
  return [...candidates];
}

function edgeFingerprint(
  sourceKey: string,
  targetKey: string,
  kind: CodeGraphEdgeKind,
  path: string,
  line: number | null,
  column: number | null,
): string {
  return hash(JSON.stringify([sourceKey, targetKey, kind, path, line, column]));
}

function externalSymbol(identity: string, name: string): ParsedCodeSymbol {
  const fingerprint = hash(`external:${identity}`);
  return {
    key: `external:${fingerprint}`,
    parentKey: null,
    kind: 'external',
    name: name.slice(0, 300),
    qualifiedName: `external:${identity}`.slice(0, 1_000),
    signature: null,
    documentation: null,
    modifiers: [],
    metadata: { identity },
    exported: true,
    startLine: null,
    startColumn: null,
    endLine: null,
    endColumn: null,
    fingerprint,
  };
}

export class CodeGraphResolver {
  resolve(files: ParsedCodeFile[]): ResolvedCodeGraph {
    const symbols = files.flatMap((file) => file.symbols);
    const symbolByKey = new Map(symbols.map((symbol) => [symbol.key, symbol]));
    const fileBySymbol = new Map<string, ParsedCodeFile>();
    const moduleByPath = new Map<string, ParsedCodeSymbol>();
    const symbolsByName = new Map<string, ParsedCodeSymbol[]>();
    const symbolsByQualified = new Map<string, ParsedCodeSymbol[]>();
    const externalByIdentity = new Map<string, ParsedCodeSymbol>();
    const edges = new Map<string, ResolvedCodeEdge>();

    for (const file of files) {
      for (const symbol of file.symbols) {
        fileBySymbol.set(symbol.key, file);
        symbolsByName.set(symbol.name, [...(symbolsByName.get(symbol.name) ?? []), symbol]);
        symbolsByQualified.set(symbol.qualifiedName, [...(symbolsByQualified.get(symbol.qualifiedName) ?? []), symbol]);
        if (symbol.kind === 'module') {
          for (const alias of moduleAliases(file.relativePath)) moduleByPath.set(alias, symbol);
        }
      }
    }

    const addEdge = (
      sourceKey: string,
      targetKey: string,
      kind: CodeGraphEdgeKind,
      sitePath: string,
      siteLine: number | null,
      siteColumn: number | null,
      confidence: number,
      metadata: Record<string, unknown>,
    ) => {
      if (sourceKey === targetKey && kind !== 'references') return;
      const fingerprint = edgeFingerprint(sourceKey, targetKey, kind, sitePath, siteLine, siteColumn);
      edges.set(fingerprint, {
        sourceKey,
        targetKey,
        kind,
        confidence,
        sitePath,
        siteLine,
        siteColumn,
        metadata,
        fingerprint,
      });
    };

    for (const file of files) {
      const module = file.symbols.find((symbol) => symbol.kind === 'module');
      if (!module) continue;
      for (const symbol of file.symbols) {
        if (symbol.parentKey) addEdge(
          symbol.parentKey,
          symbol.key,
          'defines',
          file.relativePath,
          symbol.startLine,
          symbol.startColumn,
          100,
          {},
        );
        if (symbol.exported && symbol.key !== module.key) addEdge(
          module.key,
          symbol.key,
          'exports',
          file.relativePath,
          symbol.startLine,
          symbol.startColumn,
          100,
          {},
        );
      }

      for (const reference of file.references) {
        const target = this.resolveTarget(reference, file, symbolByKey, fileBySymbol, moduleByPath, symbolsByName, symbolsByQualified)
          ?? this.getExternal(reference, externalByIdentity);
        if (!symbolByKey.has(target.key) && !externalByIdentity.has(target.qualifiedName.replace(/^external:/, ''))) {
          symbols.push(target);
          symbolByKey.set(target.key, target);
        }
        addEdge(
          reference.sourceKey,
          target.key,
          reference.kind,
          file.relativePath,
          reference.siteLine,
          reference.siteColumn,
          target.kind === 'external' ? Math.min(reference.confidence, 55) : reference.confidence,
          reference.metadata,
        );
      }
    }

    for (const external of externalByIdentity.values()) {
      if (!symbolByKey.has(external.key)) {
        symbols.push(external);
        symbolByKey.set(external.key, external);
      }
    }

    return {
      files,
      symbols,
      edges: [...edges.values()],
      diagnostics: files.flatMap((file) => file.diagnostics).slice(0, 500),
    };
  }

  private resolveTarget(
    reference: ParsedCodeReference,
    sourceFile: ParsedCodeFile,
    symbolByKey: Map<string, ParsedCodeSymbol>,
    fileBySymbol: Map<string, ParsedCodeFile>,
    moduleByPath: Map<string, ParsedCodeSymbol>,
    symbolsByName: Map<string, ParsedCodeSymbol[]>,
    symbolsByQualified: Map<string, ParsedCodeSymbol[]>,
  ): ParsedCodeSymbol | null {
    if (reference.kind === 'imports' && reference.targetModule) {
      for (const candidate of relativeImportCandidates(sourceFile.relativePath, reference.targetModule)) {
        const module = moduleByPath.get(candidate);
        if (module) return module;
      }
    }

    if (reference.targetQualifiedName) {
      const qualified = reference.targetQualifiedName.replace(/::/g, '.').replace(/^\\/, '');
      const exact = symbolsByQualified.get(qualified) ?? symbolsByQualified.get(reference.targetQualifiedName);
      if (exact?.length === 1) return exact[0];
    }

    const candidates = symbolsByName.get(reference.targetName) ?? [];
    if (candidates.length === 1) return candidates[0];
    if (!candidates.length) return null;

    const source = symbolByKey.get(reference.sourceKey);
    const sourceParent = source?.parentKey ? symbolByKey.get(source.parentKey) : null;
    if (sourceParent) {
      const sameParent = candidates.filter((candidate) => candidate.parentKey === sourceParent.key);
      if (sameParent.length === 1) return sameParent[0];
    }
    const sameFile = candidates.filter((candidate) => fileBySymbol.get(candidate.key)?.relativePath === sourceFile.relativePath);
    return sameFile.length === 1 ? sameFile[0] : null;
  }

  private getExternal(reference: ParsedCodeReference, cache: Map<string, ParsedCodeSymbol>): ParsedCodeSymbol {
    const identity = reference.targetModule
      ? `module:${reference.targetModule}`
      : reference.targetQualifiedName
        ? `symbol:${reference.targetQualifiedName}`
        : `symbol:${reference.targetName}`;
    let symbol = cache.get(identity);
    if (!symbol) {
      symbol = externalSymbol(identity, reference.targetName);
      cache.set(identity, symbol);
    }
    return symbol;
  }
}

export const codeGraphResolver = new CodeGraphResolver();
