import { z } from 'zod';

export const bridgeFigmaSelectionSchema = z.object({
  baseRevision: z.number().int().min(0),
  fileKey: z.string().trim().regex(/^[A-Za-z0-9_-]{6,240}$/),
  fileName: z.string().trim().min(1).max(240),
  sourceNodes: z.array(z.record(z.string(), z.unknown())).min(1).max(100),
  imageAssets: z.record(z.string().trim().min(1).max(500), z.object({
    mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
    base64: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).max(28 * 1024 * 1024),
  })).default({}),
  targetPageId: z.string().uuid(),
  summary: z.string().trim().min(1).max(500).default('Import Figma plugin selection'),
});
import { applyDesignOperationsSchema } from './designSchemas.js';

export const bridgeDesignApplySchema = applyDesignOperationsSchema.omit({ actor: true }).extend({
  token: z.string().trim().min(1).nullish(),
  from: z.string().trim().max(120).nullish(),
  taskId: z.string().uuid().nullish(),
});

export type BridgeDesignApplyInput = z.infer<typeof bridgeDesignApplySchema>;

export const bridgeAskSchema = z.object({
  token: z.string().trim().min(1).nullish(),
  to: z.string().trim().min(1, 'Informe o agente de destino (titulo ou id do no).'),
  message: z.string().min(1, 'Informe a mensagem.'),
  from: z.string().trim().nullish(),
  /** Vincula a mensagem a uma tarefa para cancelar handoffs obsoletos antes do envio. */
  taskId: z.string().uuid().nullish(),
  /** Espera máxima pela resposta; agentes ocupados liberam o chamador antes e a resposta chega à caixa de entrada. */
  timeoutMs: z.coerce.number().int().min(1_000).max(600_000).optional(),
  /** Envia bytes brutos ao TUI (sem espera de resposta, sem CR extra). */
  raw: z.boolean().default(false),
});

export const bridgeReplySchema = z.object({
  token: z.string().trim().min(1).nullish(),
  /** Quem responde: deve ser o destinatário da mensagem original. */
  from: z.string().trim().min(1, 'Informe quem responde (--from ou ORKESTRAI_NODE_ID).'),
  message: z.string().trim().min(1, 'Informe a resposta.').max(20_000),
});

export const bridgeHeavyAcquireSchema = z.object({
  /** What will run, shown to the team while it holds or waits for a slot. */
  label: z.string().trim().min(1).max(120),
  taskId: z.string().uuid().nullish(),
  /** Keeps the caller's place in the queue across long polls. */
  ticket: z.string().uuid().nullish(),
  waitMs: z.coerce.number().int().min(0).max(25_000).default(20_000),
});

export const bridgeInboxQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export const bridgeNoteWriteSchema = z.object({
  token: z.string().trim().min(1).nullish(),
  content: z.string(),
});

export const bridgeNoteEditSchema = z.object({
  token: z.string().trim().min(1).nullish(),
  old: z.string().min(1, 'Informe o trecho antigo.'),
  new: z.string(),
});

export const bridgeNoteCreateSchema = z.object({
  token: z.string().trim().min(1).nullish(),
  title: z.string().trim().min(1, 'Informe o titulo da nota.'),
  content: z.string().optional(),
  /** Identidade do agente autor; usada como conexão padrão quando presente. */
  from: z.string().trim().max(120).nullish(),
  /** Agente (titulo ou id) para conectar a nota criada. */
  connect: z.string().trim().nullish(),
});

export type BridgeNoteCreateInput = z.infer<typeof bridgeNoteCreateSchema>;

export const bridgeNotifySchema = z.object({
  token: z.string().trim().min(1).nullish(),
  message: z.string().trim().min(1, 'Informe a mensagem da notificacao.'),
  kind: z.enum(['info', 'attention', 'project', 'task']).default('info'),
  title: z.string().trim().nullish(),
  from: z.string().trim().nullish(),
});

export const bridgeActivitySchema = z.object({
  token: z.string().trim().min(1).nullish(),
  from: z.string().trim().min(1, 'Informe o agente que está reportando o estado.').max(120).nullish(),
  state: z.enum(['starting', 'working', 'waiting_input', 'waiting_permission', 'blocked', 'idle', 'done', 'error', 'disconnected']),
  action: z.string().trim().max(240).nullish(),
  taskId: z.string().uuid().nullish(),
}).superRefine((input, context) => {
  if (!input.from && !input.taskId) {
    context.addIssue({
      code: 'custom',
      path: ['from'],
      message: 'Informe o agente ou uma tarefa atribuída para identificar quem reporta o estado.',
    });
  }
});

export type BridgeAskInput = z.infer<typeof bridgeAskSchema>;
export type BridgeReplyInput = z.infer<typeof bridgeReplySchema>;
export type BridgeNoteWriteInput = z.infer<typeof bridgeNoteWriteSchema>;
export type BridgeNoteEditInput = z.infer<typeof bridgeNoteEditSchema>;
export type BridgeNotifyInput = z.infer<typeof bridgeNotifySchema>;
export type BridgeActivityInput = z.infer<typeof bridgeActivitySchema>;

export const bridgeRecruitSchema = z.object({
  token: z.string().trim().min(1).nullish(),
  from: z.string().trim().min(1, 'Informe o agente maestro (from).'),
  title: z.string().trim().min(1, 'Informe o titulo do recruta.'),
  provider: z.string().trim().nullish(),
  profile: z.string().trim().nullish(),
  model: z.string().trim().nullish(),
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']).nullish(),
  role: z.string().trim().nullish(),
  x: z.coerce.number().optional(),
  y: z.coerce.number().optional(),
  replace: z.string().trim().nullish(),
  floorId: z.string().trim().nullish(),
}).superRefine((input, ctx) => {
  if (input.profile && !input.provider) {
    ctx.addIssue({
      code: 'custom',
      path: ['provider'],
      message: 'Informe --provider junto com --profile.',
    });
  }
});

export const bridgeReassignSchema = z.object({
  token: z.string().trim().min(1).nullish(),
  from: z.string().trim().min(1),
  target: z.string().trim().min(1),
  role: z.string().trim().min(1, 'Informe o papel.'),
  prompt: z.string().nullish(),
});

export type BridgeReassignInput = z.infer<typeof bridgeReassignSchema>;

export const bridgeDismissSchema = z.object({
  token: z.string().trim().min(1).nullish(),
  from: z.string().trim().min(1),
  target: z.string().trim().min(1),
});

export const bridgeConnectSchema = z.object({
  token: z.string().trim().min(1).nullish(),
  from: z.string().trim().min(1),
  source: z.string().trim().nullish(),
  to: z.string().trim().min(1),
});

export type BridgeRecruitInput = z.infer<typeof bridgeRecruitSchema>;
export type BridgeDismissInput = z.infer<typeof bridgeDismissSchema>;
export type BridgeConnectInput = z.infer<typeof bridgeConnectSchema>;

export const bridgeRoleWriteSchema = z.object({
  token: z.string().trim().min(1).nullish(),
  name: z.string().trim().min(1, 'Informe o nome da responsabilidade.'),
  prompt: z.string(),
  color: z.string().trim().optional(),
});

export const bridgeRoleEditSchema = z.object({
  token: z.string().trim().min(1).nullish(),
  name: z.string().trim().min(1),
  old: z.string().min(1, 'Informe o trecho antigo.'),
  new: z.string(),
});

export type BridgeRoleWriteInput = z.infer<typeof bridgeRoleWriteSchema>;
export type BridgeRoleEditInput = z.infer<typeof bridgeRoleEditSchema>;

export const bridgeFloorCreateSchema = z.object({
  token: z.string().trim().min(1).nullish(),
  name: z.string().trim().min(1, 'Informe o nome do andar.'),
  branch: z.string().trim().nullish(),
  existingBranch: z.boolean().default(false),
  cloneLayout: z.boolean().default(false),
});

export const bridgeFloorLandSchema = z.object({
  token: z.string().trim().min(1).nullish(),
  targetBranch: z.string().trim().nullish(),
  /** Subject of the landing commit; defaults to a conventional floor subject. */
  message: z.string().trim().max(200).nullish(),
  /** Commit the floor agent's uncommitted work before landing (default). */
  commitPending: z.boolean().default(true),
});

export type BridgeFloorCreateInput = z.infer<typeof bridgeFloorCreateSchema>;
export type BridgeFloorLandInput = z.infer<typeof bridgeFloorLandSchema>;
