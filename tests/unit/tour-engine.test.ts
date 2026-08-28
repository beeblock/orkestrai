import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('@beeblock/svelar/http', () => ({ getCsrfToken: () => null }));
vi.mock('$lib/i18n/locale.svelte.js', () => ({ localeState: { current: 'pt-BR' } }));

describe('guided tour engine', () => {
  const nodes: Array<Record<string, unknown>> = [];
  const edges: Array<Record<string, unknown>> = [];
  let engine: typeof import('$lib/components/agent-room/tours/engine.svelte.js');

  beforeAll(async () => {
    vi.stubGlobal('$state', <T>(value: T) => value);
    engine = await import('$lib/components/agent-room/tours/engine.svelte.js');
  }, 30_000);

  beforeEach(() => {
    nodes.length = 0;
    edges.length = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'POST' && url.endsWith('/nodes')) {
        const body = JSON.parse(String(init?.body ?? '{}'));
        const node = { id: `node-${nodes.length + 1}`, ...body };
        nodes.push(node);
        return new Response(JSON.stringify({ data: node }), { status: 201 });
      }
      if (url.endsWith('/nodes')) return new Response(JSON.stringify({ data: nodes }));
      if (url.endsWith('/edges')) return new Response(JSON.stringify({ data: edges }));
      return new Response(JSON.stringify({ data: [] }));
    }));
  });

  afterAll(() => {
    engine.stopTour();
    vi.unstubAllGlobals();
  });

  it('does not disable or skip the next step after an action immediately satisfies its check', async () => {
    const { startTour, tourRunAction, tourState } = engine;
    await startTour('creative-image-workflow', 'workspace-1');

    const firstStep = tourState.tour?.steps[0];
    expect(firstStep?.id).toBe('create-director');
    await tourRunAction(firstStep!.action!);

    expect(tourState.stepIndex).toBe(1);
    expect(tourState.tour?.steps[tourState.stepIndex]?.id).toBe('prepare-briefs');
    expect(tourState.actionDoneFor).toBeNull();

    const secondStep = tourState.tour?.steps[tourState.stepIndex];
    await tourRunAction(secondStep!.action!);

    expect(tourState.stepIndex).toBe(2);
    expect(tourState.tour?.steps[tourState.stepIndex]?.id).toBe('prepare-character-stage');
    expect(tourState.actionDoneFor).toBeNull();
    expect(nodes.filter((node) => node.type === 'note')).toHaveLength(2);
  });
});
