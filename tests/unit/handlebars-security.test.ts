import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const handlebars = require('handlebars');

describe('Handlebars security and API Client compatibility', () => {
  it.each(['postman-runtime', '@usebruno/js'])('resolves the patched compiler for %s', (consumer) => {
    const consumerRequire = createRequire(require.resolve(consumer));
    expect(consumerRequire('handlebars/package.json').version).toBe('4.7.10');
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
    const entries = Object.entries(lock.packages).filter(([path]) => path.endsWith('node_modules/handlebars'));
    expect(entries.length).toBeGreaterThan(0);
    for (const [, metadata] of entries) expect((metadata as { version: string }).version).toBe('4.7.10');
  });

  it('preserves ordinary escaped template rendering', () => {
    expect(handlebars.compile('<strong>{{state}}</strong>')({ state: '<ready>' })).toBe('<strong>&lt;ready&gt;</strong>');
    expect(handlebars.compile('{{#each items}}{{name}};{{/each}}')({ items: [{ name: 'one' }, { name: 'two' }] })).toBe('one;two;');
  });

  it('does not emit an HTML script terminator in precompiled source', () => {
    // GHSA-xw65-4hp5-5hc7: exercise encoding without executing generated code.
    expect(handlebars.precompile('before</script><script>after')).not.toMatch(/<\/script/i);
  });

  it('rejects a malformed AST block-parameter length before rendering', () => {
    // GHSA-8r5x-fm3f-whwj: use a harmless throw instead of a system command.
    const ast = handlebars.parse('{{#if okay}}yes{{/if}}');
    ast.body[0].program.blockParams = { length: '(()=>{throw new Error("injected fixture")})()' };
    expect(() => handlebars.precompile(ast)).toThrow();
    expect(() => handlebars.compile(ast)({ okay: true })).toThrow();
  });

  it('does not expose Function through a prototype own-property lookup', () => {
    // GHSA-p8wg-vrv2-v86f: inspect the forbidden value, never invoke it.
    const render = handlebars.compile('{{lookup (lookup fn "__proto__") "constructor"}}');
    expect(render({ fn: () => '' }, { allowProtoMethodsByDefault: true })).toBe('');
  });
});
