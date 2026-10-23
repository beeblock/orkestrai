import { z } from 'zod/v3';

export const apiClientMethodSchema = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
export const apiClientProtocolSchema = z.enum(['http', 'graphql', 'websocket', 'grpc']);
export const apiClientScriptDialectSchema = z.enum(['orkestrai', 'postman', 'bruno']);

export const apiClientKeyValueSchema = z.object({
  id: z.string().trim().min(1).max(100),
  name: z.string().trim().max(500),
  value: z.string().max(20_000),
  enabled: z.boolean().default(true),
}).strict();

export const apiClientHeaderSchema = apiClientKeyValueSchema;

export const apiClientAuthSchema = z.object({
  type: z.enum(['none', 'bearer', 'basic', 'apiKey', 'oauth2']).default('none'),
  token: z.string().max(100_000).default(''),
  username: z.string().max(20_000).default(''),
  password: z.string().max(100_000).default(''),
  key: z.string().max(2_000).default(''),
  value: z.string().max(100_000).default(''),
  placement: z.enum(['header', 'query']).default('header'),
  oauth2: z.object({
    grantType: z.enum(['authorization_code', 'client_credentials', 'password', 'refresh_token']).default('authorization_code'),
    authorizationUrl: z.string().max(20_000).default(''),
    tokenUrl: z.string().max(20_000).default(''),
    clientId: z.string().max(20_000).default(''),
    clientSecret: z.string().max(100_000).default(''),
    scope: z.string().max(20_000).default(''),
    audience: z.string().max(20_000).default(''),
    username: z.string().max(20_000).default(''),
    password: z.string().max(100_000).default(''),
    accessToken: z.string().max(200_000).default(''),
    refreshToken: z.string().max(200_000).default(''),
    tokenType: z.string().max(100).default('Bearer'),
    expiresAt: z.string().max(100).nullable().default(null),
    usePkce: z.boolean().default(true),
    clientAuthentication: z.enum(['header', 'body']).default('header'),
  }).strict().default({}),
}).strict();

export const apiClientMessageSchema = z.object({
  id: z.string().trim().min(1).max(100),
  name: z.string().trim().max(500).default(''),
  content: z.string().max(2_000_000).default(''),
  type: z.enum(['text', 'json', 'binary']).default('text'),
  enabled: z.boolean().default(true),
}).strict();

export const apiClientGraphqlSchema = z.object({
  query: z.string().max(2_000_000).default(''),
  variables: z.string().max(2_000_000).default('{}'),
  operationName: z.string().max(500).default(''),
}).strict().default({});

export const apiClientWebsocketSchema = z.object({
  messages: z.array(apiClientMessageSchema).max(100).default([]),
  protocols: z.array(z.string().trim().min(1).max(500)).max(30).default([]),
  autoReconnect: z.boolean().default(false),
  reconnectAttempts: z.coerce.number().int().min(0).max(20).default(3),
  keepAliveIntervalMs: z.coerce.number().int().min(0).max(300_000).default(0),
}).strict().default({});

export const apiClientGrpcSchema = z.object({
  protoPath: z.string().max(8_000).default(''),
  service: z.string().max(1_000).default(''),
  method: z.string().max(1_000).default(''),
  methodType: z.enum(['unary', 'serverStreaming', 'clientStreaming', 'bidirectional']).default('unary'),
  messages: z.array(apiClientMessageSchema).max(100).default([]),
  useTls: z.boolean().default(false),
}).strict().default({});

export const apiClientAssertionSchema = z.object({
  id: z.string().trim().min(1).max(100),
  source: z.enum(['status', 'body', 'header', 'responseTime']),
  property: z.string().max(2_000).default(''),
  operator: z.enum(['equals', 'notEquals', 'contains', 'exists', 'matches', 'lt', 'lte', 'gt', 'gte']),
  expected: z.string().max(20_000).default(''),
  enabled: z.boolean().default(true),
}).strict();

export const apiClientRequestSchema = z.object({
  id: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(500),
  method: apiClientMethodSchema,
  protocol: apiClientProtocolSchema.default('http'),
  url: z.string().trim().min(1).max(20_000),
  folder: z.string().trim().max(1_000).default(''),
  folderId: z.string().trim().min(1).max(200).nullish(),
  sequence: z.coerce.number().int().min(0).max(100_000).default(0),
  params: z.array(apiClientKeyValueSchema).max(300).default([]),
  headers: z.array(apiClientHeaderSchema).max(300).default([]),
  auth: apiClientAuthSchema.default({ type: 'none', token: '', username: '', password: '', key: '', value: '', placement: 'header' }),
  body: z.string().max(2_000_000).default(''),
  bodyMode: z.enum(['none', 'json', 'text', 'xml', 'form', 'multipart']).default('none'),
  formFields: z.array(apiClientKeyValueSchema).max(300).default([]),
  preRequestScript: z.string().max(100_000).default(''),
  postResponseScript: z.string().max(100_000).default(''),
  testScript: z.string().max(100_000).default(''),
  assertions: z.array(apiClientAssertionSchema).max(300).default([]),
  documentation: z.string().max(200_000).default(''),
  timeoutMs: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
  followRedirects: z.boolean().default(true),
  graphql: apiClientGraphqlSchema,
  websocket: apiClientWebsocketSchema,
  grpc: apiClientGrpcSchema,
  sourcePath: z.string().max(4_000).nullish(),
  sourceData: z.object({
    kind: z.enum(['bruno', 'postman', 'openapi']),
    data: z.record(z.string(), z.unknown()),
  }).strict().nullish(),
}).strict();

export const persistedApiClientRequestSchema = apiClientRequestSchema.extend({
  url: z.string().trim().max(20_000),
});

export const apiClientFolderSchema = z.object({
  id: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(500),
  parentId: z.string().trim().min(1).max(200).nullable(),
  sequence: z.coerce.number().int().min(0).max(100_000),
  sourceData: z.object({
    kind: z.enum(['bruno', 'postman', 'openapi']),
    data: z.record(z.string(), z.unknown()),
  }).strict().nullish(),
}).strict();

export const apiClientRunnerSchema = z.object({
  id: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(500),
  requestIds: z.array(z.string().trim().min(1).max(200)).max(500),
  environment: z.string().trim().max(500).nullable(),
  iterations: z.coerce.number().int().min(1).max(1_000),
  iterationData: z.array(z.record(z.string(), z.unknown())).max(1_000).default([]),
  delayMs: z.coerce.number().int().min(0).max(120_000),
  stopOnFailure: z.boolean(),
  sequence: z.coerce.number().int().min(0).max(100_000),
}).strict();

export const apiClientHistoryEntrySchema = z.object({
  id: z.string().trim().min(1).max(200),
  requestId: z.string().trim().min(1).max(200),
  requestName: z.string().trim().max(500),
  method: apiClientMethodSchema,
  protocol: apiClientProtocolSchema.default('http'),
  url: z.string().max(20_000),
  status: z.coerce.number().int().min(0).max(999),
  ok: z.boolean(),
  durationMs: z.coerce.number().min(0),
  size: z.coerce.number().int().min(0),
  testPassed: z.coerce.number().int().min(0),
  testFailed: z.coerce.number().int().min(0),
  executedAt: z.string().max(100),
}).strict();

export const apiClientCookieSchema = z.object({
  key: z.string().min(1).max(4_000),
  value: z.string().max(100_000),
  domain: z.string().max(4_000),
  path: z.string().max(4_000).default('/'),
  expires: z.string().max(100).nullable().default(null),
  secure: z.boolean().default(false),
  httpOnly: z.boolean().default(false),
  hostOnly: z.boolean().default(true),
}).strict();

export const apiClientNetworkSchema = z.object({
  cookieJarEnabled: z.boolean().default(true),
  cookies: z.array(apiClientCookieSchema).max(2_000).default([]),
  proxyUrl: z.string().max(20_000).default(''),
  caPath: z.string().max(8_000).default(''),
  clientCertificatePath: z.string().max(8_000).default(''),
  clientKeyPath: z.string().max(8_000).default(''),
  clientPfxPath: z.string().max(8_000).default(''),
  clientKeyPassphrase: z.string().max(100_000).default(''),
  rejectUnauthorized: z.boolean().default(true),
}).strict().default({});

export const apiClientSyncSchema = z.object({
  mode: z.enum(['manual', 'watch']).default('manual'),
  conflictPolicy: z.enum(['ask', 'orkestrai', 'filesystem']).default('ask'),
  lastSyncedAt: z.string().max(100).nullable().default(null),
  sourceFingerprint: z.string().max(200).nullable().default(null),
  localFingerprint: z.string().max(200).nullable().default(null),
  managedFiles: z.array(z.string().max(4_000)).max(2_000).default([]),
}).strict().default({});

export const apiClientNativePayloadSchema = z.object({
  formatVersion: z.literal(1).default(1),
  sourceKind: z.enum(['bruno', 'postman', 'openapi', 'openCollection']).nullable().default(null),
  sourcePath: z.string().max(8_000).nullable().default(null),
  sourceCollection: z.record(z.string(), z.unknown()).nullable().default(null),
  requests: z.array(persistedApiClientRequestSchema).max(500).default([]),
  folders: z.array(apiClientFolderSchema).max(500).default([]),
  runners: z.array(apiClientRunnerSchema).max(100).default([]),
  selectedRunnerId: z.string().max(200).nullable().default(null),
  selectedRequestId: z.string().max(200).nullable().default(null),
  variables: z.record(z.string(), z.string().max(100_000)).default({}),
  environments: z.record(z.string(), z.record(z.string(), z.string().max(100_000))).default({}),
  globalVariables: z.record(z.string(), z.string().max(100_000)).default({}),
  runtimeVariables: z.record(z.string(), z.string().max(100_000)).default({}),
  scriptDialect: apiClientScriptDialectSchema.default('orkestrai'),
  vaultKeys: z.array(z.string().trim().min(1).max(500)).max(500).default([]),
  activeEnvironment: z.string().max(500).nullable().default(null),
  history: z.array(apiClientHistoryEntrySchema).max(50).default([]),
  collectionPreRequestScript: z.string().max(100_000).default(''),
  collectionPostResponseScript: z.string().max(100_000).default(''),
  compatibilityWarnings: z.array(z.object({
    code: z.string().trim().min(1).max(100),
    count: z.coerce.number().int().min(1).max(100_000).optional(),
  }).strict()).max(50).default([]),
  network: apiClientNetworkSchema,
  sync: apiClientSyncSchema,
}).strict();

export const apiClientNativeCollectionSchema = z.object({
  schema: z.literal('https://orkestrai.app/schemas/api-client/v1'),
  version: z.literal(1),
  name: z.string().trim().min(1).max(500),
  exportedAt: z.string().max(100).optional(),
  payload: apiClientNativePayloadSchema,
}).strict();

export const executeApiClientRequestSchema = z.object({
  nodeId: z.string().trim().min(1),
  request: apiClientRequestSchema,
  variables: z.record(z.string(), z.string().max(100_000)).default({}),
  collectionVariables: z.record(z.string(), z.unknown()).optional(),
  environmentVariables: z.record(z.string(), z.unknown()).optional(),
  globalVariables: z.record(z.string(), z.unknown()).optional(),
  runtimeVariables: z.record(z.string(), z.unknown()).optional(),
  iterationData: z.record(z.string(), z.unknown()).optional(),
  iterationIndex: z.coerce.number().int().min(0).max(100_000).optional(),
  iterationCount: z.coerce.number().int().min(1).max(1_000).optional(),
  scriptDialect: apiClientScriptDialectSchema.optional(),
  timeoutMs: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
  collectionPreRequestScript: z.string().max(100_000).optional(),
  collectionPostResponseScript: z.string().max(100_000).optional(),
});

export const importApiClientCollectionSchema = z.object({
  nodeId: z.string().trim().min(1),
  kind: z.enum(['bruno', 'postman', 'native', 'openapi', 'openCollection', 'postmanEnvironment']),
  path: z.string().trim().min(1).max(8_000),
});

export const exportApiClientCollectionSchema = z.object({
  nodeId: z.string().trim().min(1),
  kind: z.enum(['bruno', 'openCollection']),
  path: z.string().trim().min(1).max(8_000),
});

export const executeSavedApiClientRequestSchema = z.object({
  requestId: z.string().trim().min(1).max(200),
  variables: z.record(z.string(), z.string().max(100_000)).default({}),
  from: z.string().trim().min(1).max(200).nullish(),
});

export const agentApiClientRequestSchema = persistedApiClientRequestSchema.omit({
  sourcePath: true,
  sourceData: true,
});

export const agentApiClientFolderSchema = apiClientFolderSchema.omit({ sourceData: true });

export const agentApiClientCollectionSchema = z.object({
  requests: z.array(agentApiClientRequestSchema).max(500).default([]),
  folders: z.array(agentApiClientFolderSchema).max(500).default([]),
  runners: z.array(apiClientRunnerSchema).max(100).default([]),
  selectedRunnerId: z.string().max(200).nullable().default(null),
  selectedRequestId: z.string().max(200).nullable().default(null),
  variables: z.record(z.string(), z.string().max(100_000)).default({}),
  environments: z.record(z.string(), z.record(z.string(), z.string().max(100_000))).default({}),
  globalVariables: z.record(z.string(), z.string().max(100_000)).default({}),
  runtimeVariables: z.record(z.string(), z.string().max(100_000)).default({}),
  scriptDialect: apiClientScriptDialectSchema.default('orkestrai'),
  activeEnvironment: z.string().max(500).nullable().default(null),
  collectionPreRequestScript: z.string().max(100_000).default(''),
  collectionPostResponseScript: z.string().max(100_000).default(''),
}).strict();

export const createAgentApiClientSchema = z.object({
  title: z.string().trim().min(1).max(500),
  collection: agentApiClientCollectionSchema,
  from: z.string().trim().min(1).max(200),
}).strict();

export const replaceAgentApiClientSchema = z.object({
  nodeId: z.string().trim().min(1).max(200).optional(),
  title: z.string().trim().min(1).max(500).optional(),
  baseFingerprint: z.string().trim().length(64),
  collection: agentApiClientCollectionSchema,
  syncToSource: z.boolean().default(true),
  from: z.string().trim().min(1).max(200),
}).strict();

export const importAgentApiClientSchema = z.object({
  path: z.string().trim().min(1).max(4_000),
  kind: z.enum(['auto', 'bruno', 'postman', 'openCollection']).default('auto'),
  nodeId: z.string().trim().min(1).max(200).optional(),
  title: z.string().trim().min(1).max(500).optional(),
  syncMode: z.enum(['manual', 'watch']).default('watch'),
  from: z.string().trim().min(1).max(200),
}).strict();

export const syncAgentApiClientSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('status'), nodeId: z.string().trim().min(1).max(200).optional(), from: z.string().trim().min(1).max(200) }).strict(),
  z.object({ action: z.literal('pull'), nodeId: z.string().trim().min(1).max(200).optional(), resolution: z.enum(['filesystem']).optional(), from: z.string().trim().min(1).max(200) }).strict(),
  z.object({ action: z.literal('push'), nodeId: z.string().trim().min(1).max(200).optional(), resolution: z.enum(['orkestrai']).optional(), from: z.string().trim().min(1).max(200) }).strict(),
]);

export const exportAgentApiClientSchema = z.object({
  nodeId: z.string().trim().min(1).max(200).optional(),
  kind: z.enum(['bruno', 'postman']),
  path: z.string().trim().min(1).max(4_000).default('.orkestrai/exports'),
  from: z.string().trim().min(1).max(200),
}).strict();

export const executeAgentApiClientRunnerSchema = z.object({
  nodeId: z.string().trim().min(1).max(200).optional(),
  runnerId: z.string().trim().min(1).max(200).optional(),
  variables: z.record(z.string(), z.string().max(100_000)).default({}),
  maxExecutions: z.coerce.number().int().min(1).max(500).default(100),
  from: z.string().trim().min(1).max(200),
}).strict();

export const apiClientOAuthSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('authorize'),
    nodeId: z.string().trim().min(1),
    request: apiClientRequestSchema,
    variables: z.record(z.string(), z.string().max(100_000)).default({}),
    locale: z.enum(['pt-BR', 'en', 'es']).default('en'),
  }).strict(),
  z.object({
    action: z.literal('poll'),
    nodeId: z.string().trim().min(1),
    state: z.string().trim().min(20).max(500),
  }).strict(),
]);

export const apiClientSyncRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('status'), nodeId: z.string().trim().min(1) }).strict(),
  z.object({ action: z.literal('pull'), nodeId: z.string().trim().min(1) }).strict(),
  z.object({ action: z.literal('push'), nodeId: z.string().trim().min(1), payload: apiClientNativePayloadSchema, resolution: z.enum(['orkestrai', 'filesystem']).optional() }).strict(),
]);

export type ApiClientRequestInput = z.infer<typeof apiClientRequestSchema>;
export type ExecuteApiClientRequestInput = z.infer<typeof executeApiClientRequestSchema>;
export type ImportApiClientCollectionInput = z.infer<typeof importApiClientCollectionSchema>;
export type ExportApiClientCollectionInput = z.infer<typeof exportApiClientCollectionSchema>;
export type ExecuteSavedApiClientRequestInput = z.infer<typeof executeSavedApiClientRequestSchema>;
export type AgentApiClientCollectionInput = z.infer<typeof agentApiClientCollectionSchema>;
export type CreateAgentApiClientInput = z.infer<typeof createAgentApiClientSchema>;
export type ReplaceAgentApiClientInput = z.infer<typeof replaceAgentApiClientSchema>;
export type ImportAgentApiClientInput = z.infer<typeof importAgentApiClientSchema>;
export type SyncAgentApiClientInput = z.infer<typeof syncAgentApiClientSchema>;
export type ExportAgentApiClientInput = z.infer<typeof exportAgentApiClientSchema>;
export type ExecuteAgentApiClientRunnerInput = z.infer<typeof executeAgentApiClientRunnerSchema>;
export type ApiClientOAuthInput = z.infer<typeof apiClientOAuthSchema>;
export type ApiClientSyncRequestInput = z.infer<typeof apiClientSyncRequestSchema>;
