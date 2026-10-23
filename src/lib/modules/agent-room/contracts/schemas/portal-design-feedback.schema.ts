import { z } from 'zod/v3';
import { workspaceAttachmentSchema } from './workspaceAttachmentSchemas.js';

export const PORTAL_DESIGN_LIMITS = {
  selector: 512,
  html: 8_000,
  text: 2_000,
  instruction: 4_000,
} as const;

const boundedText = (limit: number) => z.string().trim().max(limit);
const pixel = z.number().finite().min(0).max(65_536);

export const portalElementRectSchema = z.object({
  x: pixel,
  y: pixel,
  width: pixel,
  height: pixel,
}).strict();

export const portalViewportSchema = z.object({
  width: z.number().finite().int().min(1).max(65_536),
  height: z.number().finite().int().min(1).max(65_536),
  deviceScaleFactor: z.number().finite().min(0.25).max(8),
}).strict();

export const portalComputedStylesSchema = z.object({
  display: boundedText(120),
  position: boundedText(120),
  color: boundedText(300),
  backgroundColor: boundedText(300),
  fontFamily: boundedText(300),
  fontSize: boundedText(120),
  fontWeight: boundedText(120),
  lineHeight: boundedText(120),
  textAlign: boundedText(120),
  border: boundedText(300),
  borderRadius: boundedText(120),
  padding: boundedText(180),
  margin: boundedText(180),
  width: boundedText(120),
  height: boundedText(120),
}).strict();

export const portalDesignCaptureSchema = z.object({
  selector: z.string().trim().min(1).max(PORTAL_DESIGN_LIMITS.selector),
  tagName: z.string().trim().regex(/^[a-z][a-z0-9-]*$/).max(80),
  html: z.string().trim().max(PORTAL_DESIGN_LIMITS.html),
  text: z.string().trim().max(PORTAL_DESIGN_LIMITS.text),
  role: boundedText(120).nullable(),
  ariaLabel: boundedText(300).nullable(),
  rect: portalElementRectSchema,
  viewport: portalViewportSchema,
  page: z.object({
    origin: z.string().url().max(512),
    path: z.string().startsWith('/').max(1_024).refine((value) => !/[?#]/.test(value), 'Page path cannot contain query parameters or fragments.'),
    title: boundedText(240),
  }).strict(),
  styles: portalComputedStylesSchema,
}).strict();

export const portalDesignContextSchema = portalDesignCaptureSchema.omit({ html: true });

const portalScreenshotSchema = workspaceAttachmentSchema.refine(
  (attachment) => attachment.kind === 'file'
    && attachment.mimeType === 'image/png'
    && Boolean(attachment.path?.toLowerCase().endsWith('.png')),
  'The portal screenshot must be a workspace PNG attachment.',
);

export const portalDesignDestinationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('agent'), nodeId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal('triage') }).strict(),
  z.object({ kind: z.literal('task'), taskId: z.string().uuid() }).strict(),
]);

export const sendPortalDesignFeedbackSchema = z.object({
  capture: portalDesignContextSchema,
  screenshot: portalScreenshotSchema,
  instruction: z.string().trim().min(1).max(PORTAL_DESIGN_LIMITS.instruction),
  destination: portalDesignDestinationSchema,
}).strict();

export const portalDesignFeedbackResultSchema = z.object({
  destinationKind: z.enum(['agent', 'triage', 'task']),
  destinationId: z.string().uuid(),
  destinationTitle: z.string(),
  taskId: z.string().uuid(),
  persisted: z.boolean(),
  delivery: z.object({
    delivered: z.boolean(),
    messageId: z.string().uuid().nullable(),
    error: z.string().nullable(),
  }).nullable(),
});

export type PortalDesignCapture = z.infer<typeof portalDesignCaptureSchema>;
export type PortalDesignContext = z.infer<typeof portalDesignContextSchema>;
export type PortalDesignDestination = z.infer<typeof portalDesignDestinationSchema>;
export type SendPortalDesignFeedbackInput = z.infer<typeof sendPortalDesignFeedbackSchema>;
export type PortalDesignFeedbackResult = z.infer<typeof portalDesignFeedbackResultSchema>;
