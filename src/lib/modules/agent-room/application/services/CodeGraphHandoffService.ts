import { CreateAgentReviewDto } from '../dto/AgentReviewDto.js';
import type {
  CodeGraphChangeIntelligence,
  CodeGraphChangeScope,
  CodeGraphFloorConflict,
  CodeGraphHandoffOptions,
  CodeGraphHandoffResult,
} from '../../domain/code-graph.js';
import { reviewCenterService } from './ReviewCenterService.js';
import { taskBoardService } from './TaskBoardService.js';
import { codeGraphChangeIntelligenceService } from './CodeGraphChangeIntelligenceService.js';
import { codeGraphIndexService } from './CodeGraphIndexService.js';
import { gitService } from './GitService.js';

type Locale = CodeGraphHandoffOptions['locale'];

const COPY = {
  en: {
    scopeMissing: 'The selected change scope no longer exists. Refresh Changes and try again.',
    noPrimary: 'This scope has no current changes in the primary Git working tree. Create a task for a Floor or sibling repository instead.',
    mixedRoots: 'This scope includes changes from more than one repository. Create a task for the complete impact, or narrow the review to the primary repository.',
    tooMany: 'The primary working tree has more than 500 changed files. Narrow the change set before creating a review.',
    summary: (scope: string, files: number, direct: number, impacted: number) => `${scope}: ${files} changed files, ${direct} directly changed symbols, and ${impacted} symbols in the bounded impact graph.`,
    evidence: (files: number, direct: number, impacted: number) => [`Changed files: ${files}`, `Directly changed symbols: ${direct}`, `Affected symbols in bounded graph: ${impacted}`],
    tests: 'Likely tests',
    risks: 'Cross-Floor risks',
    files: 'Changed files',
    symbols: 'Directly changed symbols',
    none: 'None',
    conflictEvidence: (files: number, symbols: number, tests: number) => `${files} files, ${symbols} symbols, ${tests} tests`,
    truncated: 'The evidence is bounded; open Changes for the complete visible result.',
  },
  'pt-BR': {
    scopeMissing: 'O escopo de mudanças selecionado não existe mais. Atualize Mudanças e tente novamente.',
    noPrimary: 'Este escopo não possui mudanças atuais no working tree Git principal. Crie uma tarefa para um Floor ou repositório irmão.',
    mixedRoots: 'Este escopo inclui mudanças de mais de um repositório. Crie uma tarefa para o impacto completo ou restrinja a revisão ao repositório principal.',
    tooMany: 'O working tree principal tem mais de 500 arquivos alterados. Reduza o conjunto antes de criar a revisão.',
    summary: (scope: string, files: number, direct: number, impacted: number) => `${scope}: ${files} arquivos alterados, ${direct} símbolos alterados diretamente e ${impacted} símbolos no grafo de impacto limitado.`,
    evidence: (files: number, direct: number, impacted: number) => [`Arquivos alterados: ${files}`, `Símbolos alterados diretamente: ${direct}`, `Símbolos afetados no grafo limitado: ${impacted}`],
    tests: 'Testes prováveis',
    risks: 'Riscos entre Floors',
    files: 'Arquivos alterados',
    symbols: 'Símbolos alterados diretamente',
    none: 'Nenhum',
    conflictEvidence: (files: number, symbols: number, tests: number) => `${files} arquivos, ${symbols} símbolos, ${tests} testes`,
    truncated: 'A evidência é limitada; abra Mudanças para ver o resultado visível completo.',
  },
  es: {
    scopeMissing: 'El alcance de cambios seleccionado ya no existe. Actualiza Cambios e inténtalo de nuevo.',
    noPrimary: 'Este alcance no tiene cambios actuales en el working tree Git principal. Crea una tarea para un Floor o repositorio hermano.',
    mixedRoots: 'Este alcance incluye cambios de más de un repositorio. Crea una tarea para el impacto completo o limita la revisión al repositorio principal.',
    tooMany: 'El working tree principal tiene más de 500 archivos cambiados. Reduce el conjunto antes de crear la revisión.',
    summary: (scope: string, files: number, direct: number, impacted: number) => `${scope}: ${files} archivos cambiados, ${direct} símbolos cambiados directamente y ${impacted} símbolos en el grafo de impacto limitado.`,
    evidence: (files: number, direct: number, impacted: number) => [`Archivos cambiados: ${files}`, `Símbolos cambiados directamente: ${direct}`, `Símbolos afectados en el grafo limitado: ${impacted}`],
    tests: 'Tests probables',
    risks: 'Riesgos entre Floors',
    files: 'Archivos cambiados',
    symbols: 'Símbolos cambiados directamente',
    none: 'Ninguno',
    conflictEvidence: (files: number, symbols: number, tests: number) => `${files} archivos, ${symbols} símbolos, ${tests} tests`,
    truncated: 'La evidencia está limitada; abre Cambios para ver el resultado visible completo.',
  },
} satisfies Record<Locale, Record<string, unknown>>;

function conflictsFor(scope: CodeGraphChangeScope, conflicts: CodeGraphFloorConflict[]): CodeGraphFloorConflict[] {
  if (scope.kind === 'workspace') return conflicts;
  return conflicts.filter((conflict) => conflict.leftFloorId === scope.floorId || conflict.rightFloorId === scope.floorId);
}

function conflictLine(conflict: CodeGraphFloorConflict, copy: (typeof COPY)[Locale]): string {
  const evidence = copy.conflictEvidence(
    conflict.sharedPaths.length,
    conflict.sharedSymbolIds.length + conflict.sharedImpactSymbolIds.length,
    conflict.sharedTests.length,
  );
  return `${conflict.leftFloorName} ↔ ${conflict.rightFloorName}: ${evidence}`;
}

function directSymbols(scope: CodeGraphChangeScope): string[] {
  const direct = new Set(scope.changedSymbolIds);
  return scope.impact.nodes
    .filter((symbol) => direct.has(symbol.id) && symbol.kind !== 'module')
    .map((symbol) => `${symbol.qualifiedName}${symbol.path ? ` (${symbol.path}:${symbol.startLine})` : ''}`)
    .slice(0, 50);
}

export class CodeGraphHandoffService {
  async create(
    workspaceId: string,
    options: CodeGraphHandoffOptions,
    actor: 'user' | 'agent' = 'user',
  ): Promise<CodeGraphHandoffResult> {
    const copy = COPY[options.locale];
    const analysis = await codeGraphChangeIntelligenceService.analyze(workspaceId);
    const scope = analysis.scopes.find((candidate) => candidate.id === options.scopeId);
    if (!scope) throw new Error(copy.scopeMissing as string);

    if (options.kind === 'review') return this.createReview(workspaceId, scope, analysis, options, copy);
    const task = await taskBoardService.create(workspaceId, {
      title: options.title,
      description: this.taskDescription(scope, analysis, copy),
      createdBy: actor,
      status: 'todo',
      dispatch: false,
    });
    return { kind: 'task', scopeId: scope.id, artifact: { id: task.id, title: task.title, status: task.status } };
  }

  private async createReview(
    workspaceId: string,
    scope: CodeGraphChangeScope,
    analysis: CodeGraphChangeIntelligence,
    options: CodeGraphHandoffOptions,
    copy: (typeof COPY)[Locale],
  ): Promise<CodeGraphHandoffResult> {
    if (scope.kind !== 'workspace') throw new Error(copy.noPrimary as string);
    const snapshot = await codeGraphIndexService.status(workspaceId);
    const primary = snapshot.projects.find((project) => project.relativePath === '.');
    if (!primary) throw new Error(copy.noPrimary as string);
    const primaryFiles = scope.files.filter((file) => file.projectId === primary.id);
    if (scope.files.some((file) => file.projectId !== primary.id)) throw new Error(copy.mixedRoots as string);
    const git = await gitService.status(workspaceId);
    const currentPaths = new Set(git.changes.map((change) => change.path));
    const selectedPaths = [...new Set(primaryFiles.map((file) => file.path).filter((path) => currentPaths.has(path)))];
    if (!selectedPaths.length) throw new Error(copy.noPrimary as string);
    if (selectedPaths.length > 500) throw new Error(copy.tooMany as string);
    const directIds = new Set(primaryFiles.flatMap((file) => file.symbolIds));
    const impacted = scope.impact.nodes.filter((symbol) => symbol.projectId === primary.id);
    const likelyTests = [...new Set(impacted.flatMap((symbol) => {
      if (!symbol.path || !/(?:^|\/)(?:test|tests|__tests__|spec)(?:\/|$)|\.(?:test|spec)\.[^/]+$/i.test(symbol.path)) return [];
      return [symbol.path];
    }))].sort().slice(0, 50);
    const conflicts = conflictsFor(scope, analysis.conflicts).map((conflict) => conflictLine(conflict, copy)).slice(0, 50);
    const review = await reviewCenterService.create(workspaceId, new CreateAgentReviewDto(
      options.title,
      copy.summary(scope.name, selectedPaths.length, directIds.size, impacted.length),
      null,
      null,
      selectedPaths,
      [...copy.evidence(selectedPaths.length, directIds.size, impacted.length), ...(scope.truncated ? [copy.truncated as string] : [])].slice(0, 50),
      likelyTests,
      conflicts,
    ));
    return { kind: 'review', scopeId: scope.id, artifact: { id: review.id, title: review.title, status: review.status } };
  }

  private taskDescription(
    scope: CodeGraphChangeScope,
    analysis: CodeGraphChangeIntelligence,
    copy: (typeof COPY)[Locale],
  ): string {
    const files = scope.files.slice(0, 100).map((file) => `- [${file.status}] ${file.projectName}/${file.path}`);
    const symbols = directSymbols(scope).map((symbol) => `- ${symbol}`);
    const tests = scope.likelyTests.slice(0, 50).map((path) => `- ${path}`);
    const risks = conflictsFor(scope, analysis.conflicts).slice(0, 50).map((conflict) => `- ${conflictLine(conflict, copy)}`);
    return [
      copy.summary(scope.name, scope.files.length, scope.changedSymbolIds.length, scope.impact.nodes.length),
      '', `## ${copy.files}`, ...(files.length ? files : [`- ${copy.none}`]),
      '', `## ${copy.symbols}`, ...(symbols.length ? symbols : [`- ${copy.none}`]),
      '', `## ${copy.tests}`, ...(tests.length ? tests : [`- ${copy.none}`]),
      '', `## ${copy.risks}`, ...(risks.length ? risks : [`- ${copy.none}`]),
      ...(scope.truncated || scope.files.length > files.length ? ['', `> ${copy.truncated}`] : []),
    ].join('\n').slice(0, 24_000);
  }
}

export const codeGraphHandoffService = new CodeGraphHandoffService();
