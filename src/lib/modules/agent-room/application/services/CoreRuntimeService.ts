import { timingSafeEqual } from 'node:crypto';

function sameSecret(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export type CoreRuntimeStatus = {
  status: 'ok';
  coreId: string;
  pid: number;
  startedAt: string;
  uptimeSeconds: number;
  version: string;
};

export class CoreRuntimeService {
  authorized(token: string | null): boolean {
    const expected = process.env.ORKESTRAI_CORE_TOKEN ?? '';
    return Boolean(expected && token && sameSecret(expected, token));
  }

  status(): CoreRuntimeStatus {
    return {
      status: 'ok',
      coreId: process.env.ORKESTRAI_CORE_ID ?? 'development',
      pid: process.pid,
      startedAt: process.env.ORKESTRAI_CORE_STARTED_AT ?? new Date(Date.now() - process.uptime() * 1000).toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      version: process.env.ORKESTRAI_CORE_VERSION ?? 'development',
    };
  }
}

export const coreRuntimeService = new CoreRuntimeService();
