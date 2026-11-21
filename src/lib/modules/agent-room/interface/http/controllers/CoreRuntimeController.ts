import { Controller, type RequestEvent } from '@beeblock/svelar/routing';
import { coreRuntimeService } from '../../../application/services/CoreRuntimeService.js';
import { requestRuntimeDiagnostics } from '../../../infrastructure/RuntimeDiagnosticsClient.js';
import { z } from 'zod/v3';

const diagnosticsQuery = z.enum(['metrics', 'profile']);

export class CoreRuntimeController extends Controller {
  async health(event: RequestEvent) {
    const token = event.request.headers.get('x-orkestrai-core-token');
    if (!coreRuntimeService.authorized(token)) {
      return this.json({ error: 'Unauthorized Core health request.' }, 401);
    }
    const mode = (event.url ?? new URL(event.request.url)).searchParams.get('diagnostics');
    if (mode === null) return this.json({ data: coreRuntimeService.status() });
    const query = diagnosticsQuery.safeParse(mode);
    if (!query.success) return this.json({ error: 'INVALID_RUNTIME_DIAGNOSTICS_QUERY' }, 400);
    const result = await requestRuntimeDiagnostics(query.data);
    const status = result.status === 'ok' ? 200 : result.status === 'busy' ? 409
      : result.status === 'rate_limited' ? 429 : result.status === 'too_large' ? 413
        : result.status === 'timeout' ? 504 : 503;
    return this.json({ data: { ...coreRuntimeService.status(), diagnostics: result } }, status);
  }
}
