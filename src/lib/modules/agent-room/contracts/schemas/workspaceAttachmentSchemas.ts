import { z } from 'zod/v3';

export const MAX_WORKSPACE_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_WORKSPACE_ATTACHMENTS = 12;

const attachmentBase = {
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(180),
};

const httpUrlSchema = z.string().trim().url().max(2_048).refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === 'http:' || protocol === 'https:';
}, 'Only HTTP and HTTPS links are supported.');

export const workspaceAttachmentSchema = z.discriminatedUnion('kind', [
  z.object({
    ...attachmentBase,
    kind: z.literal('file'),
    path: z.string().trim().regex(
      /^\.orkestrai\/attachments\/[A-Za-z0-9._-]+$/,
      'Attachment paths must point to the workspace attachment directory.',
    ).max(512),
    url: z.null(),
    mimeType: z.string().trim().max(180).nullable(),
    size: z.number().int().min(1).max(MAX_WORKSPACE_ATTACHMENT_BYTES),
  }).strict(),
  z.object({
    ...attachmentBase,
    kind: z.literal('link'),
    path: z.null(),
    url: httpUrlSchema,
    mimeType: z.null(),
    size: z.null(),
  }).strict(),
]);

export const workspaceAttachmentUploadSchema = z.object({
  file: z.custom<File>((value) => {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as File;
    return typeof candidate.name === 'string'
      && typeof candidate.size === 'number'
      && typeof candidate.arrayBuffer === 'function';
  }, 'Select a file.'),
});

export const workspaceAttachmentLinkSchema = z.object({
  url: httpUrlSchema,
});

export const workspaceAttachmentDeleteSchema = z.object({
  attachment: workspaceAttachmentSchema,
});

export type WorkspaceAttachmentInput = z.infer<typeof workspaceAttachmentSchema>;
