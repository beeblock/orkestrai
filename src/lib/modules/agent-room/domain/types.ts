import type { SavedTerminalCommand } from './terminal-commands.js';

/**
 * Identificador de um provider/agente registrado no registry de adapters
 * (`application/adapters/registry.ts`). Os ids embutidos 'codex' e 'claude'
 * permanecem validos (dados existentes), mas qualquer adapter registrado
 * pode ser usado.
 */
export type AgentProviderId = 'codex' | 'claude' | (string & {});
export type AgentName = AgentProviderId;
export type Participant = 'user' | 'system' | AgentName;
export type TeamMemberRole = 'leader' | 'engineer' | 'tester' | 'designer' | 'documenter' | 'custom';
export type TeamMemberCapability = 'lead' | 'implement' | 'review' | 'test' | 'design' | 'document';
export type TaskStatus = 'backlog' | 'in_progress' | 'testing' | 'done';
export type ExecutionMode = 'sequential' | 'parallel';
export type ModelEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';
export type ConversationMode = 'chat' | 'plan' | 'debate' | 'implement' | 'review' | 'project';
/**
 * Alvo de execucao: qualquer provider registrado, ou um dos fluxos
 * compostos embutidos (par codex/claude).
 */
export type AgentTarget =
  | AgentProviderId
  | 'both'
  | 'codex_then_claude_review'
  | 'claude_then_codex_review';

export type AgentProviderSetup = {
  /** Documentacao oficial de instalacao e autenticacao. */
  docsUrl: string;
  /** Instaladores oficiais que podem ser copiados pela Central de Providers. */
  installCommands?: Partial<Record<'darwin' | 'windows' | 'linux', string>>;
};

/**
 * Como um perfil alternativo (multi-conta) e aplicado ao spawnar esse provider.
 * Cada adapter declara a estrategia real da sua CLI em vez de o app assumir
 * um `env` generico — providers diferentes isolam conta de jeitos diferentes:
 * um diretorio de config só (`configDir`), dois diretorios que precisam andar
 * juntos (`configDirPair`, ex. OpenCode: config + credenciais em XDG_DATA_HOME),
 * um token direto sem diretorio nenhum (`token`), ou nenhum mecanismo oficial
 * (`unsupported` — o provider nao aparece na gestao de perfis).
 */
export type AgentProfileStrategy =
  | { kind: 'configDir'; envVar: string; defaultDir: string }
  | { kind: 'configDirPair'; configEnvVar: string; dataEnvVar: string; defaultConfigDir: string; defaultDataDir: string }
  | { kind: 'token'; envVar: string; optionalEnvVars?: string[] }
  | { kind: 'unsupported' };

/**
 * Metadados publicos de um adapter de agente, expostos pela rota
 * /api/agent-room/status para a UI montar seletores dinamicamente.
 */
export type AgentProviderInfo = {
  id: AgentProviderId;
  displayName: string;
  supportsResume: boolean;
  efforts?: string[];
  sessionStorage?: string;
  setup?: AgentProviderSetup;
  profileStrategy?: AgentProfileStrategy;
  installed?: boolean;
  detail?: string;
  /** Comando TUI interativo do agente para sessoes PTY. */
  tui?: {
    command: string;
    args: string[];
    env?: Record<string, string>;
    /** Args exatos com o token abaixo no lugar do id real da conversa. */
    exactResumeArgs?: string[] | null;
    /** Args de conversa nova com o token abaixo no lugar do id reservado. */
    freshSessionArgs?: string[] | null;
  };
  /** Modelos disponiveis no provider (para o dialogo de criacao). */
  models?: AgentModelOption[];
};

export type ChatMessage = {
  id: string;
  conversationId: string;
  participant: Participant;  content: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
};

export type Conversation = {
  id: string;
  title: string;
  mode: ConversationMode;
  projectPath: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProjectInfo = {
  name: string;
  path: string;
  createdAt: string;
};

export type AgentRunRequest = {
  agent: AgentName;
  memberId?: string;
  memberTitle?: string;
  taskId?: string;
  model?: string | null;
  effort?: ModelEffort | null;
  prompt: string;
  workingDirectory?: string;
  mode: Exclude<ConversationMode, 'project' | 'debate'>;
  allowWrites: boolean;
};

export type AgentRunResult = {
  agent: AgentName;
  memberId?: string;
  memberTitle?: string;
  content: string;
  rawOutput?: string;
  exitCode: number;
  error?: string;
  metadata?: Record<string, unknown>;
};

export type RunAgentPayload = {
  message: string;
  target: AgentTarget;
  mode: Exclude<ConversationMode, 'project'>;
  allowWrites: boolean;
  projectPath?: string | null;
};

export type AgentLoopPayload = {
  message: string;
  mode: Exclude<ConversationMode, 'project'>;
  allowWrites: boolean;
  projectPath?: string | null;
  maxRounds?: number;
  executionMode?: ExecutionMode;
};

export type TeamMember = {
  id: string;
  conversationId: string;
  title: string;
  provider: AgentName;
  role: TeamMemberRole;
  model: string | null;
  effort: ModelEffort;
  canWrite: boolean;
  participatesInLoop: boolean;
  capabilities: TeamMemberCapability[];
  systemPrompt: string;
  createdAt: string;
  updatedAt: string;
};

export type AgentTask = {
  id: string;
  conversationId: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: number;
  assigneeId: string | null;
  createdByMemberId: string | null;
  acceptedByMemberId: string | null;
  blockedReason: string | null;
  resultSummary: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TaskEvent = {
  id: string;
  conversationId: string;
  taskId: string;
  type: string;
  actorMemberId: string | null;
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

export type CreateTeamMemberPayload = {
  title: string;
  provider: AgentName;
  role: TeamMemberRole;
  model?: string | null;
  effort?: ModelEffort;
  canWrite?: boolean;
  participatesInLoop?: boolean;
  capabilities?: TeamMemberCapability[];
  systemPrompt?: string;
};

export type UpdateTeamMemberPayload = Partial<CreateTeamMemberPayload>;

export type UpdateTaskPayload = {
  status?: TaskStatus;
  assigneeId?: string | null;
  title?: string;
  description?: string;
};

export type AgentModelOption = {
  provider: AgentName;
  value: string;
  label: string;
  description?: string;
  /** Esforcos suportados por ESTE modelo (quando a CLI informa). */
  efforts?: string[];
};

// ---------------------------------------------------------------------------
// Canvas / Workspaces
// ---------------------------------------------------------------------------

export type CanvasNodeType = 'terminal' | 'note' | 'fileTree' | 'editor' | 'diff' | 'portal' | 'apiClient' | 'loop' | 'group' | 'shape' | 'tasks' | 'flow' | 'image' | 'imageWorkflow' | 'usage' | 'codeGraph' | 'controlCenter' | 'reviewCenter' | 'workstreams' | 'memory' | 'annotations' | 'huddles' | 'automation' | 'device' | 'design';
export type CanvasEdgeStyle = 'cord' | 'circuit';
export type WorkspaceRuntimeKind = 'native' | 'wsl';
export type WorkspaceExecutionRuntime =
  | { kind: 'native' }
  | { kind: 'wsl'; distribution: string; linuxWorkingDir: string };

export type AgentActivityState =
  | 'starting'
  | 'working'
  | 'waiting_input'
  | 'waiting_permission'
  | 'blocked'
  | 'idle'
  | 'done'
  | 'error'
  | 'disconnected';

export type AgentMessageDeliveryState =
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'acknowledged'
  | 'replied'
  | 'failed';

export type AgentActivityCategory =
  | 'agent'
  | 'message'
  | 'task'
  | 'workflow'
  | 'review'
  | 'git'
  | 'terminal'
  | 'design'
  | 'portal'
  | 'remote'
  | 'usage'
  | 'system';

export type AgentActivitySeverity = 'info' | 'success' | 'warning' | 'error';

export type AgentAttentionStatus = 'open' | 'read' | 'snoozed' | 'resolved';

export type AgentActivity = {
  id: string;
  workspaceId: string;
  nodeId: string;
  state: AgentActivityState;
  action: string | null;
  taskId: string | null;
  metadata: Record<string, unknown>;
  category: AgentActivityCategory;
  verb: string;
  objectType: string | null;
  objectId: string | null;
  objectTitle: string | null;
  outcome: string | null;
  severity: AgentActivitySeverity;
  correlationId: string | null;
  sourceType: string | null;
  sourceId: string | null;
  attentionRequired: boolean;
  resolvedAt: string | null;
  createdAt: string;
};

export type AgentMessageEnvelope = {
  id: string;
  workspaceId: string;
  fromNodeId: string | null;
  toNodeId: string;
  kind: string;
  state: AgentMessageDeliveryState;
  content: string;
  reply: string | null;
  error: string | null;
  contentHash: string;
  correlationId: string | null;
  dedupKey: string | null;
  attempts: number;
  metadata: Record<string, unknown>;
  deliveredAt: string | null;
  acknowledgedAt: string | null;
  repliedAt: string | null;
  failedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AgentAttentionItem = {
  id: string;
  workspaceId: string;
  workspaceName: string | null;
  activityEventId: string | null;
  nodeId: string | null;
  nodeTitle: string | null;
  taskId: string | null;
  category: AgentActivityCategory;
  severity: AgentActivitySeverity;
  status: AgentAttentionStatus;
  title: string;
  body: string | null;
  sourceType: string | null;
  sourceId: string | null;
  sourceContent?: string | null;
  correlationId: string | null;
  action: Record<string, unknown>;
  actionAvailable?: boolean;
  readAt: string | null;
  snoozedUntil: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AgentMessageDeliveryEvent = {
  id: string;
  messageId: string;
  workspaceId: string;
  fromNodeId: string | null;
  toNodeId: string;
  state: AgentMessageDeliveryState;
  content: string;
  reply: string | null;
  error: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type AgentActivitySnapshot = {
  nodeId: string;
  title: string;
  provider: string | null;
  role: string | null;
  floorId: string | null;
  floorName: string | null;
  state: AgentActivityState;
  stateSince: string;
  lastAction: string | null;
  lastActionData: Record<string, unknown>;
  currentTask: { id: string; title: string; status: string } | null;
  sessionAlive: boolean;
};

export type AgentMessageThread = {
  messageId: string;
  workspaceId: string;
  fromNodeId: string | null;
  fromTitle: string | null;
  toNodeId: string;
  toTitle: string;
  state: AgentMessageDeliveryState;
  content: string;
  reply: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  events: AgentMessageDeliveryEvent[];
};

export type ControlCenterSnapshot = {
  workspaceId: string;
  counts: Record<AgentActivityState, number>;
  agents: AgentActivitySnapshot[];
  activity: AgentActivity[];
  communications: AgentMessageThread[];
  generatedAt: string;
};

export type AgentWorkstreamStage = 'backlog' | 'active' | 'review' | 'blocked' | 'done';

export type AgentWorkstream = {
  id: string;
  workspaceId: string;
  title: string;
  description: string | null;
  stage: AgentWorkstreamStage;
  taskStatus: string;
  taskStatusLabel: string;
  taskStatusColor: string;
  assigneeNodeId: string | null;
  assigneeTitle: string | null;
  floor: { id: string; name: string; branch: string } | null;
  councils: Array<{
    id: string;
    title: string;
    status: string;
    mode: string;
    completedPerspectives: number;
    totalPerspectives: number;
    updatedAt: string;
  }>;
  reviews: Array<{
    id: string;
    title: string;
    status: string;
    revision: string;
    selectedPaths: string[];
    evidenceCount: number;
    testCount: number;
    riskCount: number;
    updatedAt: string;
  }>;
  huddles: Array<{
    id: string;
    title: string;
    status: WorkspaceHuddleStatus;
    participantCount: number;
    turnCount: number;
    updatedAt: string;
  }>;
  git: {
    revision: string | null;
    branch: string | null;
    paths: string[];
    changedPaths: string[];
  };
  timeline: AgentActivity[];
  createdAt: string;
  updatedAt: string;
};

export type WorkstreamSnapshot = {
  workspaceId: string;
  taskBoardNodeId: string | null;
  workstreams: AgentWorkstream[];
  counts: Record<AgentWorkstreamStage, number>;
  unlinked: {
    councils: number;
    reviews: number;
    huddles: number;
    activities: number;
    changedPaths: string[];
  };
  generatedAt: string;
};

export type WorkspaceMemoryKind = 'decision' | 'fact' | 'preference' | 'constraint' | 'reference' | 'lesson';
export type WorkspaceMemoryStatus = 'active' | 'superseded' | 'archived';
export type WorkspaceMemorySourceType = 'user' | 'note' | 'task' | 'message' | 'file' | 'url' | 'git' | 'review' | 'council' | 'agent';

export type WorkspaceMemorySource = {
  id: string;
  type: WorkspaceMemorySourceType;
  sourceId: string | null;
  label: string;
  uri: string | null;
  excerpt: string | null;
  contentHash: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type WorkspaceMemoryEntry = {
  id: string;
  workspaceId: string;
  kind: WorkspaceMemoryKind;
  status: WorkspaceMemoryStatus;
  title: string;
  content: string;
  confidence: number;
  pinned: boolean;
  tags: string[];
  createdByNodeId: string | null;
  createdByTitle: string | null;
  supersedesId: string | null;
  revision: number;
  verifiedAt: string | null;
  sources: WorkspaceMemorySource[];
  createdAt: string;
  updatedAt: string;
};

export type TraceableAnnotation = {
  id: string;
  workspaceId: string;
  kind: 'code' | 'design';
  status: 'open' | 'resolved';
  body: string;
  authorTitle: string | null;
  targetTitle: string;
  targetDetail: string | null;
  targetId: string;
  nodeId: string | null;
  taskId: string | null;
  revision: string;
  stale: boolean;
  route: string;
  createdAt: string;
  updatedAt: string;
};

export type AnnotationCenterSnapshot = {
  annotations: TraceableAnnotation[];
  counts: { open: number; resolved: number; stale: number; code: number; design: number };
};

export type WorkspaceHuddleStatus = 'active' | 'ended';
export type WorkspaceHuddleParticipantKind = 'user' | 'remote' | 'agent';
export type WorkspaceHuddleTurnState = 'pending' | 'completed' | 'failed';

export type WorkspaceHuddleParticipant = {
  id: string;
  kind: WorkspaceHuddleParticipantKind;
  participantId: string;
  displayName: string;
  role: 'facilitator' | 'member' | 'guest';
  voiceEnabled: boolean;
  joinedAt: string;
  leftAt: string | null;
};

export type WorkspaceHuddleTurn = {
  id: string;
  sequence: number;
  speakerKind: WorkspaceHuddleParticipantKind;
  speakerId: string | null;
  speakerName: string;
  addressedNodeId: string | null;
  text: string;
  state: WorkspaceHuddleTurnState;
  messageId: string | null;
  errorCode: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type WorkspaceHuddle = {
  id: string;
  workspaceId: string;
  title: string;
  agenda: string | null;
  status: WorkspaceHuddleStatus;
  facilitatorNodeId: string | null;
  linkedTaskId: string | null;
  createdByKind: WorkspaceHuddleParticipantKind;
  createdById: string | null;
  participants: WorkspaceHuddleParticipant[];
  turns: WorkspaceHuddleTurn[];
  startedAt: string;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceHuddleSummary = Omit<WorkspaceHuddle, 'participants' | 'turns'> & {
  participantCount: number;
  turnCount: number;
};

export type WorkspaceHuddleSnapshot = {
  huddles: WorkspaceHuddleSummary[];
  selected: WorkspaceHuddle | null;
  activeHuddleId: string | null;
};

export type WorkspaceAttachment = {
  id: string;
  kind: 'file' | 'link';
  name: string;
  path: string | null;
  url: string | null;
  mimeType: string | null;
  size: number | null;
};

const RASTER_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export function isRasterWorkspaceAttachment(attachment: WorkspaceAttachment): boolean {
  return attachment.kind === 'file' && RASTER_IMAGE_MIMES.has(attachment.mimeType ?? '');
}

export type WorkspaceRepositoryRoot = {
  /** Stable, shell-safe name used in bridge paths such as @api-tests/bruno. */
  alias: string;
  /** Absolute host path selected explicitly by the workspace owner. */
  path: string;
};

export type Workspace = {
  id: string;
  name: string;
  workingDir: string;
  runtimeKind: WorkspaceRuntimeKind;
  wslDistribution: string | null;
  wslWorkingDir: string | null;
  icon: string | null;
  instructions: string | null;
  /** Mantem CLAUDE.md e AGENTS.md sincronizados no working_dir. */
  syncAgentInstructionFiles: boolean;
  /** Repositorios adicionais aprovados para fluxos multi-repo. */
  repositoryRoots: WorkspaceRepositoryRoot[];
  /** Hooks de ciclo de vida de andares (setup/run/teardown). */
  hooks: WorkspaceHooks;
  /** Non-null while terminal activity is explicitly suspended by the user. */
  suspendedAt: string | null;
  /** Pasta na barra lateral (null = raiz). */
  groupId: string | null;
  /** Posicao dentro da pasta (ou da raiz), para ordenacao estavel. */
  position: number;
  createdAt: string;
  updatedAt: string;
};

/** Pasta para organizar workspaces na barra lateral — pode aninhar dentro de outra pasta (parentId), formando uma arvore. */
export type WorkspaceGroup = {
  id: string;
  name: string;
  parentId: string | null;
  position: number;
  /** Estado de expandido/recolhido na arvore da barra lateral, persistido no servidor. */
  collapsed: boolean;
  createdAt: string;
  updatedAt: string;
};

/** Payload por tipo de no (serializado em payload_json). */
export type TerminalNodePayload = {
  sessionId?: string;
  agentSessionId?: string;
  /** Ultimo diretorio real de um shell puro; agentes sempre usam a raiz do trabalho. */
  currentWorkingDir?: string;
  /** Conversa persistida sumiu: inicia limpo, mas sem reinjetar o role. */
  resumeRecovery?: boolean;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  provider?: AgentProviderId;
  /** Perfil de multi-conta ativo (id de ProviderProfile), quando aplicavel. */
  profileId?: string | null;
  /** Ausente = herda o ambiente padrão do workspace. */
  executionRuntime?: WorkspaceExecutionRuntime | null;
  role?: string | null;
  /** Args nativos da role, usados somente ao criar uma conversa nova. */
  initialRoleArgs?: string[];
  /** Nome da role representada por initialRoleArgs (permite reparo idempotente). */
  roleConfiguredAtLaunch?: string;
  /** Modo Maestro: pode recrutar/dispensar/conectar outros agentes via ponte. */
  maestro?: boolean;
  /** Identificador de um tema xterm embutido. */
  theme?: string;
  /** Comandos salvos exclusivamente para este node terminal. */
  savedCommands?: SavedTerminalCommand[];
};

export type NoteNodePayload = {
  content: string;
  locked?: boolean;
  attachments?: WorkspaceAttachment[];
};

export type ImageWorkflowRun = {
  id: string;
  status: 'succeeded' | 'failed' | 'cancelled';
  startedAt: string;
  completedAt: string;
  durationMs: number;
  actorNodeId: string | null;
  executorNodeId: string | null;
  contextNodeIds: string[];
  referenceNodeIds: string[];
  inputHash: string;
  tool: 'image_gen.imagegen';
  promptSnapshot: string;
  requestedOutputs: number;
  transparentBackground: boolean;
  outputPaths: string[];
  outputNodeIds: string[];
  errorCode: string | null;
};

export type ImageWorkflowActiveRun = {
  id: string;
  startedAt: string;
  actorNodeId: string | null;
  executorNodeId: string;
  contextNodeIds: string[];
  referenceNodeIds: string[];
  referencePaths: string[];
  outputPaths: string[];
  inputHash: string;
  promptSnapshot: string;
  requestedOutputs: number;
  transparentBackground: boolean;
  transparencyStrategy?: 'direct-alpha' | 'white-matte-then-alpha';
  /** Machine-validation failures per output, used to escalate native ImageGen repairs. */
  alphaValidationFailures?: Record<string, number>;
};

export type ImageWorkflowNodePayload = {
  schemaVersion?: 1;
  prompt?: string;
  count?: number;
  transparentBackground?: boolean;
  outputDirectory?: string;
  filePrefix?: string;
  /** Ordem explicita dos contextos e referencias conectados. */
  contextOrder?: string[];
  referenceOrder?: string[];
  status?: 'idle' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  activeRunId?: string | null;
  activeRun?: ImageWorkflowActiveRun | null;
  lastError?: string | null;
  history?: ImageWorkflowRun[];
};

export type ImageNodePayload = {
  path?: string;
  generatedBy?: {
    workflowNodeId: string;
    runId: string;
    outputIndex: number;
    inputHash: string;
  };
};

export type UsageNodePayload = {
  enabled?: boolean;
  sourceProvider?: string;
  fallbackProvider?: string;
  windowKind?: '5h' | 'weekly' | 'monthly';
  thresholdPercent?: number;
};

export type ApiClientKeyValue = {
  id: string;
  name: string;
  value: string;
  enabled: boolean;
};

export type ApiClientHeader = ApiClientKeyValue;

export type ApiClientProtocol = 'http' | 'graphql' | 'websocket' | 'grpc';

export type ApiClientMessage = {
  id: string;
  name: string;
  content: string;
  type: 'text' | 'json' | 'binary';
  enabled: boolean;
};

export type ApiClientAssertion = {
  id: string;
  source: 'status' | 'body' | 'header' | 'responseTime';
  property: string;
  operator: 'equals' | 'notEquals' | 'contains' | 'exists' | 'matches' | 'lt' | 'lte' | 'gt' | 'gte';
  expected: string;
  enabled: boolean;
};

export type ApiClientRequest = {
  id: string;
  name: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
  protocol?: ApiClientProtocol;
  url: string;
  folder?: string;
  folderId?: string | null;
  sequence?: number;
  params?: ApiClientKeyValue[];
  headers: ApiClientHeader[];
  auth: {
    type: 'none' | 'bearer' | 'basic' | 'apiKey' | 'oauth2';
    token: string;
    username: string;
    password: string;
    key?: string;
    value?: string;
    placement?: 'header' | 'query';
    oauth2?: {
      grantType: 'authorization_code' | 'client_credentials' | 'password' | 'refresh_token';
      authorizationUrl: string;
      tokenUrl: string;
      clientId: string;
      clientSecret: string;
      scope: string;
      audience: string;
      username: string;
      password: string;
    accessToken: string;
    refreshToken: string;
    tokenType: string;
    expiresAt: string | null;
      usePkce: boolean;
      clientAuthentication: 'header' | 'body';
    };
  };
  body: string;
  bodyMode: 'none' | 'json' | 'text' | 'xml' | 'form' | 'multipart';
  formFields?: ApiClientKeyValue[];
  preRequestScript?: string;
  postResponseScript?: string;
  testScript?: string;
  assertions?: ApiClientAssertion[];
  documentation?: string;
  timeoutMs?: number;
  followRedirects?: boolean;
  graphql?: { query: string; variables: string; operationName: string };
  websocket?: {
    messages: ApiClientMessage[];
    protocols: string[];
    autoReconnect: boolean;
    reconnectAttempts: number;
    keepAliveIntervalMs: number;
  };
  grpc?: {
    protoPath: string;
    service: string;
    method: string;
    methodType: 'unary' | 'serverStreaming' | 'clientStreaming' | 'bidirectional';
    messages: ApiClientMessage[];
    useTls: boolean;
  };
  sourcePath?: string | null;
  sourceData?: {
    kind: 'bruno' | 'postman' | 'openapi';
    data: Record<string, unknown>;
  } | null;
};

export type ApiClientFolder = {
  id: string;
  name: string;
  parentId: string | null;
  sequence: number;
  sourceData?: {
    kind: 'bruno' | 'postman' | 'openapi';
    data: Record<string, unknown>;
  } | null;
};

export type ApiClientRunner = {
  id: string;
  name: string;
  requestIds: string[];
  environment: string | null;
  iterations: number;
  iterationData: Array<Record<string, unknown>>;
  delayMs: number;
  stopOnFailure: boolean;
  sequence: number;
};

export type ApiClientHistoryEntry = {
  id: string;
  requestId: string;
  requestName: string;
  method: ApiClientRequest['method'];
  protocol?: ApiClientProtocol;
  url: string;
  status: number;
  ok: boolean;
  durationMs: number;
  size: number;
  testPassed: number;
  testFailed: number;
  executedAt: string;
};

export type ApiClientNodePayload = {
  formatVersion?: 1;
  sourceKind?: 'bruno' | 'postman' | 'openapi' | 'openCollection' | null;
  sourcePath?: string | null;
  sourceCollection?: Record<string, unknown> | null;
  requests?: ApiClientRequest[];
  folders?: ApiClientFolder[];
  runners?: ApiClientRunner[];
  selectedRunnerId?: string | null;
  selectedRequestId?: string | null;
  variables?: Record<string, string>;
  environments?: Record<string, Record<string, string>>;
  globalVariables?: Record<string, string>;
  runtimeVariables?: Record<string, string>;
  scriptDialect?: 'orkestrai' | 'postman' | 'bruno';
  vaultKeys?: string[];
  activeEnvironment?: string | null;
  history?: ApiClientHistoryEntry[];
  collectionPreRequestScript?: string;
  collectionPostResponseScript?: string;
  compatibilityWarnings?: Array<{
    code: string;
    count?: number;
  }>;
  network?: {
    cookieJarEnabled: boolean;
    cookies: Array<{ key: string; value: string; domain: string; path: string; expires: string | null; secure: boolean; httpOnly: boolean; hostOnly: boolean }>;
    proxyUrl: string;
    caPath: string;
    clientCertificatePath: string;
    clientKeyPath: string;
    clientPfxPath: string;
    clientKeyPassphrase: string;
    rejectUnauthorized: boolean;
  };
  sync?: {
    mode: 'manual' | 'watch';
    conflictPolicy: 'ask' | 'orkestrai' | 'filesystem';
    lastSyncedAt: string | null;
    sourceFingerprint: string | null;
    localFingerprint: string | null;
    managedFiles: string[];
  };
};

export type CanvasNodePayload = TerminalNodePayload | NoteNodePayload | ApiClientNodePayload | ImageWorkflowNodePayload | ImageNodePayload | Record<string, unknown>;

export type CanvasNode = {
  id: string;
  workspaceId: string;
  type: CanvasNodeType;
  title: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  payload: CanvasNodePayload;
  /** Andar dono do no (null = terreo). */
  floorId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceSearchResultKind =
  | 'workspace'
  | 'agent'
  | 'task'
  | 'note'
  | 'artifact'
  | 'role'
  | 'skill'
  | 'automation'
  | 'activity'
  | 'message'
  | 'attention'
  | 'memory'
  | 'huddle'
  | 'file';

export type WorkspaceSearchResult = {
  id: string;
  kind: WorkspaceSearchResultKind;
  title: string;
  subtitle: string;
  preview: string | null;
  workspaceId: string;
  workspaceName: string;
  nodeId: string | null;
  taskId: string | null;
  path: string | null;
  route: string;
  score: number;
  occurredAt?: string | null;
  facets?: {
    agent?: string | null;
    category?: string | null;
    status?: string | null;
    severity?: string | null;
  };
};

export type CanvasEdge = {
  id: string;
  workspaceId: string;
  sourceNodeId: string;
  targetNodeId: string;
  style: CanvasEdgeStyle;
  createdAt: string;
};

// ---------------------------------------------------------------------------
// Andares (floors) e automacao
// ---------------------------------------------------------------------------

export type Floor = {
  id: string;
  workspaceId: string;
  name: string;
  branch: string;
  path: string;
  status: 'active' | 'landed' | 'deleted';
  createdAt: string;
  updatedAt: string;
};

export type HookCommand = { command: string };

export type WorkspaceHooks = {
  setup?: HookCommand[];
  run?: HookCommand[];
  teardown?: HookCommand[];
  /** Executa os hooks de setup automaticamente ao criar um andar. */
  autoRunSetup?: boolean;
};

export type AutomationTriggerType =
  | 'manual'
  | 'schedule'
  | 'task'
  | 'message'
  | 'git_commit'
  | 'github_pull_request'
  | 'webhook'
  | 'file_change'
  | 'usage_threshold';

export type AutomationActionType = 'prompt_agent' | 'create_task' | 'notify';
export type AutomationRunStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export type Routine = {
  id: string;
  workspaceId: string;
  name: string;
  targetNodeId: string | null;
  /** Prompt(s) a enviar ao terminal; multiplas etapas separadas por linha com &&. */
  prompt: string;
  /** Intervalo em minutos entre disparos (null = execucao unica). */
  intervalMinutes: number | null;
  enabled: boolean;
  lastRunAt: string | null;
  runCount: number;
  triggerType: AutomationTriggerType;
  triggerConfig: Record<string, unknown>;
  actionType: AutomationActionType;
  actionConfig: Record<string, unknown>;
  recipeId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AutomationRun = {
  id: string;
  routineId: string;
  ranAt: string;
  status: AutomationRunStatus;
  ok: boolean;
  triggerType: AutomationTriggerType;
  triggerKey: string | null;
  detail: string | null;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  error: string | null;
  agentNodeId: string | null;
  provider: string | null;
  usageBefore: unknown;
  usageAfter: unknown;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  attempt: number;
  retryOfId: string | null;
  recoverable: boolean;
};

export type AutomationIntegration = {
  id: string;
  workspaceId: string;
  type: 'github';
  name: string;
  config: { owner: string; repo: string };
  secretKey: string | null;
  status: 'connected' | 'disconnected' | 'error';
  lastCheckedAt: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * Perfil de multi-conta de um provider (ex.: "Trabalho" apontando pra um
 * CLAUDE_CONFIG_DIR diferente). Os campos usados dependem da
 * `AgentProfileStrategy` declarada pelo adapter do provider — `configDir`
 * para 'configDir'/'configDirPair' (primeiro diretorio), `dataDir` só para
 * 'configDirPair' (segundo diretorio), `hasToken` para 'token' (o valor real
 * do token nunca sai do secret storage do desktop).
 */
export type ProviderProfile = {
  id: string;
  providerId: string;
  name: string;
  configDir: string | null;
  dataDir: string | null;
  hasToken: boolean;
  createdAt: string;
  updatedAt: string;
};
