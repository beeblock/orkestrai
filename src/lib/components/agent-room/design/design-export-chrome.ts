/**
 * Marcadores de chrome do editor que NUNCA podem sair no SVG exportado.
 *
 * O export serializa o mesmo SVG que o editor desenha e remove o chrome por
 * allowlist. A lista vivia duplicada em dois pontos de DesignEditor.svelte e
 * `data-design-hover` nao estava em nenhum dos dois: o anel de hover da camada
 * sob o cursor vazava para SVG, PNG, JPEG, WebP, PDF, para a thumbnail e para a
 * imagem de referencia da comparacao visual que controla a aprovacao de design.
 *
 * Todo marcador `data-design-*` novo precisa entrar aqui ou em DESIGN_ART_MARKERS.
 * `tests/unit/design-export-chrome.test.ts` varre os componentes e falha se
 * algum marcador nao estiver classificado.
 */
export const DESIGN_CHROME_MARKERS = [
  'data-design-ui',
  'data-design-hit',
  'data-design-selection',
  'data-design-hover',
  'data-design-guide',
  'data-design-ruler',
  'data-design-snap',
  'data-design-snap-label',
  'data-design-measurement',
  'data-design-resize',
  'data-design-frame-label',
  'data-design-vector-edit',
  'data-design-text-editor',
  'data-design-prototype-hit',
  'data-design-prototype-handle',
  'data-design-prototype-connection',
  'data-design-add-interaction',
] as const;

/**
 * Marcadores que fazem parte da arte ou de containers fora do SVG exportado.
 * Removidos do export, quebrariam justamente o conteudo que deve ser exportado.
 */
export const DESIGN_ART_MARKERS = [
  'data-design-element',
  'data-design-prototype-player',
  'data-design-delivery',
] as const;

export const DESIGN_CHROME_SELECTOR = DESIGN_CHROME_MARKERS.map((marker) => `[${marker}]`).join(',');

/** Remove todo o chrome do editor de um SVG ja clonado, no lugar. */
export function stripDesignChrome(root: ParentNode): void {
  root.querySelectorAll(DESIGN_CHROME_SELECTOR).forEach((element) => element.remove());
}
