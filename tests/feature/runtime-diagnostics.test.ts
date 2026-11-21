import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoreRuntimeController } from '$lib/modules/agent-room/interface/http/controllers/CoreRuntimeController.js';
import { requestRuntimeDiagnostics } from '$lib/modules/agent-room/infrastructure/RuntimeDiagnosticsClient.js';

vi.mock('$lib/modules/agent-room/infrastructure/RuntimeDiagnosticsClient.js', () => ({ requestRuntimeDiagnostics: vi.fn() }));

describe('owner-authenticated runtime diagnostics', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
  const event = (query = '', token = 'owner-secret') => ({ request: new Request(`http://localhost/core/health${query}`,
    { headers: { 'x-orkestrai-core-token': token } }), url: new URL(`http://localhost/core/health${query}`) }) as any;

  it('preserves ordinary health without invoking diagnostics', async () => {
    vi.stubEnv('ORKESTRAI_CORE_TOKEN', 'owner-secret');
    const response = await new CoreRuntimeController().health(event());
    expect(response.status).toBe(200); expect((await response.json()).data.status).toBe('ok');
    expect(requestRuntimeDiagnostics).not.toHaveBeenCalled();
  });

  it('authenticates before validation and admits only the two fixed operations', async () => {
    vi.stubEnv('ORKESTRAI_CORE_TOKEN', 'owner-secret');
    const controller = new CoreRuntimeController();
    expect((await controller.health(event('?diagnostics=metrics', 'workspace-token'))).status).toBe(401);
    expect((await controller.health(event('?diagnostics=Runtime.evaluate'))).status).toBe(400);
    expect(requestRuntimeDiagnostics).not.toHaveBeenCalled();
    vi.mocked(requestRuntimeDiagnostics).mockResolvedValue({ status: 'ok', mainRendererPid: 123 });
    const response = await controller.health(event('?diagnostics=metrics'));
    expect(response.status).toBe(200); expect(requestRuntimeDiagnostics).toHaveBeenLastCalledWith('metrics');
    expect((await response.json()).data.diagnostics.mainRendererPid).toBe(123);
  });

  it('reports busy, cooldown and failure distinctly instead of presenting healthy diagnostics', async () => {
    vi.stubEnv('ORKESTRAI_CORE_TOKEN', 'owner-secret');
    const controller = new CoreRuntimeController();
    for (const [status, http] of [['busy', 409], ['rate_limited', 429], ['timeout', 504], ['too_large', 413], ['unavailable', 503]] as const) {
      vi.mocked(requestRuntimeDiagnostics).mockResolvedValueOnce({ status });
      const response = await controller.health(event('?diagnostics=profile'));
      expect(response.status).toBe(http); expect((await response.json()).data.diagnostics.status).toBe(status);
    }
  });
});
