import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { filesystemService } from '$lib/modules/agent-room/application/services/FilesystemService.js';
import { autonomyPolicyService } from '$lib/modules/agent-room/application/services/AutonomyPolicyService.js';
import { bridgeService } from '$lib/modules/agent-room/application/services/BridgeService.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.js';
import { BridgeController } from '$lib/modules/agent-room/interface/http/controllers/BridgeController.js';
import { OpenWorkspaceFolderDto } from '$lib/modules/agent-room/application/dto/OpenWorkspaceFolderDto.js';
import { openDesktopFolder } from '$lib/modules/agent-room/infrastructure/DesktopFolderClient.js';

vi.mock('$lib/modules/agent-room/infrastructure/DesktopFolderClient.js', () => ({ openDesktopFolder: vi.fn() }));

describe('Authenticated workspace folder opening', () => {
  useSvelarTest({ refreshDatabase: true });
  let root: string;
  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'ork-folder-service-')));
    await mkdir(join(root, 'project'));
    await mkdir(join(root, 'assets'));
    vi.mocked(openDesktopFolder).mockReset().mockResolvedValue();
  });
  afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });
  const workspace = () => workspaceRepository.createWorkspace({ name: 'Folder regression', workingDir: join(root, 'project'), repositoryRoots: [{ alias: 'assets', path: join(root, 'assets') }] });

  it('opens project and approved repository folders without creating or enabling Computer, with audit', async () => {
    const ws = await workspace();
    for (const path of ['.', '@assets']) {
      await expect(filesystemService.openFolder(new OpenWorkspaceFolderDto(ws.id, 'agent', path))).resolves.toEqual({ opened: true, path });
    }
    expect(openDesktopFolder).toHaveBeenCalledWith(join(root, 'assets'), join(root, 'assets'));
    expect(await workspaceRepository.listNodes(ws.id)).toEqual([]);
    const events = await autonomyPolicyService.listAudit(ws.id);
    expect(events.filter(event => event.capability === 'filesystem' && event.eventType === 'completed')).toHaveLength(2);
    expect(await autonomyPolicyService.verifyAudit(ws.id)).toMatchObject({ valid: true });
  });
  it('rejects unregistered roots, traversal and files before opening', async () => {
    const ws = await workspace();
    await writeFile(join(root, 'project', 'file.txt'), 'hello');
    for (const path of ['../assets', '@other', 'file.txt']) await expect(filesystemService.openFolder(new OpenWorkspaceFolderDto(ws.id, 'agent', path))).rejects.toThrow();
    expect(openDesktopFolder).not.toHaveBeenCalled();
  });
  it('preserves emergency stop and explicit capability restrictions', async () => {
    const ws = await workspace();
    const current = await autonomyPolicyService.get(ws.id);
    await autonomyPolicyService.update(ws.id, { enabled: true, mode: 'bounded', policy: { ...current.policy, capabilities: [] } });
    await expect(filesystemService.openFolder(new OpenWorkspaceFolderDto(ws.id, 'agent', '.'))).rejects.toThrow();
    await autonomyPolicyService.emergencyStop(ws.id);
    await expect(filesystemService.openFolder(new OpenWorkspaceFolderDto(ws.id, 'agent', '.'))).rejects.toThrow();
    expect(openDesktopFolder).not.toHaveBeenCalled();
  });
  it('audits desktop failures without falsely completing', async () => {
    const ws = await workspace();
    vi.mocked(openDesktopFolder).mockRejectedValue(new Error('Desktop unavailable'));
    await expect(filesystemService.openFolder(new OpenWorkspaceFolderDto(ws.id, 'agent', '.'))).rejects.toThrow('Desktop unavailable');
    const events = await autonomyPolicyService.listAudit(ws.id);
    expect(events.some(event => event.eventType === 'failed')).toBe(true);
    expect(events.some(event => event.eventType === 'completed')).toBe(false);
  });
  it('authenticates both workspace and agent and rejects body identity spoofing', async () => {
    const ws = await workspace();
    const resolve = vi.spyOn(bridgeService, 'resolveWorkspaceByToken').mockImplementation(async token => {
      if (token !== 'workspace-token') throw new Error('Invalid token');
      return ws;
    });
    const actor = vi.spyOn(ptySessionManager, 'resolveBridgeAgent').mockReturnValue(null);
    const event = (body: unknown, token = 'workspace-token') => ({ params: {}, url: new URL('http://localhost/api'), request: new Request('http://localhost/api', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-orkestrai-agent-token': 'agent-token' }, body: JSON.stringify(body) }) });
    const controller = new BridgeController();
    expect((await controller.fsOpenFolder(event({ path: '.' }))).status).toBe(403);
    actor.mockReturnValue('real-agent');
    expect((await controller.fsOpenFolder(event({ path: '.', from: 'other-agent' }))).status).toBeGreaterThanOrEqual(400);
    expect((await controller.fsOpenFolder(event({ path: '/tmp' }))).status).toBeGreaterThanOrEqual(400);
    expect((await controller.fsOpenFolder(event({ path: '.' }, 'wrong'))).status).toBeGreaterThanOrEqual(400);
    expect(openDesktopFolder).not.toHaveBeenCalled();
    const response = await controller.fsOpenFolder(event({ path: '.' }));
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ opened: true, path: '.' });
    expect(actor).toHaveBeenCalledWith(ws.id, 'agent-token');
    expect(resolve).toHaveBeenCalledWith('workspace-token');
  });
});
