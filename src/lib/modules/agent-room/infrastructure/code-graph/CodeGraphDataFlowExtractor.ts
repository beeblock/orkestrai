import type { CodeGraphEdgeKind } from '../../domain/code-graph.js';
import { normalizeCodeGraphContractPath } from '../../domain/code-graph-contract.js';
import type { ParsedCodeReference, ParsedCodeSymbol, ScannedCodeFile } from './types.js';

const MAX_DATA_FLOWS_PER_FILE = 2_000;

type ResourceType = 'environment' | 'file' | 'network' | 'database' | 'ipc';

function lineAt(source: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) if (source.charCodeAt(index) === 10) line += 1;
  return line;
}

function scopeFor(symbols: ParsedCodeSymbol[], line: number): ParsedCodeSymbol {
  return symbols
    .filter((symbol) => symbol.kind !== 'module' && symbol.startLine != null && symbol.endLine != null && symbol.startLine <= line && symbol.endLine >= line)
    .sort((left, right) => (left.endLine! - left.startLine!) - (right.endLine! - right.startLine!))[0]
    ?? symbols[0];
}

function identifier(value: string, limit = 300): string | null {
  const normalized = value.replace(/\s+/g, ' ').trim().slice(0, limit);
  return normalized && /^[A-Za-z0-9_.:/@-]+$/.test(normalized) ? normalized : null;
}

function relativeFile(value: string): string | null {
  const normalized = value.replace(/\\/g, '/').replace(/\/{2,}/g, '/').trim().slice(0, 500);
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized) || normalized.includes('..') || /[${}]/.test(normalized)) return null;
  return /^[A-Za-z0-9_./@-]+$/.test(normalized) ? normalized : null;
}

function safeNetworkPath(value: string): string | null {
  return normalizeCodeGraphContractPath(value);
}

function addReference(
  output: ParsedCodeReference[],
  symbols: ParsedCodeSymbol[],
  source: string,
  offset: number,
  kind: CodeGraphEdgeKind,
  resourceType: ResourceType,
  identity: string,
): void {
  if (output.length >= MAX_DATA_FLOWS_PER_FILE) return;
  const line = lineAt(source, offset);
  output.push({
    sourceKey: scopeFor(symbols, line).key,
    kind,
    targetName: `${resourceType}:${identity}`.slice(0, 300),
    targetQualifiedName: `resource:${resourceType}:${identity}`.slice(0, 1_000),
    targetModule: null,
    confidence: 85,
    siteLine: line,
    siteColumn: 0,
    metadata: { resourceType },
  });
}

export class CodeGraphDataFlowExtractor {
  extract(file: ScannedCodeFile, symbols: ParsedCodeSymbol[]): ParsedCodeReference[] {
    if (file.language === 'json' || file.language === 'yaml') return [];
    const output: ParsedCodeReference[] = [];
    const source = file.content;

    const directEnv = /\bprocess\s*\.\s*env\s*\.\s*([A-Za-z_][A-Za-z0-9_]{0,199})\b/g;
    for (const match of source.matchAll(directEnv)) {
      const key = identifier(match[1], 200);
      if (key) addReference(output, symbols, source, match.index ?? 0, 'usesEnv', 'environment', key);
    }
    const envCall = /\b(?:env|getenv)\s*\(\s*(['"])([A-Za-z_][A-Za-z0-9_]{0,199})\1/g;
    for (const match of source.matchAll(envCall)) {
      const key = identifier(match[2], 200);
      if (key) addReference(output, symbols, source, match.index ?? 0, 'usesEnv', 'environment', key);
    }

    const fileCall = /\b(?:fs\s*\.\s*)?(readFile|readFileSync|createReadStream|writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream)\s*\(\s*(['"`])([^'"`]{1,500})\2/g;
    for (const match of source.matchAll(fileCall)) {
      const path = relativeFile(match[3]);
      if (!path) continue;
      const kind: CodeGraphEdgeKind = /^(?:read|createRead)/.test(match[1]) ? 'reads' : 'writes';
      addReference(output, symbols, source, match.index ?? 0, kind, 'file', path);
    }

    const networkCall = /\b(?:fetch|axios\s*\.\s*(?:get|post|put|patch|delete)|(?:api|client|http)\s*\.\s*(?:get|post|put|patch|delete))\s*\(\s*(['"`])([^'"`]{1,1000})\1/g;
    for (const match of source.matchAll(networkCall)) {
      const path = safeNetworkPath(match[2]);
      if (path) addReference(output, symbols, source, match.index ?? 0, 'sends', 'network', path);
    }

    const tableCall = /\b(?:DB::|db\s*\.|knex\s*\.?|database\s*\.)(?:table|from|collection)?\s*\(\s*(['"])([A-Za-z_][A-Za-z0-9_.-]{0,199})\1/g;
    for (const match of source.matchAll(tableCall)) {
      const table = identifier(match[2], 200);
      if (table) addReference(output, symbols, source, match.index ?? 0, 'queries', 'database', table);
    }

    const ipcReceive = /\b(?:ipcMain|ipcRenderer)\s*\.\s*(?:handle|handleOnce|on|once)\s*\(\s*(['"])([A-Za-z0-9_.:/@-]{1,300})\1/g;
    for (const match of source.matchAll(ipcReceive)) {
      const channel = identifier(match[2]);
      if (channel) addReference(output, symbols, source, match.index ?? 0, 'receives', 'ipc', channel);
    }
    const ipcSend = /\b(?:ipcMain|ipcRenderer)\s*\.\s*(?:invoke|send|sendSync|emit)\s*\(\s*(['"])([A-Za-z0-9_.:/@-]{1,300})\1/g;
    for (const match of source.matchAll(ipcSend)) {
      const channel = identifier(match[2]);
      if (channel) addReference(output, symbols, source, match.index ?? 0, 'sends', 'ipc', channel);
    }

    return output;
  }
}

export const codeGraphDataFlowExtractor = new CodeGraphDataFlowExtractor();
