import { describe, expect, it } from 'vitest';
import { applyDesignOperations, migrateDesignDocument } from '$lib/modules/agent-room/application/services/DesignDocumentService.js';
import { designDocumentSchema, type DesignDocument } from '$lib/modules/agent-room/contracts/schemas/designSchemas.js';
import { auditDesignDocument } from '$lib/modules/agent-room/domain/design-quality.js';
import { createDesignTemplate, designTemplateIds } from '$lib/modules/agent-room/domain/design-templates.js';

let sequence = 20;
const makeId = () => `00000000-0000-7000-8000-${String(sequence++).padStart(12, '0')}`;

function empty(): DesignDocument {
  const pageId = makeId();
  return designDocumentSchema.parse({
    schemaVersion: 1, id: makeId(), nodeId: makeId(), workspaceId: makeId(), name: 'Template', revision: 0,
    activePageId: pageId, pages: [{ id: pageId, name: 'Page', width: 1800, height: 1200, background: '#f5f5f3', order: 0 }], elements: [], createdAt: '2026-08-17T12:00:00.000Z', updatedAt: '2026-08-17T12:00:00.000Z',
  });
}

describe('native Design templates and migrations', () => {
  it.each(designTemplateIds)('applies the %s template through typed operations', (templateId) => {
    const source = empty();
    const operations = createDesignTemplate(templateId, source, makeId);
    const result = applyDesignOperations(source, operations, '2026-08-17T12:01:00.000Z');
    expect(result.elements.length).toBeGreaterThan(7);
    expect(result.variableCollections.length).toBe(1);
    expect(result.variables.length).toBeGreaterThan(5);
    if (templateId === 'mobile') expect(result.prototypeFlows).toHaveLength(1);
    if (templateId === 'design-system') expect(result.components).toHaveLength(1);
    expect(auditDesignDocument(result).issues.filter((issue) => issue.rule === 'text-clipping')).toEqual([]);
  });

  it('migrates unversioned documents and rejects future schemas', () => {
    const source = empty();
    const legacy = { ...source } as Record<string, unknown>;
    delete legacy.schemaVersion;
    expect(migrateDesignDocument(legacy).schemaVersion).toBe(1);
    expect(() => migrateDesignDocument({ ...source, schemaVersion: 99 })).toThrow('Unsupported');
  });
});
