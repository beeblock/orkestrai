import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const appRoot = resolve(process.argv[2] ?? process.cwd());
const require = createRequire(join(appRoot, 'package.json'));
const modules = await realpath(join(appRoot, 'node_modules'));
const manifest = JSON.parse(await readFile(join(modules, 'zod/package.json'), 'utf8'));
assert.equal(manifest.version, '4.6.7');
assert.equal(await realpath(require.resolve('zod/v3')), await realpath(join(modules, 'zod/v3/index.cjs')));

const input = Array.from({ length: 10_000 }, (_, index) => index);
let checked = 0;
for (const [label, z] of [
  ['v4-cjs', require('zod').z],
  ['v4-esm', (await import(pathToFileURL(join(modules, 'zod/index.js')).href)).z],
  ['v3-cjs', require('zod/v3').z],
  ['v3-esm', (await import(pathToFileURL(join(modules, 'zod/v3/index.js')).href)).z],
]) {
  let visited = 0;
  const element = z.preprocess(value => { visited++; return value; }, z.string());
  for (const [schema, value, path] of [
    [z.array(element).max(2), input, []],
    [z.array(element).length(2), input, []],
    [z.set(element).max(2), new Set(input), []],
    [z.object({ items: z.array(element).max(2) }), { items: input }, ['items']],
  ]) {
    visited = 0;
    const parsed = schema.safeParse(value);
    assert.equal(parsed.success, false, label);
    assert.equal(visited, 0, `${label}: oversized input must not parse its elements`);
    assert.equal(parsed.error.issues.length, 1, label);
    assert.equal(parsed.error.issues[0].code, 'too_big', label);
    assert.deepEqual(parsed.error.issues[0].path, path, label);
    visited = 0;
    const asyncParsed = await schema.safeParseAsync(value);
    assert.equal(asyncParsed.success, false, label);
    assert.equal(visited, 0, `${label}: asynchronous elements must not start`);
    assert.equal(asyncParsed.error.issues.length, 1, label);
    checked++;
  }
  assert.deepEqual(z.array(z.string()).max(2).parse(['ok']), ['ok']);
  assert.deepEqual([...z.set(z.string()).max(2).parse(new Set(['ok']))], ['ok']);
  // Do not disguise this fix as suppression of ordinary element errors.
  assert.equal(z.array(z.string()).safeParse([1, 2, 3]).error.issues.length, 3);
  if (label.startsWith('v4')) {
    visited = 0;
    const map = z.map(z.string(), element).max(2).safeParse(new Map(input.map(index => [index, index])));
    assert.equal(map.success, false);
    assert.equal(visited, 0);
    assert.equal(map.error.issues.length, 1);
    checked++;
  }
}
const esmV3 = await import(pathToFileURL(join(modules, 'zod/v3/index.js')).href);
const frameworkPath = join(modules, '@beeblock/svelar/dist/validation/index.js');
assert.equal(await realpath(createRequire(frameworkPath).resolve('zod/v3')), await realpath(require.resolve('zod/v3')));
const framework = await import(pathToFileURL(frameworkPath).href);
assert.equal(framework.z, esmV3.z, 'Svelar must keep the patched v3 contract, not the v4 API');
assert.equal(framework.validate(framework.z.object({ value: framework.z.string() }), { value: 'ok' }).success, true);
const converter = require('zod-v3-to-json-schema');
const schema = converter.zodToJsonSchema(require('zod/v3').z.object({ items: require('zod/v3').z.array(require('zod/v3').z.string()).max(2) }));
assert.equal(schema.type, 'object');
assert.equal(schema.properties.items.maxItems, 2);
console.log(JSON.stringify({ zodSizeValidation: 'passed', version: manifest.version, checked, apis: ['v4-cjs', 'v4-esm', 'v3-cjs', 'v3-esm'], frameworkCompatibility: true, jsonSchemaCompatibility: true }));
