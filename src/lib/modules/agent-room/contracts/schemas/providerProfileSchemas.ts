import { z } from 'zod/v3';

const profilePathSchema = z.string().trim().max(4_096).refine(
  (value) => !/[\u0000\r\n]/.test(value),
  'Profile paths cannot contain control characters.',
).nullish();

export const saveProviderProfileSchema = z.object({
  providerId: z.string().trim().min(1).max(64).regex(/^[a-z0-9_-]+$/i),
  name: z.string().trim().min(1).max(48),
  configDir: profilePathSchema,
  dataDir: profilePathSchema,
  token: z.string().trim().max(32_768).refine((value) => !value.includes('\u0000')).nullish(),
});

export type SaveProviderProfileInput = z.infer<typeof saveProviderProfileSchema>;
