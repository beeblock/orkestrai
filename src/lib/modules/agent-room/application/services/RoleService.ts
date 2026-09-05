import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { z } from 'zod';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { ptySessionManager } from '../../infrastructure/pty/PtySessionManager.ts';
import { builtinRoleCatalog } from '../catalogs/BuiltinRoleCatalog.js';
import type { AgentRoleLaunchContext } from '../adapters/types.js';
import { taskBoardService } from './TaskBoardService.js';
import { agentTerminalDeliveryService } from './AgentTerminalDeliveryService.js';

export type AgentRole = {
  slug: string;
  name: string;
  color: string;
  prompt: string;
};

const MAX_ROLE_FILE_BYTES = 256 * 1024;
const MAX_DISCOVERED_ROLES = 100;
const roleInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  color: z.string().trim().regex(/^#[0-9a-f]{6}$/i).default('#7C4DFF'),
  prompt: z.string().max(200_000).default(''),
});

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'role'
  );
}

function instructionFileContents(role: AgentRole): string {
  return [
    '---',
    `name: ${role.slug}`,
    `description: ${JSON.stringify(`Orkestrai workspace role: ${role.name}`)}`,
    '---',
    '',
    role.prompt.trim(),
    '',
  ].join('\n');
}

function readRoleFile(file: string, fallbackName: string, slug: string): AgentRole | null {
  try {
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.size > MAX_ROLE_FILE_BYTES) return null;
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    const parsed = roleInputSchema.safeParse({
      name: raw.name ?? fallbackName,
      color: raw.color ?? '#7C4DFF',
      prompt: raw.prompt ?? '',
    });
    return parsed.success ? { slug, ...parsed.data } : null;
  } catch {
    return null;
  }
}

/**
 * Responsabilidades (roles) de agentes: nome, cor e conjunto de instruções.
 * Portateis: ficam em `.orkestrai/roles/<slug>/role.json` (+ AGENTS.md) no
 * working_dir do workspace, entao viajam com o repositório.
 *
 * Aplicacao: uma sessão nova recebe a role pelo mecanismo nativo do provider
 * ou por referência a este arquivo. Uma sessão retomada já possui esse contexto
 * e recebe somente trabalho ainda aberto.
 */
export class RoleService {
  catalog(locale: unknown) {
    return builtinRoleCatalog(locale);
  }

  async installBuiltin(workspaceId: string, roleId: string, locale: unknown): Promise<AgentRole> {
    const template = builtinRoleCatalog(locale).find((role) => role.id === roleId);
    if (!template) throw new Error('Responsabilidade pronta não encontrada.');
    return this.save(workspaceId, template);
  }

  private async rolesDir(workspaceId: string): Promise<string> {
    const workspace = await workspaceRepository.getWorkspace(workspaceId);
    if (!workspace) throw new Error('Workspace não encontrado.');
    const current = resolve(workspace.workingDir, '.orkestrai', 'roles');
    // Legado: workspaces criados na era .pantheon/ continuam legiveis.
    if (!existsSync(current)) {
      const legacy = resolve(workspace.workingDir, '.pantheon', 'roles');
      if (existsSync(legacy)) return legacy;
    }
    return current;
  }

  async list(workspaceId: string): Promise<AgentRole[]> {
    const dir = await this.rolesDir(workspaceId);
    if (!existsSync(dir)) return [];
    const roles: AgentRole[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const file = resolve(dir, entry.name, 'role.json');
      if (!existsSync(file)) continue;
      const role = readRoleFile(file, entry.name, entry.name);
      if (role) roles.push(role);
    }
    return roles.sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(workspaceId: string, nameOrSlug: string): Promise<AgentRole | null> {
    const normalized = nameOrSlug.toLowerCase();
    const roles = await this.list(workspaceId);
    return roles.find((role) => role.slug === normalized || role.name.toLowerCase() === normalized) ?? null;
  }

  /** Resolve os dados que o adapter precisa para instalar a role no launch. */
  async launchContext(workspaceId: string, nameOrSlug: string): Promise<AgentRoleLaunchContext | null> {
    const role = await this.get(workspaceId, nameOrSlug);
    if (!role?.prompt.trim()) return null;
    return {
      name: role.name,
      prompt: role.prompt.trim(),
      instructionFile: await this.ensureInstructionFile(workspaceId, role),
    };
  }

  private async ensureInstructionFile(workspaceId: string, role: AgentRole): Promise<string> {
    const dir = resolve(await this.rolesDir(workspaceId), role.slug);
    const file = resolve(dir, 'AGENTS.md');
    const expected = instructionFileContents(role);
    mkdirSync(dir, { recursive: true });
    if (!existsSync(file) || readFileSync(file, 'utf8') !== expected) {
      writeFileSync(file, expected);
    }
    return file;
  }

  async save(workspaceId: string, input: { name: string; color?: string; prompt: string }): Promise<AgentRole> {
    const parsed = roleInputSchema.parse({ ...input, color: input.color ?? '#7C4DFF' });
    const slug = slugify(parsed.name);
    const role: AgentRole = {
      slug,
      ...parsed,
    };
    const dir = resolve(await this.rolesDir(workspaceId), slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, 'role.json'), JSON.stringify(role, null, 2));
    if (role.prompt.trim()) {
      await this.ensureInstructionFile(workspaceId, role);
    } else {
      rmSync(resolve(dir, 'AGENTS.md'), { force: true });
    }
    return role;
  }

  async edit(workspaceId: string, nameOrSlug: string, oldText: string, newText: string): Promise<AgentRole> {
    const role = await this.requireRole(workspaceId, nameOrSlug);
    if (!role.prompt.includes(oldText)) {
      throw new Error('Trecho antigo não encontrado no prompt da responsabilidade.');
    }
    return this.save(workspaceId, {
      name: role.name,
      color: role.color,
      prompt: role.prompt.replace(oldText, newText),
    });
  }

  async remove(workspaceId: string, nameOrSlug: string): Promise<boolean> {
    const role = await this.get(workspaceId, nameOrSlug);
    if (!role) return false;
    rmSync(resolve(await this.rolesDir(workspaceId), role.slug), { recursive: true, force: true });
    return true;
  }

  /**
   * Descobre roles de um diretório (ex.: repo de um colega) e importa para a
   * biblioteca do workspace. Retorna quantas foram importadas.
   */
  async discover(workspaceId: string, fromDir?: string): Promise<{ imported: number; roles: AgentRole[] }> {
    const workspace = await workspaceRepository.getWorkspace(workspaceId);
    if (!workspace) throw new Error('Workspace não encontrado.');
    const base = fromDir ?? workspace.workingDir;
    if (fromDir && !isAbsolute(fromDir)) throw new Error('O diretório de origem deve ser absoluto.');
    const source = resolve(base, '.orkestrai', 'roles');
    if (!existsSync(source)) return { imported: 0, roles: [] };

    const realBase = realpathSync(base);
    const realSource = realpathSync(source);
    const relativeSource = relative(realBase, realSource);
    if (relativeSource.startsWith('..') || isAbsolute(relativeSource)) {
      throw new Error('O diretório de roles deve permanecer dentro da pasta selecionada.');
    }

    const entries = readdirSync(realSource, { withFileTypes: true }).filter((entry) => entry.isDirectory());
    if (entries.length > MAX_DISCOVERED_ROLES) {
      throw new Error(`A pasta possui mais de ${MAX_DISCOVERED_ROLES} roles.`);
    }

    const found: AgentRole[] = [];
    for (const entry of entries) {
      const file = resolve(realSource, entry.name, 'role.json');
      if (!existsSync(file)) continue;
      const parsed = readRoleFile(file, entry.name, entry.name);
      if (parsed) found.push({ ...parsed, slug: slugify(parsed.name) });
    }

    const existing = new Set((await this.list(workspaceId)).map((role) => role.slug));
    let imported = 0;
    for (const role of found) {
      if (existing.has(role.slug)) continue;
      await this.save(workspaceId, role);
      existing.add(role.slug);
      imported += 1;
    }
    return { imported, roles: found };
  }

  /**
   * Prepara uma sessão PTY nova ou retomada. Roles só entram em conversas
   * novas; numa retomada, apenas agentes com trabalho aberto são acordados.
   */
  async applyToTerminal(
    workspaceId: string,
    nodeId: string,
    mode: 'fresh' | 'resume' | 'role' = 'fresh',
  ): Promise<{ applied: boolean; tasksDelivered: number }> {
    const node = await workspaceRepository.getNode(nodeId);
    if (!node || node.workspaceId !== workspaceId || node.type !== 'terminal') {
      throw new Error('Terminal não encontrado neste workspace.');
    }
    const payload = node.payload as {
      role?: string | null;
      roleConfiguredAtLaunch?: string;
      sessionId?: string;
      maestro?: boolean;
    };
    const role = payload.role && mode !== 'resume' ? await this.get(workspaceId, payload.role) : null;
    if (payload.role && mode !== 'resume' && !role) {
      throw new Error(`Responsabilidade "${payload.role}" não encontrada.`);
    }
    const configuredAtLaunch = Boolean(
      role
      && payload.roleConfiguredAtLaunch?.toLowerCase() === role.name.toLowerCase()
    );
    const shouldApplyRole = mode !== 'resume' && Boolean(role) && !(mode === 'fresh' && configuredAtLaunch);
    const tasks = mode === 'role'
      ? []
      : (await taskBoardService.list(workspaceId)).filter((task) => {
          if (task.status === 'done') return false;
          return task.assigneeNodeId === nodeId || (payload.maestro && !task.assigneeNodeId);
        });
    if (!shouldApplyRole && tasks.length === 0) return { applied: false, tasksDelivered: 0 };
    if (!payload.sessionId) throw new Error('O terminal ainda não tem sessão PTY.');

    const session = ptySessionManager.get(payload.sessionId);
    if (!session || session.exited) throw new Error('Sessão PTY não está ativa.');
    await ptySessionManager.waitUntilIdle(payload.sessionId);

    let applied = false;
    if (shouldApplyRole && role) {
      // Providers sem system/developer prompt nativo recebem apenas uma
      // referencia curta. O prompt completo permanece no arquivo versionavel.
      await agentTerminalDeliveryService.deliver({
        workspaceId,
        nodeId,
        sessionId: payload.sessionId,
        message: `[responsabilidade: ${role.name}] Leia e siga .orkestrai/roles/${role.slug}/AGENTS.md como sua funcao permanente neste workspace.`,
      });
      applied = true;
    }

    if (tasks.length) {
      const briefs = tasks.map((task) => {
        const images = task.images.length ? task.images.map((image) => `- ${image}`).join('\n') : '(nenhuma)';
        const ownership = task.assigneeNodeId
          ? `Responsável: ${task.assigneeTitle ?? node.title ?? nodeId}`
          : 'Responsável: ainda não atribuído';
        return [
          `#${task.id.slice(0, 8)} — ${task.title}`,
          `Etapa atual: ${task.status}`,
          ownership,
          `Descrição: ${task.description?.trim() || '(sem descrição)'}`,
          `Imagens: ${images}`,
          `Nota vinculada: ${task.noteTitle ? `${task.noteTitle} (${task.noteId})` : '(nenhuma)'}`,
        ].join('\n');
      }).join('\n\n');
      const instruction = mode === 'resume'
        ? `[retomada do workspace] Continue somente o trabalho aberto abaixo a partir do ponto em que parou. Consulte o estado atual com orkestrai task list e mantenha cada etapa atualizada.`
        : `[fila inicial do Kanban] Revise o trabalho aberto abaixo. Tarefas sem responsável devem ser atribuídas com orkestrai task assign <id> "<Agente>" antes de mensagens diretas.`;
      await agentTerminalDeliveryService.deliver({
        workspaceId,
        nodeId,
        sessionId: payload.sessionId,
        message: `${instruction}\n\n${briefs}`,
      });
    }
    return { applied, tasksDelivered: tasks.length };
  }

  private async requireRole(workspaceId: string, nameOrSlug: string): Promise<AgentRole> {
    const role = await this.get(workspaceId, nameOrSlug);
    if (!role) throw new Error(`Responsabilidade "${nameOrSlug}" não encontrada.`);
    return role;
  }
}

export const roleService = new RoleService();
