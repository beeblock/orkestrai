import { describe, expect, it } from 'vitest';
import { TOURS_PT } from '$lib/components/agent-room/tours/catalog/pt-BR.js';
import { TOURS_EN } from '$lib/components/agent-room/tours/catalog/en.js';
import { TOURS_ES } from '$lib/components/agent-room/tours/catalog/es.js';
import { checkPasses, isTourComplete } from '$lib/components/agent-room/tours/checks.js';
import type { Tour, WorkspaceSnapshot } from '$lib/components/agent-room/tours/types.js';
import { DOCS_PT } from '$lib/i18n/docs/pt-BR.js';
import { USE_CASE_TOUR_IDS } from '$lib/components/agent-room/tours/use-case-links.js';

const CATALOGS = { 'pt-BR': TOURS_PT, en: TOURS_EN, es: TOURS_ES };

function createdTitles(tour: Tour): Set<string> {
  const titles = new Set<string>();
  for (const step of tour.steps) {
    const actions = step.action ? (Array.isArray(step.action) ? step.action : [step.action]) : [];
    for (const action of actions) {
      if (action.kind === 'createAgent' || action.kind === 'createNote' || action.kind === 'createUsage' || action.kind === 'createApiClient' || action.kind === 'createImageWorkflow' || action.kind === 'createShape' || action.kind === 'createDesign') titles.add(action.title);
      if (action.kind === 'createFlow') titles.add(action.title);
      if (action.kind === 'createPortal') titles.add(action.title ?? 'Portal');
    }
  }
  return titles;
}

describe('catalogo de tours (integridade)', () => {
  it('todos os idiomas tem os mesmos tours e passos (ids e ordem)', () => {
    const ptIds = TOURS_PT.map((tour) => tour.id);
    expect(TOURS_EN.map((tour) => tour.id)).toEqual(ptIds);
    expect(TOURS_ES.map((tour) => tour.id)).toEqual(ptIds);
    for (const tour of TOURS_PT) {
      const en = TOURS_EN.find((item) => item.id === tour.id)!;
      const es = TOURS_ES.find((item) => item.id === tour.id)!;
      expect(en.steps.map((step) => step.id)).toEqual(tour.steps.map((step) => step.id));
      expect(es.steps.map((step) => step.id)).toEqual(tour.steps.map((step) => step.id));
    }
  });

  it('todo tour tem 3+ passos, ids de passo unicos e titulo/tagline', () => {
    for (const catalog of Object.values(CATALOGS)) {
      for (const tour of catalog) {
        expect(tour.steps.length).toBeGreaterThanOrEqual(3);
        expect(new Set(tour.steps.map((step) => step.id)).size).toBe(tour.steps.length);
        expect(tour.title.length).toBeGreaterThan(3);
        expect(tour.tagline.length).toBeGreaterThan(10);
      }
    }
  });

  it('todo caso de uso documentado abre um tour existente', () => {
    const tourIds = new Set(TOURS_PT.map((tour) => tour.id));
    expect(Object.keys(USE_CASE_TOUR_IDS).sort()).toEqual(DOCS_PT.useCases.map((useCase) => useCase.id).sort());
    for (const useCase of DOCS_PT.useCases) {
      expect(tourIds.has(USE_CASE_TOUR_IDS[useCase.id]), `${useCase.id}: tour inexistente`).toBe(true);
    }
  });

  it('o tour de Council usa uma acao direta que funciona na rota atual', () => {
    for (const catalog of Object.values(CATALOGS)) {
      const council = catalog.find((tour) => tour.id === 'council-perspectives');
      expect(council?.steps[0]?.action).toEqual({ kind: 'openCouncil' });
    }
  });

  it('acoes connect/task/routine/flow referenciam titulos criados no proprio tour (3 idiomas)', () => {
    for (const catalog of Object.values(CATALOGS)) {
      for (const tour of catalog) {
        const titles = createdTitles(tour);
        for (const step of tour.steps) {
          const actions = step.action ? (Array.isArray(step.action) ? step.action : [step.action]) : [];
          for (const action of actions) {
            if (action.kind === 'connect') {
              expect(titles.has(action.fromTitle) || action.fromTitle === action.toTitle, `${tour.id}: connect ${action.fromTitle}`).toBe(true);
              expect(titles.has(action.toTitle) || action.fromTitle === action.toTitle, `${tour.id}: connect ${action.toTitle}`).toBe(true);
            }
            if (action.kind === 'createTask' && action.assigneeTitle) {
              expect(titles.has(action.assigneeTitle), `${tour.id}: task assignee ${action.assigneeTitle}`).toBe(true);
            }
            if (action.kind === 'createRoutine') {
              expect(titles.has(action.targetTitle), `${tour.id}: routine target ${action.targetTitle}`).toBe(true);
            }
            if (action.kind === 'createFlow') {
              for (const flowStep of action.steps) {
                if (flowStep.kind === 'agent') {
                  expect(titles.has(flowStep.target ?? ''), `${tour.id}: flow target ${flowStep.target}`).toBe(true);
                }
              }
            }
          }
        }
      }
    }
  });

  it('checks do tour usam titulos coerentes com as acoes (3 idiomas)', () => {
    for (const catalog of Object.values(CATALOGS)) {
      for (const tour of catalog) {
        const titles = createdTitles(tour);
        for (const step of tour.steps) {
          // nodeExists com titulo: precisa ser algo criado no tour (ou o proprio quadro/portal)
          if (step.check?.kind === 'nodeExists' && step.check.titleIncludes) {
            const allowed = ['Tarefas', 'Tasks', 'Tareas'];
            expect(
              titles.has(step.check.titleIncludes) || allowed.includes(step.check.titleIncludes),
              `${tour.id}: check nodeExists "${step.check.titleIncludes}"`
            ).toBe(true);
          }
          // edgeExists: os dois lados precisam ter sido criados no tour
          if (step.check?.kind === 'edgeExists') {
            expect(titles.has(step.check.fromTitle), `${tour.id}: check edge from "${step.check.fromTitle}"`).toBe(true);
            expect(titles.has(step.check.toTitle), `${tour.id}: check edge to "${step.check.toTitle}"`).toBe(true);
          }
        }
      }
    }
  });
});

describe('checkPasses', () => {
  const snap: WorkspaceSnapshot = {
    nodes: [
      { id: 'n1', type: 'terminal', title: 'Líder' },
      { id: 'n2', type: 'note', title: 'Briefing' },
      { id: 'n3', type: 'portal', title: 'Portal App' },
      { id: 'n4', type: 'flow', title: 'Pipeline', payload: { run: null },
      },
    ],
    edges: [{ id: 'e1', sourceNodeId: 'n2', targetNodeId: 'n1' }],
    tasks: [{ id: 't1', title: 'Montar o time e começar', status: 'todo' }],
    mcps: [{ name: 'deepwiki' }],
    floors: [{ name: 'feature-nova' }],
    routines: [{ id: 'r1' }],
  };

  it('nodeExists por tipo e titulo', () => {
    expect(checkPasses({ kind: 'nodeExists', nodeType: 'terminal', titleIncludes: 'Líder' }, snap)).toBe(true);
    expect(checkPasses({ kind: 'nodeExists', nodeType: 'terminal', titleIncludes: 'Inexistente' }, snap)).toBe(false);
    expect(checkPasses({ kind: 'nodeExists', nodeType: 'portal' }, snap)).toBe(true);
  });

  it('edgeExists em qualquer direcao', () => {
    expect(checkPasses({ kind: 'edgeExists', fromTitle: 'Briefing', toTitle: 'Líder' }, snap)).toBe(true);
    expect(checkPasses({ kind: 'edgeExists', fromTitle: 'Líder', toTitle: 'Briefing' }, snap)).toBe(true);
    expect(checkPasses({ kind: 'edgeExists', fromTitle: 'Briefing', toTitle: 'Portal App' }, snap)).toBe(false);
  });

  it('demais checks: task, mcp, floor, routine, flow', () => {
    expect(checkPasses({ kind: 'taskExists', titleIncludes: 'montar o time' }, snap)).toBe(true);
    expect(checkPasses({ kind: 'mcpInstalled', name: 'deepwiki' }, snap)).toBe(true);
    expect(checkPasses({ kind: 'mcpInstalled', name: 'github' }, snap)).toBe(false);
    expect(checkPasses({ kind: 'floorExists', nameIncludes: 'feature' }, snap)).toBe(true);
    expect(checkPasses({ kind: 'routineExists' }, snap)).toBe(true);
    expect(checkPasses({ kind: 'flowRunFinished' }, snap)).toBe(true);
  });
});

describe('isTourComplete (regressao: tour nao pode ficar travado no ultimo passo)', () => {
  const base = {
    id: 't',
    icon: 'Workflow',
    title: 'Tour',
    tagline: 'tagline de teste',
    steps: [
      { id: 'a', title: 'A', body: 'passo A', check: { kind: 'routineExists' } },
      { id: 'b', title: 'B', body: 'passo B', check: { kind: 'routineExists' } },
    ],
  } satisfies Tour;

  it('conclui quando o check do ultimo passo passou e o indice esta no fim', () => {
    expect(isTourComplete(base, 1, new Set(['a', 'b']))).toBe(true);
  });

  it('nao conclui antes de chegar no ultimo passo nem sem o check dele', () => {
    expect(isTourComplete(base, 0, new Set(['a', 'b']))).toBe(false);
    expect(isTourComplete(base, 1, new Set(['a']))).toBe(false);
  });

  it('ultimo passo sem check nao auto-conclui (finalizacao manual)', () => {
    const manual: Tour = { ...base, steps: [base.steps[0], { id: 'b', title: 'B', body: 'passo B' }] };
    expect(isTourComplete(manual, 1, new Set(['a', 'b']))).toBe(false);
  });
});
