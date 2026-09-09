import { afterEach, describe, expect, it } from 'vitest';
import { coreRuntimeService } from '../../src/lib/modules/agent-room/application/services/CoreRuntimeService.js';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('CoreRuntimeService', () => {
  it('requires the exact internal token and never returns it', () => {
    process.env.ORKESTRAI_CORE_TOKEN = 'core-secret-token';
    process.env.ORKESTRAI_CORE_ID = 'core-id';
    process.env.ORKESTRAI_CORE_STARTED_AT = '2026-09-09T10:00:00.000Z';
    process.env.ORKESTRAI_CORE_VERSION = '0.29.0';

    expect(coreRuntimeService.authorized(null)).toBe(false);
    expect(coreRuntimeService.authorized('wrong')).toBe(false);
    expect(coreRuntimeService.authorized('core-secret-token')).toBe(true);

    const status = coreRuntimeService.status();
    expect(status).toMatchObject({ status: 'ok', coreId: 'core-id', version: '0.29.0' });
    expect(status).not.toHaveProperty('coreToken');
  });
});
