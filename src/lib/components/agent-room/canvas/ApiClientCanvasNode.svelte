<script lang="ts">
  import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Braces, Check, ChevronDown, ChevronRight, Copy, Download, ExternalLink, FileCode2, FileJson2, Folder, FolderOpen, FolderPlus, GripVertical, History, ListChecks, LoaderCircle, MoreHorizontal, Pencil, Play, Plus, RefreshCw, Send, Trash2, X } from '@lucide/svelte';
  import { stringify as stringifyYaml } from 'yaml';
  import { getCsrfToken } from '@beeblock/svelar/http';
  import { toast } from '@beeblock/svelar/ui';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Switch } from '$lib/components/ui/switch';
  import * as ContextMenu from '$lib/components/ui/context-menu';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import * as NativeSelect from '$lib/components/ui/native-select';
  import * as Tabs from '$lib/components/ui/tabs';
  import NodeShell from './NodeShell.svelte';
  import ApiClientRunnerDialog from './ApiClientRunnerDialog.svelte';
  import ApiResponseViewer from './ApiResponseViewer.svelte';
  import ApiCodeEditor from './ApiCodeEditor.svelte';
  import type { ApiClientAssertion, ApiClientFolder, ApiClientHeader, ApiClientHistoryEntry, ApiClientKeyValue, ApiClientMessage, ApiClientNodePayload, ApiClientProtocol, ApiClientRequest, ApiClientRunner } from '$lib/modules/agent-room/domain/types.js';
  import { apiClientDescendantFolderIds, apiClientFolderPath, apiClientTreeRows, migrateApiClientFolders, normalizeApiClientRunners, type ApiClientTreeRow } from '$lib/modules/agent-room/domain/api-client-collection.js';
  import { exportOpenApiDocument } from '$lib/modules/agent-room/domain/api-client-openapi-export.js';
  import { postmanCollectionFilename, serializePostmanCollection } from '$lib/modules/agent-room/domain/api-client-postman.js';
  import * as m from '$lib/paraglide/messages.js';
  import { localeState } from '$lib/i18n/locale.svelte.js';

  export type ApiClientNodeData = {
    title: string;
    workspaceId: string;
    payload: ApiClientNodePayload;
    onPayloadChange?: (id: string, partial: Record<string, unknown>) => void;
    onRename?: (id: string, title: string) => void;
    onResize?: (id: string, params: { x: number; y: number; width: number; height: number }) => void;
    connections?: Array<{ edgeId: string; nodeId: string; title: string; type: string }>;
    onJumpToNode?: (id: string) => void;
    onRemoveConnection?: (edgeId: string) => void;
  };

  type ApiResponse = {
    status: number;
    statusText: string;
    ok: boolean;
    durationMs: number;
    size: number;
    contentType: string;
    headers: Record<string, string>;
    body: string;
    binary: boolean;
    variables: Record<string, string>;
    scopes?: {
      collection: Record<string, string>;
      environment: Record<string, string>;
      globals: Record<string, string>;
      runtime: Record<string, string>;
      iteration: Record<string, unknown>;
    };
    flow?: { nextRequest?: string | null; skipRequest: boolean; stopExecution: boolean };
    visualizations?: Array<{ type: 'html' | 'table'; content: string; data?: unknown }>;
    skipped?: boolean;
    vaultKeys?: string[];
    scriptLogs: string[];
    tests: Array<{ id: string; label: string; passed: boolean; actual: string; expected: string }>;
    protocol?: 'websocket' | 'grpc';
    messages?: Array<{ direction: 'sent' | 'received'; type: 'text' | 'json' | 'binary'; content: string; at: string }>;
    cookies?: NonNullable<ApiClientNodePayload['network']>['cookies'];
  };

  type ApiClientErrorPayload = {
    error?: unknown;
    code?: unknown;
    stage?: unknown;
    lineNumber?: unknown;
  };

  type DesktopBridge = {
    pickDirectory?: () => Promise<string | null>;
    pickApiExportDirectory?: () => Promise<string | null>;
    pickApiCollection?: (kind: 'bruno' | 'postman' | 'native' | 'openapi' | 'openCollection' | 'postmanEnvironment' | 'proto' | 'certificate' | 'privateKey' | 'pfx') => Promise<string | null>;
    openApiCollection?: (kind: 'bruno' | 'postman', path: string) => Promise<boolean>;
    openExternal?: (url: string) => Promise<void>;
    openPath?: (path: string) => Promise<string>;
    saveAutomationSecret?: (key: string, value: string) => Promise<{ stored: boolean }>;
    deleteAutomationSecret?: (key: string) => Promise<{ deleted: boolean }>;
  };

  let { id, data, selected } = $props<{ id: string; data: ApiClientNodeData; selected?: boolean }>();
  let requests = $state<ApiClientRequest[]>([]);
  let folders = $state<ApiClientFolder[]>([]);
  let runners = $state<ApiClientRunner[]>([]);
  let selectedRunnerId = $state<string | null>(null);
  let selectedRequestId = $state<string | null>(null);
  let variables = $state<Record<string, string>>({});
  let environments = $state<Record<string, Record<string, string>>>({});
  let globalVariables = $state<Record<string, string>>({});
  let runtimeVariables = $state<Record<string, string>>({});
  let scriptDialect = $state<'orkestrai' | 'postman' | 'bruno'>('orkestrai');
  let vaultKeys = $state<string[]>([]);
  let variableEditorScope = $state<'collection' | 'environment' | 'globals' | 'runtime' | 'vault'>('collection');
  let vaultName = $state('');
  let vaultValue = $state('');
  let activeEnvironment = $state<string | null>(null);
  let history = $state<ApiClientHistoryEntry[]>([]);
  let activeTab = $state('body');
  let scriptScope = $state<'request' | 'collection'>('request');
  let testEditorMode = $state<'assertions' | 'javascript'>('assertions');
  let collectionPreRequestScript = $state('');
  let collectionPostResponseScript = $state('');
  let responseView = $state<'body' | 'messages' | 'headers' | 'tests' | 'console' | 'visualizer'>('body');
  let sending = $state(false);
  let running = $state(false);
  let runProgress = $state({ completed: 0, total: 0, failed: 0 });
  let importing = $state(false);
  let oauthAuthorizing = $state(false);
  let error = $state('');
  let response = $state<ApiResponse | null>(null);
  let draggedItem = $state<{ kind: 'request' | 'folder'; id: string } | null>(null);
  let dropIndicator = $state<{ kind: 'request' | 'folder'; id: string; placement: 'before' | 'after' | 'inside' } | null>(null);
  let collapsedFolderIds = $state<Set<string>>(new Set());
  let folderDialogOpen = $state(false);
  let folderDialogMode = $state<'create' | 'rename'>('create');
  let folderDialogName = $state('');
  let folderDialogParentId = $state<string | null>(null);
  let editingFolderId = $state<string | null>(null);
  let runnerDialogOpen = $state(false);
  let newEnvironmentName = $state('');
  let compatibilityWarnings = $state<Array<{ code: string; count?: number }>>([]);
  let network = $state<NonNullable<ApiClientNodePayload['network']>>({ cookieJarEnabled: true, cookies: [], proxyUrl: '', caPath: '', clientCertificatePath: '', clientKeyPath: '', clientPfxPath: '', clientKeyPassphrase: '', rejectUnauthorized: true });
  let sync = $state<NonNullable<ApiClientNodePayload['sync']>>({ mode: 'manual', conflictPolicy: 'ask', lastSyncedAt: null, sourceFingerprint: null, localFingerprint: null, managedFiles: [] });
  let syncing = $state(false);
  let syncStatus = $state<{ linked: boolean; writable: boolean; sourceChanged: boolean; localChanged: boolean; conflict: boolean; sourcePath?: string; lastSyncedAt?: string | null } | null>(null);
  const selectedRequest = $derived(requests.find((request) => request.id === selectedRequestId) ?? null);
  const orderedRequests = $derived([...requests].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0)));
  const treeRows = $derived(apiClientTreeRows(folders, requests, collapsedFolderIds));
  const desktop = typeof window === 'undefined'
    ? undefined
    : (window as typeof window & { orkestraiDesktop?: DesktopBridge }).orkestraiDesktop;

  $effect(() => {
    const payload = data.payload;
    const clonedRequests = $state.snapshot(payload.requests ?? []) as ApiClientRequest[];
    const normalizedRequests: ApiClientRequest[] = clonedRequests.map((request: ApiClientRequest, index: number) => ({
      ...request,
      protocol: request.protocol ?? 'http',
      folder: request.folder ?? '',
      sequence: request.sequence ?? index,
      params: request.params ?? [],
      headers: request.headers ?? [],
      auth: {
        key: '', value: '', placement: 'header',
        ...(request.auth ?? { type: 'none', token: '', username: '', password: '' }),
        oauth2: {
          grantType: 'authorization_code', authorizationUrl: '', tokenUrl: '', clientId: '', clientSecret: '', scope: '', audience: '',
          username: '', password: '', accessToken: '', refreshToken: '', tokenType: 'Bearer', expiresAt: null, usePkce: true, clientAuthentication: 'header',
          ...(request.auth?.oauth2 ?? {}),
        },
      },
      formFields: request.formFields ?? [],
      preRequestScript: request.preRequestScript ?? '',
      postResponseScript: request.postResponseScript ?? '',
      testScript: request.testScript ?? (request.sourceData?.kind === 'bruno' ? String((request.sourceData.data as any)?.request?.tests ?? '') : ''),
      assertions: request.assertions ?? [],
      documentation: request.documentation ?? '',
      timeoutMs: request.timeoutMs ?? 30_000,
      followRedirects: request.followRedirects ?? true,
      graphql: { query: '', variables: '{}', operationName: '', ...(request.graphql ?? {}) },
      websocket: { messages: [], protocols: [], autoReconnect: false, reconnectAttempts: 3, keepAliveIntervalMs: 0, ...(request.websocket ?? {}) },
      grpc: { protoPath: '', service: '', method: '', methodType: 'unary', messages: [], useTls: false, ...(request.grpc ?? {}) },
    }));
    const structure = migrateApiClientFolders(normalizedRequests, $state.snapshot(payload.folders ?? []));
    const nextRunners = normalizeApiClientRunners(
      $state.snapshot(payload.runners ?? []),
      structure.requests.map((request) => request.id),
    );
    requests = structure.requests;
    folders = structure.folders;
    runners = nextRunners;
    selectedRunnerId = payload.selectedRunnerId && nextRunners.some((runner) => runner.id === payload.selectedRunnerId)
      ? payload.selectedRunnerId
      : nextRunners[0]?.id ?? null;
    selectedRequestId = payload.selectedRequestId ?? structure.requests[0]?.id ?? null;
    variables = $state.snapshot(payload.variables ?? {});
    environments = $state.snapshot(payload.environments ?? {});
    globalVariables = $state.snapshot(payload.globalVariables ?? {});
    runtimeVariables = $state.snapshot(payload.runtimeVariables ?? {});
    scriptDialect = payload.scriptDialect ?? (payload.sourceKind === 'postman' ? 'postman' : payload.sourceKind === 'bruno' || payload.sourceKind === 'openCollection' ? 'bruno' : 'orkestrai');
    vaultKeys = $state.snapshot(payload.vaultKeys ?? []);
    activeEnvironment = payload.activeEnvironment && payload.environments?.[payload.activeEnvironment]
      ? payload.activeEnvironment
      : null;
    history = $state.snapshot(payload.history ?? []);
    collectionPreRequestScript = payload.collectionPreRequestScript ?? '';
    collectionPostResponseScript = payload.collectionPostResponseScript ?? '';
    compatibilityWarnings = $state.snapshot(payload.compatibilityWarnings ?? []);
    network = $state.snapshot({ cookieJarEnabled: true, cookies: [], proxyUrl: '', caPath: '', clientCertificatePath: '', clientKeyPath: '', clientPfxPath: '', clientKeyPassphrase: '', rejectUnauthorized: true, ...(payload.network ?? {}) });
    sync = $state.snapshot(payload.sync ?? { mode: 'manual', conflictPolicy: 'ask', lastSyncedAt: null, sourceFingerprint: null, localFingerprint: null, managedFiles: [] });
    if (structure.migrated) queueMicrotask(() => persist());
  });

  function inputValue(event: Event): string {
    return (event.currentTarget as HTMLInputElement).value;
  }

  function linkedSourceWritable(kind: ApiClientNodePayload['sourceKind']): boolean {
    return kind === 'bruno' || kind === 'openCollection' || kind === 'postman';
  }

  function persist(extra: Record<string, unknown> = {}) {
    data.onPayloadChange?.(id, {
      requests: $state.snapshot(requests),
      folders: $state.snapshot(folders),
      runners: $state.snapshot(runners),
      selectedRunnerId,
      selectedRequestId,
      variables: $state.snapshot(variables),
      environments: $state.snapshot(environments),
      globalVariables: $state.snapshot(globalVariables),
      runtimeVariables: $state.snapshot(runtimeVariables),
      scriptDialect,
      vaultKeys: $state.snapshot(vaultKeys),
      activeEnvironment,
      history: $state.snapshot(history),
      collectionPreRequestScript,
      collectionPostResponseScript,
      network: $state.snapshot(network),
      sync: $state.snapshot(sync),
      ...extra,
    });
  }

  function currentPayload(): ApiClientNodePayload {
    return {
      ...$state.snapshot(data.payload),
      requests: $state.snapshot(requests), folders: $state.snapshot(folders), runners: $state.snapshot(runners),
      selectedRunnerId, selectedRequestId, variables: $state.snapshot(variables), environments: $state.snapshot(environments),
      globalVariables: $state.snapshot(globalVariables), runtimeVariables: $state.snapshot(runtimeVariables), scriptDialect, vaultKeys: $state.snapshot(vaultKeys),
      activeEnvironment, history: $state.snapshot(history), collectionPreRequestScript, collectionPostResponseScript,
      compatibilityWarnings: $state.snapshot(compatibilityWarnings), network: $state.snapshot(network), sync: $state.snapshot(sync),
    };
  }

  function applySynchronizedPayload(payload: ApiClientNodePayload) {
    const nextRequests = $state.snapshot(payload.requests ?? []) as ApiClientRequest[];
    const structure = migrateApiClientFolders(nextRequests, $state.snapshot(payload.folders ?? []));
    requests = structure.requests;
    folders = structure.folders;
    runners = normalizeApiClientRunners($state.snapshot(payload.runners ?? []), requests.map((request) => request.id));
    selectedRunnerId = payload.selectedRunnerId ?? runners[0]?.id ?? null;
    selectedRequestId = payload.selectedRequestId ?? requests[0]?.id ?? null;
    variables = $state.snapshot(payload.variables ?? {});
    environments = $state.snapshot(payload.environments ?? {});
    globalVariables = $state.snapshot(payload.globalVariables ?? {});
    runtimeVariables = $state.snapshot(payload.runtimeVariables ?? {});
    scriptDialect = payload.scriptDialect ?? 'orkestrai';
    vaultKeys = $state.snapshot(payload.vaultKeys ?? []);
    activeEnvironment = payload.activeEnvironment ?? null;
    collectionPreRequestScript = payload.collectionPreRequestScript ?? '';
    collectionPostResponseScript = payload.collectionPostResponseScript ?? '';
    compatibilityWarnings = $state.snapshot(payload.compatibilityWarnings ?? []);
    network = $state.snapshot(payload.network ?? network);
    sync = $state.snapshot(payload.sync ?? sync);
    data.onPayloadChange?.(id, $state.snapshot(payload) as Record<string, unknown>);
  }

  async function synchronize(action: 'status' | 'pull' | 'push', resolution?: 'orkestrai' | 'filesystem', automatic = false) {
    if (syncing || !data.payload.sourcePath) return;
    syncing = true;
    try {
      const csrf = getCsrfToken();
      const result = await fetch(`/api/agent-room/workspaces/${data.workspaceId}/api-client/sync`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
        body: JSON.stringify({ action, nodeId: id, ...(action === 'push' ? { payload: currentPayload(), resolution } : {}) }),
      });
      const body = await result.json().catch(() => ({}));
      if (!result.ok || body.error) throw new Error(body.error || m['api_client.sync_failed']());
      const value = body.data;
      if (action === 'status') {
        syncStatus = value;
        if (automatic && value.linked) {
          let nextAction: 'pull' | 'push' | null = null;
          let nextResolution: 'orkestrai' | 'filesystem' | undefined;
          if (value.sourceChanged && value.localChanged) {
            if (sync.conflictPolicy === 'filesystem') { nextAction = 'pull'; nextResolution = 'filesystem'; }
            else if (sync.conflictPolicy === 'orkestrai' && value.writable) { nextAction = 'push'; nextResolution = 'orkestrai'; }
          } else if (value.sourceChanged) { nextAction = 'pull'; nextResolution = 'filesystem'; }
          else if (value.localChanged && value.writable) { nextAction = 'push'; nextResolution = 'orkestrai'; }
          if (nextAction) {
            syncing = false;
            await synchronize(nextAction, nextResolution, true);
          }
        }
      } else if (value.status === 'conflict') {
        syncStatus = { linked: true, writable: linkedSourceWritable(data.payload.sourceKind), sourceChanged: true, localChanged: Boolean(value.localChanged), conflict: true, sourcePath: value.sourcePath };
      } else if (value.payload) {
        applySynchronizedPayload(value.payload);
        syncStatus = { linked: true, writable: linkedSourceWritable(data.payload.sourceKind), sourceChanged: false, localChanged: false, conflict: false, sourcePath: data.payload.sourcePath ?? undefined, lastSyncedAt: value.payload.sync?.lastSyncedAt };
        if (!automatic) toast.success(action === 'pull' ? m['api_client.sync_pull_success']() : m['api_client.sync_push_success']({ count: value.files ?? 0 }));
      }
    } catch (cause) {
      if (!automatic) {
        error = cause instanceof Error ? cause.message : m['api_client.sync_failed']();
        toast.error(error);
      }
    } finally {
      syncing = false;
    }
  }

  $effect(() => {
    const watching = sync.mode === 'watch' && Boolean(data.payload.sourcePath);
    if (!watching) return;
    const timer = setInterval(() => void synchronize('status', undefined, true), 5_000);
    return () => clearInterval(timer);
  });

  function chooseRequest(requestId: string) {
    selectedRequestId = requestId;
    response = null;
    error = '';
    data.onPayloadChange?.(id, { selectedRequestId });
  }

  function updateRequest(changes: Partial<ApiClientRequest>, persistNow = false) {
    if (!selectedRequest) return;
    requests = requests.map((request) => request.id === selectedRequest.id ? { ...request, ...changes } : request);
    if (persistNow) persist();
  }

  function changeProtocol(protocol: ApiClientProtocol) {
    if (!selectedRequest) return;
    const method = protocol === 'websocket' ? 'GET' : protocol === 'grpc' || protocol === 'graphql' ? 'POST' : selectedRequest.method;
    updateRequest({ protocol, method }, true);
    activeTab = 'body';
    response = null;
  }

  function addProtocolMessage(protocol: 'websocket' | 'grpc') {
    if (!selectedRequest) return;
    const message: ApiClientMessage = {
      id: crypto.randomUUID(),
      name: m['api_client.message_name_default']({ count: (selectedRequest[protocol]?.messages.length ?? 0) + 1 }),
      content: protocol === 'grpc' ? '{}' : '',
      type: protocol === 'grpc' ? 'json' : 'text',
      enabled: true,
    };
    updateRequest({ [protocol]: { ...selectedRequest[protocol], messages: [...(selectedRequest[protocol]?.messages ?? []), message] } }, true);
  }

  function updateProtocolMessage(protocol: 'websocket' | 'grpc', messageId: string, changes: Partial<ApiClientMessage>, persistNow = false) {
    if (!selectedRequest) return;
    updateRequest({
      [protocol]: {
        ...selectedRequest[protocol],
        messages: (selectedRequest[protocol]?.messages ?? []).map((message) => message.id === messageId ? { ...message, ...changes } : message),
      },
    }, persistNow);
  }

  function removeProtocolMessage(protocol: 'websocket' | 'grpc', messageId: string) {
    if (!selectedRequest) return;
    updateRequest({
      [protocol]: { ...selectedRequest[protocol], messages: (selectedRequest[protocol]?.messages ?? []).filter((message) => message.id !== messageId) },
    }, true);
  }

  async function pickProtoFile() {
    if (!selectedRequest) return;
    const path = await desktop?.pickApiCollection?.('proto');
    if (path) updateRequest({ grpc: { ...selectedRequest.grpc!, protoPath: path } }, true);
  }

  async function pickNetworkFile(field: 'caPath' | 'clientCertificatePath' | 'clientKeyPath' | 'clientPfxPath', kind: 'certificate' | 'privateKey' | 'pfx') {
    const path = await desktop?.pickApiCollection?.(kind);
    if (!path) return;
    network = { ...network, [field]: path };
    persist();
  }

  async function authorizeOAuth() {
    if (!selectedRequest || selectedRequest.auth.type !== 'oauth2' || oauthAuthorizing) return;
    const requestId = selectedRequest.id;
    const popup = !desktop?.openExternal ? window.open('about:blank', '_blank', 'noopener,noreferrer') : null;
    oauthAuthorizing = true;
    error = '';
    try {
      const csrf = getCsrfToken();
      const call = async (body: Record<string, unknown>) => {
        const result = await fetch(`/api/agent-room/workspaces/${data.workspaceId}/api-client/oauth`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
          body: JSON.stringify(body),
        });
        const payload = await result.json().catch(() => ({}));
        if (!result.ok || payload.error) throw new Error(payload.error || m['api_client.oauth_failed']());
        return payload.data as { status: 'pending' | 'complete' | 'error'; state?: string; authorizationUrl?: string; error?: string; tokens?: NonNullable<ApiClientRequest['auth']['oauth2']> };
      };
      let result = await call({ action: 'authorize', nodeId: id, request: selectedRequest, variables: effectiveVariables(), locale: localeState.current });
      if (result.status === 'pending' && result.state && result.authorizationUrl) {
        if (popup) popup.location.href = result.authorizationUrl;
        else await desktop?.openExternal?.(result.authorizationUrl);
        for (let attempt = 0; attempt < 120 && result.status === 'pending'; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 1_000));
          result = await call({ action: 'poll', nodeId: id, state: result.state });
        }
      } else popup?.close();
      if (result.status === 'pending') throw new Error(m['api_client.oauth_timeout']());
      if (result.status === 'error') throw new Error(result.error || m['api_client.oauth_failed']());
      if (!result.tokens?.accessToken) throw new Error(m['api_client.oauth_failed']());
      requests = requests.map((request) => request.id === requestId ? {
        ...request,
        auth: { ...request.auth, oauth2: { ...request.auth.oauth2!, ...result.tokens } },
      } : request);
      persist();
      toast.success(m['api_client.oauth_success']());
    } catch (cause) {
      popup?.close();
      error = cause instanceof Error ? cause.message : m['api_client.oauth_failed']();
      toast.error(error);
    } finally {
      oauthAuthorizing = false;
    }
  }

  function addRequest(folderId: string | null = null) {
    const request: ApiClientRequest = {
      id: crypto.randomUUID(),
      name: m['api_client.new_request'](),
      method: 'GET',
      protocol: 'http',
      url: '',
      folder: '',
      folderId,
      sequence: requests.length,
      params: [],
      headers: [],
      auth: { type: 'none', token: '', username: '', password: '', key: '', value: '', placement: 'header', oauth2: { grantType: 'authorization_code', authorizationUrl: '', tokenUrl: '', clientId: '', clientSecret: '', scope: '', audience: '', username: '', password: '', accessToken: '', refreshToken: '', tokenType: 'Bearer', expiresAt: null, usePkce: true, clientAuthentication: 'header' } },
      body: '',
      bodyMode: 'none',
      formFields: [],
      preRequestScript: '',
      postResponseScript: '',
      testScript: '',
      assertions: [],
      documentation: '',
      timeoutMs: 30_000,
      followRedirects: true,
      graphql: { query: '', variables: '{}', operationName: '' },
      websocket: { messages: [], protocols: [], autoReconnect: false, reconnectAttempts: 3, keepAliveIntervalMs: 0 },
      grpc: { protoPath: '', service: '', method: '', methodType: 'unary', messages: [], useTls: false },
      sourcePath: null,
    };
    requests = [...requests, request];
    selectedRequestId = request.id;
    persist();
  }

  function deleteRequest(requestId = selectedRequest?.id) {
    if (!requestId) return;
    requests = requests.filter((request) => request.id !== requestId).map((request, sequence) => ({ ...request, sequence }));
    if (selectedRequestId === requestId) selectedRequestId = requests[0]?.id ?? null;
    response = null;
    runners = runners.map((runner) => ({ ...runner, requestIds: runner.requestIds.filter((id) => id !== requestId) }));
    persist();
  }

  function duplicateRequest(requestId: string) {
    const source = requests.find((request) => request.id === requestId);
    if (!source) return;
    const clone = $state.snapshot(source);
    clone.id = crypto.randomUUID();
    clone.name = m['api_client.copy_name']({ name: source.name });
    const sourceIndex = orderedRequests.findIndex((request) => request.id === requestId);
    const next = [...orderedRequests];
    next.splice(sourceIndex + 1, 0, clone);
    requests = next.map((request, sequence) => ({ ...request, sequence }));
    selectedRequestId = clone.id;
    persist();
  }

  function moveRequest(requestId: string, direction: -1 | 1) {
    const source = requests.find((request) => request.id === requestId);
    if (!source) return;
    const siblings = orderedRequests.filter((request) => (request.folderId ?? null) === (source.folderId ?? null));
    const next = [...siblings];
    const index = next.findIndex((request) => request.id === requestId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    const sequenceById = new Map(next.map((request, sequence) => [request.id, sequence]));
    requests = requests.map((request) => sequenceById.has(request.id) ? { ...request, sequence: sequenceById.get(request.id) } : request);
    persist();
  }

  function updateDropIndicator(event: DragEvent, target: ApiClientTreeRow) {
    if (!draggedItem || draggedItem.id === target.id) {
      dropIndicator = null;
      return;
    }
    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const ratio = bounds.height > 0 ? (event.clientY - bounds.top) / bounds.height : 0.5;
    let placement: 'before' | 'after' | 'inside';
    if (target.kind === 'folder' && draggedItem.kind === 'request') {
      placement = 'inside';
    } else if (target.kind === 'folder' && ratio >= 0.25 && ratio <= 0.75) {
      placement = 'inside';
    } else {
      placement = ratio < 0.5 ? 'before' : 'after';
    }
    dropIndicator = { kind: target.kind, id: target.id, placement };
  }

  function finishDrag() {
    draggedItem = null;
    dropIndicator = null;
  }

  function dropItem(target: ApiClientTreeRow | null, placement: 'before' | 'after' | 'inside' = 'inside') {
    if (!draggedItem || draggedItem.id === target?.id) return;
    if (draggedItem.kind === 'request') {
      const source = requests.find((request) => request.id === draggedItem?.id);
      if (!source) return;
      const targetFolderId = target?.kind === 'folder' ? target.folder.id : target?.kind === 'request' ? (target.request.folderId ?? null) : null;
      const siblings = orderedRequests.filter((request) => request.id !== source.id && (request.folderId ?? null) === targetFolderId);
      const siblingIndex = target?.kind === 'request' ? siblings.findIndex((request) => request.id === target.request.id) : -1;
      const targetIndex = siblingIndex >= 0 ? siblingIndex + (placement === 'after' ? 1 : 0) : siblings.length;
      siblings.splice(targetIndex, 0, { ...source, folderId: targetFolderId });
      const sequenceById = new Map(siblings.map((request, sequence) => [request.id, sequence]));
      requests = requests.map((request) => request.id === source.id
        ? { ...request, folderId: targetFolderId, sequence: sequenceById.get(request.id) ?? 0 }
        : sequenceById.has(request.id) ? { ...request, sequence: sequenceById.get(request.id) } : request);
    } else {
      const folder = folders.find((candidate) => candidate.id === draggedItem?.id);
      if (!folder) return;
      const descendants = apiClientDescendantFolderIds(folders, folder.id);
      const targetParentId = target?.kind === 'folder'
        ? (descendants.has(target.folder.id) ? folder.parentId : placement === 'inside' ? target.folder.id : target.folder.parentId)
        : target?.kind === 'request' ? (target.request.folderId ?? null) : null;
      const siblings = folders.filter((candidate) => candidate.id !== folder.id && candidate.parentId === targetParentId).sort((a, b) => a.sequence - b.sequence);
      const siblingIndex = target?.kind === 'folder' && placement !== 'inside'
        ? siblings.findIndex((candidate) => candidate.id === target.folder.id)
        : -1;
      const targetIndex = siblingIndex >= 0 ? siblingIndex + (placement === 'after' ? 1 : 0) : siblings.length;
      siblings.splice(targetIndex, 0, { ...folder, parentId: targetParentId });
      const sequenceById = new Map(siblings.map((candidate, sequence) => [candidate.id, sequence]));
      folders = folders.map((candidate) => candidate.id === folder.id
        ? { ...candidate, parentId: targetParentId, sequence: sequenceById.get(candidate.id) ?? 0 }
        : sequenceById.has(candidate.id) ? { ...candidate, sequence: sequenceById.get(candidate.id)! } : candidate);
    }
    finishDrag();
    persist();
  }

  function openCreateFolder(parentId: string | null = null) {
    folderDialogMode = 'create';
    editingFolderId = null;
    folderDialogName = '';
    folderDialogParentId = parentId;
    folderDialogOpen = true;
  }

  function openRenameFolder(folder: ApiClientFolder) {
    folderDialogMode = 'rename';
    editingFolderId = folder.id;
    folderDialogName = folder.name;
    folderDialogParentId = folder.parentId;
    folderDialogOpen = true;
  }

  function saveFolder() {
    const name = folderDialogName.trim();
    if (!name) return;
    if (folderDialogMode === 'rename' && editingFolderId) {
      const blocked = apiClientDescendantFolderIds(folders, editingFolderId);
      const parentId = folderDialogParentId && !blocked.has(folderDialogParentId) ? folderDialogParentId : null;
      folders = folders.map((folder) => folder.id === editingFolderId ? { ...folder, name, parentId } : folder);
    } else {
      folders = [...folders, { id: crypto.randomUUID(), name, parentId: folderDialogParentId, sequence: folders.filter((folder) => folder.parentId === folderDialogParentId).length }];
    }
    folderDialogOpen = false;
    persist();
  }

  function deleteFolder(folderId: string) {
    const removed = apiClientDescendantFolderIds(folders, folderId);
    folders = folders.filter((folder) => !removed.has(folder.id));
    requests = requests.map((request) => removed.has(request.folderId ?? '') ? { ...request, folderId: null } : request);
    persist();
  }

  function toggleFolder(folderId: string) {
    const next = new Set(collapsedFolderIds);
    if (next.has(folderId)) next.delete(folderId);
    else next.add(folderId);
    collapsedFolderIds = next;
  }

  function requestsInFolder(folderId: string): ApiClientRequest[] {
    const ids = apiClientDescendantFolderIds(folders, folderId);
    return orderedRequests.filter((request) => ids.has(request.folderId ?? ''));
  }

  function addHeader() {
    if (!selectedRequest) return;
    updateRequest({ headers: [...selectedRequest.headers, { id: crypto.randomUUID(), name: '', value: '', enabled: true }] }, true);
  }

  function updateHeader(headerId: string, changes: Partial<ApiClientHeader>, persistNow = false) {
    if (!selectedRequest) return;
    updateRequest({
      headers: selectedRequest.headers.map((header) => header.id === headerId ? { ...header, ...changes } : header),
    }, persistNow);
  }

  function removeHeader(headerId: string) {
    if (!selectedRequest) return;
    updateRequest({ headers: selectedRequest.headers.filter((header) => header.id !== headerId) }, true);
  }

  function addKeyValue(field: 'params' | 'formFields') {
    if (!selectedRequest) return;
    updateRequest({ [field]: [...(selectedRequest[field] ?? []), { id: crypto.randomUUID(), name: '', value: '', enabled: true }] }, true);
  }

  function updateKeyValue(field: 'params' | 'formFields', fieldId: string, changes: Partial<ApiClientKeyValue>, persistNow = false) {
    if (!selectedRequest) return;
    updateRequest({ [field]: (selectedRequest[field] ?? []).map((item) => item.id === fieldId ? { ...item, ...changes } : item) }, persistNow);
  }

  function removeKeyValue(field: 'params' | 'formFields', fieldId: string) {
    if (!selectedRequest) return;
    updateRequest({ [field]: (selectedRequest[field] ?? []).filter((item) => item.id !== fieldId) }, true);
  }

  function addAssertion() {
    if (!selectedRequest) return;
    const assertion: ApiClientAssertion = { id: crypto.randomUUID(), source: 'status', property: '', operator: 'equals', expected: '200', enabled: true };
    updateRequest({ assertions: [...(selectedRequest.assertions ?? []), assertion] }, true);
  }

  function updateAssertion(assertionId: string, changes: Partial<ApiClientAssertion>, persistNow = false) {
    if (!selectedRequest) return;
    updateRequest({ assertions: (selectedRequest.assertions ?? []).map((item) => item.id === assertionId ? { ...item, ...changes } : item) }, persistNow);
  }

  function removeAssertion(assertionId: string) {
    if (!selectedRequest) return;
    updateRequest({ assertions: (selectedRequest.assertions ?? []).filter((item) => item.id !== assertionId) }, true);
  }

  function addVariable() {
    if (variableEditorScope === 'vault') return;
    const current = currentVariables();
    let index = Object.keys(current).length + 1;
    while (`variable${index}` in current) index += 1;
    setCurrentVariables({ ...current, [`variable${index}`]: '' });
    persist();
  }

  function currentVariables(): Record<string, string> {
    if (variableEditorScope === 'globals') return globalVariables;
    if (variableEditorScope === 'runtime') return runtimeVariables;
    if (variableEditorScope === 'environment') return activeEnvironment ? (environments[activeEnvironment] ?? {}) : {};
    return variables;
  }

  function effectiveVariables(environmentName: string | null = activeEnvironment): Record<string, string> {
    return { ...globalVariables, ...variables, ...(environmentName ? environments[environmentName] : {}), ...runtimeVariables };
  }

  function applyExecutionVariables(next: Record<string, string>, environmentName: string | null) {
    if (!environmentName) {
      variables = next;
      return;
    }
    const previousEnvironment = environments[environmentName] ?? {};
    const nextEnvironment = Object.fromEntries(Object.entries(next).filter(([key, value]) =>
      key in previousEnvironment || !(key in variables) || variables[key] !== value
    ));
    environments = { ...environments, [environmentName]: nextEnvironment };
  }

  function applyExecutionScopes(scopes: NonNullable<ApiResponse['scopes']>, environmentName: string | null) {
    variables = { ...scopes.collection };
    globalVariables = { ...scopes.globals };
    runtimeVariables = { ...scopes.runtime };
    if (environmentName) environments = { ...environments, [environmentName]: { ...scopes.environment } };
  }

  function setCurrentVariables(next: Record<string, string>) {
    if (variableEditorScope === 'globals') globalVariables = next;
    else if (variableEditorScope === 'runtime') runtimeVariables = next;
    else if (variableEditorScope === 'environment' && activeEnvironment) environments = { ...environments, [activeEnvironment]: next };
    else variables = next;
  }

  function renameVariable(oldName: string, newName: string) {
    const normalized = newName.trim();
    const current = currentVariables();
    if (!normalized || normalized === oldName || normalized in current) return;
    const next: Record<string, string> = {};
    for (const [name, value] of Object.entries(current)) next[name === oldName ? normalized : name] = value;
    setCurrentVariables(next);
    persist();
  }

  function updateVariable(name: string, value: string) {
    setCurrentVariables({ ...currentVariables(), [name]: value });
  }

  function removeVariable(name: string) {
    const next = { ...currentVariables() };
    delete next[name];
    setCurrentVariables(next);
    persist();
  }

  function addEnvironment() {
    const name = newEnvironmentName.trim();
    if (!name || environments[name]) return;
    environments = { ...environments, [name]: {} };
    activeEnvironment = name;
    variableEditorScope = 'environment';
    newEnvironmentName = '';
    persist();
  }

  function deleteEnvironment() {
    if (!activeEnvironment) return;
    const next = { ...environments };
    delete next[activeEnvironment];
    environments = next;
    activeEnvironment = null;
    if (variableEditorScope === 'environment') variableEditorScope = 'collection';
    persist();
  }

  async function vaultSecretKey(name: string) {
    const bytes = new TextEncoder().encode(name);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 32);
    return `automation:api-vault:${data.workspaceId}:${id}:${hash}`;
  }

  async function saveVaultVariable() {
    const name = vaultName.trim();
    if (!name || !vaultValue || !desktop?.saveAutomationSecret) return;
    await desktop.saveAutomationSecret(await vaultSecretKey(name), vaultValue);
    if (!vaultKeys.includes(name)) vaultKeys = [...vaultKeys, name].sort();
    vaultName = '';
    vaultValue = '';
    persist();
    toast.success(m['api_client.vault_saved']());
  }

  async function removeVaultVariable(name: string) {
    await desktop?.deleteAutomationSecret?.(await vaultSecretKey(name));
    vaultKeys = vaultKeys.filter((key) => key !== name);
    persist();
  }

  function bodyModeLabel(mode: string) {
    if (mode === 'json') return m['api_client.body_json']();
    if (mode === 'text') return m['api_client.body_text']();
    if (mode === 'xml') return m['api_client.body_xml']();
    if (mode === 'form') return m['api_client.body_form']();
    if (mode === 'multipart') return m['api_client.body_multipart']();
    return m['api_client.body_none']();
  }

  function testSourceLabel(source: string) {
    if (source === 'body') return m['api_client.test_source_body']();
    if (source === 'header') return m['api_client.test_source_header']();
    if (source === 'responseTime') return m['api_client.test_source_responseTime']();
    return m['api_client.test_source_status']();
  }

  function testOperatorLabel(operator: string) {
    if (operator === 'notEquals') return m['api_client.test_operator_notEquals']();
    if (operator === 'contains') return m['api_client.test_operator_contains']();
    if (operator === 'exists') return m['api_client.test_operator_exists']();
    if (operator === 'matches') return m['api_client.test_operator_matches']();
    if (operator === 'lt') return m['api_client.test_operator_lt']();
    if (operator === 'lte') return m['api_client.test_operator_lte']();
    if (operator === 'gt') return m['api_client.test_operator_gt']();
    if (operator === 'gte') return m['api_client.test_operator_gte']();
    return m['api_client.test_operator_equals']();
  }

  function scriptStageLabel(stage: unknown): string {
    if (stage === 'collectionPreRequest') return m['api_client.collection_pre_request_script']();
    if (stage === 'folderPreRequest') return m['api_client.folder_pre_request_script']();
    if (stage === 'requestPostResponse') return m['api_client.post_response_script']();
    if (stage === 'folderPostResponse') return m['api_client.folder_post_response_script']();
    if (stage === 'collectionPostResponse') return m['api_client.collection_post_response_script']();
    return m['api_client.pre_request_script']();
  }

  function scriptRuntimeHint(): string {
    if (scriptDialect === 'postman') return m['api_client.script_hint_postman']();
    if (scriptDialect === 'bruno') return m['api_client.script_hint_bruno']();
    return m['api_client.script_hint_orkestrai']();
  }

  function executionErrorMessage(payload: ApiClientErrorPayload): string {
    const detail = typeof payload.error === 'string' && payload.error.trim()
      ? payload.error.trim()
      : m['api_client.request_failed']();
    if (payload.code !== 'api_client_script_failed') return detail;
    const stage = scriptStageLabel(payload.stage);
    return typeof payload.lineNumber === 'number' && Number.isFinite(payload.lineNumber)
      ? m['api_client.script_error_line']({ stage, line: Math.trunc(payload.lineNumber), detail })
      : m['api_client.script_error']({ stage, detail });
  }

  function renderClientVariables(value: string): string {
    const values = effectiveVariables();
    return value.replace(/{{\s*([^{}]+?)\s*}}/g, (match, name) =>
      Object.prototype.hasOwnProperty.call(values, name) ? values[name] : match
    );
  }

  function shellQuote(value: string): string {
    return `'${value.replaceAll("'", "'\\''")}'`;
  }

  async function executeRequest(
    request: ApiClientRequest,
    showResponse = true,
    executionVariables = effectiveVariables(),
    environmentName: string | null = activeEnvironment,
    iterationIndex = 0,
    iterationCount = 1,
    iterationData: Record<string, unknown> = {},
  ): Promise<ApiResponse> {
    error = '';
    if (showResponse) response = null;
    const csrf = getCsrfToken();
    const result = await fetch(`/api/agent-room/workspaces/${data.workspaceId}/api-client/execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
      body: JSON.stringify({
        nodeId: id,
        request,
        variables: executionVariables,
        collectionVariables: variables,
        environmentVariables: environmentName ? (environments[environmentName] ?? {}) : {},
        globalVariables,
        runtimeVariables,
        iterationData,
        iterationIndex,
        iterationCount,
        scriptDialect,
        timeoutMs: request.timeoutMs ?? 30_000,
        collectionPreRequestScript,
        collectionPostResponseScript,
      }),
    });
    const payload = await result.json().catch(() => ({}));
    if (!result.ok || payload.error) throw new Error(executionErrorMessage(payload));
    const apiResponse = payload.data as ApiResponse;
    if (apiResponse.scopes) applyExecutionScopes(apiResponse.scopes, environmentName);
    else if (apiResponse.variables) applyExecutionVariables(apiResponse.variables, environmentName);
    if (apiResponse.cookies) network = { ...network, cookies: $state.snapshot(apiResponse.cookies) };
    if (apiResponse.vaultKeys) vaultKeys = $state.snapshot(apiResponse.vaultKeys);
    const passed = apiResponse.tests.filter((test) => test.passed).length;
    const entry: ApiClientHistoryEntry = {
      id: crypto.randomUUID(), requestId: request.id, requestName: request.name, method: request.method, protocol: request.protocol ?? 'http',
      url: request.url, status: apiResponse.status, ok: apiResponse.ok, durationMs: apiResponse.durationMs,
      size: apiResponse.size, testPassed: passed, testFailed: apiResponse.tests.length - passed, executedAt: new Date().toISOString(),
    };
    history = [entry, ...history].slice(0, 50);
    persist();
    if (showResponse) {
      response = apiResponse;
      activeTab = 'response';
      responseView = apiResponse.visualizations?.length ? 'visualizer' : apiResponse.messages?.length ? 'messages' : 'body';
    }
    return apiResponse;
  }

  async function sendRequest() {
    if (!selectedRequest || !selectedRequest.url.trim() || sending) return;
    sending = true;
    try {
      await executeRequest(selectedRequest);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : m['api_client.request_failed']();
    } finally {
      sending = false;
    }
  }

  async function runRequests(
    selectedRequests: ApiClientRequest[],
    options: Pick<ApiClientRunner, 'environment' | 'iterations' | 'iterationData' | 'delayMs' | 'stopOnFailure'> = { environment: activeEnvironment, iterations: 1, iterationData: [], delayMs: 0, stopOnFailure: false },
  ) {
    if (running || !selectedRequests.length) return;
    running = true;
    const total = selectedRequests.length * options.iterations;
    runProgress = { completed: 0, total, failed: 0 };
    runtimeVariables = {};
    let chainVariables = effectiveVariables(options.environment);
    let shouldStop = false;
    try {
      for (let iteration = 0; iteration < options.iterations && !shouldStop; iteration += 1) {
        let cursor = 0;
        let steps = 0;
        while (cursor < selectedRequests.length && !shouldStop) {
          const request = selectedRequests[cursor];
          let failed = false;
          let execution: ApiResponse | null = null;
          try {
            execution = await executeRequest(
              request,
              request.id === selectedRequestId,
              chainVariables,
              options.environment,
              iteration,
              options.iterations,
              options.iterationData[iteration] ?? {},
            );
            chainVariables = execution.variables ?? chainVariables;
            failed = !execution.ok || execution.tests.some((test) => !test.passed);
          } catch {
            failed = true;
          }
          if (failed) runProgress.failed += 1;
          runProgress.completed += 1;
          if (failed && options.stopOnFailure) {
            shouldStop = true;
            break;
          }
          if (execution?.flow?.stopExecution || execution?.flow?.nextRequest === null) {
            shouldStop = true;
            break;
          }
          if (typeof execution?.flow?.nextRequest === 'string') {
            const requestedIndex = selectedRequests.findIndex((candidate) => candidate.id === execution?.flow?.nextRequest || candidate.name === execution?.flow?.nextRequest);
            cursor = requestedIndex >= 0 ? requestedIndex : cursor + 1;
          } else cursor += 1;
          steps += 1;
          if (steps >= 10_000) {
            toast.error(m['api_client.run_flow_limit']());
            shouldStop = true;
            break;
          }
          if (options.delayMs > 0 && runProgress.completed < total) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
        }
      }
      if (runProgress.failed) {
        toast.error(m['api_client.run_completed_failed']({ failed: runProgress.failed, total: runProgress.completed }));
      } else {
        toast.success(m['api_client.run_completed']({ total: runProgress.completed }));
      }
    } finally {
      running = false;
    }
  }

  async function runCollection() {
    await runRequests(orderedRequests);
  }

  async function runFolder(folderId: string) {
    await runRequests(requestsInFolder(folderId));
  }

  async function runRunner(runner: ApiClientRunner) {
    const byId = new Map(requests.map((request) => [request.id, request]));
    const selected = runner.requestIds.map((requestId) => byId.get(requestId)).filter((request): request is ApiClientRequest => Boolean(request));
    await runRequests(selected, runner);
  }

  function saveRunners(next: ApiClientRunner[], nextSelectedId: string | null) {
    runners = normalizeApiClientRunners(next, requests.map((request) => request.id));
    selectedRunnerId = nextSelectedId;
    persist();
  }

  async function copyCurl() {
    if (!selectedRequest || selectedRequest.protocol === 'websocket' || selectedRequest.protocol === 'grpc') return;
    const graphql = selectedRequest.graphql ?? { query: '', variables: '{}', operationName: '' };
    let renderedUrl = renderClientVariables(selectedRequest.url);
    const query = new URLSearchParams();
    for (const param of selectedRequest.params ?? []) {
      if (param.enabled && param.name.trim()) query.append(param.name.trim(), renderClientVariables(param.value));
    }
    if (selectedRequest.auth.type === 'apiKey' && selectedRequest.auth.placement === 'query' && selectedRequest.auth.key?.trim()) {
      query.append(selectedRequest.auth.key.trim(), renderClientVariables(selectedRequest.auth.value ?? ''));
    }
    const queryString = query.toString();
    if (queryString) renderedUrl += `${renderedUrl.includes('?') ? '&' : '?'}${queryString}`;
    if (selectedRequest.protocol === 'graphql' && selectedRequest.method === 'GET') {
      const graphqlQuery = new URLSearchParams({ query: renderClientVariables(graphql.query) });
      if (graphql.variables.trim()) graphqlQuery.set('variables', renderClientVariables(graphql.variables));
      if (graphql.operationName) graphqlQuery.set('operationName', graphql.operationName);
      renderedUrl += `${renderedUrl.includes('?') ? '&' : '?'}${graphqlQuery.toString()}`;
    }
    const parts = [`curl --request ${selectedRequest.method}`, shellQuote(renderedUrl)];
    const explicitHeaders = new Set(selectedRequest.headers.filter((header) => header.enabled).map((header) => header.name.trim().toLowerCase()));
    for (const header of selectedRequest.headers) {
      if (header.enabled && header.name.trim()) parts.push(`--header ${shellQuote(`${header.name}: ${renderClientVariables(header.value)}`)}`);
    }
    if (selectedRequest.auth.type === 'bearer' && selectedRequest.auth.token && !explicitHeaders.has('authorization')) {
      parts.push(`--header ${shellQuote(`Authorization: Bearer ${renderClientVariables(selectedRequest.auth.token)}`)}`);
    } else if (selectedRequest.auth.type === 'basic') {
      parts.push(`--user ${shellQuote(`${renderClientVariables(selectedRequest.auth.username)}:${renderClientVariables(selectedRequest.auth.password)}`)}`);
    } else if (selectedRequest.auth.type === 'apiKey' && selectedRequest.auth.placement !== 'query' && selectedRequest.auth.key?.trim() && !explicitHeaders.has(selectedRequest.auth.key.trim().toLowerCase())) {
      parts.push(`--header ${shellQuote(`${selectedRequest.auth.key}: ${renderClientVariables(selectedRequest.auth.value ?? '')}`)}`);
    } else if (selectedRequest.auth.type === 'oauth2' && selectedRequest.auth.oauth2?.accessToken && !explicitHeaders.has('authorization')) {
      parts.push(`--header ${shellQuote(`Authorization: ${selectedRequest.auth.oauth2.tokenType || 'Bearer'} ${renderClientVariables(selectedRequest.auth.oauth2.accessToken)}`)}`);
    }
    if (selectedRequest.protocol === 'graphql' && selectedRequest.method !== 'GET') {
      parts.push(`--header ${shellQuote('Content-Type: application/json')}`);
      let graphqlVariables: unknown = {};
      try { graphqlVariables = JSON.parse(renderClientVariables(graphql.variables || '{}')); } catch { /* The copied command remains useful while variables are being edited. */ }
      parts.push(`--data-raw ${shellQuote(JSON.stringify({ query: renderClientVariables(graphql.query), variables: graphqlVariables, ...(graphql.operationName ? { operationName: graphql.operationName } : {}) }))}`);
    } else if (selectedRequest.bodyMode === 'form') {
      for (const field of selectedRequest.formFields ?? []) if (field.enabled && field.name.trim()) parts.push(`--data-urlencode ${shellQuote(`${field.name}=${renderClientVariables(field.value)}`)}`);
    } else if (selectedRequest.bodyMode === 'multipart') {
      for (const field of selectedRequest.formFields ?? []) if (field.enabled && field.name.trim()) parts.push(`--form ${shellQuote(`${field.name}=${renderClientVariables(field.value)}`)}`);
    } else if (selectedRequest.bodyMode !== 'none' && selectedRequest.body) {
      parts.push(`--data-raw ${shellQuote(renderClientVariables(selectedRequest.body))}`);
    }
    await navigator.clipboard.writeText(parts.join(' \\\n  '));
    toast.success(m['api_client.curl_copied']());
  }

  function exportPostman() {
    const payload = portablePayload();
    const collection = serializePostmanCollection(data.title, payload);
    const url = URL.createObjectURL(new Blob([JSON.stringify(collection, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = postmanCollectionFilename(data.title);
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function portablePayload(): ApiClientNodePayload {
    return {
      ...$state.snapshot(data.payload),
      formatVersion: 1,
      requests: $state.snapshot(requests),
      folders: $state.snapshot(folders),
      runners: $state.snapshot(runners),
      selectedRunnerId,
      selectedRequestId,
      variables: $state.snapshot(variables),
      environments: $state.snapshot(environments),
      activeEnvironment,
      history: $state.snapshot(history),
      collectionPreRequestScript,
      collectionPostResponseScript,
      compatibilityWarnings: $state.snapshot(compatibilityWarnings),
    };
  }

  function downloadText(contents: string, filename: string, type: string) {
    const url = URL.createObjectURL(new Blob([contents], { type }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function exportOpenApi(format: 'json' | 'yaml') {
    const document = exportOpenApiDocument(data.title, portablePayload());
    const slug = data.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'openapi';
    downloadText(
      format === 'json' ? `${JSON.stringify(document, null, 2)}\n` : stringifyYaml(document, { lineWidth: 0 }),
      `${slug}.openapi.${format === 'json' ? 'json' : 'yaml'}`,
      format === 'json' ? 'application/json' : 'application/yaml',
    );
  }

  function exportPostmanEnvironment() {
    const name = activeEnvironment;
    if (!name) return;
    const environment = {
      id: crypto.randomUUID(),
      name,
      values: Object.entries(environments[name] ?? {}).map(([key, value]) => ({ key, value, type: 'default', enabled: true })),
      _postman_variable_scope: 'environment',
      _postman_exported_at: new Date().toISOString(),
      _postman_exported_using: 'Orkestrai',
    };
    const slug = name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'environment';
    downloadText(`${JSON.stringify(environment, null, 2)}\n`, `${slug}.postman_environment.json`, 'application/json');
  }

  function exportNative() {
    const nativeCollection = {
      schema: 'https://orkestrai.app/schemas/api-client/v1',
      version: 1,
      name: data.title,
      exportedAt: new Date().toISOString(),
      payload: portablePayload(),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(nativeCollection, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${data.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'collection'}.orkestrai-api.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function exportBruno(kind: 'bruno' | 'openCollection') {
    if (importing || !requests.length) return;
    const path = await desktop?.pickApiExportDirectory?.();
    if (!path) return;
    importing = true;
    error = '';
    try {
      const csrf = getCsrfToken();
      const result = await fetch(`/api/agent-room/workspaces/${data.workspaceId}/api-client/export`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
        body: JSON.stringify({ nodeId: id, kind, path }),
      });
      const payload = await result.json().catch(() => ({}));
      if (!result.ok || payload.error) throw new Error(payload.error || m['api_client.export_failed']());
      toast.success(m[kind === 'openCollection' ? 'api_client.export_open_collection_success' : 'api_client.export_bruno_success']({ path: payload.data.path }));
    } catch (cause) {
      error = cause instanceof Error ? cause.message : m['api_client.export_failed']();
    } finally {
      importing = false;
    }
  }

  async function importCollection(kind: 'bruno' | 'postman' | 'native' | 'openapi' | 'openCollection' | 'postmanEnvironment') {
    if (importing) return;
    let path = kind === 'bruno'
      ? await desktop?.pickDirectory?.()
      : await desktop?.pickApiCollection?.(kind);
    if (!path && kind === 'bruno') path = await desktop?.pickApiCollection?.('bruno');
    if (!path) return;
    importing = true;
    error = '';
    try {
      const csrf = getCsrfToken();
      const result = await fetch(`/api/agent-room/workspaces/${data.workspaceId}/api-client/import`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
        body: JSON.stringify({ nodeId: id, kind, path }),
      });
      const payload = await result.json().catch(() => ({}));
      if (!result.ok || payload.error) throw new Error(payload.error || m['api_client.import_failed']());
      const imported = payload.data.payload as ApiClientNodePayload;
      const importedRequests: ApiClientRequest[] = $state.snapshot(imported.requests ?? []).map((request, index) => ({
        ...request,
        protocol: request.protocol ?? 'http', folder: request.folder ?? '', sequence: request.sequence ?? index, params: request.params ?? [], headers: request.headers ?? [],
        auth: {
          key: '', value: '', placement: 'header' as const, ...request.auth,
          oauth2: {
            grantType: 'authorization_code', authorizationUrl: '', tokenUrl: '', clientId: '', clientSecret: '', scope: '', audience: '',
            username: '', password: '', accessToken: '', refreshToken: '', tokenType: 'Bearer', expiresAt: null, usePkce: true, clientAuthentication: 'header',
            ...(request.auth?.oauth2 ?? {}),
          },
        }, formFields: request.formFields ?? [],
        preRequestScript: request.preRequestScript ?? '', postResponseScript: request.postResponseScript ?? '',
        testScript: request.testScript ?? (request.sourceData?.kind === 'bruno' ? String((request.sourceData.data as any)?.request?.tests ?? '') : ''),
        assertions: request.assertions ?? [], documentation: request.documentation ?? '', timeoutMs: request.timeoutMs ?? 30_000,
        followRedirects: request.followRedirects ?? true,
        graphql: { query: '', variables: '{}', operationName: '', ...(request.graphql ?? {}) },
        websocket: { messages: [], protocols: [], autoReconnect: false, reconnectAttempts: 3, keepAliveIntervalMs: 0, ...(request.websocket ?? {}) },
        grpc: { protoPath: '', service: '', method: '', methodType: 'unary', messages: [], useTls: false, ...(request.grpc ?? {}) },
      }));
      const structure = migrateApiClientFolders(importedRequests, $state.snapshot(imported.folders ?? []));
      requests = structure.requests;
      folders = structure.folders;
      runners = normalizeApiClientRunners($state.snapshot(imported.runners ?? []), requests.map((request) => request.id));
      selectedRunnerId = imported.selectedRunnerId ?? runners[0]?.id ?? null;
      selectedRequestId = imported.selectedRequestId ?? requests[0]?.id ?? null;
      variables = $state.snapshot(imported.variables ?? {});
      environments = $state.snapshot(imported.environments ?? {});
      globalVariables = $state.snapshot(imported.globalVariables ?? {});
      runtimeVariables = $state.snapshot(imported.runtimeVariables ?? {});
      scriptDialect = imported.scriptDialect ?? (imported.sourceKind === 'postman' ? 'postman' : imported.sourceKind === 'bruno' || imported.sourceKind === 'openCollection' ? 'bruno' : 'orkestrai');
      vaultKeys = $state.snapshot(imported.vaultKeys ?? []);
      activeEnvironment = imported.activeEnvironment ?? null;
      history = $state.snapshot(imported.history ?? []);
      collectionPreRequestScript = imported.collectionPreRequestScript ?? '';
      collectionPostResponseScript = imported.collectionPostResponseScript ?? '';
      compatibilityWarnings = $state.snapshot(imported.compatibilityWarnings ?? []);
      data.onPayloadChange?.(id, {
        ...imported,
        requests: $state.snapshot(requests),
        folders: $state.snapshot(folders),
        runners: $state.snapshot(runners),
        selectedRunnerId,
      } as Record<string, unknown>);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : m['api_client.import_failed']();
    } finally {
      importing = false;
    }
  }

  async function openSource() {
    const kind = data.payload.sourceKind;
    const path = data.payload.sourcePath;
    if (!kind || !path) return;
    if (kind === 'bruno' || kind === 'openCollection') {
      if (!await desktop?.openApiCollection?.('bruno', path)) error = m['api_client.open_source_failed']();
      return;
    }
    if (kind === 'postman') {
      if (!await desktop?.openApiCollection?.('postman', path)) error = m['api_client.open_source_failed']();
      return;
    }
    const result = await desktop?.openPath?.(path);
    if (result) error = m['api_client.open_source_failed']();
  }

  function compatibilityWarningLabel(item: { code: string; count?: number }): string {
    const count = item.count ?? 1;
    if (item.code === 'multiple_servers') return m['api_client.compat_multiple_servers']({ count });
    if (item.code === 'webhooks_ignored') return m['api_client.compat_webhooks']({ count });
    if (item.code === 'cookie_parameters_ignored') return m['api_client.compat_cookies']({ count });
    if (item.code === 'security_alternatives_simplified') return m['api_client.compat_security_alternatives']({ count });
    if (item.code === 'oauth_simplified') return m['api_client.compat_oauth']();
    if (item.code === 'callbacks_ignored') return m['api_client.compat_callbacks']({ count });
    return m['api_client.compat_generic']();
  }

  function dismissCompatibilityWarnings() {
    compatibilityWarnings = [];
    persist({ compatibilityWarnings: [] });
  }
</script>

<NodeShell
  {id}
  {selected}
  class="canvas-api-client"
  accent="var(--app-secondary)"
  minWidth={520}
  minHeight={360}
  onResize={data.onResize}
  connections={data.connections ?? []}
  titleText={data.title}
  onRename={data.onRename}
  onJumpToNode={data.onJumpToNode}
  onRemoveConnection={data.onRemoveConnection}
>
  {#snippet icon()}<Braces size={13} aria-hidden="true" />{/snippet}
  {#snippet title()}{data.title}{/snippet}
  {#snippet actions()}
    <button class="node-action-btn" aria-label={m['api_client.run_collection']()} title={m['api_client.run_collection']()} disabled={running || !requests.length} onclick={() => void runCollection()}>
      {#if running}<LoaderCircle size={14} class="animate-spin" />{:else}<Play size={14} />{/if}
    </button>
    <DropdownMenu.Root>
      <DropdownMenu.Trigger class="node-action-btn" aria-label={m['api_client.import']()} title={m['api_client.import']()} disabled={importing}>
        {#if importing}<LoaderCircle size={14} class="animate-spin" />{:else}<ChevronDown size={14} />{/if}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end" class="w-56">
        <DropdownMenu.Sub>
          <DropdownMenu.SubTrigger><Download size={14} aria-hidden="true" /> {m['api_client.import']()}</DropdownMenu.SubTrigger>
          <DropdownMenu.SubContent class="w-64">
            <DropdownMenu.Item onclick={() => importCollection('bruno')}>
              <FolderOpen size={14} aria-hidden="true" /> {m['api_client.import_bruno']()}
            </DropdownMenu.Item>
            <DropdownMenu.Item onclick={() => importCollection('openCollection')}>
              <FileCode2 size={14} aria-hidden="true" /> {m['api_client.import_open_collection']()}
            </DropdownMenu.Item>
            <DropdownMenu.Item onclick={() => importCollection('postman')}>
              <FileJson2 size={14} aria-hidden="true" /> {m['api_client.import_postman']()}
            </DropdownMenu.Item>
            <DropdownMenu.Item onclick={() => importCollection('openapi')}>
              <FileCode2 size={14} aria-hidden="true" /> {m['api_client.import_openapi']()}
            </DropdownMenu.Item>
            <DropdownMenu.Item onclick={() => importCollection('postmanEnvironment')}>
              <FileJson2 size={14} aria-hidden="true" /> {m['api_client.import_postman_environment']()}
            </DropdownMenu.Item>
            <DropdownMenu.Item onclick={() => importCollection('native')}>
              <Braces size={14} aria-hidden="true" /> {m['api_client.import_native']()}
            </DropdownMenu.Item>
          </DropdownMenu.SubContent>
        </DropdownMenu.Sub>
        {#if data.payload.sourcePath}
          <DropdownMenu.Separator />
          <DropdownMenu.Item onclick={openSource}>
            <ExternalLink size={14} aria-hidden="true" /> {m['api_client.open_source']()}
          </DropdownMenu.Item>
        {/if}
        <DropdownMenu.Separator />
        <DropdownMenu.Item onclick={copyCurl} disabled={!selectedRequest || selectedRequest.protocol === 'websocket' || selectedRequest.protocol === 'grpc'}>
          <Copy size={14} aria-hidden="true" /> {m['api_client.copy_curl']()}
        </DropdownMenu.Item>
        <DropdownMenu.Sub>
          <DropdownMenu.SubTrigger><Download size={14} aria-hidden="true" /> {m['api_client.export']()}</DropdownMenu.SubTrigger>
          <DropdownMenu.SubContent class="w-64">
            <DropdownMenu.Item onclick={exportPostman} disabled={!requests.length}>
              <FileJson2 size={14} aria-hidden="true" /> {m['api_client.export_postman']()}
            </DropdownMenu.Item>
            <DropdownMenu.Item onclick={() => void exportBruno('bruno')} disabled={!requests.length}>
              <FolderOpen size={14} aria-hidden="true" /> {m['api_client.export_bruno']()}
            </DropdownMenu.Item>
            <DropdownMenu.Item onclick={() => void exportBruno('openCollection')} disabled={!requests.length}>
              <FileCode2 size={14} aria-hidden="true" /> {m['api_client.export_open_collection']()}
            </DropdownMenu.Item>
            <DropdownMenu.Item onclick={() => exportOpenApi('yaml')} disabled={!requests.length}>
              <FileCode2 size={14} aria-hidden="true" /> {m['api_client.export_openapi_yaml']()}
            </DropdownMenu.Item>
            <DropdownMenu.Item onclick={() => exportOpenApi('json')} disabled={!requests.length}>
              <FileJson2 size={14} aria-hidden="true" /> {m['api_client.export_openapi_json']()}
            </DropdownMenu.Item>
            <DropdownMenu.Item onclick={exportPostmanEnvironment} disabled={!activeEnvironment}>
              <FileJson2 size={14} aria-hidden="true" /> {m['api_client.export_postman_environment']()}
            </DropdownMenu.Item>
            <DropdownMenu.Item onclick={exportNative}>
              <Braces size={14} aria-hidden="true" /> {m['api_client.export_native']()}
            </DropdownMenu.Item>
          </DropdownMenu.SubContent>
        </DropdownMenu.Sub>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  {/snippet}

  <div class="grid h-full min-h-0 grid-cols-[180px_minmax(0,1fr)] overflow-hidden bg-[var(--app-surface)]">
    <aside class="flex min-h-0 flex-col border-r border-[var(--app-border)] bg-[var(--app-surface-subtle)]">
      <div class="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--app-border)] px-2">
        <ContextMenu.Root>
          <ContextMenu.Trigger class="nodrag min-w-0 flex-1 truncate text-[10px] font-semibold uppercase text-[var(--app-text-muted)]">{m['api_client.requests']()} <span class="tabular-nums opacity-70">{requests.length}</span></ContextMenu.Trigger>
          <ContextMenu.Content class="w-48">
            <ContextMenu.Item onclick={() => void runCollection()}><Play />{m['api_client.run_collection']()}</ContextMenu.Item>
            <ContextMenu.Item onclick={() => addRequest()}><Plus />{m['api_client.add_request']()}</ContextMenu.Item>
            <ContextMenu.Item onclick={() => openCreateFolder()}><FolderPlus />{m['api_client.add_folder']()}</ContextMenu.Item>
            <ContextMenu.Item onclick={() => (runnerDialogOpen = true)}><ListChecks />{m['api_client.runners']()}</ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Root>
        <button class="nodrag grid size-6 place-items-center rounded text-[var(--app-text-muted)] hover:bg-[var(--app-surface-raised)] hover:text-[var(--app-text)] focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]" aria-label={m['api_client.runners']()} title={m['api_client.runners']()} onclick={() => (runnerDialogOpen = true)}><ListChecks size={13} aria-hidden="true" /></button>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger class="nodrag grid size-6 place-items-center rounded text-[var(--app-text-muted)] hover:bg-[var(--app-surface-raised)] hover:text-[var(--app-text)] focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]" aria-label={m['api_client.add_item']()} title={m['api_client.add_item']()}>
            <Plus size={13} aria-hidden="true" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="end" class="w-44">
            <DropdownMenu.Item onclick={() => addRequest()}><Plus />{m['api_client.add_request']()}</DropdownMenu.Item>
            <DropdownMenu.Item onclick={() => openCreateFolder()}><FolderPlus />{m['api_client.add_folder']()}</DropdownMenu.Item>
            <DropdownMenu.Item onclick={() => (runnerDialogOpen = true)}><ListChecks />{m['api_client.add_runner']()}</DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </div>
      <div class="nodrag min-h-0 flex-1 overflow-y-auto p-1.5" role="list" ondragover={(event) => { event.preventDefault(); if (event.target === event.currentTarget) dropIndicator = null; }} ondrop={(event) => { event.preventDefault(); dropItem(null); }}>
        {#each treeRows as row (row.id)}
          {#if row.kind === 'folder'}
            <ContextMenu.Root>
              <ContextMenu.Trigger
                class={`nodrag group/folder relative mb-0.5 flex min-w-0 items-center rounded hover:bg-[var(--app-surface-raised)] ${dropIndicator?.id === row.id && dropIndicator.placement === 'inside' ? 'bg-[var(--app-accent)]/10 ring-1 ring-inset ring-[var(--app-accent)]' : ''}`}
                data-testid={`api-folder-${row.folder.id}`}
                style={`padding-left: ${row.depth * 12}px`}
                ondragover={(event) => { event.preventDefault(); event.stopPropagation(); updateDropIndicator(event, row); }}
                ondrop={(event) => { event.preventDefault(); event.stopPropagation(); dropItem(row, dropIndicator?.id === row.id ? dropIndicator.placement : 'inside'); }}
              >
                {#if dropIndicator?.id === row.id && dropIndicator.placement !== 'inside'}
                  <span
                    class={`pointer-events-none absolute inset-x-0 z-20 h-0.5 rounded-full bg-[var(--app-accent)] shadow-[0_0_0_1px_var(--app-surface),0_0_8px_var(--app-accent)] ${dropIndicator.placement === 'before' ? 'top-0 -translate-y-1/2' : 'bottom-0 translate-y-1/2'}`}
                    data-testid={`api-drop-${dropIndicator.placement}-${row.id}`}
                    aria-hidden="true"
                  ></span>
                {/if}
                <button
                  type="button"
                  class="nodrag grid size-6 shrink-0 cursor-grab place-items-center text-[var(--app-text-muted)] opacity-50"
                  draggable="true"
                  data-testid={`api-folder-drag-${row.folder.id}`}
                  aria-label={m['api_client.reorder_folder']()}
                  onpointerdown={(event) => event.stopPropagation()}
                  ondragstart={(event) => { event.stopPropagation(); draggedItem = { kind: 'folder', id: row.folder.id }; dropIndicator = null; if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'; }}
                  ondragend={finishDrag}
                ><GripVertical size={12} /></button>
                <button type="button" class="nodrag flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pr-1 text-left" onclick={() => toggleFolder(row.folder.id)}>
                  {#if collapsedFolderIds.has(row.folder.id)}<ChevronRight size={12} class="shrink-0" />{:else}<ChevronDown size={12} class="shrink-0" />{/if}
                  <Folder size={12} class="shrink-0 text-[var(--app-secondary)]" />
                  <span class="min-w-0 flex-1 truncate text-[11px] font-medium text-[var(--app-text)]">{row.folder.name}</span>
                  <span class="text-[9px] tabular-nums text-[var(--app-text-muted)]">{requestsInFolder(row.folder.id).length}</span>
                </button>
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger class="nodrag grid size-6 shrink-0 place-items-center rounded text-[var(--app-text-muted)] opacity-0 hover:bg-[var(--app-border)] group-hover/folder:opacity-100 focus:opacity-100" aria-label={m['api_client.folder_actions']()}><MoreHorizontal size={12} /></DropdownMenu.Trigger>
                  <DropdownMenu.Content align="start" class="w-48">
                    <DropdownMenu.Item onclick={() => void runFolder(row.folder.id)}><Play />{m['api_client.run_folder']()}</DropdownMenu.Item>
                    <DropdownMenu.Item onclick={() => addRequest(row.folder.id)}><Plus />{m['api_client.add_request']()}</DropdownMenu.Item>
                    <DropdownMenu.Item onclick={() => openCreateFolder(row.folder.id)}><FolderPlus />{m['api_client.add_subfolder']()}</DropdownMenu.Item>
                    <DropdownMenu.Item onclick={() => openRenameFolder(row.folder)}><Pencil />{m['api_client.rename_folder']()}</DropdownMenu.Item>
                    <DropdownMenu.Separator />
                    <DropdownMenu.Item variant="destructive" onclick={() => deleteFolder(row.folder.id)}><Trash2 />{m['api_client.delete_folder']()}</DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Root>
              </ContextMenu.Trigger>
              <ContextMenu.Content class="w-48">
                <ContextMenu.Item onclick={() => void runFolder(row.folder.id)}><Play />{m['api_client.run_folder']()}</ContextMenu.Item>
                <ContextMenu.Item onclick={() => addRequest(row.folder.id)}><Plus />{m['api_client.add_request']()}</ContextMenu.Item>
                <ContextMenu.Item onclick={() => openCreateFolder(row.folder.id)}><FolderPlus />{m['api_client.add_subfolder']()}</ContextMenu.Item>
                <ContextMenu.Item onclick={() => openRenameFolder(row.folder)}><Pencil />{m['api_client.rename_folder']()}</ContextMenu.Item>
                <ContextMenu.Separator />
                <ContextMenu.Item variant="destructive" onclick={() => deleteFolder(row.folder.id)}><Trash2 />{m['api_client.delete_folder']()}</ContextMenu.Item>
              </ContextMenu.Content>
            </ContextMenu.Root>
          {:else}
            {@const request = row.request}
            <ContextMenu.Root>
              <ContextMenu.Trigger
                class={`nodrag group/request relative mb-0.5 flex min-w-0 items-center rounded hover:bg-[var(--app-surface-raised)] ${request.id === selectedRequestId ? 'bg-[var(--app-surface-raised)] ring-1 ring-[var(--app-accent)]/30' : ''}`}
                data-testid={`api-request-${request.id}`}
                style={`padding-left: ${row.depth * 12}px`}
                role="listitem"
                ondragover={(event) => { event.preventDefault(); event.stopPropagation(); updateDropIndicator(event, row); }}
                ondrop={(event) => { event.preventDefault(); event.stopPropagation(); dropItem(row, dropIndicator?.id === row.id ? dropIndicator.placement : 'before'); }}
              >
                {#if dropIndicator?.id === row.id}
                  <span
                    class={`pointer-events-none absolute inset-x-0 z-20 h-0.5 rounded-full bg-[var(--app-accent)] shadow-[0_0_0_1px_var(--app-surface),0_0_8px_var(--app-accent)] ${dropIndicator.placement === 'before' ? 'top-0 -translate-y-1/2' : 'bottom-0 translate-y-1/2'}`}
                    data-testid={`api-drop-${dropIndicator.placement}-${row.id}`}
                    aria-hidden="true"
                  ></span>
                {/if}
                <button
                  type="button"
                  class="nodrag grid size-6 shrink-0 cursor-grab place-items-center text-[var(--app-text-muted)] opacity-50"
                  draggable="true"
                  data-testid={`api-request-drag-${request.id}`}
                  aria-label={m['api_client.reorder_request']()}
                  onpointerdown={(event) => event.stopPropagation()}
                  ondragstart={(event) => { event.stopPropagation(); draggedItem = { kind: 'request', id: request.id }; dropIndicator = null; if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'; }}
                  ondragend={finishDrag}
                ><GripVertical size={12} /></button>
                <button class="nodrag flex min-w-0 flex-1 items-center gap-2 px-0 py-1.5 text-left focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]" aria-current={request.id === selectedRequestId ? 'true' : undefined} onclick={() => chooseRequest(request.id)}>
                  <span class="w-9 shrink-0 text-[9px] font-bold text-[var(--app-secondary)]">{request.protocol === 'graphql' ? 'GQL' : request.protocol === 'websocket' ? 'WS' : request.protocol === 'grpc' ? 'RPC' : request.method}</span>
                  <span class="min-w-0 flex-1 truncate text-[11px] text-[var(--app-text)]">{request.name}</span>
                </button>
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger class="nodrag grid size-6 shrink-0 place-items-center rounded text-[var(--app-text-muted)] opacity-0 hover:bg-[var(--app-border)] group-hover/request:opacity-100 focus:opacity-100" aria-label={m['api_client.request_actions']()}><MoreHorizontal size={12} /></DropdownMenu.Trigger>
                  <DropdownMenu.Content align="start" class="w-44">
                    <DropdownMenu.Item onclick={() => void executeRequest(request)}><Play />{m['api_client.run_request']()}</DropdownMenu.Item>
                    <DropdownMenu.Item onclick={() => duplicateRequest(request.id)}><Copy />{m['api_client.duplicate_request']()}</DropdownMenu.Item>
                    <DropdownMenu.Item onclick={() => moveRequest(request.id, -1)}>{m['api_client.move_up']()}</DropdownMenu.Item>
                    <DropdownMenu.Item onclick={() => moveRequest(request.id, 1)}>{m['api_client.move_down']()}</DropdownMenu.Item>
                    <DropdownMenu.Separator />
                    <DropdownMenu.Item variant="destructive" onclick={() => deleteRequest(request.id)}><Trash2 />{m['api_client.delete_request']()}</DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Root>
              </ContextMenu.Trigger>
              <ContextMenu.Content class="w-44">
                <ContextMenu.Item onclick={() => void executeRequest(request)}><Play />{m['api_client.run_request']()}</ContextMenu.Item>
                <ContextMenu.Item onclick={() => duplicateRequest(request.id)}><Copy />{m['api_client.duplicate_request']()}</ContextMenu.Item>
                <ContextMenu.Item onclick={() => moveRequest(request.id, -1)}>{m['api_client.move_up']()}</ContextMenu.Item>
                <ContextMenu.Item onclick={() => moveRequest(request.id, 1)}>{m['api_client.move_down']()}</ContextMenu.Item>
                <ContextMenu.Separator />
                <ContextMenu.Item variant="destructive" onclick={() => deleteRequest(request.id)}><Trash2 />{m['api_client.delete_request']()}</ContextMenu.Item>
              </ContextMenu.Content>
            </ContextMenu.Root>
          {/if}
        {:else}
          <div class="grid h-full place-items-center p-4 text-center text-[11px] leading-5 text-[var(--app-text-muted)]">
            <div>
              <Braces size={24} class="mx-auto mb-2 opacity-40" aria-hidden="true" />
              <p>{m['api_client.empty']()}</p>
              <Button size="sm" variant="outline" class="mt-3 h-7 text-[11px]" onclick={addRequest}><Plus size={13} /> {m['api_client.add_request']()}</Button>
            </div>
          </div>
        {/each}
      </div>
    </aside>

    {#if selectedRequest}
      <section class="flex min-h-0 min-w-0 flex-col">
        {#if compatibilityWarnings.length}
          <div class="flex shrink-0 items-start gap-2 border-b border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[10px] leading-4 text-[var(--app-text-soft)]" role="status" data-testid="api-client-compatibility-warning">
            <AlertTriangle size={13} class="mt-0.5 shrink-0 text-amber-500" aria-hidden="true" />
            <div class="min-w-0 flex-1">
              <strong class="block text-[var(--app-text)]">{m['api_client.compat_title']()}</strong>
              <span>{compatibilityWarnings.map(compatibilityWarningLabel).join(' ')}</span>
            </div>
            <button class="grid size-6 shrink-0 place-items-center rounded text-[var(--app-text-muted)] hover:bg-amber-500/15 hover:text-[var(--app-text)]" aria-label={m['api_client.compat_dismiss']()} title={m['api_client.compat_dismiss']()} onclick={dismissCompatibilityWarnings}><X size={12} /></button>
          </div>
        {/if}
        <div class="flex shrink-0 gap-1.5 border-b border-[var(--app-border)] p-2">
          <NativeSelect.Root class="w-[104px] shrink-0" size="sm" aria-label={m['api_client.protocol']()} value={selectedRequest.protocol ?? 'http'} onchange={(event: Event) => changeProtocol(inputValue(event) as ApiClientProtocol)}>
            <NativeSelect.Option value="http">HTTP</NativeSelect.Option>
            <NativeSelect.Option value="graphql">GraphQL</NativeSelect.Option>
            <NativeSelect.Option value="websocket">WebSocket</NativeSelect.Option>
            <NativeSelect.Option value="grpc">gRPC</NativeSelect.Option>
          </NativeSelect.Root>
          {#if selectedRequest.protocol === 'websocket' || selectedRequest.protocol === 'grpc'}
            <div class="grid h-8 w-[58px] shrink-0 place-items-center rounded border border-[var(--app-border)] bg-[var(--app-surface-subtle)] font-mono text-[10px] font-bold text-[var(--app-secondary)]">{selectedRequest.protocol === 'websocket' ? 'WS' : 'RPC'}</div>
          {:else}
            <NativeSelect.Root
              class="w-[76px] shrink-0 [&_select]:font-bold [&_select]:text-[var(--app-secondary)]"
              size="sm"
              aria-label={m['api_client.method']()}
              value={selectedRequest.method}
              onchange={(event: Event) => updateRequest({ method: (event.currentTarget as HTMLSelectElement).value as ApiClientRequest['method'] }, true)}
            >
              {#each ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as method}
                <NativeSelect.Option value={method}>{method}</NativeSelect.Option>
              {/each}
            </NativeSelect.Root>
          {/if}
          <Input
            value={selectedRequest.url}
            type="url"
            name="request-url"
            autocomplete="off"
            spellcheck="false"
            aria-label={m['api_client.url']()}
            placeholder={selectedRequest.protocol === 'websocket' ? m['api_client.websocket_url_placeholder']() : selectedRequest.protocol === 'grpc' ? m['api_client.grpc_url_placeholder']() : m['api_client.url_placeholder']()}
            class="h-8 min-w-0 flex-1 font-mono text-[11px]"
            oninput={(event: Event) => updateRequest({ url: inputValue(event) })}
            onblur={() => persist()}
            onkeydown={(event: KeyboardEvent) => event.key === 'Enter' && sendRequest()}
          />
          <Button size="sm" class="h-8 shrink-0 px-3 text-[11px]" disabled={sending || !selectedRequest.url.trim()} onclick={sendRequest}>
            {#if sending}<LoaderCircle size={13} class="animate-spin" />{:else}<Send size={13} />{/if}
            {sending ? m['api_client.sending']() : m['api_client.send']()}
          </Button>
        </div>
        <div class="flex shrink-0 items-center gap-2 border-b border-[var(--app-border)] px-2 py-1.5">
          <Input
            value={selectedRequest.name}
            name="request-name"
            autocomplete="off"
            aria-label={m['api_client.request_name']()}
            class="h-7 min-w-0 flex-1 border-transparent bg-transparent px-1 text-[12px] font-semibold hover:border-[var(--app-border)]"
            oninput={(event: Event) => updateRequest({ name: inputValue(event) })}
            onblur={() => persist()}
          />
          <div class="flex min-w-28 max-w-48 items-center gap-1 text-[var(--app-text-muted)]">
            <Folder size={12} class="shrink-0" />
            <NativeSelect.Root
              value={selectedRequest.folderId ?? ''}
              aria-label={m['api_client.folder']()}
              class="min-w-0 flex-1 [&_select]:h-7 [&_select]:text-[10px]"
              onchange={(event: Event) => updateRequest({ folderId: inputValue(event) || null }, true)}
            >
              <NativeSelect.Option value="">{m['api_client.collection_root']()}</NativeSelect.Option>
              {#each folders as folder (folder.id)}<NativeSelect.Option value={folder.id}>{apiClientFolderPath(folders, folder.id)}</NativeSelect.Option>{/each}
            </NativeSelect.Root>
          </div>
          <button class="grid size-7 place-items-center rounded text-[var(--app-text-muted)] hover:bg-[var(--app-danger-soft)] hover:text-[var(--app-danger)] focus-visible:ring-2 focus-visible:ring-[var(--app-danger)]" aria-label={m['api_client.delete_request']()} onclick={() => deleteRequest()}>
            <Trash2 size={13} aria-hidden="true" />
          </button>
        </div>

        <Tabs.Root bind:value={activeTab} class="flex min-h-0 flex-1 flex-col">
          <Tabs.List class="h-8 max-w-full shrink-0 justify-start overflow-x-auto rounded-none border-b border-[var(--app-border)] bg-transparent px-2 [&_[data-state=active]]:bg-[var(--app-surface-raised)] [&_[data-state=active]]:text-[var(--app-text)] [&_[data-state=active]]:shadow-[inset_0_-2px_0_var(--app-accent)]">
            <Tabs.Trigger value="params" class="h-7 flex-none text-[10px]">{m['api_client.params']()} <span class="tabular-nums">{selectedRequest.params?.filter((item) => item.enabled).length ?? 0}</span></Tabs.Trigger>
            <Tabs.Trigger value="headers" class="h-7 flex-none text-[10px]">{m['api_client.headers']()} <span class="tabular-nums">{selectedRequest.headers.filter((header) => header.enabled).length}</span></Tabs.Trigger>
            <Tabs.Trigger value="body" class="h-7 flex-none text-[10px]">{selectedRequest.protocol === 'graphql' ? 'GraphQL' : selectedRequest.protocol === 'websocket' || selectedRequest.protocol === 'grpc' ? m['api_client.messages']() : m['api_client.body']()}</Tabs.Trigger>
            <Tabs.Trigger value="auth" class="h-7 flex-none text-[10px]">{m['api_client.auth']()}</Tabs.Trigger>
            <Tabs.Trigger value="variables" class="h-7 flex-none text-[10px]">{m['api_client.variables']()}</Tabs.Trigger>
            <Tabs.Trigger value="scripts" class="h-7 flex-none text-[10px]">{m['api_client.scripts']()}</Tabs.Trigger>
            <Tabs.Trigger value="tests" class="h-7 flex-none text-[10px]">{m['api_client.tests']()} <span class="tabular-nums">{selectedRequest.assertions?.length ?? 0}</span></Tabs.Trigger>
            <Tabs.Trigger value="network" class="h-7 flex-none text-[10px]">{m['api_client.network']()}</Tabs.Trigger>
            <Tabs.Trigger value="sync" class="h-7 flex-none text-[10px]" onclick={() => void synchronize('status')}>{m['api_client.sync']()}</Tabs.Trigger>
            <Tabs.Trigger value="docs" class="h-7 flex-none text-[10px]">{m['api_client.docs']()}</Tabs.Trigger>
            <Tabs.Trigger value="response" class="h-7 flex-none text-[10px]">{m['api_client.response']()}</Tabs.Trigger>
            <Tabs.Trigger value="history" class="h-7 flex-none text-[10px]">{m['api_client.history']()}</Tabs.Trigger>
          </Tabs.List>
          <Tabs.Content value="params" class="m-0 min-h-0 flex-1 overflow-auto p-2">
            {#each selectedRequest.params ?? [] as param (param.id)}
              <div class="mb-1 grid grid-cols-[24px_minmax(90px,0.8fr)_minmax(120px,1.2fr)_28px] gap-1">
                <button class="grid size-7 place-items-center rounded border border-[var(--app-border)] text-[var(--app-text-muted)] hover:bg-[var(--app-surface-raised)]" aria-label={param.enabled ? m['api_client.disable_param']() : m['api_client.enable_param']()} onclick={() => updateKeyValue('params', param.id, { enabled: !param.enabled }, true)}>{#if param.enabled}<Check size={12} />{/if}</button>
                <Input value={param.name} name="param-name" autocomplete="off" spellcheck="false" aria-label={m['api_client.param_name']()} placeholder={m['api_client.param_name']()} class="h-7 font-mono text-[10px]" oninput={(event: Event) => updateKeyValue('params', param.id, { name: inputValue(event) })} onblur={() => persist()} />
                <Input value={param.value} name="param-value" autocomplete="off" spellcheck="false" aria-label={m['api_client.param_value']()} placeholder={m['api_client.param_value']()} class="h-7 font-mono text-[10px]" oninput={(event: Event) => updateKeyValue('params', param.id, { value: inputValue(event) })} onblur={() => persist()} />
                <button class="grid size-7 place-items-center rounded text-[var(--app-text-muted)] hover:bg-[var(--app-danger-soft)] hover:text-[var(--app-danger)]" aria-label={m['api_client.remove_param']()} onclick={() => removeKeyValue('params', param.id)}><Trash2 size={12} /></button>
              </div>
            {/each}
            <Button size="sm" variant="outline" class="mt-1 h-7 text-[10px]" onclick={() => addKeyValue('params')}><Plus size={12} /> {m['api_client.add_param']()}</Button>
          </Tabs.Content>
          <Tabs.Content value="body" class="m-0 min-h-0 flex-1 overflow-auto p-2">
            {#if selectedRequest.protocol === 'graphql'}
              <div class="grid min-h-full grid-rows-[minmax(180px,1fr)_minmax(120px,0.65fr)] gap-2">
                <ApiCodeEditor value={selectedRequest.graphql?.query ?? ''} language="graphql" label={m['api_client.graphql_query']()} minHeight={180} onchange={(value) => updateRequest({ graphql: { ...selectedRequest.graphql!, query: value } })} onblur={() => persist()} />
                <div class="grid min-h-0 grid-cols-[minmax(0,1fr)_180px] gap-2">
                  <ApiCodeEditor value={selectedRequest.graphql?.variables ?? '{}'} language="json" label={m['api_client.graphql_variables']()} minHeight={130} onchange={(value) => updateRequest({ graphql: { ...selectedRequest.graphql!, variables: value } })} onblur={() => persist()} />
                  <label class="flex flex-col gap-1.5"><span class="text-[10px] font-semibold text-[var(--app-text-muted)]">{m['api_client.graphql_operation']()}</span><Input value={selectedRequest.graphql?.operationName ?? ''} class="h-8 font-mono text-[10px]" oninput={(event: Event) => updateRequest({ graphql: { ...selectedRequest.graphql!, operationName: inputValue(event) } })} onblur={() => persist()} /></label>
                </div>
              </div>
            {:else if selectedRequest.protocol === 'websocket'}
              <div class="mb-3 grid grid-cols-[minmax(0,1fr)_120px_110px] gap-2 border-b border-[var(--app-border)] pb-3">
                <label class="space-y-1"><span class="block text-[10px] font-semibold text-[var(--app-text-muted)]">{m['api_client.websocket_protocols']()}</span><Input value={(selectedRequest.websocket?.protocols ?? []).join(', ')} class="h-8 font-mono text-[10px]" placeholder={m['api_client.websocket_protocols_placeholder']()} oninput={(event: Event) => updateRequest({ websocket: { ...selectedRequest.websocket!, protocols: inputValue(event).split(',').map((value) => value.trim()).filter(Boolean) } })} onblur={() => persist()} /></label>
                <label class="space-y-1"><span class="block text-[10px] font-semibold text-[var(--app-text-muted)]">{m['api_client.keep_alive']()}</span><Input type="number" min="0" max="300000" step="1000" value={selectedRequest.websocket?.keepAliveIntervalMs ?? 0} class="h-8 font-mono text-[10px]" oninput={(event: Event) => updateRequest({ websocket: { ...selectedRequest.websocket!, keepAliveIntervalMs: Number(inputValue(event)) } })} onblur={() => persist()} /></label>
                <label class="flex items-end justify-between gap-2 pb-1 text-[10px]"><span>{m['api_client.auto_reconnect']()}</span><Switch checked={selectedRequest.websocket?.autoReconnect ?? false} onCheckedChange={(checked: boolean) => updateRequest({ websocket: { ...selectedRequest.websocket!, autoReconnect: checked } }, true)} /></label>
              </div>
              {#each selectedRequest.websocket?.messages ?? [] as message (message.id)}
                <div class="mb-2 grid grid-cols-[24px_120px_90px_minmax(140px,1fr)_28px] items-start gap-1">
                  <button class="grid size-7 place-items-center rounded border border-[var(--app-border)] text-[var(--app-text-muted)]" aria-label={message.enabled ? m['api_client.disable_message']() : m['api_client.enable_message']()} onclick={() => updateProtocolMessage('websocket', message.id, { enabled: !message.enabled }, true)}>{#if message.enabled}<Check size={12} />{/if}</button>
                  <Input value={message.name} class="h-7 text-[10px]" aria-label={m['api_client.message_name']()} oninput={(event: Event) => updateProtocolMessage('websocket', message.id, { name: inputValue(event) })} onblur={() => persist()} />
                  <NativeSelect.Root size="sm" value={message.type} aria-label={m['api_client.message_type']()} onchange={(event: Event) => updateProtocolMessage('websocket', message.id, { type: inputValue(event) as ApiClientMessage['type'] }, true)}><NativeSelect.Option value="text">{m['api_client.message_text']()}</NativeSelect.Option><NativeSelect.Option value="json">JSON</NativeSelect.Option><NativeSelect.Option value="binary">{m['api_client.message_binary']()}</NativeSelect.Option></NativeSelect.Root>
                  <ApiCodeEditor value={message.content} language={message.type === 'json' ? 'json' : 'text'} label={m['api_client.message_content']()} minHeight={96} onchange={(value) => updateProtocolMessage('websocket', message.id, { content: value })} onblur={() => persist()} />
                  <button class="grid size-7 place-items-center rounded text-[var(--app-text-muted)] hover:text-[var(--app-danger)]" aria-label={m['api_client.remove_message']()} onclick={() => removeProtocolMessage('websocket', message.id)}><Trash2 size={12} /></button>
                </div>
              {/each}
              <Button size="sm" variant="outline" class="h-7 text-[10px]" onclick={() => addProtocolMessage('websocket')}><Plus size={12} />{m['api_client.add_message']()}</Button>
            {:else if selectedRequest.protocol === 'grpc'}
              <div class="mb-3 grid grid-cols-[minmax(180px,1fr)_auto] gap-2">
                <label class="space-y-1"><span class="block text-[10px] font-semibold text-[var(--app-text-muted)]">{m['api_client.grpc_proto']()}</span><Input value={selectedRequest.grpc?.protoPath ?? ''} readonly class="h-8 min-w-0 font-mono text-[10px]" /></label>
                <Button size="sm" variant="outline" class="mt-[18px] h-8" onclick={pickProtoFile}><FolderOpen size={13} />{m['api_client.choose_file']()}</Button>
              </div>
              <div class="mb-3 grid grid-cols-[minmax(130px,1fr)_minmax(110px,0.8fr)_150px_90px] gap-2 border-b border-[var(--app-border)] pb-3">
                <label class="space-y-1"><span class="block text-[10px] font-semibold text-[var(--app-text-muted)]">{m['api_client.grpc_service']()}</span><Input value={selectedRequest.grpc?.service ?? ''} class="h-8 font-mono text-[10px]" oninput={(event: Event) => updateRequest({ grpc: { ...selectedRequest.grpc!, service: inputValue(event) } })} onblur={() => persist()} /></label>
                <label class="space-y-1"><span class="block text-[10px] font-semibold text-[var(--app-text-muted)]">{m['api_client.grpc_method']()}</span><Input value={selectedRequest.grpc?.method ?? ''} class="h-8 font-mono text-[10px]" oninput={(event: Event) => updateRequest({ grpc: { ...selectedRequest.grpc!, method: inputValue(event) } })} onblur={() => persist()} /></label>
                <label class="space-y-1"><span class="block text-[10px] font-semibold text-[var(--app-text-muted)]">{m['api_client.grpc_streaming']()}</span><NativeSelect.Root size="sm" value={selectedRequest.grpc?.methodType ?? 'unary'} onchange={(event: Event) => updateRequest({ grpc: { ...selectedRequest.grpc!, methodType: inputValue(event) as NonNullable<ApiClientRequest['grpc']>['methodType'] } }, true)}><NativeSelect.Option value="unary">{m['api_client.grpc_unary']()}</NativeSelect.Option><NativeSelect.Option value="serverStreaming">{m['api_client.grpc_server_stream']()}</NativeSelect.Option><NativeSelect.Option value="clientStreaming">{m['api_client.grpc_client_stream']()}</NativeSelect.Option><NativeSelect.Option value="bidirectional">{m['api_client.grpc_bidirectional']()}</NativeSelect.Option></NativeSelect.Root></label>
                <label class="flex items-end justify-between gap-2 pb-1 text-[10px]"><span>{m['api_client.grpc_tls']()}</span><Switch checked={selectedRequest.grpc?.useTls ?? false} onCheckedChange={(checked: boolean) => updateRequest({ grpc: { ...selectedRequest.grpc!, useTls: checked } }, true)} /></label>
              </div>
              {#each selectedRequest.grpc?.messages ?? [] as message (message.id)}
                <div class="mb-2 grid grid-cols-[24px_130px_minmax(180px,1fr)_28px] items-start gap-1">
                  <button class="grid size-7 place-items-center rounded border border-[var(--app-border)] text-[var(--app-text-muted)]" aria-label={message.enabled ? m['api_client.disable_message']() : m['api_client.enable_message']()} onclick={() => updateProtocolMessage('grpc', message.id, { enabled: !message.enabled }, true)}>{#if message.enabled}<Check size={12} />{/if}</button>
                  <Input value={message.name} class="h-7 text-[10px]" aria-label={m['api_client.message_name']()} oninput={(event: Event) => updateProtocolMessage('grpc', message.id, { name: inputValue(event) })} onblur={() => persist()} />
                  <ApiCodeEditor value={message.content} language="json" label={m['api_client.message_content']()} minHeight={96} onchange={(value) => updateProtocolMessage('grpc', message.id, { content: value })} onblur={() => persist()} />
                  <button class="grid size-7 place-items-center rounded text-[var(--app-text-muted)] hover:text-[var(--app-danger)]" aria-label={m['api_client.remove_message']()} onclick={() => removeProtocolMessage('grpc', message.id)}><Trash2 size={12} /></button>
                </div>
              {/each}
              <Button size="sm" variant="outline" class="h-7 text-[10px]" onclick={() => addProtocolMessage('grpc')}><Plus size={12} />{m['api_client.add_message']()}</Button>
            {:else}
              <div class="mb-2 flex items-center gap-1">
                {#each ['none', 'json', 'text', 'xml', 'form', 'multipart'] as mode}
                  <button aria-pressed={selectedRequest.bodyMode === mode} class={`rounded border px-2 py-1 text-[10px] transition-colors ${selectedRequest.bodyMode === mode ? 'border-[var(--app-accent)]/35 bg-[var(--app-accent-soft)] font-medium text-[var(--app-accent)]' : 'border-transparent text-[var(--app-text-muted)] hover:bg-[var(--app-surface-raised)] hover:text-[var(--app-text)]'}`} onclick={() => updateRequest({ bodyMode: mode as ApiClientRequest['bodyMode'] }, true)}>{bodyModeLabel(mode)}</button>
                {/each}
              </div>
              {#if selectedRequest.bodyMode === 'form' || selectedRequest.bodyMode === 'multipart'}
              {#each selectedRequest.formFields ?? [] as field (field.id)}
                <div class="mb-1 grid grid-cols-[24px_minmax(90px,0.8fr)_minmax(120px,1.2fr)_28px] gap-1">
                  <button class="grid size-7 place-items-center rounded border border-[var(--app-border)] text-[var(--app-text-muted)]" aria-label={field.enabled ? m['api_client.disable_field']() : m['api_client.enable_field']()} onclick={() => updateKeyValue('formFields', field.id, { enabled: !field.enabled }, true)}>{#if field.enabled}<Check size={12} />{/if}</button>
                  <Input value={field.name} name="form-name" autocomplete="off" aria-label={m['api_client.field_name']()} class="h-7 font-mono text-[10px]" oninput={(event: Event) => updateKeyValue('formFields', field.id, { name: inputValue(event) })} onblur={() => persist()} />
                  <Input value={field.value} name="form-value" autocomplete="off" aria-label={m['api_client.field_value']()} class="h-7 font-mono text-[10px]" oninput={(event: Event) => updateKeyValue('formFields', field.id, { value: inputValue(event) })} onblur={() => persist()} />
                  <button class="grid size-7 place-items-center rounded text-[var(--app-text-muted)] hover:text-[var(--app-danger)]" aria-label={m['api_client.remove_field']()} onclick={() => removeKeyValue('formFields', field.id)}><Trash2 size={12} /></button>
                </div>
              {/each}
              <Button size="sm" variant="outline" class="mt-1 h-7 text-[10px]" onclick={() => addKeyValue('formFields')}><Plus size={12} />{m['api_client.add_field']()}</Button>
            {:else if selectedRequest.bodyMode !== 'none'}
              <ApiCodeEditor
                value={selectedRequest.body}
                language={selectedRequest.bodyMode === 'json' ? 'json' : selectedRequest.bodyMode === 'xml' ? 'xml' : 'text'}
                label={m['api_client.body']()}
                minHeight={230}
                onchange={(value) => updateRequest({ body: value })}
                onblur={() => persist()}
              />
              {/if}
            {/if}
          </Tabs.Content>
          <Tabs.Content value="headers" class="m-0 min-h-0 flex-1 overflow-auto p-2">
            {#each selectedRequest.headers as header (header.id)}
              <div class="mb-1 grid grid-cols-[24px_minmax(90px,0.8fr)_minmax(120px,1.2fr)_28px] gap-1">
                <button class="grid size-7 place-items-center rounded border border-[var(--app-border)] text-[var(--app-text-muted)] hover:bg-[var(--app-surface-raised)]" aria-label={header.enabled ? m['api_client.disable_header']() : m['api_client.enable_header']()} onclick={() => updateHeader(header.id, { enabled: !header.enabled }, true)}>{#if header.enabled}<Check size={12} />{/if}</button>
                <Input value={header.name} name="header-name" autocomplete="off" spellcheck="false" aria-label={m['api_client.header_name']()} class="h-7 font-mono text-[10px]" oninput={(event: Event) => updateHeader(header.id, { name: inputValue(event) })} onblur={() => persist()} />
                <Input value={header.value} name="header-value" autocomplete="off" spellcheck="false" aria-label={m['api_client.header_value']()} class="h-7 font-mono text-[10px]" oninput={(event: Event) => updateHeader(header.id, { value: inputValue(event) })} onblur={() => persist()} />
                <button class="grid size-7 place-items-center rounded text-[var(--app-text-muted)] hover:bg-[var(--app-danger-soft)] hover:text-[var(--app-danger)]" aria-label={m['api_client.remove_header']()} onclick={() => removeHeader(header.id)}><Trash2 size={12} /></button>
              </div>
            {/each}
            <Button size="sm" variant="outline" class="mt-1 h-7 text-[10px]" onclick={addHeader}><Plus size={12} /> {m['api_client.add_header']()}</Button>
          </Tabs.Content>
          <Tabs.Content value="auth" class="m-0 min-h-0 flex-1 overflow-auto p-2">
            <NativeSelect.Root
              class="w-full"
              size="sm"
              aria-label={m['api_client.auth']()}
              value={selectedRequest.auth.type}
              onchange={(event: Event) => updateRequest({ auth: { ...selectedRequest.auth, type: (event.currentTarget as HTMLSelectElement).value as ApiClientRequest['auth']['type'] } }, true)}
            >
              <NativeSelect.Option value="none">{m['api_client.auth_none']()}</NativeSelect.Option>
              <NativeSelect.Option value="bearer">{m['api_client.auth_bearer']()}</NativeSelect.Option>
              <NativeSelect.Option value="basic">{m['api_client.auth_basic']()}</NativeSelect.Option>
              <NativeSelect.Option value="apiKey">{m['api_client.auth_api_key']()}</NativeSelect.Option>
              <NativeSelect.Option value="oauth2">OAuth 2.0</NativeSelect.Option>
            </NativeSelect.Root>
            {#if selectedRequest.auth.type === 'bearer'}
              <Input value={selectedRequest.auth.token} type="password" name="auth-token" autocomplete="off" spellcheck="false" aria-label={m['api_client.auth_token']()} placeholder={m['api_client.auth_token']()} class="mt-2 h-8 font-mono text-[11px]" oninput={(event: Event) => updateRequest({ auth: { ...selectedRequest.auth, token: inputValue(event) } })} onblur={() => persist()} />
            {:else if selectedRequest.auth.type === 'basic'}
              <div class="mt-2 grid grid-cols-2 gap-2">
                <Input value={selectedRequest.auth.username} name="auth-username" autocomplete="username" spellcheck="false" aria-label={m['api_client.auth_username']()} placeholder={m['api_client.auth_username']()} class="h-8 font-mono text-[11px]" oninput={(event: Event) => updateRequest({ auth: { ...selectedRequest.auth, username: inputValue(event) } })} onblur={() => persist()} />
                <Input value={selectedRequest.auth.password} type="password" name="auth-password" autocomplete="current-password" spellcheck="false" aria-label={m['api_client.auth_password']()} placeholder={m['api_client.auth_password']()} class="h-8 font-mono text-[11px]" oninput={(event: Event) => updateRequest({ auth: { ...selectedRequest.auth, password: inputValue(event) } })} onblur={() => persist()} />
              </div>
            {:else if selectedRequest.auth.type === 'apiKey'}
              <div class="mt-2 grid grid-cols-[minmax(100px,0.7fr)_minmax(140px,1fr)_120px] gap-2">
                <Input value={selectedRequest.auth.key ?? ''} name="auth-api-key" autocomplete="off" spellcheck="false" aria-label={m['api_client.auth_key']()} placeholder={m['api_client.auth_key']()} class="h-8 font-mono text-[11px]" oninput={(event: Event) => updateRequest({ auth: { ...selectedRequest.auth, key: inputValue(event) } })} onblur={() => persist()} />
                <Input value={selectedRequest.auth.value ?? ''} type="password" name="auth-api-value" autocomplete="off" spellcheck="false" aria-label={m['api_client.auth_value']()} placeholder={m['api_client.auth_value']()} class="h-8 font-mono text-[11px]" oninput={(event: Event) => updateRequest({ auth: { ...selectedRequest.auth, value: inputValue(event) } })} onblur={() => persist()} />
                <NativeSelect.Root size="sm" aria-label={m['api_client.auth_placement']()} value={selectedRequest.auth.placement ?? 'header'} onchange={(event: Event) => updateRequest({ auth: { ...selectedRequest.auth, placement: inputValue(event) as 'header' | 'query' } }, true)}>
                  <NativeSelect.Option value="header">{m['api_client.auth_header']()}</NativeSelect.Option>
                  <NativeSelect.Option value="query">{m['api_client.auth_query']()}</NativeSelect.Option>
                </NativeSelect.Root>
              </div>
            {:else if selectedRequest.auth.type === 'oauth2'}
              {@const oauth = selectedRequest.auth.oauth2!}
              <div class="mt-3 grid gap-3">
                <div class="grid grid-cols-2 gap-2">
                  <label class="space-y-1"><span class="block text-[10px] font-semibold text-[var(--app-text-muted)]">{m['api_client.oauth_grant_type']()}</span><NativeSelect.Root size="sm" value={oauth.grantType} onchange={(event: Event) => updateRequest({ auth: { ...selectedRequest.auth, oauth2: { ...oauth, grantType: inputValue(event) as typeof oauth.grantType } } }, true)}><NativeSelect.Option value="authorization_code">{m['api_client.oauth_authorization_code']()}</NativeSelect.Option><NativeSelect.Option value="client_credentials">{m['api_client.oauth_client_credentials']()}</NativeSelect.Option><NativeSelect.Option value="password">{m['api_client.oauth_password_grant']()}</NativeSelect.Option><NativeSelect.Option value="refresh_token">{m['api_client.oauth_refresh_token_grant']()}</NativeSelect.Option></NativeSelect.Root></label>
                  <label class="space-y-1"><span class="block text-[10px] font-semibold text-[var(--app-text-muted)]">{m['api_client.oauth_client_auth']()}</span><NativeSelect.Root size="sm" value={oauth.clientAuthentication} onchange={(event: Event) => updateRequest({ auth: { ...selectedRequest.auth, oauth2: { ...oauth, clientAuthentication: inputValue(event) as typeof oauth.clientAuthentication } } }, true)}><NativeSelect.Option value="header">{m['api_client.oauth_client_auth_header']()}</NativeSelect.Option><NativeSelect.Option value="body">{m['api_client.oauth_client_auth_body']()}</NativeSelect.Option></NativeSelect.Root></label>
                </div>
                {#if oauth.grantType === 'authorization_code'}
                  <label class="space-y-1"><span class="block text-[10px] font-semibold text-[var(--app-text-muted)]">{m['api_client.oauth_authorization_url']()}</span><Input value={oauth.authorizationUrl} class="h-8 font-mono text-[10px]" placeholder={m['api_client.oauth_authorization_placeholder']()} oninput={(event: Event) => updateRequest({ auth: { ...selectedRequest.auth, oauth2: { ...oauth, authorizationUrl: inputValue(event) } } })} onblur={() => persist()} /></label>
                {/if}
                <label class="space-y-1"><span class="block text-[10px] font-semibold text-[var(--app-text-muted)]">{m['api_client.oauth_token_url']()}</span><Input value={oauth.tokenUrl} class="h-8 font-mono text-[10px]" placeholder={m['api_client.oauth_token_placeholder']()} oninput={(event: Event) => updateRequest({ auth: { ...selectedRequest.auth, oauth2: { ...oauth, tokenUrl: inputValue(event) } } })} onblur={() => persist()} /></label>
                <div class="grid grid-cols-2 gap-2">
                  <label class="space-y-1"><span class="block text-[10px] font-semibold text-[var(--app-text-muted)]">{m['api_client.oauth_client_id']()}</span><Input value={oauth.clientId} class="h-8 font-mono text-[10px]" oninput={(event: Event) => updateRequest({ auth: { ...selectedRequest.auth, oauth2: { ...oauth, clientId: inputValue(event) } } })} onblur={() => persist()} /></label>
                  <label class="space-y-1"><span class="block text-[10px] font-semibold text-[var(--app-text-muted)]">{m['api_client.oauth_client_secret']()}</span><Input type="password" value={oauth.clientSecret} class="h-8 font-mono text-[10px]" oninput={(event: Event) => updateRequest({ auth: { ...selectedRequest.auth, oauth2: { ...oauth, clientSecret: inputValue(event) } } })} onblur={() => persist()} /></label>
                </div>
                <div class="grid grid-cols-2 gap-2">
                  <label class="space-y-1"><span class="block text-[10px] font-semibold text-[var(--app-text-muted)]">{m['api_client.oauth_scope']()}</span><Input value={oauth.scope} class="h-8 font-mono text-[10px]" placeholder="openid profile" oninput={(event: Event) => updateRequest({ auth: { ...selectedRequest.auth, oauth2: { ...oauth, scope: inputValue(event) } } })} onblur={() => persist()} /></label>
                  <label class="space-y-1"><span class="block text-[10px] font-semibold text-[var(--app-text-muted)]">{m['api_client.oauth_audience']()}</span><Input value={oauth.audience} class="h-8 font-mono text-[10px]" oninput={(event: Event) => updateRequest({ auth: { ...selectedRequest.auth, oauth2: { ...oauth, audience: inputValue(event) } } })} onblur={() => persist()} /></label>
                </div>
                {#if oauth.grantType === 'password'}
                  <div class="grid grid-cols-2 gap-2">
                    <Input value={oauth.username} autocomplete="username" aria-label={m['api_client.auth_username']()} placeholder={m['api_client.auth_username']()} class="h-8 font-mono text-[10px]" oninput={(event: Event) => updateRequest({ auth: { ...selectedRequest.auth, oauth2: { ...oauth, username: inputValue(event) } } })} onblur={() => persist()} />
                    <Input type="password" value={oauth.password} autocomplete="current-password" aria-label={m['api_client.auth_password']()} placeholder={m['api_client.auth_password']()} class="h-8 font-mono text-[10px]" oninput={(event: Event) => updateRequest({ auth: { ...selectedRequest.auth, oauth2: { ...oauth, password: inputValue(event) } } })} onblur={() => persist()} />
                  </div>
                {/if}
                {#if oauth.grantType === 'authorization_code'}
                  <label class="flex items-center justify-between gap-3 border-y border-[var(--app-border)] py-2"><span><strong class="block text-[10px]">PKCE (S256)</strong><span class="block text-[9px] text-[var(--app-text-muted)]">{m['api_client.oauth_pkce_hint']()}</span></span><Switch checked={oauth.usePkce} onCheckedChange={(checked: boolean) => updateRequest({ auth: { ...selectedRequest.auth, oauth2: { ...oauth, usePkce: checked } } }, true)} /></label>
                {/if}
                <div class="flex flex-wrap items-center gap-2">
                  <Button size="sm" class="h-8 text-[10px]" disabled={oauthAuthorizing || !oauth.tokenUrl || (oauth.grantType === 'authorization_code' && !oauth.authorizationUrl)} onclick={() => void authorizeOAuth()}>{#if oauthAuthorizing}<LoaderCircle size={12} class="animate-spin" />{:else}<ExternalLink size={12} />{/if}{oauth.accessToken ? m['api_client.oauth_refresh']() : m['api_client.oauth_get_token']()}</Button>
                  {#if oauth.accessToken}<span class="text-[10px] text-emerald-500">{m['api_client.oauth_token_ready']()}{oauth.expiresAt ? ` · ${new Date(oauth.expiresAt).toLocaleString()}` : ''}</span><Button size="sm" variant="ghost" class="h-7 text-[10px]" onclick={() => updateRequest({ auth: { ...selectedRequest.auth, oauth2: { ...oauth, accessToken: '', refreshToken: '', expiresAt: null } } }, true)}>{m['api_client.oauth_clear_token']()}</Button>{/if}
                </div>
              </div>
            {/if}
          </Tabs.Content>
          <Tabs.Content value="variables" class="m-0 min-h-0 flex-1 overflow-auto p-2">
            <p class="mb-2 text-[10px] text-[var(--app-text-muted)]">{m['api_client.variables_hint']()}</p>
            <div class="mb-3 flex flex-wrap items-center gap-2 border-b border-[var(--app-border)] pb-3">
              <NativeSelect.Root class="w-40" size="sm" aria-label={m['api_client.active_environment']()} value={activeEnvironment ?? '__none__'} onchange={(event: Event) => { const value = inputValue(event); activeEnvironment = value === '__none__' ? null : value; if (activeEnvironment) variableEditorScope = 'environment'; persist(); }}>
                <NativeSelect.Option value="__none__">{m['api_client.no_environment']()}</NativeSelect.Option>
                {#each Object.keys(environments).sort() as environment}<NativeSelect.Option value={environment}>{environment}</NativeSelect.Option>{/each}
              </NativeSelect.Root>
              <Input bind:value={newEnvironmentName} class="h-8 w-36 text-[11px]" aria-label={m['api_client.new_environment']()} placeholder={m['api_client.new_environment']()} onkeydown={(event: KeyboardEvent) => event.key === 'Enter' && addEnvironment()} />
              <Button size="sm" variant="outline" class="h-8" disabled={!newEnvironmentName.trim()} onclick={addEnvironment}><Plus size={12} />{m['api_client.add_environment']()}</Button>
              {#if activeEnvironment}<Button size="sm" variant="ghost" class="h-8 text-[var(--app-danger)]" onclick={deleteEnvironment}><Trash2 size={12} />{m['api_client.delete_environment']()}</Button>{/if}
            </div>
            <div class="mb-3 flex flex-wrap items-center gap-1" role="group" aria-label={m['api_client.variable_scope']()}>
              {#each [
                { id: 'collection', label: m['api_client.collection_variables']() },
                { id: 'environment', label: m['api_client.environment_variables']() },
                { id: 'globals', label: m['api_client.global_variables']() },
                { id: 'runtime', label: m['api_client.runtime_variables']() },
                { id: 'vault', label: m['api_client.vault_variables']() },
              ] as scope}
                <button disabled={scope.id === 'environment' && !activeEnvironment} aria-pressed={variableEditorScope === scope.id} class={`rounded border px-2 py-1 text-[10px] transition-colors disabled:opacity-40 ${variableEditorScope === scope.id ? 'border-[var(--app-accent)]/35 bg-[var(--app-accent-soft)] font-medium text-[var(--app-accent)]' : 'border-transparent text-[var(--app-text-muted)] hover:bg-[var(--app-surface-raised)] hover:text-[var(--app-text)]'}`} onclick={() => (variableEditorScope = scope.id as typeof variableEditorScope)}>{scope.label}</button>
              {/each}
            </div>
            {#if variableEditorScope === 'vault'}
              <div class="mb-3 grid grid-cols-[minmax(100px,0.8fr)_minmax(120px,1.2fr)_auto] gap-1">
                <Input bind:value={vaultName} autocomplete="off" spellcheck="false" aria-label={m['api_client.variable_name']()} placeholder={m['api_client.variable_name']()} class="h-8 font-mono text-[10px]" />
                <Input type="password" bind:value={vaultValue} autocomplete="new-password" aria-label={m['api_client.variable_value']()} placeholder={m['api_client.variable_value']()} class="h-8 font-mono text-[10px]" onkeydown={(event: KeyboardEvent) => event.key === 'Enter' && void saveVaultVariable()} />
                <Button size="sm" class="h-8" disabled={!vaultName.trim() || !vaultValue || !desktop?.saveAutomationSecret} onclick={() => void saveVaultVariable()}>{m['api_client.save_secret']()}</Button>
              </div>
              {#each vaultKeys as name (name)}
                <div class="mb-1 grid grid-cols-[minmax(100px,0.8fr)_minmax(120px,1.2fr)_28px] items-center gap-1">
                  <code class="truncate px-2 text-[10px]">{name}</code><span class="px-2 font-mono text-[10px] text-[var(--app-text-muted)]">••••••••</span>
                  <button class="grid size-7 place-items-center rounded text-[var(--app-text-muted)] hover:bg-[var(--app-danger-soft)] hover:text-[var(--app-danger)]" aria-label={m['api_client.remove_variable']()} onclick={() => void removeVaultVariable(name)}><Trash2 size={12} /></button>
                </div>
              {/each}
              {#if !desktop?.saveAutomationSecret}<p class="text-[10px] text-[var(--app-warning)]">{m['api_client.vault_desktop_required']()}</p>{/if}
            {:else}
              {#each Object.entries(currentVariables()) as [name, value] (name)}
                <div class="mb-1 grid grid-cols-[minmax(100px,0.8fr)_minmax(120px,1.2fr)_28px] gap-1">
                  <Input value={name} name="variable-name" autocomplete="off" spellcheck="false" aria-label={m['api_client.variable_name']()} class="h-7 font-mono text-[10px]" onblur={(event: Event) => renameVariable(name, inputValue(event))} />
                  <Input value={value} name="variable-value" autocomplete="off" spellcheck="false" aria-label={m['api_client.variable_value']()} class="h-7 font-mono text-[10px]" oninput={(event: Event) => updateVariable(name, inputValue(event))} onblur={() => persist()} />
                  <button class="grid size-7 place-items-center rounded text-[var(--app-text-muted)] hover:bg-[var(--app-danger-soft)] hover:text-[var(--app-danger)]" aria-label={m['api_client.remove_variable']()} onclick={() => removeVariable(name)}><Trash2 size={12} /></button>
                </div>
              {/each}
              <Button size="sm" variant="outline" class="mt-1 h-7 text-[10px]" onclick={addVariable}><Plus size={12} /> {m['api_client.add_variable']()}</Button>
            {/if}
          </Tabs.Content>
          <Tabs.Content value="scripts" class="m-0 min-h-0 flex-1 overflow-auto p-2">
            <div class="mb-2 flex flex-wrap items-center gap-1 border-b border-[var(--app-border)] pb-2">
              <button aria-pressed={scriptScope === 'request'} class={`rounded border px-2 py-1 text-[10px] transition-colors ${scriptScope === 'request' ? 'border-[var(--app-accent)]/35 bg-[var(--app-accent-soft)] font-medium text-[var(--app-accent)]' : 'border-transparent text-[var(--app-text-muted)] hover:bg-[var(--app-surface-raised)] hover:text-[var(--app-text)]'}`} onclick={() => (scriptScope = 'request')}>{m['api_client.request_scripts']()}</button>
              <button aria-pressed={scriptScope === 'collection'} class={`rounded border px-2 py-1 text-[10px] transition-colors ${scriptScope === 'collection' ? 'border-[var(--app-accent)]/35 bg-[var(--app-accent-soft)] font-medium text-[var(--app-accent)]' : 'border-transparent text-[var(--app-text-muted)] hover:bg-[var(--app-surface-raised)] hover:text-[var(--app-text)]'}`} onclick={() => (scriptScope = 'collection')}>{m['api_client.collection_scripts']()}</button>
              <label class="ml-auto flex items-center gap-2 text-[10px] text-[var(--app-text-muted)]"><span>{m['api_client.script_runtime']()}</span><NativeSelect.Root class="w-32" size="sm" value={scriptDialect} onchange={(event: Event) => { scriptDialect = inputValue(event) as typeof scriptDialect; persist(); }}><NativeSelect.Option value="orkestrai">Orkestrai</NativeSelect.Option><NativeSelect.Option value="postman">Postman</NativeSelect.Option><NativeSelect.Option value="bruno">Bruno</NativeSelect.Option></NativeSelect.Root></label>
            </div>
            <div class="grid h-full min-h-[260px] grid-cols-2 auto-rows-fr gap-2 max-[720px]:grid-cols-1">
              {#if scriptScope === 'request'}
                <ApiCodeEditor value={selectedRequest.preRequestScript ?? ''} language="javascript" completionProfile={scriptDialect} label={m['api_client.pre_request_script']()} minHeight={220} onchange={(value) => updateRequest({ preRequestScript: value })} onblur={() => persist()} />
                <ApiCodeEditor value={selectedRequest.postResponseScript ?? ''} language="javascript" completionProfile={scriptDialect} label={m['api_client.post_response_script']()} minHeight={220} onchange={(value) => updateRequest({ postResponseScript: value })} onblur={() => persist()} />
              {:else}
                <ApiCodeEditor value={collectionPreRequestScript} language="javascript" completionProfile={scriptDialect} label={m['api_client.collection_pre_request_script']()} minHeight={220} onchange={(value) => (collectionPreRequestScript = value)} onblur={() => persist()} />
                <ApiCodeEditor value={collectionPostResponseScript} language="javascript" completionProfile={scriptDialect} label={m['api_client.collection_post_response_script']()} minHeight={220} onchange={(value) => (collectionPostResponseScript = value)} onblur={() => persist()} />
              {/if}
            </div>
            <p class="mt-2 text-[10px] leading-4 text-[var(--app-text-muted)]">{scriptRuntimeHint()}</p>
          </Tabs.Content>
          <Tabs.Content value="tests" class="m-0 min-h-0 flex-1 overflow-auto p-2">
            <div class="mb-2 flex items-center gap-1 border-b border-[var(--app-border)] pb-2">
              <button aria-pressed={testEditorMode === 'assertions'} class={`rounded border px-2 py-1 text-[10px] transition-colors ${testEditorMode === 'assertions' ? 'border-[var(--app-accent)]/35 bg-[var(--app-accent-soft)] font-medium text-[var(--app-accent)]' : 'border-transparent text-[var(--app-text-muted)] hover:bg-[var(--app-surface-raised)] hover:text-[var(--app-text)]'}`} onclick={() => (testEditorMode = 'assertions')}>{m['api_client.assertions']()}</button>
              <button aria-pressed={testEditorMode === 'javascript'} class={`rounded border px-2 py-1 text-[10px] transition-colors ${testEditorMode === 'javascript' ? 'border-[var(--app-accent)]/35 bg-[var(--app-accent-soft)] font-medium text-[var(--app-accent)]' : 'border-transparent text-[var(--app-text-muted)] hover:bg-[var(--app-surface-raised)] hover:text-[var(--app-text)]'}`} onclick={() => (testEditorMode = 'javascript')}>{m['api_client.javascript_tests']()}</button>
              <span class="ml-auto rounded bg-[var(--app-surface-raised)] px-2 py-1 font-mono text-[9px] uppercase text-[var(--app-text-muted)]">{scriptDialect}</span>
            </div>
            {#if testEditorMode === 'assertions'}
              {#each selectedRequest.assertions ?? [] as assertion (assertion.id)}
                <div class="mb-1 grid grid-cols-[24px_105px_minmax(90px,1fr)_110px_minmax(90px,1fr)_28px] gap-1">
                  <button class="grid size-7 place-items-center rounded border border-[var(--app-border)] text-[var(--app-text-muted)]" aria-label={assertion.enabled ? m['api_client.disable_test']() : m['api_client.enable_test']()} onclick={() => updateAssertion(assertion.id, { enabled: !assertion.enabled }, true)}>{#if assertion.enabled}<Check size={12} />{/if}</button>
                  <NativeSelect.Root size="sm" aria-label={m['api_client.test_source']()} value={assertion.source} onchange={(event: Event) => updateAssertion(assertion.id, { source: inputValue(event) as ApiClientAssertion['source'] }, true)}>
                    {#each ['status', 'body', 'header', 'responseTime'] as source}<NativeSelect.Option value={source}>{testSourceLabel(source)}</NativeSelect.Option>{/each}
                  </NativeSelect.Root>
                  <Input value={assertion.property} name="assertion-property" aria-label={m['api_client.test_property']()} placeholder={m['api_client.test_property']()} class="h-7 font-mono text-[10px]" oninput={(event: Event) => updateAssertion(assertion.id, { property: inputValue(event) })} onblur={() => persist()} />
                  <NativeSelect.Root size="sm" aria-label={m['api_client.test_operator']()} value={assertion.operator} onchange={(event: Event) => updateAssertion(assertion.id, { operator: inputValue(event) as ApiClientAssertion['operator'] }, true)}>
                    {#each ['equals', 'notEquals', 'contains', 'exists', 'matches', 'lt', 'lte', 'gt', 'gte'] as operator}<NativeSelect.Option value={operator}>{testOperatorLabel(operator)}</NativeSelect.Option>{/each}
                  </NativeSelect.Root>
                  <Input value={assertion.expected} name="assertion-expected" aria-label={m['api_client.test_expected']()} placeholder={m['api_client.test_expected']()} class="h-7 font-mono text-[10px]" disabled={assertion.operator === 'exists'} oninput={(event: Event) => updateAssertion(assertion.id, { expected: inputValue(event) })} onblur={() => persist()} />
                  <button class="grid size-7 place-items-center rounded text-[var(--app-text-muted)] hover:text-[var(--app-danger)]" aria-label={m['api_client.remove_test']()} onclick={() => removeAssertion(assertion.id)}><Trash2 size={12} /></button>
                </div>
              {/each}
              <Button size="sm" variant="outline" class="mt-1 h-7 text-[10px]" onclick={addAssertion}><Plus size={12} />{m['api_client.add_test']()}</Button>
            {:else}
              <div class="h-[calc(100%_-_38px)] min-h-[280px]">
                <ApiCodeEditor value={selectedRequest.testScript ?? ''} language="javascript" completionProfile={scriptDialect} label={m['api_client.test_script']()} minHeight={280} onchange={(value) => updateRequest({ testScript: value })} onblur={() => persist()} />
              </div>
            {/if}
          </Tabs.Content>
          <Tabs.Content value="network" class="m-0 min-h-0 flex-1 overflow-auto p-3">
            <div class="grid gap-3">
              <div class="flex items-center justify-between gap-4 border-b border-[var(--app-border)] pb-3">
                <span><strong class="block text-[11px]">{m['api_client.cookie_jar']()}</strong><span class="mt-0.5 block text-[10px] text-[var(--app-text-muted)]">{m['api_client.cookie_jar_hint']({ count: network.cookies.length })}</span></span>
                <div class="flex items-center gap-2"><Button size="sm" variant="ghost" class="h-7 text-[10px]" disabled={!network.cookies.length} onclick={() => { network = { ...network, cookies: [] }; persist(); }}>{m['api_client.clear_cookies']()}</Button><Switch checked={network.cookieJarEnabled} onCheckedChange={(checked: boolean) => { network = { ...network, cookieJarEnabled: checked }; persist(); }} /></div>
              </div>
              {#if network.cookies.length}
                <div class="max-h-36 divide-y divide-[var(--app-border)] overflow-auto rounded border border-[var(--app-border)]">
                  {#each network.cookies as cookie, index (`${cookie.domain}-${cookie.path}-${cookie.key}`)}
                    <div class="grid grid-cols-[minmax(90px,0.7fr)_minmax(120px,1.3fr)_28px] items-center gap-2 px-2 py-1.5 text-[9px]"><strong class="truncate font-mono text-[var(--app-text-soft)]" title={cookie.key}>{cookie.key}</strong><span class="truncate font-mono text-[var(--app-text-muted)]" title={`${cookie.domain}${cookie.path}`}>{cookie.domain}{cookie.path}</span><button class="grid size-7 place-items-center rounded text-[var(--app-text-muted)] hover:bg-[var(--app-danger-soft)] hover:text-[var(--app-danger)]" aria-label={m['api_client.remove_cookie']({ name: cookie.key })} onclick={() => { network = { ...network, cookies: network.cookies.filter((_, candidate) => candidate !== index) }; persist(); }}><Trash2 size={11} /></button></div>
                  {/each}
                </div>
              {/if}
              <label class="space-y-1"><span class="block text-[10px] font-semibold text-[var(--app-text-muted)]">{m['api_client.proxy_url']()}</span><Input value={network.proxyUrl} class="h-8 font-mono text-[10px]" placeholder={m['api_client.proxy_placeholder']()} oninput={(event: Event) => (network = { ...network, proxyUrl: inputValue(event) })} onblur={() => persist()} /></label>
              <div class="flex items-center justify-between gap-4 border-b border-[var(--app-border)] pb-3">
                <span><strong class="block text-[11px]">{m['api_client.verify_tls']()}</strong><span class="mt-0.5 block text-[10px] text-[var(--app-text-muted)]">{m['api_client.verify_tls_hint']()}</span></span><Switch checked={network.rejectUnauthorized} onCheckedChange={(checked: boolean) => { network = { ...network, rejectUnauthorized: checked }; persist(); }} />
              </div>
              {#each [
                { field: 'caPath', label: m['api_client.ca_certificate'](), kind: 'certificate' },
                { field: 'clientCertificatePath', label: m['api_client.client_certificate'](), kind: 'certificate' },
                { field: 'clientKeyPath', label: m['api_client.client_key'](), kind: 'privateKey' },
                { field: 'clientPfxPath', label: m['api_client.client_pfx'](), kind: 'pfx' },
              ] as item}
                <label class="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2"><span class="min-w-0 space-y-1"><span class="block text-[10px] font-semibold text-[var(--app-text-muted)]">{item.label}</span><Input value={network[item.field as keyof typeof network] as string} readonly class="h-8 min-w-0 font-mono text-[10px]" /></span><Button size="sm" variant="outline" class="h-8" onclick={() => pickNetworkFile(item.field as 'caPath' | 'clientCertificatePath' | 'clientKeyPath' | 'clientPfxPath', item.kind as 'certificate' | 'privateKey' | 'pfx')}><FolderOpen size={13} />{m['api_client.choose_file']()}</Button></label>
              {/each}
              {#if network.clientKeyPath || network.clientPfxPath}
                <label class="space-y-1"><span class="block text-[10px] font-semibold text-[var(--app-text-muted)]">{m['api_client.key_passphrase']()}</span><Input type="password" value={network.clientKeyPassphrase} class="h-8 font-mono text-[10px]" oninput={(event: Event) => (network = { ...network, clientKeyPassphrase: inputValue(event) })} onblur={() => persist()} /></label>
              {/if}
            </div>
          </Tabs.Content>
          <Tabs.Content value="sync" class="m-0 min-h-0 flex-1 overflow-auto p-3">
            {#if data.payload.sourcePath}
              <div class="grid gap-3">
                <div class="flex items-start gap-3 rounded border border-[var(--app-border)] bg-[var(--app-surface-subtle)] p-3">
                  <RefreshCw size={15} class={`mt-0.5 shrink-0 text-[var(--app-secondary)] ${syncing ? 'animate-spin' : ''}`} />
                  <div class="min-w-0 flex-1"><strong class="block text-[11px]">{m['api_client.sync_linked']()}</strong><code class="mt-1 block truncate text-[9px] text-[var(--app-text-muted)]" title={data.payload.sourcePath}>{data.payload.sourcePath}</code></div>
                  <span class="rounded border border-[var(--app-border)] px-1.5 py-0.5 text-[9px] uppercase text-[var(--app-text-muted)]">{data.payload.sourceKind}</span>
                </div>
                {#if syncStatus}
                  <div class="flex flex-wrap gap-1.5">
                    <span class={`rounded px-2 py-1 text-[9px] font-medium ${syncStatus.conflict ? 'bg-red-500/10 text-red-500' : syncStatus.sourceChanged || syncStatus.localChanged ? 'bg-amber-500/10 text-amber-600' : 'bg-emerald-500/10 text-emerald-600'}`}>{syncStatus.conflict ? m['api_client.sync_conflict']() : syncStatus.sourceChanged ? m['api_client.sync_source_changed']() : syncStatus.localChanged ? m['api_client.sync_local_changed']() : m['api_client.sync_current']()}</span>
                    {#if !syncStatus.writable}<span class="rounded bg-[var(--app-surface-raised)] px-2 py-1 text-[9px] text-[var(--app-text-muted)]">{m['api_client.sync_read_only']()}</span>{/if}
                  </div>
                {/if}
                <label class="flex items-center justify-between gap-4 border-b border-[var(--app-border)] pb-3"><span><strong class="block text-[11px]">{m['api_client.sync_watch']()}</strong><span class="block text-[9px] text-[var(--app-text-muted)]">{m['api_client.sync_watch_hint']()}</span></span><Switch checked={sync.mode === 'watch'} onCheckedChange={(checked: boolean) => { sync = { ...sync, mode: checked ? 'watch' : 'manual' }; persist(); }} /></label>
                <label class="grid grid-cols-[minmax(0,1fr)_180px] items-center gap-3"><span><strong class="block text-[11px]">{m['api_client.sync_conflict_policy']()}</strong><span class="block text-[9px] text-[var(--app-text-muted)]">{m['api_client.sync_conflict_policy_hint']()}</span></span><NativeSelect.Root size="sm" value={sync.conflictPolicy} onchange={(event: Event) => { sync = { ...sync, conflictPolicy: inputValue(event) as typeof sync.conflictPolicy }; persist(); }}><NativeSelect.Option value="ask">{m['api_client.sync_ask']()}</NativeSelect.Option><NativeSelect.Option value="orkestrai">{m['api_client.sync_prefer_orkestrai']()}</NativeSelect.Option><NativeSelect.Option value="filesystem">{m['api_client.sync_prefer_files']()}</NativeSelect.Option></NativeSelect.Root></label>
                <div class="flex flex-wrap items-center gap-2 border-t border-[var(--app-border)] pt-3">
                  <Button size="sm" variant="outline" class="h-8 text-[10px]" disabled={syncing} onclick={() => void synchronize('pull', syncStatus?.conflict ? 'filesystem' : undefined)}><ArrowDownToLine size={12} />{syncStatus?.conflict ? m['api_client.sync_use_files']() : m['api_client.sync_pull']()}</Button>
                  <Button size="sm" class="h-8 text-[10px]" disabled={syncing || syncStatus?.writable === false} onclick={() => void synchronize('push', syncStatus?.sourceChanged ? 'orkestrai' : undefined)}><ArrowUpFromLine size={12} />{syncStatus?.conflict ? m['api_client.sync_use_orkestrai']() : m['api_client.sync_push']()}</Button>
                  <Button size="icon-sm" variant="ghost" class="ml-auto size-8" disabled={syncing} aria-label={m['api_client.sync_check']()} title={m['api_client.sync_check']()} onclick={() => void synchronize('status')}><RefreshCw size={13} /></Button>
                </div>
                {#if sync.lastSyncedAt}<p class="text-[9px] text-[var(--app-text-muted)]">{m['api_client.sync_last']({ date: new Date(sync.lastSyncedAt).toLocaleString() })}</p>{/if}
              </div>
            {:else}
              <div class="grid min-h-52 place-items-center text-center"><div><RefreshCw size={22} class="mx-auto mb-2 text-[var(--app-text-muted)]" /><strong class="block text-[11px]">{m['api_client.sync_not_linked']()}</strong><p class="mt-1 max-w-sm text-[10px] leading-4 text-[var(--app-text-muted)]">{m['api_client.sync_not_linked_hint']()}</p></div></div>
            {/if}
          </Tabs.Content>
          <Tabs.Content value="docs" class="m-0 min-h-0 flex-1 overflow-auto p-2">
            <div class="mb-3 grid grid-cols-[minmax(140px,220px)_minmax(0,1fr)] items-center gap-3 rounded border border-[var(--app-border)] bg-[var(--app-surface-subtle)] p-2.5">
              <label class="space-y-1"><span class="block text-[10px] font-semibold text-[var(--app-text-muted)]">{m['api_client.timeout']()}</span><Input type="number" min="1000" max="120000" step="1000" value={selectedRequest.timeoutMs ?? 30000} class="h-7 font-mono text-[10px]" aria-label={m['api_client.timeout']()} oninput={(event: Event) => updateRequest({ timeoutMs: Number(inputValue(event)) })} onblur={() => persist()} /></label>
              <label class="flex items-center justify-between gap-3"><span><strong class="block text-[10px] font-semibold">{m['api_client.follow_redirects']()}</strong><span class="mt-0.5 block text-[9px] leading-4 text-[var(--app-text-muted)]">{m['api_client.follow_redirects_hint']()}</span></span><Switch checked={selectedRequest.followRedirects ?? true} onCheckedChange={(checked: boolean) => updateRequest({ followRedirects: checked }, true)} aria-label={m['api_client.follow_redirects']()} /></label>
            </div>
            <textarea class="min-h-44 w-full resize-y rounded border border-[var(--app-border)] bg-[var(--app-canvas)] p-3 text-[11px] leading-5 text-[var(--app-text)]" aria-label={m['api_client.docs']()} placeholder={m['api_client.docs_placeholder']()} value={selectedRequest.documentation ?? ''} oninput={(event) => updateRequest({ documentation: event.currentTarget.value })} onblur={() => persist()}></textarea>
          </Tabs.Content>
          <Tabs.Content value="response" class="m-0 min-h-0 flex-1 overflow-auto p-2">
            {#if response}
              <div class="mb-2 flex flex-wrap items-center gap-2 text-[10px] text-[var(--app-text-muted)]">
                <strong class:text-emerald-500={response.ok} class:text-red-500={!response.ok}>{response.status} {response.statusText}</strong>
                <span class="tabular-nums">{response.durationMs} ms</span>
                <span class="tabular-nums">{new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(response.size / 1024)} KB</span>
                <span class="truncate">{response.contentType}</span>
                {#if response.tests.length}<span class:text-emerald-500={response.tests.every((test) => test.passed)} class:text-red-500={response.tests.some((test) => !test.passed)}>{response.tests.filter((test) => test.passed).length}/{response.tests.length} {m['api_client.tests_passed']()}</span>{/if}
              </div>
              <div class="mb-2 flex items-center gap-1 border-b border-[var(--app-border)] pb-2">
                {#each ['body', ...(response.visualizations?.length ? ['visualizer'] : []), ...(response.messages?.length ? ['messages'] : []), 'headers', 'tests', 'console'] as view}
                  <button aria-pressed={responseView === view} class={`rounded border px-2 py-1 text-[10px] transition-colors ${responseView === view ? 'border-[var(--app-accent)]/35 bg-[var(--app-accent-soft)] font-medium text-[var(--app-accent)]' : 'border-transparent text-[var(--app-text-muted)] hover:bg-[var(--app-surface-raised)] hover:text-[var(--app-text)]'}`} onclick={() => (responseView = view as typeof responseView)}>{view === 'body' ? m['api_client.response_body']() : view === 'visualizer' ? m['api_client.visualizer']() : view === 'messages' ? m['api_client.messages']() : view === 'headers' ? m['api_client.response_headers']() : view === 'tests' ? m['api_client.tests']() : m['api_client.script_console']()}</button>
                {/each}
              </div>
              {#if responseView === 'body'}
                {#if response.binary}<p class="text-[11px] text-[var(--app-text-muted)]">{m['api_client.binary_response']()}</p>{:else}<ApiResponseViewer body={response.body} contentType={response.contentType} />{/if}
              {:else if responseView === 'visualizer'}
                <div class="space-y-2">
                  {#each response.visualizations ?? [] as visualization}
                    {#if visualization.type === 'html'}
                      <iframe sandbox="" title={m['api_client.visualizer']()} srcdoc={visualization.content} class="h-[420px] w-full rounded border border-[var(--app-border)] bg-white"></iframe>
                    {:else}
                      <ApiResponseViewer body={JSON.stringify(visualization.data ?? {}, null, 2)} contentType="application/json" />
                    {/if}
                  {/each}
                </div>
              {:else if responseView === 'messages'}
                <div class="space-y-1.5">
                  {#each response.messages ?? [] as message}
                    <div class={`grid grid-cols-[72px_minmax(0,1fr)_78px] gap-2 rounded border px-2 py-1.5 font-mono text-[10px] ${message.direction === 'sent' ? 'border-sky-500/25 bg-sky-500/5' : 'border-emerald-500/25 bg-emerald-500/5'}`}>
                      <strong class={message.direction === 'sent' ? 'text-sky-500' : 'text-emerald-500'}>{message.direction === 'sent' ? m['api_client.message_sent']() : m['api_client.message_received']()}</strong>
                      <pre class="whitespace-pre-wrap break-all text-[var(--app-text)]">{message.content}</pre>
                      <time class="text-right text-[var(--app-text-muted)]">{new Date(message.at).toLocaleTimeString()}</time>
                    </div>
                  {/each}
                </div>
              {:else if responseView === 'headers'}
                <div class="divide-y divide-[var(--app-border)] rounded border border-[var(--app-border)]">{#each Object.entries(response.headers) as [name, value]}<div class="grid grid-cols-[minmax(110px,0.7fr)_minmax(0,1.3fr)] gap-3 px-2 py-1.5 font-mono text-[10px]"><strong class="break-all text-[var(--app-text-soft)]">{name}</strong><span class="break-all text-[var(--app-text-muted)]">{value}</span></div>{/each}</div>
              {:else if responseView === 'tests'}
                {#each response.tests as test (test.id)}<div class="mb-1 grid grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-2 rounded border border-[var(--app-border)] px-2 py-1.5 text-[10px]"><span class={test.passed ? 'text-emerald-500' : 'text-red-500'}>{test.passed ? '✓' : '×'}</span><span class="truncate">{test.label}</span><code class="max-w-52 truncate text-[var(--app-text-muted)]">{test.actual} → {test.expected}</code></div>{:else}<p class="text-[11px] text-[var(--app-text-muted)]">{m['api_client.no_tests']()}</p>{/each}
              {:else}
                {#each response.scriptLogs as log, index (`${index}-${log}`)}<pre class="mb-1 whitespace-pre-wrap break-words font-mono text-[10px] text-[var(--app-text-soft)]">{log}</pre>{:else}<p class="text-[11px] text-[var(--app-text-muted)]">{m['api_client.no_script_logs']()}</p>{/each}
              {/if}
            {:else}
              <div class="grid h-full place-items-center text-[11px] text-[var(--app-text-muted)]">{m['api_client.no_response']()}</div>
            {/if}
          </Tabs.Content>
          <Tabs.Content value="history" class="m-0 min-h-0 flex-1 overflow-auto p-2">
            <div class="mb-2 flex items-center justify-between"><span class="text-[10px] text-[var(--app-text-muted)]">{m['api_client.history_hint']()}</span>{#if history.length}<Button size="sm" variant="ghost" class="h-7 text-[10px]" onclick={() => { history = []; persist(); }}><Trash2 size={12} />{m['api_client.clear_history']()}</Button>{/if}</div>
            {#each history as entry (entry.id)}
              <button class="mb-1 grid w-full grid-cols-[42px_minmax(0,1fr)_52px_62px_64px] items-center gap-2 rounded border border-[var(--app-border)] px-2 py-1.5 text-left text-[10px] hover:bg-[var(--app-surface-raised)]" onclick={() => chooseRequest(entry.requestId)}>
                <strong class="text-[var(--app-secondary)]">{entry.method}</strong><span class="truncate">{entry.requestName}</span><span class={entry.ok ? 'text-emerald-500' : 'text-red-500'}>{entry.status}</span><span class="tabular-nums text-[var(--app-text-muted)]">{entry.durationMs} ms</span><span class="tabular-nums text-[var(--app-text-muted)]">{entry.testPassed}/{entry.testPassed + entry.testFailed}</span>
              </button>
            {:else}<div class="grid h-36 place-items-center text-[11px] text-[var(--app-text-muted)]"><History size={22} class="mb-2 opacity-40" />{m['api_client.no_history']()}</div>{/each}
          </Tabs.Content>
        </Tabs.Root>
        {#if running}<div class="shrink-0 border-t border-[var(--app-border)] px-3 py-1.5 text-[10px] text-[var(--app-text-muted)]">{m['api_client.running_progress']({ completed: runProgress.completed, total: runProgress.total, failed: runProgress.failed })}</div>{/if}
        {#if error}<p class="shrink-0 border-t border-red-500/20 bg-red-500/10 px-3 py-2 text-[10px] text-red-500" aria-live="polite">{error}</p>{/if}
      </section>
    {:else}
      <section class="grid min-h-0 place-items-center p-6 text-center text-[11px] text-[var(--app-text-muted)]">
        <div><Braces size={28} class="mx-auto mb-3 opacity-40" /><p>{m['api_client.select_or_create']()}</p></div>
      </section>
    {/if}
  </div>
</NodeShell>

<Dialog.Root open={folderDialogOpen} onOpenChange={(value) => (folderDialogOpen = value)}>
  <Dialog.Content class="sm:max-w-md" data-testid="api-client-folder-dialog">
    <Dialog.Header>
      <Dialog.Title>{folderDialogMode === 'rename' ? m['api_client.rename_folder']() : m['api_client.add_folder']()}</Dialog.Title>
      <Dialog.Description>{m['api_client.folder_dialog_description']()}</Dialog.Description>
    </Dialog.Header>
    <form class="space-y-4" onsubmit={(event) => { event.preventDefault(); saveFolder(); }}>
      <label class="block space-y-1.5">
        <span class="text-xs font-medium">{m['api_client.folder_name']()}</span>
        <Input bind:value={folderDialogName} maxlength="100" autofocus autocomplete="off" placeholder={m['api_client.folder_name_placeholder']()} />
      </label>
      <label class="block space-y-1.5">
        <span class="text-xs font-medium">{m['api_client.parent_folder']()}</span>
        <NativeSelect.Root value={folderDialogParentId ?? ''} onchange={(event: Event) => (folderDialogParentId = inputValue(event) || null)}>
          <NativeSelect.Option value="">{m['api_client.collection_root']()}</NativeSelect.Option>
          {#each folders.filter((folder) => !editingFolderId || !apiClientDescendantFolderIds(folders, editingFolderId).has(folder.id)) as folder (folder.id)}
            <NativeSelect.Option value={folder.id}>{apiClientFolderPath(folders, folder.id)}</NativeSelect.Option>
          {/each}
        </NativeSelect.Root>
      </label>
      <Dialog.Footer>
        <Button type="button" variant="outline" onclick={() => (folderDialogOpen = false)}>{m['settings.cancel']()}</Button>
        <Button type="submit" disabled={!folderDialogName.trim()}>{folderDialogMode === 'rename' ? m['dlg.save']() : m['api_client.create_folder']()}</Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>

<ApiClientRunnerDialog
  open={runnerDialogOpen}
  {runners}
  {selectedRunnerId}
  {requests}
  environmentNames={Object.keys(environments)}
  {running}
  onSave={saveRunners}
  onRun={runRunner}
  onClose={() => (runnerDialogOpen = false)}
/>
