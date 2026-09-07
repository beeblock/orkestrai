import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  DESIGN_ART_MARKERS,
  DESIGN_CHROME_MARKERS,
  DESIGN_CHROME_SELECTOR,
  stripDesignChrome,
} from '../../src/lib/components/agent-room/design/design-export-chrome.js';

const DESIGN_DIR = 'src/lib/components/agent-room/design';

function emittedMarkers(): string[] {
  const files = readdirSync(DESIGN_DIR).filter((name) => name.endsWith('.svelte'));
  const found = new Set<string>();
  for (const name of files) {
    const source = readFileSync(join(DESIGN_DIR, name), 'utf8');
    for (const match of source.matchAll(/data-design-[a-z-]+/g)) found.add(match[0]);
  }
  return [...found].sort();
}

describe('design export chrome', () => {
  it('classifica todo marcador data-design-* emitido pelo editor', () => {
    const classified = new Set<string>([...DESIGN_CHROME_MARKERS, ...DESIGN_ART_MARKERS]);
    const unclassified = emittedMarkers().filter((marker) => !classified.has(marker));
    // Um marcador nao classificado ou vaza para o SVG exportado (se for chrome)
    // ou some da arte (se for conteudo). Classifique-o em design-export-chrome.ts.
    expect(unclassified).toEqual([]);
  });

  it('nao remove os marcadores de arte', () => {
    for (const marker of DESIGN_ART_MARKERS) {
      expect(DESIGN_CHROME_MARKERS).not.toContain(marker);
    }
  });

  it('cobre o anel de hover, que vazava para todo export', () => {
    expect(DESIGN_CHROME_MARKERS).toContain('data-design-hover');
    expect(DESIGN_CHROME_SELECTOR).toContain('[data-design-hover]');
  });

  it('remove tudo que o seletor casa e nada alem disso', () => {
    const chrome = DESIGN_CHROME_MARKERS.map((marker) => ({ marker, removed: false }));
    const art = DESIGN_ART_MARKERS.map((marker) => ({ marker, removed: false }));
    const nodes = [...chrome, ...art];
    // Sem DOM no ambiente de teste (vitest roda em node): exercitamos
    // stripDesignChrome contra um ParentNode minimo, checando que ele so remove
    // o que o seletor declara.
    const root = {
      querySelectorAll: (selector: string) => {
        expect(selector).toBe(DESIGN_CHROME_SELECTOR);
        const wanted = new Set(selector.split(',').map((part) => part.slice(1, -1)));
        return nodes
          .filter((node) => wanted.has(node.marker))
          .map((node) => ({ remove: () => { node.removed = true; } }));
      },
    } as unknown as ParentNode;

    stripDesignChrome(root);
    expect(chrome.filter((node) => !node.removed)).toEqual([]);
    expect(art.filter((node) => node.removed)).toEqual([]);
  });
});
