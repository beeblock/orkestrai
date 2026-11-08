import { describe, expect, it } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { uuidv7 } from '@beeblock/svelar/support';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentWorkspace } from '$lib/modules/agent-room/domain/models/AgentWorkspace.js';
import { createWorkspaceSchema } from '$lib/modules/agent-room/contracts/schemas/workspaceSchemas.js';
import { CreateWorkspaceDto } from '$lib/modules/agent-room/application/dto/WorkspaceDtos.js';
import { codeGraphIndexService } from '$lib/modules/agent-room/application/services/CodeGraphIndexService.js';
import { codeGraphRepository } from '$lib/modules/agent-room/infrastructure/repositories/CodeGraphRepository.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { workspaceService } from '$lib/modules/agent-room/application/services/WorkspaceService.js';

describe('Code Intelligence requires explicit activation', () => {
  useSvelarTest({ refreshDatabase: true });

  it.each(['native', 'wsl'] as const)('keeps a new %s workspace off through shared validation, DTO and persistence', async runtimeKind => {
    const input = createWorkspaceSchema.parse({ name: 'No indexing by default', workingDir: '/unavailable/fixture', runtimeKind });
    expect(input.codeIntelligenceMode).toBe('disabled');
    expect(CreateWorkspaceDto.from(input).codeIntelligenceMode).toBe('disabled');
    expect(new CreateWorkspaceDto('Direct DTO', '/unavailable/fixture', null, null).codeIntelligenceMode).toBe('disabled');
    const workspace = await workspaceRepository.createWorkspace({ name: input.name, workingDir: input.workingDir, runtimeKind });
    expect(workspace.codeIntelligenceMode).toBe('disabled');
    await expect(codeGraphIndexService.index(workspace.id)).rejects.toMatchObject({ mode: 'disabled', status: 403 });
    await expect(codeGraphIndexService.availableSnapshot(workspace.id)).rejects.toMatchObject({ mode: 'disabled', status: 403 });
    expect((await codeGraphRepository.snapshot(workspace.id)).projects).toEqual([]);
  });

  it('does not interpret a legacy assisted default as consent or erase retained graph projects', async () => {
    const row = await AgentWorkspace.create({ id: uuidv7(), name: 'Legacy default', working_dir: '/unavailable/fixture', code_intelligence_mode: 'assisted' });
    expect(row.getAttribute('code_intelligence_opt_in')).not.toBeTruthy();
    const workspace = (await workspaceRepository.getWorkspace(row.getAttribute('id')))!;
    await codeGraphRepository.syncProjects(workspace.id, [{ name: 'Retained', rootPath: workspace.workingDir, relativePath: '.' }]);
    const before = await codeGraphRepository.snapshot(workspace.id);
    expect(workspace.codeIntelligenceMode).toBe('disabled');
    const renamed = (await workspaceRepository.updateWorkspace(workspace.id, { name: 'Renamed without activation' }))!;
    expect(renamed.codeIntelligenceMode).toBe('disabled');
    await codeGraphIndexService.applyWorkspaceMode(renamed);
    expect(await codeGraphRepository.snapshot(workspace.id)).toEqual(before);
    expect((await AgentWorkspace.find(workspace.id))?.getAttribute('code_intelligence_mode')).toBe('assisted');
  });

  it.each(['manual', 'assisted'] as const)('preserves an explicit %s activation across reloads and unrelated updates', async codeIntelligenceMode => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'Opt in', workingDir: '/fixture' });
    await workspaceRepository.updateWorkspace(workspace.id, { codeIntelligenceMode });
    expect((await workspaceRepository.getWorkspace(workspace.id))?.codeIntelligenceMode).toBe(codeIntelligenceMode);
    expect((await workspaceRepository.updateWorkspace(workspace.id, { name: 'Renamed' }))?.codeIntelligenceMode).toBe(codeIntelligenceMode);
    await workspaceRepository.updateWorkspace(workspace.id, { codeIntelligenceMode: 'disabled' });
    expect((await workspaceRepository.getWorkspace(workspace.id))?.codeIntelligenceMode).toBe('disabled');
    expect((await AgentWorkspace.find(workspace.id))?.getAttribute('code_intelligence_opt_in')).toBe(false);
  });

  it.each([undefined, 'assisted'] as const)('imports an old workspace without activating its saved mode (%s)', async codeIntelligenceMode => {
    const directory = await mkdtemp(join(tmpdir(), 'ork-graph-import-'));
    try {
      const imported = await workspaceService.importWorkspace({ format: 'orkestrai-workspace',
        workspace: { name: 'Old export', workingDir: directory, codeIntelligenceMode }, nodes: [], edges: [] });
      expect(imported.codeIntelligenceMode).toBe('disabled');
      expect((await workspaceRepository.getWorkspace(imported.id))?.codeIntelligenceMode).toBe('disabled');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
