import { z } from 'zod/v3';

export const councilModeSchema = z.enum(['advisory', 'implementation']);
export const councilCriterionSchema = z.enum(['balanced', 'quality', 'speed', 'risk', 'cost', 'custom']);
export const councilStatusSchema = z.enum([
  'running', 'ready', 'partial', 'failed', 'selected', 'consensus_requested', 'rejected',
]);
export const councilPerspectiveStatusSchema = z.enum(['pending', 'running', 'completed', 'failed']);

const boundedList = z.array(z.string().trim().min(1).max(1_000)).max(8);

export const councilPerspectiveOutputSchema = z.object({
  proposal: z.string().trim().min(1).max(12_000),
  evidence: boundedList,
  risks: boundedList,
  tests: boundedList,
  divergences: boundedList,
  recommendation: z.string().trim().min(1).max(4_000),
  confidence: z.number().int().min(0).max(100),
}).strict();

export const councilLeaderRecommendationSchema = z.object({
  perspectiveId: z.string().uuid().nullable(),
  recommendation: z.string().trim().min(1).max(8_000),
  rationale: boundedList,
  divergences: boundedList,
  consensus: z.enum(['strong', 'partial', 'none']),
}).strict();

export const createCouncilSchema = z.object({
  title: z.string().trim().min(1).max(180),
  objective: z.string().trim().min(10).max(12_000),
  taskId: z.string().uuid().nullable().optional(),
  leaderNodeId: z.string().uuid().nullable().optional(),
  mode: councilModeSchema.default('advisory'),
  criterion: councilCriterionSchema.default('balanced'),
  customCriterion: z.string().trim().min(3).max(1_000).nullable().optional(),
  requestLeaderRecommendation: z.boolean().default(true),
  maxExecutions: z.number().int().min(2).max(6),
  perspectives: z.array(z.object({
    agentNodeId: z.string().uuid(),
    approach: z.string().trim().max(1_000).default(''),
  }).strict()).min(2).max(5),
}).strict().superRefine((value, context) => {
  const uniqueAgents = new Set(value.perspectives.map((item) => item.agentNodeId));
  if (uniqueAgents.size !== value.perspectives.length) {
    context.addIssue({ code: 'custom', path: ['perspectives'], message: 'Each agent can contribute only one perspective.' });
  }
  if (value.criterion === 'custom' && !value.customCriterion?.trim()) {
    context.addIssue({ code: 'custom', path: ['customCriterion'], message: 'Describe the custom decision criterion.' });
  }
  const requiredExecutions = value.perspectives.length + (value.requestLeaderRecommendation ? 1 : 0);
  if (value.maxExecutions < requiredExecutions) {
    context.addIssue({ code: 'custom', path: ['maxExecutions'], message: `This council requires ${requiredExecutions} executions.` });
  }
});

export const decideCouncilSchema = z.object({
  status: z.enum(['selected', 'consensus_requested', 'rejected']),
  selectedPerspectiveId: z.string().uuid().nullable().optional(),
  note: z.string().trim().max(4_000).nullable().optional(),
}).strict().superRefine((value, context) => {
  if (value.status === 'selected' && !value.selectedPerspectiveId) {
    context.addIssue({ code: 'custom', path: ['selectedPerspectiveId'], message: 'Select a perspective.' });
  }
});

export const landCouncilPerspectiveSchema = z.object({
  confirm: z.literal(true),
  targetBranch: z.string().trim().min(1).max(240).optional(),
}).strict();

export type CouncilMode = z.infer<typeof councilModeSchema>;
export type CouncilCriterion = z.infer<typeof councilCriterionSchema>;
export type CouncilStatus = z.infer<typeof councilStatusSchema>;
export type CouncilPerspectiveStatus = z.infer<typeof councilPerspectiveStatusSchema>;
export type CouncilPerspectiveOutput = z.infer<typeof councilPerspectiveOutputSchema>;
export type CouncilLeaderRecommendation = z.infer<typeof councilLeaderRecommendationSchema>;
export type CreateCouncilInput = z.infer<typeof createCouncilSchema>;
export type DecideCouncilInput = z.infer<typeof decideCouncilSchema>;
export type LandCouncilPerspectiveInput = z.infer<typeof landCouncilPerspectiveSchema>;

export type CouncilPerspectiveData = {
  id: string;
  councilId: string;
  agentNodeId: string;
  agentTitle: string;
  provider: string;
  model: string | null;
  approach: string;
  status: CouncilPerspectiveStatus;
  floorId: string | null;
  floorName: string | null;
  artifactPath: string | null;
  output: CouncilPerspectiveOutput | null;
  usageSnapshot: Record<string, unknown> | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
};

export type CouncilData = {
  id: string;
  workspaceId: string;
  taskId: string | null;
  taskTitle: string | null;
  leaderNodeId: string | null;
  leaderTitle: string | null;
  title: string;
  objective: string;
  mode: CouncilMode;
  criterion: CouncilCriterion;
  customCriterion: string | null;
  requestLeaderRecommendation: boolean;
  maxExecutions: number;
  executionCount: number;
  status: CouncilStatus;
  recommendation: CouncilLeaderRecommendation | null;
  recommendationError: string | null;
  selectedPerspectiveId: string | null;
  decisionNote: string | null;
  perspectives: CouncilPerspectiveData[];
  startedAt: string;
  completedAt: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
