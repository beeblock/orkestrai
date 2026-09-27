import { realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type {
  DeviceCommandInput,
  DeviceCommandResponse,
  DeviceCommandResult,
  DevicePlatform,
  DeviceSnapshot,
  DeviceAttachment,
  DeviceRecovery,
} from '../../contracts/schemas/device.schema.js';
import { deviceAttachmentSchema } from '../../contracts/schemas/device.schema.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { AndroidDeviceAdapter } from '../adapters/devices/AndroidDeviceAdapter.js';
import { IosSimulatorAdapter } from '../adapters/devices/IosSimulatorAdapter.js';
import type { DeviceAdapter, DeviceRuntimeSession } from '../adapters/devices/types.js';
import { CreateCanvasNodeDto } from '../dto/WorkspaceDtos.js';

const IDLE_TIMEOUT_MS = 15 * 60_000;

type DeviceGlobal = typeof globalThis & {
  __orkestraiDeviceService?: DeviceService;
  __orkestraiShutdownDevices?: () => Promise<void>;
  __orkestraiStopWorkspaceDevice?: (workspaceId: string) => Promise<void>;
  __orkestraiBroadcast?: (payload: Record<string, unknown>) => void;
};

function broadcast(workspaceId: string): void {
  (globalThis as DeviceGlobal).__orkestraiBroadcast?.({ type: 'deviceChanged', workspaceId });
}

export class DeviceService {
  private readonly adapters: Map<DevicePlatform, DeviceAdapter>;
  private readonly sessions = new Map<string, DeviceRuntimeSession>();
  private lifecycle: Promise<unknown> = Promise.resolve();
  private closing = false;
  private readonly recovery = new Map<string, { key: string; result: DeviceRecovery | null }>();
  private readonly cleanupTimer: ReturnType<typeof setInterval>;

  constructor(adapters: DeviceAdapter[] = [new IosSimulatorAdapter(), new AndroidDeviceAdapter()]) {
    this.adapters = new Map(adapters.map((adapter) => [adapter.platform, adapter]));
    this.cleanupTimer = setInterval(() => void this.stopIdleSessions(), 60_000);
    this.cleanupTimer.unref?.();
    (globalThis as DeviceGlobal).__orkestraiShutdownDevices = () => this.stopAll();
    (globalThis as DeviceGlobal).__orkestraiStopWorkspaceDevice = (workspaceId) => this.stop(workspaceId);
  }

  async snapshot(workspaceId: string, touch = true): Promise<DeviceSnapshot> {
    const workspace = await this.requireWorkspace(workspaceId);
    if (touch && !workspace.suspendedAt && !this.closing && !this.sessions.has(workspaceId)) {
      await this.serial(() => this.restore(workspaceId));
    }
    const session = this.sessions.get(workspaceId) ?? null;
    if (session && touch) session.touchedAt = Date.now();
    const adapters = [...this.adapters.values()];
    const [platforms, deviceGroups] = await Promise.all([
      Promise.all(adapters.map((adapter) => adapter.availability())),
      Promise.all(adapters.map((adapter) => adapter.list().catch(() => []))),
    ]);
    return {
      nodeId: (await workspaceRepository.listNodes(workspaceId)).find(node => node.type === 'device')?.id ?? null,
      platforms,
      devices: deviceGroups.flat(),
      session: session?.public ?? null,
      recovery: this.recovery.get(workspaceId)?.result ?? null,
    };
  }

  async execute(workspaceId: string, input: DeviceCommandInput): Promise<DeviceCommandResponse> {
    const workspace = await this.requireWorkspace(workspaceId);
    let result: DeviceCommandResult | null = null;
    if (input.command === 'start') {
      await this.start(workspaceId, input.platform, input.deviceId, input.confirmPhysical);
    } else if (input.command === 'stop') {
      await this.stop(workspaceId);
    } else if (input.command === 'restart') {
      await this.restart(workspaceId);
    } else {
      const session = this.requireSession(workspaceId);
      const adapter = this.requireAdapter(session.public.platform);
      session.touchedAt = Date.now();
      const command = input.command === 'install'
        ? { ...input, path: await this.safeWorkspacePath(workspace.workingDir, input.path) }
        : input;
      result = await adapter.command(session, command, {
        workspaceRoot: workspace.workingDir,
        screenshotDirectory: join(workspace.workingDir, '.orkestrai', 'devices', 'screenshots'),
      });
      broadcast(workspaceId);
    }
    return { snapshot: await this.snapshot(workspaceId), result };
  }

  async stream(workspaceId: string, signal?: AbortSignal): Promise<Response> {
    await this.requireWorkspace(workspaceId);
    const session = this.requireSession(workspaceId);
    session.touchedAt = Date.now();
    const response = await fetch(session.streamUrl, { signal });
    if (!response.ok || !response.body) throw new Error(`Device stream unavailable (HTTP ${response.status}).`);
    return new Response(response.body, {
      status: 200,
      headers: {
        'content-type': response.headers.get('content-type') ?? 'multipart/x-mixed-replace; boundary=frame',
        'cache-control': 'no-store, no-cache, must-revalidate',
        'x-content-type-options': 'nosniff',
      },
    });
  }

  async start(
    workspaceId: string,
    platform: DevicePlatform,
    deviceId: string,
    confirmPhysical = false,
  ): Promise<void> {
    await this.serial(() => this.startDevice(workspaceId, platform, deviceId, confirmPhysical));
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.lifecycle.catch(() => undefined).then(operation);
    this.lifecycle = next.catch(() => undefined);
    return next;
  }

  private async ensureCanvasNode(workspaceId: string, attachment: DeviceAttachment, restoring = false): Promise<void> {
    const { workspaceService } = await import('./WorkspaceService.js');
    const existing = (await workspaceRepository.listNodes(workspaceId)).find(node => node.type === 'device');
    if (restoring && !existing) throw new Error('The Mobile node was removed during restoration.');
    const node = existing ?? await workspaceService.createNode(CreateCanvasNodeDto.from(workspaceId, {
      type: 'device', title: attachment.deviceName, width: 560, height: 720, payload: {},
    }));
    await workspaceRepository.updateNode(node.id, { payload: { ...node.payload, deviceAttachment: attachment } });
    this.recovery.delete(workspaceId);
  }

  private async restore(workspaceId: string): Promise<void> {
    if (this.closing || this.sessions.has(workspaceId)) return;
    const workspace = await this.requireWorkspace(workspaceId);
    if (workspace.suspendedAt) return;
    const node = (await workspaceRepository.listNodes(workspaceId)).find(node => node.type === 'device');
    const parsed = deviceAttachmentSchema.safeParse((node?.payload as Record<string, unknown> | undefined)?.deviceAttachment);
    if (!parsed.success) return;
    const attachment = parsed.data;
    const key = JSON.stringify([node!.id, attachment]);
    if (this.recovery.get(workspaceId)?.key === key) return;
    const entry: { key: string; result: DeviceRecovery | null } = { key, result: null };
    this.recovery.set(workspaceId, entry);
    const fail = (reason: DeviceRecovery['reason']) => { entry.result = { ...attachment, reason }; };
    if (attachment.physical) return fail('confirmation_required');
    try {
      const adapter = this.requireAdapter(attachment.platform);
      if (!(await adapter.availability()).available) return fail('unavailable');
      const device = (await adapter.list()).find(candidate => candidate.id === attachment.deviceId);
      if (!device?.available) return fail('unavailable');
      if (device.physical) return fail('confirmation_required');
      if ([...this.sessions.values()].some(active => active.public.platform === attachment.platform
        && (active.public.deviceId === attachment.deviceId || active.restartDeviceId === attachment.deviceId))) return fail('busy');
      await this.startDevice(workspaceId, attachment.platform, attachment.deviceId, false, true);
    } catch { fail('failed'); }
  }

  private async startDevice(workspaceId: string, platform: DevicePlatform, deviceId: string, confirmPhysical: boolean, restoring = false): Promise<void> {
    const workspace = await this.requireWorkspace(workspaceId);
    if (this.closing) throw new Error('Device service is closing.');
    if (workspace.suspendedAt) throw new Error('Workspace is suspended.');
    const adapter = this.requireAdapter(platform);
    const availability = await adapter.availability();
    if (!availability.available) throw new Error(`Device backend unavailable: ${availability.reason}.`);
    const device = (await adapter.list()).find((candidate) => candidate.id === deviceId);
    if (!device?.available) throw new Error('The selected device is no longer available.');
    if (device.physical && !confirmPhysical) {
      throw new Error('Physical Android devices require explicit user confirmation before attachment.');
    }
    const attachment: DeviceAttachment = { platform, deviceId, deviceName: device.name, physical: device.physical };

    const existing = this.sessions.get(workspaceId);
    if (existing?.public.platform === platform && existing.public.status === 'streaming'
      && (existing.public.deviceId === deviceId || existing.restartDeviceId === deviceId)) {
      await this.ensureCanvasNode(workspaceId, attachment, restoring);
      existing.touchedAt = Date.now();
      return;
    }

    for (const [ownerWorkspaceId, active] of this.sessions) {
      if (ownerWorkspaceId === workspaceId || (active.public.platform === platform
        && (active.public.deviceId === deviceId || active.restartDeviceId === deviceId))) {
        if (restoring && ownerWorkspaceId !== workspaceId) throw new Error('Device is already attached to another workspace.');
        await this.stopDevice(ownerWorkspaceId);
      }
    }

    const session = await adapter.start(workspaceId, device);
    try {
      if (this.closing || (await this.requireWorkspace(workspaceId)).suspendedAt) throw new Error('Device attachment was cancelled.');
      await this.ensureCanvasNode(workspaceId, attachment, restoring);
    }
    catch (error) { await adapter.stop(session).catch(() => undefined); throw error; }
    this.sessions.set(workspaceId, session);
    broadcast(workspaceId);
  }

  async stop(workspaceId: string): Promise<void> {
    await this.serial(() => this.stopDevice(workspaceId));
  }

  private async stopDevice(workspaceId: string, preserveAttachment = false): Promise<void> {
    if (!preserveAttachment) {
      const node = (await workspaceRepository.listNodes(workspaceId)).find(candidate => candidate.type === 'device');
      if (node) {
        const { deviceAttachment: _attachment, ...payload } = node.payload as Record<string, unknown>;
        await workspaceRepository.updateNode(node.id, { payload });
      }
      this.recovery.delete(workspaceId);
    }
    const session = this.sessions.get(workspaceId);
    if (!session) return;
    this.sessions.delete(workspaceId);
    await this.requireAdapter(session.public.platform).stop(session);
    broadcast(workspaceId);
  }

  async restart(workspaceId: string): Promise<void> {
    await this.serial(async () => {
      const session = this.requireSession(workspaceId);
      const platform = session.public.platform;
      const deviceId = session.restartDeviceId ?? session.public.deviceId;
      await this.stopDevice(workspaceId, true);
      await this.startDevice(workspaceId, platform, deviceId, true);
    });
  }

  async stopAll(): Promise<void> {
    this.closing = true;
    clearInterval(this.cleanupTimer);
    await this.serial(async () => {
      for (const workspaceId of this.sessions.keys()) await this.stopDevice(workspaceId, true).catch(() => undefined);
    });
  }

  private async stopIdleSessions(): Promise<void> {
    const cutoff = Date.now() - IDLE_TIMEOUT_MS;
    for (const [workspaceId, session] of this.sessions) {
      if (session.touchedAt < cutoff) await this.stop(workspaceId).catch(() => undefined);
    }
  }

  private requireSession(workspaceId: string): DeviceRuntimeSession {
    const session = this.sessions.get(workspaceId);
    if (!session) throw new Error('No device is attached to this workspace.');
    if (session.public.status !== 'streaming') throw new Error(session.public.lastError ?? 'The device stream is not ready.');
    return session;
  }

  private requireAdapter(platform: DevicePlatform): DeviceAdapter {
    const adapter = this.adapters.get(platform);
    if (!adapter) throw new Error(`Unsupported device platform: ${platform}.`);
    return adapter;
  }

  private async requireWorkspace(workspaceId: string) {
    const workspace = await workspaceRepository.getWorkspace(workspaceId);
    if (!workspace) throw new Error('Workspace not found.');
    return workspace;
  }

  private async safeWorkspacePath(rootInput: string, pathInput: string): Promise<string> {
    const root = await realpath(resolve(rootInput));
    const candidate = await realpath(isAbsolute(pathInput) ? resolve(pathInput) : resolve(root, pathInput));
    const distance = relative(root, candidate);
    if (distance === '..' || distance.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(distance)) {
      throw new Error('Device install paths must stay inside the workspace.');
    }
    return candidate;
  }
}

const deviceGlobal = globalThis as DeviceGlobal;
export const deviceService = (deviceGlobal.__orkestraiDeviceService ??= new DeviceService());
