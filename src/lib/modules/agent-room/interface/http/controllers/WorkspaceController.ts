import { Controller } from '@beeblock/svelar/routing';
import { workspaceService } from '$lib/modules/agent-room/application/services/WorkspaceService.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.ts';
import { roleService } from '$lib/modules/agent-room/application/services/RoleService.js';
import { MoveWorkspaceDto } from '$lib/modules/agent-room/application/dto/WorkspaceGroupDto.js';
import { WorkspaceGroupError, workspaceGroupService } from '$lib/modules/agent-room/application/services/WorkspaceGroupService.js';
import { MoveWorkspaceRequest } from '$lib/modules/agent-room/interface/http/requests/WorkspaceGroupRequests.js';
import {
  CreateCanvasEdgeDto,
  ChangeTerminalProviderDto,
  ChangeTerminalRuntimeDto,
  CreateCanvasNodeDto,
  CreateWorkspaceDto,
  UpdateCanvasEdgeDto,
  UpdateCanvasNodeDto,
  UpdateWorkspaceDto,
} from '$lib/modules/agent-room/application/dto/WorkspaceDtos.js';
import {
  CreateCanvasEdgeRequest,
  ChangeTerminalProviderRequest,
  ChangeTerminalRuntimeRequest,
  CreateCanvasNodeRequest,
  CreateWorkspaceRequest,
  DiscoverRolesRequest,
  UpdateCanvasEdgeRequest,
  UpdateCanvasNodeRequest,
  UpdateWorkspaceRequest,
} from '$lib/modules/agent-room/interface/http/requests/WorkspaceRequests.js';

export class WorkspaceController extends Controller {
  async listWorkspaces() {
    return this.json({ data: await workspaceService.list() });
  }

  async createWorkspace(event: any) {
    try {
      const input = await CreateWorkspaceRequest.validate(event);
      const workspace = await workspaceService.create(CreateWorkspaceDto.from(input));
      return this.json({ data: workspace }, 201);
    } catch (error) {
      return this.errorResponse(error, 'Falha ao criar workspace.');
    }
  }

  async getWorkspace(event: any) {
    try {
      return this.json({ data: await workspaceService.get(event.params.id) });
    } catch (error) {
      return this.errorResponse(error, 'Workspace nao encontrado.', 404);
    }
  }

  async resumeWorkspace(event: any) {
    try {
      return this.json({ data: await workspaceService.resumeWorkspace(event.params.id) });
    } catch (error) {
      return this.errorResponse(error, 'Workspace nao encontrado.', 404);
    }
  }

  async updateWorkspace(event: any) {
    try {
      const input = await UpdateWorkspaceRequest.validate(event);
      return this.json({ data: await workspaceService.update(event.params.id, UpdateWorkspaceDto.from(input)) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao atualizar workspace.');
    }
  }

  async deleteWorkspace(event: any) {
    try {
      return this.json({ data: await workspaceService.remove(event.params.id) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao apagar workspace.');
    }
  }

  /** Move o workspace para outra pasta da barra lateral (ou a raiz). */
  async moveWorkspace(event: any) {
    try {
      const input = await MoveWorkspaceRequest.validate(event);
      await workspaceGroupService.moveWorkspace(event.params.id, MoveWorkspaceDto.from(input).groupId);
      return this.json({ data: await workspaceService.get(event.params.id) });
    } catch (error) {
      return this.json(
        { error: error instanceof WorkspaceGroupError ? error.code : 'workspace_move_failed' },
        400,
      );
    }
  }

  /**
   * Mapa workspaceId -> numero de sessoes PTY vivas (para o indicador de
   * "workspace ativo" na sidebar; workspaces sem sessao nao aparecem).
   */
  async activity() {
    const workspaces = await workspaceService.list();
    const result: Record<string, number> = {};
    for (const workspace of workspaces) {
      const nodes = await workspaceRepository.listNodes(workspace.id);
      let live = 0;
      for (const node of nodes) {
        if (node.type !== 'terminal') continue;
        const sessionId = (node.payload as { sessionId?: string }).sessionId;
        const session = sessionId ? ptySessionManager.get(sessionId) : null;
        if (session && !session.exited) live += 1;
      }
      if (live) result[workspace.id] = live;
    }
    return this.json({ data: result });
  }

  async listNodes(event: any) {
    try {
      return this.json({ data: await workspaceService.listNodes(event.params.id) });
    } catch (error) {
      return this.errorResponse(error, 'Workspace nao encontrado.', 404);
    }
  }

  async createNode(event: any) {
    try {
      const input = await CreateCanvasNodeRequest.validate(event);
      const node = await workspaceService.createNode(CreateCanvasNodeDto.from(event.params.id, input));
      return this.json({ data: node }, 201);
    } catch (error) {
      return this.errorResponse(error, 'Falha ao criar no.');
    }
  }

  /** Le um no pelo id — inclusive arquivado (o historico do kanban abre notas). */
  async getNode(event: any) {
    try {
      const node = await workspaceRepository.getNode(event.params.nodeId);
      if (!node || node.workspaceId !== event.params.id) throw new Error('No nao encontrado.');
      return this.json({ data: node });
    } catch (error) {
      return this.errorResponse(error, 'No nao encontrado.', 404);
    }
  }

  async updateNode(event: any) {
    try {
      const input = await UpdateCanvasNodeRequest.validate(event);
      return this.json({ data: await workspaceService.updateNode(UpdateCanvasNodeDto.from(event.params.nodeId, input)) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao atualizar no.');
    }
  }

  async deleteNode(event: any) {
    try {
      return this.json({ data: await workspaceService.deleteNode(event.params.id, event.params.nodeId) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao apagar no.');
    }
  }

  /** Recarrega um terminal (mata a sessao; o no recria com resume). */
  async reloadNode(event: any) {
    try {
      return this.json({ data: await workspaceService.reloadNode(event.params.id, event.params.nodeId) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao recarregar terminal.');
    }
  }

  async changeTerminalProvider(event: any) {
    try {
      const input = await ChangeTerminalProviderRequest.validate(event);
      return this.json({
        data: await workspaceService.changeTerminalProvider(
          ChangeTerminalProviderDto.from(event.params.id, event.params.nodeId, input)
        ),
      });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao trocar provider do terminal.');
    }
  }

  async changeTerminalRuntime(event: any) {
    try {
      const input = await ChangeTerminalRuntimeRequest.validate(event);
      return this.json({
        data: await workspaceService.changeTerminalRuntime(
          ChangeTerminalRuntimeDto.from(event.params.id, event.params.nodeId, input),
        ),
      });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao trocar o ambiente do terminal.');
    }
  }

  async listEdges(event: any) {
    try {
      return this.json({ data: await workspaceService.listEdges(event.params.id) });
    } catch (error) {
      return this.errorResponse(error, 'Workspace nao encontrado.', 404);
    }
  }

  async createEdge(event: any) {
    try {
      const input = await CreateCanvasEdgeRequest.validate(event);
      const edge = await workspaceService.createEdge(CreateCanvasEdgeDto.from(event.params.id, input));
      return this.json({ data: edge }, 201);
    } catch (error) {
      return this.errorResponse(error, 'Falha ao criar conexao.');
    }
  }

  async updateEdge(event: any) {
    try {
      const input = await UpdateCanvasEdgeRequest.validate(event);
      return this.json({ data: await workspaceService.updateEdge(UpdateCanvasEdgeDto.from(event.params.edgeId, input)) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao atualizar conexao.');
    }
  }

  async deleteEdge(event: any) {
    try {
      return this.json({ data: await workspaceService.deleteEdge(event.params.id, event.params.edgeId) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao apagar conexao.');
    }
  }

  async exportWorkspace(event: any) {
    try {
      return this.json({ data: await workspaceService.exportWorkspace(event.params.id) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao exportar workspace.', 404);
    }
  }

  async importWorkspace(event: any) {
    try {
      const body = await event.request.json();
      const workspace = await workspaceService.importWorkspace(body.data ?? body, body.workingDir);
      return this.json({ data: workspace }, 201);
    } catch (error) {
      return this.errorResponse(error, 'Falha ao importar workspace.');
    }
  }

  async unloadWorkspace(event: any) {
    try {
      return this.json({ data: await workspaceService.unloadWorkspace(event.params.id) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao descarregar workspace.');
    }
  }

  async listRoles(event: any) {
    try {
      return this.json({ data: await roleService.list(event.params.id) });
    } catch (error) {
      return this.errorResponse(error, 'Workspace nao encontrado.', 404);
    }
  }

  async listRoleCatalog(event: any) {
    const url = new URL(event.request.url);
    return this.json({ data: roleService.catalog(url.searchParams.get('locale')) });
  }

  async installRoleCatalogItem(event: any) {
    try {
      const body = await event.request.json().catch(() => ({}));
      return this.json({ data: await roleService.installBuiltin(event.params.id, event.params.roleId, body.locale) }, 201);
    } catch (error) {
      return this.errorResponse(error, 'Falha ao instalar responsabilidade.');
    }
  }

  async saveRole(event: any) {
    try {
      const body = await event.request.json();
      return this.json({
        data: await roleService.save(event.params.id, {
          name: String(body.name ?? ''),
          color: body.color,
          prompt: String(body.prompt ?? ''),
        }),
      });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao salvar responsabilidade.');
    }
  }

  async deleteRole(event: any) {
    try {
      const removed = await roleService.remove(event.params.id, event.params.slug);
      if (!removed) throw new Error('Responsabilidade nao encontrada.');
      return this.json({ data: { deleted: true } });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao excluir responsabilidade.', 404);
    }
  }

  async discoverRoles(event: any) {
    try {
      const input = await DiscoverRolesRequest.validate(event);
      return this.json({ data: await roleService.discover(event.params.id, input.fromDir) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao descobrir responsabilidades.');
    }
  }

  async applyRole(event: any) {
    try {
      const body = await event.request.json().catch(() => ({}));
      const mode = body.mode === 'resume' || body.mode === 'role' ? body.mode : 'fresh';
      return this.json({ data: await roleService.applyToTerminal(event.params.id, String(body.nodeId ?? ''), mode) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao aplicar responsabilidade.');
    }
  }

  private errorResponse(error: unknown, fallback: string, status = 400) {
    return this.json({ error: error instanceof Error ? error.message : fallback }, status);
  }
}
