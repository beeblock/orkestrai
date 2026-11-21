import { z } from 'zod/v3';

/** Status readers do not need delivery history; full audit is an explicit read. */
export const controlCenterQuerySchema = z.object({
  communications: z.enum(['0', '1']).default('1'),
  projection: z.enum(['compact', 'full']).default('compact'),
});
