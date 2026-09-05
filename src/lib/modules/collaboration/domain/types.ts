export type CollaborationRole = 'viewer' | 'collaborator' | 'operator' | 'administrator';

export type CollaborationScope =
  | 'workspace.view'
  | 'activity.view'
  | 'tasks.view'
  | 'tasks.write'
  | 'approvals.view'
  | 'approvals.decide'
  | 'design.view'
  | 'design.comment'
  | 'design.propose'
  | 'design.decide'
  | 'design.edit'
  | 'leader.message'
  | 'voice.transcribe'
  | 'agents.message'
  | 'agents.invoke'
  | 'huddles.view'
  | 'huddles.speak'
  | 'huddles.manage'
  | 'terminal.control'
  | 'peers.manage';

export type CollaborationShareStatus = 'active' | 'stopped' | 'expired';

export type CollaborationShareData = {
  id: string;
  workspaceId: string;
  status: CollaborationShareStatus;
  defaultRole: CollaborationRole;
  relayUrl: string;
  relayRegion: string | null;
  maxPeers: number;
  revision: number;
  expiresAt: string;
  startedAt: string;
  stoppedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CollaborationDeviceData = {
  id: string;
  shareId: string;
  workspaceId: string;
  deviceId: string;
  displayName: string;
  platform: 'darwin' | 'win32' | 'linux' | 'ios' | 'android' | 'web';
  fingerprint: string;
  role: CollaborationRole;
  scopes: CollaborationScope[];
  requestedAt: string;
  approvedAt: string | null;
  lastSeenAt: string | null;
  revokedAt: string | null;
};

export type CollaborationAuditData = {
  id: string;
  workspaceId: string;
  shareId: string | null;
  actorDeviceId: string | null;
  eventType: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type SharedCanvasNodeDto = {
  id: string;
  type: 'agent' | 'tasks' | 'group' | 'shape' | 'control' | 'review' | 'automation' | 'design';
  title: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  floorId: string | null;
  visual: Record<string, string | number | boolean | null>;
};

export type SharedWorkspaceDto = {
  shareId: string;
  revision: number;
  workspace: { name: string; icon: string | null };
  nodes: SharedCanvasNodeDto[];
  edges: Array<{ id: string; sourceNodeId: string; targetNodeId: string; style: string }>;
  columns: Array<{ id: string; key: string; name: string | null; color: string; position: number }>;
  tasks: Array<{
    id: string; title: string; description: string | null; status: string;
    assigneeNodeId: string | null; assigneeTitle: string | null; createdAt: string; updatedAt: string;
  }>;
  agents: Array<{
    id: string; title: string; provider: string | null; role: string | null;
    state: string; stateSince: string; currentTask: { id: string; title: string; status: string } | null;
    workSummary: {
      focus: string | null;
      lastActiveAt: string;
      recentActivity: Array<{
        id: string;
        category: string;
        verb: string;
        objectTitle: string | null;
        state: string;
        severity: 'info' | 'success' | 'warning' | 'error';
        occurredAt: string;
      }>;
      coordination: {
        sent: number;
        received: number;
        replied: number;
        failed: number;
        lastPeerTitle: string | null;
        lastDirection: 'sent' | 'received' | null;
        lastState: 'queued' | 'sent' | 'delivered' | 'acknowledged' | 'replied' | 'failed' | null;
        lastAt: string | null;
      };
    } | null;
  }>;
  conversations: Array<{
    messageId: string;
    agentNodeId: string;
    agentTitle: string;
    state: 'queued' | 'sent' | 'delivered' | 'acknowledged' | 'replied' | 'failed';
    message: string;
    reply: string | null;
    error: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  huddles: Array<{
    id: string;
    title: string;
    agenda: string | null;
    status: 'active' | 'ended';
    facilitatorNodeId: string | null;
    linkedTaskId: string | null;
    participants: Array<{ kind: 'user' | 'remote' | 'agent'; participantId: string; displayName: string; role: 'facilitator' | 'member' | 'guest' }>;
    turns: Array<{
      id: string; sequence: number; speakerKind: 'user' | 'remote' | 'agent'; speakerName: string;
      addressedNodeId: string | null; text: string; state: 'pending' | 'completed' | 'failed'; errorCode: string | null; createdAt: string;
    }>;
    startedAt: string;
    endedAt: string | null;
    updatedAt: string;
  }>;
  floors: Array<{ id: string; name: string; status: string; activeTasks: number; activeAgents: number }>;
  roles: Array<{ name: string; agentCount: number }>;
  reviews: Array<{
    id: string; title: string; summary: string | null; status: string; taskTitle: string | null;
    assigneeTitle: string | null; evidenceCount: number; testCount: number; riskCount: number;
    decidedAt: string | null; createdAt: string; updatedAt: string;
  }>;
  designs: Array<{
    nodeId: string;
    name: string;
    revision: number;
    pages: Array<{ id: string; name: string }>;
    elements: Array<{
      id: string; pageId: string; name: string; type: string;
      x: number; y: number; width: number; height: number; opacity: number; fill: string;
    }>;
    pageCount: number;
    elementCount: number;
    presences: Array<{ participantId: string; name: string; color: string; pageId: string; elementCount: number }>;
    comments: Array<{
      id: string; pageId: string; pageName: string; elementId: string | null; elementName: string | null;
      status: 'open' | 'resolved'; authorName: string; body: string; replyCount: number; updatedAt: string;
    }>;
    proposals: Array<{
      id: string; title: string; description: string; authorName: string;
      status: 'pending' | 'approved' | 'rejected'; operationCount: number;
      floorId: string | null; councilId: string | null; updatedAt: string;
    }>;
  }>;
  usage: Array<{
    provider: string;
    plan: string | null;
    windows: Array<{ kind: '5h' | 'weekly' | 'monthly'; usedPercent: number; resetsAt: string | null }>;
    available: boolean;
    diagnostic?: 'provider_cli_only' | 'admin_api_required' | 'enterprise_api_required' | 'model_provider_managed' | null;
    fetchedAt: string;
  }>;
  activity: Array<{
    id: string;
    kind: 'agent' | 'task' | 'review';
    title: string;
    detail: string | null;
    state: string;
    occurredAt: string;
  }>;
  generatedAt: string;
};

export type CollaborationCommand =
  | { type: 'task.create'; title: string; description?: string | null; status?: string; assigneeNodeId?: string | null }
  | { type: 'task.update'; taskId: string; title?: string; description?: string | null; status?: string; assigneeNodeId?: string | null }
  | { type: 'review.decide'; reviewId: string; status: 'approved' | 'changes_requested' | 'rejected'; note?: string | null }
  | { type: 'design.comment.create'; nodeId: string; pageId: string; elementId?: string | null; body: string }
  | { type: 'design.comment.reply'; nodeId: string; commentId: string; body: string }
  | { type: 'design.comment.resolve'; nodeId: string; commentId: string; status: 'open' | 'resolved' }
  | { type: 'design.proposal.create'; nodeId: string; elementId: string; title: string; description?: string | null; changes: { x: number; y: number; width: number; height: number; opacity: number; fill: string } }
  | { type: 'design.proposal.decide'; nodeId: string; proposalId: string; status: 'approved' | 'rejected'; note?: string | null }
  | { type: 'design.element.update'; nodeId: string; elementId: string; changes: { x: number; y: number; width: number; height: number; opacity: number; fill: string } }
  | { type: 'leader.message'; message: string }
  | { type: 'agent.message'; agentNodeId: string; message: string }
  | { type: 'agent.invoke'; agentNodeId: string }
  | { type: 'huddle.create'; title: string; agenda?: string | null; agentNodeIds: string[]; facilitatorNodeId?: string | null }
  | { type: 'huddle.turn'; huddleId: string; text: string; targetNodeIds: string[] }
  | { type: 'huddle.end'; huddleId: string };

export type CollaborationCommandResult = {
  commandId: string;
  accepted: boolean;
  revision: number;
  result: Record<string, unknown> | null;
  errorCode: string | null;
};
