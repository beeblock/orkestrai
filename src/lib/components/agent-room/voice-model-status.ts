/** O sidecar nao usa os modelos locais; no backend embarcado, o disco e a fonte de verdade. */
export async function voiceModelsReadyForUse(
  settings: Record<string, string>,
  fetchFn: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<boolean> {
  if (settings.voiceBackend === 'sidecar') return true;

  const response = await fetchFn('/api/agent-room/voice/models', signal ? { signal } : undefined);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) throw new Error('voice_models_status_failed');
  return payload.data?.ready === true;
}
