import { z } from '@beeblock/svelar/validation';
const path = z.string().trim().min(1).max(1000);
export const assistantArtifactInputSchema = z.discriminatedUnion('command', [
  z.object({ command: z.literal('artifact_speech'), path, text: z.string().trim().min(1).max(2000), voice: z.string().max(80).optional(), speed: z.number().min(0.75).max(1.5).optional() }).strict(),
  z.object({ command: z.literal('artifact_report'), path, title: z.string().trim().min(1).max(200), sections: z.array(z.object({ heading: z.string().max(200), text: z.string().max(10000) }).strict()).min(1).max(30) }).strict(),
  z.object({ command: z.literal('artifact_inspect'), path, expectedHash: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict(),
  z.object({ command: z.literal('artifact_transcribe'), path, expectedHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
]);
export const assistantArtifactResultSchema = z.object({ kind: z.literal('artifact'), path: z.string(), contentType: z.string(), size: z.number().int().nonnegative(), sha256: z.string().regex(/^[a-f0-9]{64}$/), status: z.literal('prepared'), transcript: z.string().optional() });
export type AssistantArtifactInput = z.infer<typeof assistantArtifactInputSchema>;
export type AssistantArtifactResult = z.infer<typeof assistantArtifactResultSchema>;
