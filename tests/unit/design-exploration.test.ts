import { describe, expect, it } from 'vitest';
import { CreateDesignExplorationDto } from '$lib/modules/agent-room/application/dto/CreateDesignExplorationDto.js';
import {
  designExplorationBrief,
  designExplorationCopy,
  designExplorationLayout,
  isDesignExplorationPayload,
  isDesignExplorationStalled,
} from '$lib/modules/agent-room/domain/design-exploration.js';
import { createDesignExplorationSchema } from '$lib/modules/agent-room/contracts/schemas/create-design-exploration.schema.js';
import type { CanvasNode } from '$lib/modules/agent-room/domain/types.js';

function input(locale: 'pt-BR' | 'en' | 'es' = 'en') {
  return createDesignExplorationSchema.parse({
    title: 'Checkout redesign',
    objective: 'Reduce checkout abandonment without hiding delivery costs.',
    audience: 'Returning mobile customers',
    platform: 'responsive-web',
    codeTarget: 'svelar',
    constraints: 'Keep the existing payment API.',
    references: 'Current checkout and support tickets.',
    includeDarkMode: true,
    executionMode: 'manual',
    locale,
  });
}

describe('design exploration workflow', () => {
  it('only marks assigned active concept work as stalled', () => {
    const now = Date.parse('2026-09-06T13:00:00.000Z');
    const old = '2026-09-06T12:54:59.000Z';

    expect(isDesignExplorationStalled({ phase: 'active', taskId: 'task', assigneeNodeId: 'agent', startedAt: old, lastProgressAt: '2026-09-06T12:59:59.000Z' }, now)).toBe(true);
    expect(isDesignExplorationStalled({ phase: 'active', stage: 'expand', taskId: 'task', assigneeNodeId: 'agent', startedAt: old, lastProgressAt: '2026-09-06T12:59:59.000Z' }, now)).toBe(false);
    expect(isDesignExplorationStalled({ phase: 'active', taskId: 'task', assigneeNodeId: 'agent', lastProgressAt: old }, now)).toBe(true);
    expect(isDesignExplorationStalled({ phase: 'active', taskId: null, assigneeNodeId: null, lastProgressAt: old }, now)).toBe(false);
    expect(isDesignExplorationStalled({ phase: 'waiting', taskId: 'task', assigneeNodeId: 'agent', lastProgressAt: old }, now)).toBe(false);
  });

  it('recognizes both current and legacy exploration payloads', () => {
    expect(isDesignExplorationPayload({ workflowKind: 'design-exploration' })).toBe(true);
    expect(isDesignExplorationPayload({ explorationId: 'legacy-exploration' })).toBe(true);
    expect(isDesignExplorationPayload({ workflowKind: 'other' })).toBe(false);
  });

  it('validates delegation and keeps manual creation independent from a leader', () => {
    expect(createDesignExplorationSchema.safeParse(input()).success).toBe(true);
    expect(createDesignExplorationSchema.safeParse({ ...input(), executionMode: 'leader' }).success).toBe(false);
    expect(createDesignExplorationSchema.safeParse({
      ...input(),
      executionMode: 'leader',
      leaderNodeId: '019fd75e-a7a4-7460-84c6-33f1d6457af0',
    }).success).toBe(true);
  });

  it('builds a localized brief with a small concept gate before complete delivery', () => {
    const brief = designExplorationBrief(CreateDesignExplorationDto.from(input('es')), 'note-1');
    expect(brief).toContain('UI A - Claridad');
    expect(brief).toContain('UI B - Expresiva');
    expect(brief).toContain('UI C - Eficiente');
    expect(brief).toContain('Tokens tipados');
    expect(brief).toContain('30-120 capas útiles');
    expect(brief).toContain('Inspección visual humana');
    expect(brief).toContain('Código aplicado');
    expect(brief).toContain('Brand board');
    expect(brief).toContain('note-1');
    expect(brief).not.toContain('lista de arquivos');
  });

  it('keeps every concept task bound to a professional visual quality bar', () => {
    for (const locale of ['pt-BR', 'en', 'es'] as const) {
      const concepts = designExplorationCopy(locale).tasks.filter((task) => task.kind === 'concept');
      expect(concepts).toHaveLength(3);
      for (const concept of concepts) {
        expect(concept.description).toContain('30-120');
        expect(concept.description.toLowerCase()).toContain('pill');
        expect(concept.description.toLowerCase()).toContain(locale === 'en' ? 'audit error' : locale === 'pt-BR' ? 'erro da auditoria' : 'error pendiente de auditoría');
      }
    }
  });

  it('places the package below existing nodes without overlapping their vertical extent', () => {
    const existing = [{ x: 100, y: 200, width: 400, height: 300, type: 'terminal' }] as CanvasNode[];
    const layout = designExplorationLayout(existing);
    expect(layout.baseY).toBe(660);
    expect(layout.note.y).toBeGreaterThan(500);
    expect(layout.designs).toHaveLength(3);
    expect(layout.designs[1].x).toBeGreaterThan(layout.designs[0].x + layout.designs[0].width);
    expect(layout.group.width).toBeGreaterThan(1_600);
  });
});
