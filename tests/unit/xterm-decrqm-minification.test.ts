import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, mkdirSync, mkdtempSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'acorn';
import { transform } from 'esbuild';
import { applyPatch, parsePatch, reversePatch } from 'diff';
import { applyDependencyPatches } from '../../scripts/apply-dependency-patches.mjs';

const roots: string[] = [];
const patchName = '@xterm+xterm+6.0.0.patch';
const target = 'node_modules/@xterm/xterm/lib/xterm.mjs';
const entry = JSON.parse(readFileSync('patches/dependency-patches.json', 'utf8')).files.find((item: { file: string }) => item.file === target);
const patchText = readFileSync(join('patches', patchName), 'utf8');
const patch = parsePatch(patchText)[0];
const installed = readFileSync(target, 'utf8');
const original = applyPatch(installed, reversePatch(patch), { fuzzFactor: 0 }) as string;

function requestMode(source: string): string {
  let method: { start: number; end: number } | undefined;
  function visit(node: any): void {
    if (!node || typeof node !== 'object' || method) return;
    if (node.type === 'MethodDefinition' && node.key?.name === 'requestMode') { method = node; return; }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit); else visit(value);
    }
  }
  visit(parse(source, { ecmaVersion: 'latest', sourceType: 'module' }));
  if (!method) throw new Error('Pinned xterm requestMode method is unavailable.');
  return source.slice(method.start, method.end);
}

async function evaluate(source: string, minify: boolean, synchronizedOutput = false): Promise<string[]> {
  // The pinned method references only C0.ESC outside its class. Preserve the
  // actual published handler; exercise the same production minifier in strict mode.
  const module = { exports: {} as { Handler: { prototype: { requestMode: Function } } } };
  const code = `const b={ESC:'\\x1b'};export class Handler {${requestMode(source)}}`;
  const result = await transform(code, { minify, target: 'es2020', format: 'cjs' });
  Function('module', 'exports', '"use strict";\n' + result.code)(module, module.exports);
  const responses: string[] = [];
  const context = { _coreService: { decPrivateModes: { synchronizedOutput }, triggerDataEvent: (text: string) => responses.push(text), modes: {} },
    _coreMouseService: { activeProtocol: 'NONE', activeEncoding: 'DEFAULT' },
    _bufferService: { buffers: { active: {}, alt: {} }, cols: 80 }, _optionsService: { rawOptions: { windowOptions: {} } } };
  expect(module.exports.Handler.prototype.requestMode.call(context, { params: [2026] }, false)).toBe(true);
  return responses;
}

function fixture(version = '6.0.0') {
  const root = mkdtempSync(join(tmpdir(), 'orkestrai-xterm-patch-')); roots.push(root);
  mkdirSync(join(root, 'patches'), { recursive: true });
  mkdirSync(join(root, 'node_modules/@xterm/xterm/lib'), { recursive: true });
  copyFileSync(join('patches', patchName), join(root, 'patches', patchName));
  writeFileSync(join(root, 'patches/dependency-patches.json'), JSON.stringify({ schemaVersion: 1, files: [entry] }));
  writeFileSync(join(root, 'node_modules/@xterm/xterm/package.json'), JSON.stringify({ version }));
  writeFileSync(join(root, target), original);
  return root;
}

describe('pinned xterm DECRQM production minification regression', () => {
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

  it('reproduces the real unpatched ReferenceError and preserves the exact mode response after the patch', async () => {
    expect(typeof original).toBe('string');
    expect(await evaluate(original, false)).toEqual(['\x1b[?2026;2$y']);
    await expect(evaluate(original, true)).rejects.toThrow(ReferenceError);
    expect(await evaluate(installed, true)).toEqual(['\x1b[?2026;2$y']);
    expect(await evaluate(installed, true, true)).toEqual(['\x1b[?2026;1$y']);
  });

  it('applies the exact reviewed version/source once and is idempotent', () => {
    const root = fixture();
    expect(applyDependencyPatches(root)).toEqual({ verified: 1, applied: 1 });
    expect(readFileSync(join(root, target), 'utf8')).toBe(installed);
    expect(applyDependencyPatches(root)).toEqual({ verified: 1, applied: 0 });
  });

  it('refuses another xterm version without modifying its module', () => {
    const root = fixture('6.0.1');
    expect(() => applyDependencyPatches(root)).toThrow('Unexpected dependency version');
    expect(readFileSync(join(root, target), 'utf8')).toBe(original);
  });
});
