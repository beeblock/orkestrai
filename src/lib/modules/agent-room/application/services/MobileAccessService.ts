import { createHash, randomBytes } from 'node:crypto';
import { settingsService } from './SettingsService.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';

type MobileGateway = {
  status: () => { running: boolean; port: number | null; addresses: string[] };
  start: (options: { port: number; tokenHash: string }) => Promise<{ running: boolean; port: number | null; addresses: string[] }>;
  stop: () => Promise<{ running: boolean; port: number | null; addresses: string[] }>;
};

export type MobileAccessStatus = {
  available: boolean;
  enabled: boolean;
  running: boolean;
  port: number;
  addresses: string[];
};

const ENABLED = 'mobileAccessEnabled';
const PORT = 'mobileAccessPort';
const TOKEN_HASH = 'mobileAccessTokenHash';
const DEFAULT_PORT = 7420;

function gateway(): MobileGateway | null {
  return (globalThis as { __orkestraiMobileGateway?: MobileGateway }).__orkestraiMobileGateway ?? null;
}

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Phone access on the local network. The pairing token is shown once, inside
 * the pairing link, and only its hash is stored; pairing again replaces it and
 * signs out the previous phone.
 */
export class MobileAccessService {
  private async port(): Promise<number> {
    const value = Number(await settingsService.get(PORT));
    return Number.isInteger(value) && value >= 1024 && value <= 65535 ? value : DEFAULT_PORT;
  }

  async status(): Promise<MobileAccessStatus> {
    const current = gateway()?.status();
    return {
      available: Boolean(gateway()),
      enabled: (await settingsService.get(ENABLED)) === 'true',
      running: Boolean(current?.running),
      port: current?.port ?? await this.port(),
      addresses: current?.addresses ?? [],
    };
  }

  /** Turns phone access on with a new pairing token and returns the links that carry it. */
  async pair(port?: number): Promise<MobileAccessStatus & { links: string[] }> {
    const target = gateway();
    if (!target) throw new Error('O acesso pelo celular está disponível no app instalado.');
    const chosen = port && Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : await this.port();
    const token = randomBytes(24).toString('base64url');
    const tokenHash = hash(token);
    const running = await target.start({ port: chosen, tokenHash });
    await settingsService.set(PORT, String(chosen));
    await settingsService.set(TOKEN_HASH, tokenHash);
    await settingsService.set(ENABLED, 'true');
    return {
      ...(await this.status()),
      links: running.addresses.map((address) => `http://${address}:${chosen}/m#t=${token}`),
    };
  }

  async disable(): Promise<MobileAccessStatus> {
    await gateway()?.stop();
    await settingsService.set(ENABLED, 'false');
    await settingsService.set(TOKEN_HASH, '');
    return this.status();
  }

  /** Restores phone access at boot for an already paired phone. */
  async resume(): Promise<void> {
    const target = gateway();
    if (!target || (await settingsService.get(ENABLED)) !== 'true') return;
    const tokenHash = await settingsService.get(TOKEN_HASH);
    if (!tokenHash) return;
    await target.start({ port: await this.port(), tokenHash }).catch((error) => {
      console.warn('[mobile] Phone access could not start:', error instanceof Error ? error.message : error);
    });
  }

  /** What the phone needs to start: its language and the workspaces it can open. */
  async session(): Promise<{ locale: string; workspaces: Array<{ id: string; name: string }> }> {
    const workspaces = await workspaceRepository.listWorkspaces();
    return {
      locale: (await settingsService.get('uiLanguage')) || 'pt-BR',
      workspaces: workspaces.filter((workspace) => !workspace.suspendedAt).map((workspace) => ({ id: workspace.id, name: workspace.name })),
    };
  }
}

export const mobileAccessService = new MobileAccessService();
