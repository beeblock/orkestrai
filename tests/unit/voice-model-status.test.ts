import { describe, expect, it, vi } from 'vitest';
import { voiceModelsReadyForUse } from '$lib/components/agent-room/voice-model-status.js';

function response(data: unknown, ok = true): Response {
  return {
    ok,
    json: async () => data,
  } as Response;
}

describe('voiceModelsReadyForUse', () => {
  it('usa o status real dos modelos locais mesmo com confirmacao antiga', async () => {
    const fetchFn = vi.fn(async () => response({ data: { ready: false } })) as unknown as typeof fetch;
    const settings = { voiceBackend: 'embedded', voiceModelsConfirmed: 'true' };

    await expect(voiceModelsReadyForUse(settings, fetchFn)).resolves.toBe(false);
    expect(fetchFn).toHaveBeenCalledWith('/api/agent-room/voice/models', undefined);
  });

  it('libera o motor local somente quando os arquivos estao prontos', async () => {
    const fetchFn = vi.fn(async () => response({ data: { ready: true } })) as unknown as typeof fetch;
    await expect(voiceModelsReadyForUse({ voiceBackend: 'embedded' }, fetchFn)).resolves.toBe(true);
  });

  it('sidecar nao depende dos modelos locais', async () => {
    const fetchFn = vi.fn() as unknown as typeof fetch;
    await expect(voiceModelsReadyForUse({ voiceBackend: 'sidecar' }, fetchFn)).resolves.toBe(true);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('propaga falha ao consultar o status', async () => {
    const fetchFn = vi.fn(async () => response({ error: 'falhou' }, false)) as unknown as typeof fetch;
    await expect(voiceModelsReadyForUse({ voiceBackend: 'embedded' }, fetchFn)).rejects.toThrow(
      'voice_models_status_failed'
    );
  });
});
