import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('test bootstrap', () => {
  it('compiles ignored Paraglide output before every Vitest entry point', () => {
    const packageJson = JSON.parse(readFileSync(path.resolve('package.json'), 'utf8'));
    const scripts = packageJson.scripts as Record<string, string>;

    expect(scripts['test:prepare']).toContain(
      'paraglide-js compile --project ./project.inlang --outdir ./src/lib/paraglide',
    );
    expect(scripts['test:prepare']).toContain('svelte-kit sync');
    expect(scripts.test).toMatch(/^npm run test:prepare && vitest run$/);
    expect(scripts['test:watch']).toMatch(/^npm run test:prepare && vitest$/);
    expect(scripts['test:coverage']).toMatch(/^npm run test:prepare && vitest run --coverage$/);
  });
});
