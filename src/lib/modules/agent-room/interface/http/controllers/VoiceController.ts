import { Controller } from '@beeblock/svelar/routing';
import { voiceService } from '$lib/modules/agent-room/application/services/VoiceService.js';
import { settingsService } from '$lib/modules/agent-room/application/services/SettingsService.js';
import { workspaceService } from '$lib/modules/agent-room/application/services/WorkspaceService.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { lastReplyText } from '$lib/modules/agent-room/infrastructure/transcript/AgentTranscript.js';
import {
  deleteEmbeddedModels,
  embeddedDownloadStatus,
  embeddedModelsSize,
  ensureEmbeddedModels,
} from '$lib/modules/agent-room/infrastructure/voice/EmbeddedVoice.js';
import { z } from 'zod/v3';

const speakSchema = z.object({
  text: z.string().trim().min(1, 'Informe o texto.'),
  voice: z.string().trim().nullish(),
  speed: z.coerce.number().min(0.75).max(1.5).optional(),
});

/** Proxy do sidecar de voz (evita CORS e centraliza a URL configuravel). */
export class VoiceController extends Controller {
  async health() {
    try {
      return this.json({ data: await voiceService.health() });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao consultar o sidecar de voz.');
    }
  }

  /** Inicia o download dos modelos embarcados (compartilhado, idempotente). */
  async downloadModels() {
    try {
      void ensureEmbeddedModels().catch(() => {});
      return this.json({ data: embeddedDownloadStatus() }, 202);
    } catch (error) {
      return this.errorResponse(error, 'Falha ao iniciar o download.');
    }
  }

  /** Estado do download + tamanho em disco (polling da modal e Configuracoes). */
  async modelsStatus() {
    return this.json({ data: { ...embeddedDownloadStatus(), bytes: embeddedModelsSize() } });
  }

  /** Apaga os modelos para liberar espaco (proximo uso baixa de novo). */
  async deleteModels() {
    deleteEmbeddedModels();
    await settingsService.set('voiceModelsConfirmed', 'false');
    return this.json({ data: { deleted: true } });
  }

  async transcribe(event: any) {
    try {
      const form = await event.request.formData();
      const file = form.get('file');
      if (!(file instanceof File)) return this.errorResponse(new Error('Envie o audio em "file".'), 'Audio ausente.', 422);
      const language = typeof form.get('language') === 'string' ? String(form.get('language')) : null;
      const audio = Buffer.from(await file.arrayBuffer());
      const text = await voiceService.transcribe(audio, file.name || 'audio.webm', language);
      return this.json({ data: { text } });
    } catch (error) {
      return this.errorResponse(error, 'Falha na transcricao.');
    }
  }

  async speak(event: any) {
    try {
      const input = speakSchema.parse(await event.request.json());
      const audio = await voiceService.speak(input.text, input.voice ?? undefined, input.speed);
      return new Response(new Uint8Array(audio), {
        headers: { 'content-type': 'audio/wav', 'cache-control': 'no-store' },
      });
    } catch (error) {
      return this.errorResponse(error, 'Falha na sintese de voz.');
    }
  }

  /**
   * Ultima resposta do agente pelo transcrito da CLI (JSONL limpo, sem TUI) —
   * fonte do texto falado no ciclo de ditado. null = cair na raspagem de tela.
   */
  async replyText(event: any) {
    try {
      const workspaceId = String(event.url.searchParams.get('workspaceId') ?? '');
      const nodeId = String(event.url.searchParams.get('nodeId') ?? '');
      const node = await workspaceRepository.getNode(nodeId);
      if (!node || node.workspaceId !== workspaceId) return this.json({ data: { text: null } });
      const payload = (node.payload ?? {}) as { provider?: string; agentSessionId?: string; cwd?: string };
      if (!payload.provider || !payload.agentSessionId) return this.json({ data: { text: null } });
      const cwd = payload.cwd ?? (await workspaceService.get(workspaceId)).workingDir;
      return this.json({ data: { text: await lastReplyText(payload.provider, cwd, payload.agentSessionId) } });
    } catch {
      return this.json({ data: { text: null } });
    }
  }

  private errorResponse(error: unknown, fallback: string, status = 400) {
    return this.json({ error: error instanceof Error ? error.message : fallback }, status);
  }
}
