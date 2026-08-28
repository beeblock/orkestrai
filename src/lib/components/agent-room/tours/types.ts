/** Tipos do motor de tours guiados (onboarding interativo por caso de uso). */

export type TourPosition = { x: number; y: number };

export type TourAction =
  | { kind: 'createAgent'; title: string; provider: string; leader?: boolean; position?: TourPosition }
  | { kind: 'createNote'; title: string; content: string; position?: TourPosition }
  | { kind: 'createTasksBoard' }
  | { kind: 'createUsage'; title: string }
  | { kind: 'createApiClient'; title: string }
  | {
      kind: 'createImageWorkflow';
      title: string;
      prompt: string;
      count?: number;
      transparentBackground?: boolean;
      outputDirectory?: string;
      filePrefix?: string;
      position?: TourPosition;
    }
  | {
      kind: 'createSampleImage';
      title: string;
      path: string;
      label: string;
      background: string;
      foreground: string;
      position?: TourPosition;
    }
  | { kind: 'connectWorkflowOutput'; fromWorkflowTitle: string; outputIndex: number; toWorkflowTitle: string }
  | { kind: 'runImageWorkflow'; title: string }
  | { kind: 'createShape'; title: string; shape?: 'rectangle' | 'rounded' | 'ellipse' | 'diamond' | 'arrow' }
  | { kind: 'createDevice'; title: string }
  | { kind: 'createDesign'; title: string }
  | { kind: 'createTask'; title: string; assigneeTitle?: string }
  | { kind: 'connect'; fromTitle: string; toTitle: string }
  | { kind: 'createPortal'; url: string; title?: string }
  | { kind: 'createFlow'; title: string; steps: Array<{ kind: 'agent' | 'approval'; target?: string; prompt?: string }> }
  | { kind: 'createRoutine'; targetTitle: string; prompt: string; intervalMinutes?: number | null }
  | { kind: 'createFloor'; name: string }
  | { kind: 'installMcp'; key: string }
  | { kind: 'openCouncil' }
  | { kind: 'openSharing' }
  | { kind: 'openDesign'; title: string }
  | { kind: 'createDesignExploration'; title: string; objective: string; audience: string }
  | { kind: 'openPage'; path: string };

export type TourCheck =
  | { kind: 'nodeExists'; nodeType: string; titleIncludes?: string }
  | { kind: 'edgeExists'; fromTitle: string; toTitle: string }
  | { kind: 'taskExists'; titleIncludes: string }
  | { kind: 'mcpInstalled'; name: string }
  | { kind: 'floorExists'; nameIncludes: string }
  | { kind: 'routineExists' }
  | { kind: 'flowRunFinished' }
  | { kind: 'imageWorkflowSucceeded'; title: string; minOutputs?: number };

export type TourStep = {
  id: string;
  title: string;
  body: string;
  /** Botao "Fazer por mim": o app executa a acao real (cria no/tarefa/portal...).
      Aceita lista — passos que criam varios artefatos de uma vez. */
  action?: TourAction | TourAction[];
  /** Auto-conclui quando a condicao aparece no workspace. Sem check = botao manual. */
  check?: TourCheck;
};

export type Tour = {
  id: string;
  /** Icone lucide (nome — resolvido na UI). */
  icon: string;
  title: string;
  tagline: string;
  steps: TourStep[];
};

export type WorkspaceSnapshot = {
  nodes: Array<{ id: string; type: string; title: string | null; payload?: Record<string, unknown> }>;
  edges: Array<{ id: string; sourceNodeId: string; targetNodeId: string }>;
  tasks: Array<{ id: string; title: string; status: string }>;
  mcps: Array<{ name: string }>;
  floors: Array<{ name: string }>;
  routines: Array<{ id: string }>;
};
