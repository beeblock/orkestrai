import { execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import WebSocket from 'ws';
import type {
  DeviceCommandInput,
  DeviceCommandResult,
  DeviceDescriptor,
  DevicePlatformAvailability,
  DeviceRuntimeState,
} from '../../../contracts/schemas/device.schema.js';
import type { DeviceAdapter, DeviceAdapterContext, DeviceRuntimeSession } from './types.js';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const MAX_COMMAND_OUTPUT = 2 * 1024 * 1024;

type SimctlDevice = {
  name?: string;
  udid?: string;
  state?: string;
  isAvailable?: boolean;
};

type ServeSimState = {
  running?: boolean;
  url?: string;
  streamUrl?: string;
  wsUrl?: string;
};

function runtimeState(value: string | undefined): DeviceRuntimeState {
  if (value === 'Booted') return 'booted';
  if (value === 'Booting') return 'booting';
  if (value === 'Shutdown') return 'shutdown';
  return 'unknown';
}

function commandEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
  };
}

async function freeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not allocate a loopback port.'));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

export class IosSimulatorAdapter implements DeviceAdapter {
  readonly platform = 'ios' as const;
  private deviceList: { value: DeviceDescriptor[]; until: number } | null = null;
  private deviceListFlight: Promise<DeviceDescriptor[]> | null = null;
  private deviceListRevision = 0;

  private cliPath(): string {
    const middleware = require.resolve('serve-sim/middleware');
    return join(dirname(middleware), 'serve-sim.js');
  }

  private async runCli(args: string[], timeout = 30_000): Promise<string> {
    const { stdout } = await execFileAsync(process.execPath, [this.cliPath(), ...args], {
      env: commandEnvironment(),
      timeout,
      maxBuffer: MAX_COMMAND_OUTPUT,
      windowsHide: true,
    });
    return stdout.trim();
  }

  private async runSimctl(args: string[], timeout = 30_000): Promise<string> {
    if (args[0] !== 'list') { this.deviceList = null; this.deviceListFlight = null; this.deviceListRevision++; }
    const { stdout } = await execFileAsync('xcrun', ['simctl', ...args], {
      timeout,
      maxBuffer: MAX_COMMAND_OUTPUT,
      windowsHide: true,
    });
    return stdout.trim();
  }

  private async helperState(deviceId: string): Promise<ServeSimState | null> {
    try {
      const output = await this.runCli(['--list', deviceId]);
      return output ? JSON.parse(output) as ServeSimState : null;
    } catch {
      return null;
    }
  }

  private async withControlSocket(
    session: DeviceRuntimeSession,
    execute: (send: (opcode: number, payload: Record<string, unknown>) => Promise<void>) => Promise<void>,
  ): Promise<void> {
    if (!session.controlUrl) throw new Error('The device control channel is unavailable.');
    const socket = new WebSocket(session.controlUrl, { handshakeTimeout: 5_000 });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out opening the device control channel.')), 5_000);
      socket.once('open', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    const send = (opcode: number, payload: Record<string, unknown>) => new Promise<void>((resolve, reject) => {
      const message = Buffer.concat([Buffer.from([opcode]), Buffer.from(JSON.stringify(payload), 'utf8')]);
      socket.send(message, (error) => error ? reject(error) : resolve());
    });
    try {
      await execute(send);
    } finally {
      socket.close();
    }
  }

  async availability(): Promise<DevicePlatformAvailability> {
    if (process.platform !== 'darwin') {
      return { platform: 'ios', available: false, reason: 'unsupported_os', detail: null, setupUrl: 'https://developer.apple.com/xcode/' };
    }
    if (process.arch !== 'arm64') {
      return { platform: 'ios', available: false, reason: 'unsupported_arch', detail: process.arch, setupUrl: 'https://developer.apple.com/xcode/' };
    }
    try {
      const devices = await this.list();
      if (!devices.length) {
        return { platform: 'ios', available: false, reason: 'runtime_missing', detail: null, setupUrl: 'https://developer.apple.com/documentation/xcode/installing-additional-simulator-runtimes' };
      }
      return { platform: 'ios', available: true, reason: 'ready', detail: null, setupUrl: null };
    } catch (error) {
      return {
        platform: 'ios',
        available: false,
        reason: 'xcode_missing',
        detail: error instanceof Error ? error.message.slice(0, 500) : null,
        setupUrl: 'https://developer.apple.com/xcode/',
      };
    }
  }

  async list(): Promise<DeviceDescriptor[]> {
    if (process.platform !== 'darwin' || process.arch !== 'arm64') return [];
    if (this.deviceList && this.deviceList.until > Date.now()) return this.deviceList.value.map(device => ({ ...device }));
    if (!this.deviceListFlight) {
      const revision = this.deviceListRevision;
      const flight = this.readDevices().then(value => {
        if (revision === this.deviceListRevision) this.deviceList = { value, until: Date.now() + 5000 };
        return value;
      });
      this.deviceListFlight = flight;
      void flight.finally(() => { if (this.deviceListFlight === flight) this.deviceListFlight = null; }).catch(() => {});
    }
    return (await this.deviceListFlight).map(device => ({ ...device }));
  }

  private async readDevices(): Promise<DeviceDescriptor[]> {
    const raw = JSON.parse(await this.runSimctl(['list', 'devices', 'available', '--json'])) as {
      devices?: Record<string, SimctlDevice[]>;
    };
    const devices: DeviceDescriptor[] = [];
    for (const [runtimeIdentifier, entries] of Object.entries(raw.devices ?? {})) {
      if (!/SimRuntime\.(iOS|watchOS|visionOS|xrOS)-/i.test(runtimeIdentifier)) continue;
      const runtime = runtimeIdentifier.replace(/^.*SimRuntime\./, '').replace(/-/g, ' ');
      for (const entry of entries) {
        if (!entry.udid || !entry.name || entry.isAvailable === false) continue;
        devices.push({
          id: entry.udid,
          name: entry.name,
          platform: 'ios',
          runtime,
          state: runtimeState(entry.state),
          available: true,
          physical: false,
        });
      }
    }
    return devices.sort((left, right) => {
      if (left.state === 'booted' && right.state !== 'booted') return -1;
      if (left.state !== 'booted' && right.state === 'booted') return 1;
      return `${left.runtime} ${left.name}`.localeCompare(`${right.runtime} ${right.name}`);
    });
  }

  async start(workspaceId: string, device: DeviceDescriptor): Promise<DeviceRuntimeSession> {
    const startedByOrkestrai = device.state !== 'booted';
    let helperStartedByOrkestrai = false;
    try {
      if (startedByOrkestrai) {
        await this.runSimctl(['boot', device.id]).catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          if (!/current state: Booted|Unable to boot device in current state: Booted/i.test(message)) throw error;
        });
      }
      await this.runSimctl(['bootstatus', device.id, '-b'], 180_000);
      let state = await this.helperState(device.id);
      if (!state?.running || !state.streamUrl || !state.url) {
        const port = await freeLoopbackPort();
        const raw = await this.runCli(['--detach', '--quiet', '--codec', 'mjpeg', '--port', String(port), device.id], 60_000);
        state = JSON.parse(raw) as ServeSimState;
        helperStartedByOrkestrai = true;
      }
      if (!state.streamUrl || !state.url) throw new Error('The simulator stream helper did not return its loopback endpoints.');
      const runtime: DeviceRuntimeSession = {
        public: {
          workspaceId,
          platform: 'ios',
          deviceId: device.id,
          deviceName: device.name,
          status: 'starting',
          orientation: 'portrait',
          startedByOrkestrai,
          attachedAt: new Date().toISOString(),
          lastError: null,
        },
        streamUrl: state.streamUrl,
        helperBaseUrl: state.streamUrl.replace(/\/stream\.mjpeg(?:\?.*)?$/, ''),
        controlUrl: state.wsUrl ?? null,
        helperStartedByOrkestrai,
        touchedAt: Date.now(),
      };
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if (await this.health(runtime)) {
          runtime.public.status = 'streaming';
          return runtime;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      throw new Error('The simulator booted, but its local stream did not become ready.');
    } catch (error) {
      if (helperStartedByOrkestrai) await this.runCli(['--kill', device.id]).catch(() => undefined);
      if (startedByOrkestrai) await this.runSimctl(['shutdown', device.id]).catch(() => undefined);
      throw error;
    }
  }

  async stop(session: DeviceRuntimeSession): Promise<void> {
    if (session.helperStartedByOrkestrai) {
      await this.runCli(['--kill', session.public.deviceId], 20_000).catch(() => undefined);
    }
    if (session.public.startedByOrkestrai) {
      await this.runSimctl(['shutdown', session.public.deviceId], 30_000).catch(() => undefined);
    }
  }

  async health(session: DeviceRuntimeSession): Promise<boolean> {
    try {
      const response = await fetch(`${session.helperBaseUrl}/health`, { signal: AbortSignal.timeout(2_000) });
      return response.ok;
    } catch {
      return false;
    }
  }

  async command(
    session: DeviceRuntimeSession,
    input: Exclude<DeviceCommandInput, { command: 'start' | 'stop' | 'restart' }>,
    context: DeviceAdapterContext,
  ): Promise<DeviceCommandResult | null> {
    const udid = session.public.deviceId;
    if (input.command === 'tap') {
      await this.runCli(['tap', String(input.x), String(input.y), '-d', udid]);
      return null;
    }
    if (input.command === 'swipe') {
      const steps = Math.max(2, Math.min(24, Math.round(input.durationMs / 35)));
      await this.runCli(['gesture', JSON.stringify({ type: 'begin', x: input.fromX, y: input.fromY }), '-d', udid]);
      for (let step = 1; step < steps; step += 1) {
        const progress = step / steps;
        await this.runCli(['gesture', JSON.stringify({
          type: 'move',
          x: input.fromX + (input.toX - input.fromX) * progress,
          y: input.fromY + (input.toY - input.fromY) * progress,
        }), '-d', udid]);
      }
      await this.runCli(['gesture', JSON.stringify({ type: 'end', x: input.toX, y: input.toY }), '-d', udid]);
      return null;
    }
    if (input.command === 'pinch') {
      const point = (distance: number, side: -1 | 1) => ({
        x: Math.max(0, Math.min(1, input.centerX + side * distance / 2)),
        y: input.centerY,
      });
      const steps = Math.max(2, Math.min(24, Math.round(input.durationMs / 35)));
      await this.withControlSocket(session, async (send) => {
        const startLeft = point(input.startDistance, -1);
        const startRight = point(input.startDistance, 1);
        await send(5, { type: 'begin', x1: startLeft.x, y1: startLeft.y, x2: startRight.x, y2: startRight.y });
        for (let step = 1; step < steps; step += 1) {
          const progress = step / steps;
          const distance = input.startDistance + (input.endDistance - input.startDistance) * progress;
          const left = point(distance, -1);
          const right = point(distance, 1);
          await send(5, { type: 'move', x1: left.x, y1: left.y, x2: right.x, y2: right.y });
          await new Promise((resolve) => setTimeout(resolve, Math.max(8, input.durationMs / steps)));
        }
        const endLeft = point(input.endDistance, -1);
        const endRight = point(input.endDistance, 1);
        await send(5, { type: 'end', x1: endLeft.x, y1: endLeft.y, x2: endRight.x, y2: endRight.y });
      });
      return null;
    }
    if (input.command === 'type') {
      await this.runCli(['type', input.text, '-d', udid]);
      return null;
    }
    if (input.command === 'button') {
      await this.runCli(['button', input.button, '-d', udid]);
      return null;
    }
    if (input.command === 'rotate') {
      await this.runCli(['rotate', input.orientation, '-d', udid]);
      session.public.orientation = input.orientation;
      return null;
    }
    if (input.command === 'install') {
      await this.runSimctl(['install', udid, input.path], 120_000);
      return null;
    }
    if (input.command === 'launch') {
      await this.runSimctl(['launch', udid, input.bundleId], 60_000);
      return null;
    }
    if (input.command === 'screenshot') {
      await mkdir(context.screenshotDirectory, { recursive: true });
      const path = join(context.screenshotDirectory, `${new Date().toISOString().replace(/[:.]/g, '-')}.png`);
      await this.runSimctl(['io', udid, 'screenshot', path], 30_000);
      return { kind: 'screenshot', path };
    }
    if (input.command === 'logs') {
      const { stdout = '', stderr = '' } = await execFileAsync('xcrun', [
        'simctl', 'spawn', udid, 'log', 'show', '--last', `${input.minutes}m`, '--style', 'compact',
      ], { timeout: 30_000, maxBuffer: MAX_COMMAND_OUTPUT, windowsHide: true }).catch((error) => ({
        stdout: String((error as { stdout?: string }).stdout ?? ''),
        stderr: String((error as { stderr?: string }).stderr ?? (error instanceof Error ? error.message : error)),
      }));
      const combined = `${stdout}${stderr ? `\n${stderr}` : ''}`.trim();
      const limit = 120_000;
      return { kind: 'logs', content: combined.slice(-limit), truncated: combined.length > limit };
    }
    if (input.command === 'tree') {
      let response: Response | null = null;
      for (let attempt = 0; attempt < 12; attempt += 1) {
        response = await fetch(`${session.helperBaseUrl}/ax`, { signal: AbortSignal.timeout(15_000) });
        if (response.ok || response.status !== 503) break;
        await response.body?.cancel().catch(() => undefined);
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      if (!response) throw new Error('Accessibility tree unavailable.');
      if (!response.ok) throw new Error(`Accessibility tree unavailable (HTTP ${response.status}).`);
      const raw = await response.text();
      const limit = 250_000;
      if (raw.length > limit) {
        return { kind: 'tree', tree: { preview: raw.slice(0, limit) }, truncated: true };
      }
      return { kind: 'tree', tree: JSON.parse(raw), truncated: false };
    }
    if (input.command === 'permissions') {
      const args = ['permissions', input.action];
      if (input.action === 'list') {
        if (input.bundleId) args.push(input.bundleId);
      } else {
        const permission = input.permission ?? (input.action === 'reset' ? 'all' : null);
        if (!permission || !input.bundleId) {
          throw new Error('Permission changes require a permission and bundle id.');
        }
        args.push(permission, input.bundleId);
        if (input.value) args.push('--value', input.value);
      }
      args.push('-d', udid);
      const content = await this.runCli(args, 30_000);
      const limit = 120_000;
      return { kind: 'permissions', content: content.slice(-limit), truncated: content.length > limit };
    }
    return null;
  }
}
