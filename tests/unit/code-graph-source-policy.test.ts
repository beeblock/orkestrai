import { describe, expect, it } from 'vitest';
import { isCodeGraphGeneratedPath } from '$lib/modules/agent-room/infrastructure/code-graph/CodeGraphSourcePolicy.js';

describe('root-relative graph source exclusions', () => {
  it.each(['Library/PackageCache/pkg/source.ts', 'Library\\PackageCache\\pkg\\source.ts', 'library\\cache.js', './Temp/generated.ts'])
    ('excludes generated roots across POSIX and Windows separators: %s', path => {
      expect(isCodeGraphGeneratedPath(path, ['Library', 'Temp'])).toBe(true);
    });

  it.each(['Assets/Library/authored.ts', 'Assets\\Temp\\source.ts', 'Packages/com.example/source.ts', 'src/library.ts', ''])
    ('preserves authored input including nested names: %s', path => {
      expect(isCodeGraphGeneratedPath(path, ['Library', 'Temp'])).toBe(false);
    });
});
