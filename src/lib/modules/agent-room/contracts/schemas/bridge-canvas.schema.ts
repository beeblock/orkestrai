import { z } from '@beeblock/svelar/validation';
import { normalizePortalHost } from '../../domain/portal-hosts.js';

export const canvasLayoutChangesSchema = z.object({
  x: z.number().finite().min(-1_000_000).max(1_000_000).optional(),
  y: z.number().finite().min(-1_000_000).max(1_000_000).optional(),
  width: z.number().finite().min(40).max(10_000).optional(),
  height: z.number().finite().min(40).max(10_000).optional(),
  zIndex: z.number().int().min(-10_000).max(10_000).optional(),
}).strict().refine(value => Object.keys(value).length > 0, 'At least one layout change is required.');

export const bridgeCanvasCommandSchema = z.object({
  from: z.string().trim().min(1).max(120),
  taskId: z.string().uuid(),
  input: z.discriminatedUnion('command', [
    z.object({ command: z.literal('layout'), updates: z.array(z.object({
      nodeId: z.string().uuid(), revision: z.string().regex(/^[a-f0-9]{64}$/), changes: canvasLayoutChangesSchema,
    }).strict()).min(1).max(50) }).strict(),
    z.object({ command: z.literal('archive_note'), nodeId: z.string().uuid() }).strict(),
    z.object({ command: z.literal('restore_note'), nodeId: z.string().uuid() }).strict(),
    z.object({ command: z.literal('configure_portal_hosts'), nodeId: z.string().uuid(), revision: z.string().regex(/^[a-f0-9]{64}$/),
      allowedHosts: z.array(z.string().trim().min(1).max(253)
        .refine(value => normalizePortalHost(value) !== null, 'Use exact hostnames, not URLs, ports or wildcards.')
        .transform(value => normalizePortalHost(value)!)).min(1).max(64)
        .transform(values => [...new Set(values)]),
    }).strict(),
    z.object({ command: z.literal('update_shell'), nodeId: z.string().uuid(), revision: z.string().regex(/^[a-f0-9]{64}$/),
      changes: z.object({ title: z.string().trim().min(1).max(120).optional(),
        cwd: z.string().trim().min(1).max(4_000).optional(), startupCommand: z.string().trim().max(4_000).optional(),
      }).strict().refine(value => Object.keys(value).length > 0, 'At least one Shell change is required.'),
    }).strict(),
    z.object({ command: z.literal('restart_shell'), nodeId: z.string().uuid(), revision: z.string().regex(/^[a-f0-9]{64}$/),
      expectedSessionId: z.string().min(1).max(120).nullable(),
    }).strict(),
    z.object({ command: z.literal('create_shell'), nodeId: z.string().uuid(), title: z.string().trim().min(1).max(120),
      cwd: z.string().trim().min(1).max(4_000).default('.'),
      startupCommand: z.string().trim().max(4_000).default(''),
      start: z.boolean().default(true),
      x: z.number().finite().min(-1_000_000).max(1_000_000).optional(),
      y: z.number().finite().min(-1_000_000).max(1_000_000).optional(),
    }).strict(),
  ]),
}).strict();

export const bridgeCanvasListSchema = z.object({
  includeArchived: z.enum(['true', 'false']).default('false').transform(value => value === 'true'),
  afterId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type BridgeCanvasCommandInput = z.infer<typeof bridgeCanvasCommandSchema>;
