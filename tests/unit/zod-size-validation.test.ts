import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('constrained validation resource limits', () => {
  it('rejects oversized containers before walking elements through every shipped API', () => {
    const output = execFileSync(process.execPath, [resolve('tests/fixtures/zod-size-validation.mjs'), process.cwd()], { encoding: 'utf8', timeout: 30_000 });
    expect(JSON.parse(output)).toMatchObject({ zodSizeValidation: 'passed', version: '4.6.7', checked: 18, frameworkCompatibility: true, jsonSchemaCompatibility: true });
  });
});
