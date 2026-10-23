import { z } from 'zod/v3';

export const agentLoopSchema = z.object({
  message: z.string().trim().min(1, 'Informe um objetivo ou comando para o loop.'),
  mode: z.enum(['chat', 'plan', 'debate', 'implement', 'review']).default('implement'),
  allowWrites: z.boolean().default(false),
  projectPath: z.string().trim().nullable().optional(),
  maxRounds: z.coerce.number().int().min(1).max(12).optional(),
  executionMode: z.enum(['sequential', 'parallel']).default('sequential'),
});

export type AgentLoopInput = z.infer<typeof agentLoopSchema>;

/** Query do spec de comando interativo de um agente (dialogo de criacao). */
export const agentSpecSchema = z.object({
  provider: z.string().trim().min(1),
  model: z.string().trim().nullish(),
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']).nullish(),
});

export type AgentSpecInput = z.infer<typeof agentSpecSchema>;

/** Form do dialogo de criacao de terminal/agente no canvas. */
export const createAgentNodeSchema = z.object({
  title: z.string().trim().min(1, 'Informe o nome do agente.'),
  model: z.string().trim().nullish(),
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']).nullish(),
  profileId: z.string().uuid().nullish(),
  /** Lider da equipe = Modo Maestro (recruta/demite agentes sob demanda). */
  leader: z.boolean().default(false),
});

export type CreateAgentNodeInput = z.infer<typeof createAgentNodeSchema>;
