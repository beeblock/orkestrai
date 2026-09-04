import type { CanvasNodePayload, CanvasNodeType } from './types.js';

const SECRET_FIELD = /(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|passwd|secret|token)/i;

function remapIds(value: unknown, ids: ReadonlyMap<string, string>): string[] {
  return Array.isArray(value)
    ? value.flatMap((id) => typeof id === 'string' && ids.has(id) ? [ids.get(id)!] : [])
    : [];
}

function clearSecretRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .map(([key, entry]) => [key, SECRET_FIELD.test(key) ? '' : String(entry ?? '')]));
}

function clearKeyValueSecrets(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
    const record = entry as Record<string, unknown>;
    const name = String(record.name ?? record.key ?? '');
    return SECRET_FIELD.test(name) ? { ...record, value: '' } : record;
  });
}

function detachedApiClientPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const requests = Array.isArray(payload.requests) ? payload.requests.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
    const request = structuredClone(entry) as Record<string, unknown>;
    delete request.sourcePath;
    delete request.sourceData;
    request.params = clearKeyValueSecrets(request.params);
    request.headers = clearKeyValueSecrets(request.headers);
    request.formFields = clearKeyValueSecrets(request.formFields);
    if (request.auth && typeof request.auth === 'object' && !Array.isArray(request.auth)) {
      const auth = request.auth as Record<string, unknown>;
      const oauth2 = auth.oauth2 && typeof auth.oauth2 === 'object' && !Array.isArray(auth.oauth2)
        ? auth.oauth2 as Record<string, unknown>
        : null;
      request.auth = {
        ...auth,
        token: '',
        password: '',
        value: '',
        ...(oauth2 ? {
          oauth2: {
            ...oauth2,
            clientSecret: '',
            password: '',
            accessToken: '',
            refreshToken: '',
            expiresAt: null,
          },
        } : {}),
      };
    }
    return request;
  }) : [];
  const folders = Array.isArray(payload.folders) ? payload.folders.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
    const folder = structuredClone(entry) as Record<string, unknown>;
    delete folder.sourceData;
    return folder;
  }) : [];
  const environments = payload.environments && typeof payload.environments === 'object' && !Array.isArray(payload.environments)
    ? Object.fromEntries(Object.entries(payload.environments as Record<string, unknown>)
      .map(([name, entries]) => [name, clearSecretRecord(entries)]))
    : {};
  const network = payload.network && typeof payload.network === 'object' && !Array.isArray(payload.network)
    ? payload.network as Record<string, unknown>
    : {};
  return {
    ...payload,
    sourceKind: null,
    sourcePath: null,
    sourceCollection: null,
    requests,
    folders,
    variables: clearSecretRecord(payload.variables),
    environments,
    globalVariables: clearSecretRecord(payload.globalVariables),
    runtimeVariables: {},
    vaultKeys: [],
    history: [],
    network: {
      ...network,
      cookies: [],
      proxyUrl: '',
      caPath: '',
      clientCertificatePath: '',
      clientKeyPath: '',
      clientPfxPath: '',
      clientKeyPassphrase: '',
    },
    sync: {
      mode: 'manual',
      conflictPolicy: 'ask',
      lastSyncedAt: null,
      sourceFingerprint: null,
      localFingerprint: null,
      managedFiles: [],
    },
  };
}

export function transferredNodePayload(
  type: CanvasNodeType,
  source: CanvasNodePayload,
  ids: ReadonlyMap<string, string>,
  keepMaestro: boolean,
): CanvasNodePayload {
  const payload = structuredClone((source ?? {}) as Record<string, unknown>);
  if (type === 'terminal') {
    delete payload.sessionId;
    delete payload.agentSessionId;
    delete payload.currentWorkingDir;
    delete payload.env;
    payload.resumeRecovery = false;
    payload.maestro = keepMaestro && payload.maestro === true;
  }
  if (type === 'group') {
    payload.members = remapIds(payload.members, ids);
    if (Array.isArray(payload.designNodeIds)) payload.designNodeIds = remapIds(payload.designNodeIds, ids);
    if (Array.isArray(payload.taskIds)) payload.taskIds = [];
  }
  if (type === 'imageWorkflow') {
    payload.contextOrder = remapIds(payload.contextOrder, ids);
    payload.referenceOrder = remapIds(payload.referenceOrder, ids);
    payload.status = 'idle';
    payload.activeRunId = null;
    payload.activeRun = null;
    payload.lastError = null;
    payload.history = [];
  }
  if (type === 'image') {
    const generatedBy = payload.generatedBy;
    if (generatedBy && typeof generatedBy === 'object' && !Array.isArray(generatedBy)) {
      const sourceWorkflowId = (generatedBy as Record<string, unknown>).workflowNodeId;
      const workflowNodeId = typeof sourceWorkflowId === 'string' ? ids.get(sourceWorkflowId) : null;
      if (workflowNodeId) payload.generatedBy = { ...generatedBy, workflowNodeId };
      else delete payload.generatedBy;
    }
  }
  if (type === 'loop') {
    delete payload.conversationId;
  }
  if (type === 'flow') {
    payload.run = null;
    payload.runs = [];
  }
  if (type === 'apiClient') {
    return detachedApiClientPayload(payload);
  }
  if (type === 'design') {
    const work = payload.explorationWork;
    if (work && typeof work === 'object' && !Array.isArray(work)) {
      payload.explorationWork = {
        ...work,
        phase: 'waiting',
        taskId: null,
        assigneeNodeId: null,
        startedAt: null,
        lastProgressAt: null,
      };
    }
    if (payload.visualReview && typeof payload.visualReview === 'object') {
      payload.visualReview = { status: 'pending', revision: null, note: '', reviewedAt: null };
    }
  }
  if (type === 'device') return {};
  return payload;
}
