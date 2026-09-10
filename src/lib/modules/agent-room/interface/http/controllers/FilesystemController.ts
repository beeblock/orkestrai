import { Controller } from '@beeblock/svelar/routing';
import { FormRequest } from '@beeblock/svelar/forms';
import {
  executeGitOperationSchema,
  fsWriteSchema,
  gitOperationInputSchema,
  gitPathSchema,
} from '$lib/modules/agent-room/contracts/schemas/fsSchemas.js';
import { filesystemService } from '$lib/modules/agent-room/application/services/FilesystemService.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.ts';
import { portalService } from '$lib/modules/agent-room/application/services/PortalService.js';
import { gitService } from '$lib/modules/agent-room/application/services/GitService.js';


class FsWriteRequest extends FormRequest {
  rules() {
    return fsWriteSchema;
  }
  authorize(): boolean {
    return true;
  }
  passedValidation(data: unknown) {
    return fsWriteSchema.parse(data);
  }
}

class GitPathRequest extends FormRequest {
  rules() {
    return gitPathSchema;
  }
  authorize(): boolean {
    return true;
  }
  passedValidation(data: unknown) {
    return gitPathSchema.parse(data);
  }
}

class GitOperationPreviewRequest extends FormRequest {
  rules() { return gitOperationInputSchema; }
  authorize(): boolean { return true; }
  passedValidation(data: unknown) { return gitOperationInputSchema.parse(data); }
}

class GitOperationExecuteRequest extends FormRequest {
  rules() { return executeGitOperationSchema; }
  authorize(): boolean { return true; }
  passedValidation(data: unknown) { return executeGitOperationSchema.parse(data); }
}

export class FilesystemController extends Controller {
  async list(event: any) {
    try {
      const path = event.url.searchParams.get('path');
      return this.json({ data: await filesystemService.list(event.params.id, path) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao listar diretório.');
    }
  }

  async read(event: any) {
    try {
      const path = event.url.searchParams.get('path');
      if (!path) throw new Error('Informe o caminho do arquivo.');
      return this.json({ data: await filesystemService.read(event.params.id, path) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao ler arquivo.', 404);
    }
  }

  async inspect(event: any) {
    try {
      const path = event.url.searchParams.get('path');
      if (!path) throw new Error('Informe o caminho do arquivo.');
      return this.json({ data: await filesystemService.inspect(event.params.id, path) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao inspecionar arquivo.', 404);
    }
  }

  async write(event: any) {
    try {
      const input = await FsWriteRequest.validate(event);
      return this.json({ data: await filesystemService.write(event.params.id, input.path, input.content) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao escrever arquivo.');
    }
  }

  async writeBinary(event: any) {
    try {
      const body = await event.request.json();
      const data = Buffer.from(String(body.base64 ?? ''), 'base64');
      return this.json({ data: await filesystemService.writeBinary(event.params.id, String(body.path ?? ''), data) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao salvar imagem.');
    }
  }

  async raw(event: any) {
    try {
      const path = event.url.searchParams.get('path');
      if (!path) throw new Error('Informe o caminho.');
      const file = await filesystemService.readBinary(event.params.id, path);
      return new Response(Buffer.from(file.data), {
        headers: {
          'content-type': file.contentType,
          'content-disposition': `${file.contentType.startsWith('image/') ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
          'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
          'x-content-type-options': 'nosniff',
          'cache-control': 'private, max-age=60',
        },
      });
    } catch (error) {
      return this.json({ error: error instanceof Error ? error.message : 'Não encontrado.' }, 404);
    }
  }

  async gitStatus(event: any) {
    try {
      return this.json({ data: await gitService.status(event.params.id) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao ler status git.');
    }
  }

  async gitDiff(event: any) {
    try {
      const path = event.url.searchParams.get('path');
      const staged = event.url.searchParams.get('staged') === 'true';
      return this.json({ data: await gitService.diff(event.params.id, path, staged) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao ler diff.');
    }
  }

  async gitFileDiff(event: any) {
    try {
      const path = event.url.searchParams.get('path');
      if (!path) throw new Error('Informe o caminho do arquivo.');
      const staged = event.url.searchParams.get('staged') === 'true';
      return this.json({ data: await gitService.fileDiff(event.params.id, path, staged) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao ler diff estruturado.');
    }
  }

  async gitLogGraph(event: any) {
    try {
      return this.json({ data: await gitService.logGraph(event.params.id) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao ler histórico.');
    }
  }

  async gitWorkspace(event: any) {
    try {
      const limit = Number(event.url.searchParams.get('limit') ?? 100);
      return this.json({ data: await gitService.workspaceSnapshot(event.params.id, limit) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao carregar o workspace Git.');
    }
  }

  async gitPreviewOperation(event: any) {
    try {
      const input = await GitOperationPreviewRequest.validate(event);
      return this.json({ data: await gitService.previewOperation(event.params.id, input) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao preparar a operação Git.');
    }
  }

  async gitExecuteOperation(event: any) {
    try {
      const input = await GitOperationExecuteRequest.validate(event);
      return this.json({ data: await gitService.executeOperation(event.params.id, input) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao executar a operação Git.');
    }
  }

  async gitStage(event: any) {
    try {
      const input = await GitPathRequest.validate(event);
      return this.json({ data: await gitService.stage(event.params.id, input.path) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao dar stage.');
    }
  }

  async gitUnstage(event: any) {
    try {
      const input = await GitPathRequest.validate(event);
      return this.json({ data: await gitService.unstage(event.params.id, input.path) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao dar unstage.');
    }
  }

  async gitCommit(event: any) {
    try {
      const body = await event.request.json();
      return this.json({ data: await gitService.commit(event.params.id, String(body.message ?? '')) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao commitar.');
    }
  }

  async gitPull(event: any) {
    try {
      return this.json({ data: await gitService.pull(event.params.id) });
    } catch (error) {
      return this.errorResponse(error, 'Falha no pull.');
    }
  }

  async gitPush(event: any) {
    try {
      return this.json({ data: await gitService.push(event.params.id) });
    } catch (error) {
      return this.errorResponse(error, 'Falha no push.');
    }
  }

  async gitCheckout(event: any) {
    try {
      const body = await event.request.json();
      return this.json({ data: await gitService.checkout(event.params.id, String(body.branch ?? '')) });
    } catch (error) {
      return this.errorResponse(error, 'Falha no checkout.');
    }
  }

  async gitCreateBranch(event: any) {
    try {
      const body = await event.request.json();
      return this.json({ data: await gitService.createBranch(event.params.id, String(body.branch ?? ''), body.checkout !== false) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao criar branch.');
    }
  }

  async gitBranches(event: any) {
    try {
      return this.json({ data: await gitService.listBranches(event.params.id) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao listar branches.');
    }
  }

  async gitStash(event: any) {
    try {
      const body = await event.request.json().catch(() => ({}));
      return this.json({ data: await gitService.stash(event.params.id, Boolean(body.pop)) });
    } catch (error) {
      return this.errorResponse(error, 'Falha no stash.');
    }
  }

  async search(event: any) {
    try {
      const query = event.url.searchParams.get('q') ?? '';
      const byContent = event.url.searchParams.get('content') === 'true';
      return this.json({ data: await filesystemService.search(event.params.id, query, { byContent }) });
    } catch (error) {
      return this.errorResponse(error, 'Falha na busca.');
    }
  }

  async writeTerminal(event: any) {
    try {
      const body = await event.request.json();
      const node = await workspaceRepository.getNode(event.params.nodeId);
      if (!node || node.workspaceId !== event.params.id || node.type !== 'terminal') {
        throw new Error('Terminal não encontrado neste workspace.');
      }
      const sessionId = (node.payload as { sessionId?: string }).sessionId;
      if (!sessionId) throw new Error('O terminal não tem sessão PTY ativa.');
      if (body.submit === true) await ptySessionManager.writeWithConfirmedSubmit(sessionId, String(body.data ?? ''));
      else ptySessionManager.writeHumanInput(sessionId, String(body.data ?? ''));
      return this.json({ data: { written: true } });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao escrever no terminal.');
    }
  }

  async drainPortalCommands(event: any) {
    try {
      return this.json({ data: portalService.drain(event.params.nodeId) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao drenar comandos.');
    }
  }

  async postPortalResult(event: any) {
    try {
      const body = await event.request.json();
      portalService.postResult(event.params.commandId, {
        id: event.params.commandId,
        ok: Boolean(body.ok),
        result: body.result,
        error: body.error,
      });
      return this.json({ data: { received: true } });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao registrar resultado.');
    }
  }

  async openInIde(event: any) {
    try {
      const workspace = await workspaceRepository.getWorkspace(event.params.id);
      if (!workspace) throw new Error('Workspace não encontrado.');
      const editors = ['code', 'cursor', 'zed', 'idea', 'subl'];
      const { execFile } = await import('node:child_process');
      for (const editor of editors) {
        const opened = await new Promise<boolean>((resolve) => {
          execFile(editor, [workspace.workingDir], (error) => resolve(!error));
        });
        if (opened) return this.json({ data: { opened: editor } });
      }
      throw new Error('Nenhuma IDE encontrada (code, cursor, zed, idea, subl).');
    } catch (error) {
      return this.errorResponse(error, 'Falha ao abrir na IDE.');
    }
  }

  async gitDiscard(event: any) {
    try {
      const input = await GitPathRequest.validate(event);
      return this.json({ data: await gitService.discard(event.params.id, input.path) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao descartar alterações.');
    }
  }

  private errorResponse(error: unknown, fallback: string, status = 400) {
    return this.json({ error: error instanceof Error ? error.message : fallback }, status);
  }
}
