import { z } from 'zod';
import type { AutonomyRisk } from '../../contracts/schemas/autonomy-policy.schema.js';
import type { IntegrationType } from '../../contracts/schemas/integration.schema.js';

const shortText = z.string().trim().min(1).max(4_000);
const identifier = z.string().trim().min(1).max(180).regex(/^[a-zA-Z0-9._:@/+\-]+$/);
const emailAddress = z.string().email().max(320).refine((value) => !/[\r\n]/.test(value));
const recipients = z.array(emailAddress).min(1).max(50);
const attachment = z.object({
  path: z.string().trim().min(1).max(2_000).refine((value) => !value.startsWith('/') && !value.startsWith('\\') && !/(^|[\\/])\.\.([\\/]|$)/.test(value)),
  filename: z.string().trim().min(1).max(255).refine((value) => !/[\\/\r\n]/.test(value)),
  mimeType: z.string().trim().min(1).max(120).regex(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i),
}).strict();

export type IntegrationActionManifest = {
  id: string;
  mutation: boolean;
  risk?: AutonomyRisk;
  inputSchema: z.ZodTypeAny;
};

export type IntegrationManifest = {
  id: IntegrationType;
  version: string;
  auth: 'legacy_token' | 'oauth_pkce' | 'token' | 'optional_token';
  secretSlots: number;
  hosts: string[];
  actions: IntegrationActionManifest[];
};

const mailBody = {
  to: recipients,
  cc: z.array(emailAddress).max(50).default([]),
  bcc: z.array(emailAddress).max(50).default([]),
  subject: z.string().trim().min(1).max(998).refine((value) => !/[\r\n]/.test(value)),
  text: z.string().max(2_000_000).default(''),
  html: z.string().max(2_000_000).optional(),
  threadId: identifier.optional(),
  inReplyTo: z.string().trim().max(998).refine((value) => !/[\r\n]/.test(value)).optional(),
  attachments: z.array(attachment).max(10).default([]),
};

export const integrationCatalog: Record<IntegrationType, IntegrationManifest> = {
  github: {
    id: 'github', version: '1.0.0', auth: 'legacy_token', secretSlots: 1,
    hosts: ['api.github.com'],
    actions: [
      { id: 'github.read_latest_pull_request', mutation: false, inputSchema: z.object({}).strict() },
    ],
  },
  gmail: {
    id: 'gmail', version: '1.0.0', auth: 'oauth_pkce', secretSlots: 1,
    hosts: ['gmail.googleapis.com', 'oauth2.googleapis.com'],
    actions: [
      { id: 'gmail.list_messages', mutation: false, inputSchema: z.object({ query: z.string().max(2_000).default(''), maxResults: z.number().int().min(1).max(100).default(25), pageToken: identifier.optional() }).strict() },
      { id: 'gmail.read_message', mutation: false, inputSchema: z.object({ messageId: identifier, format: z.enum(['metadata', 'full']).default('full') }).strict() },
      { id: 'gmail.send_email', mutation: true, risk: 'external_publication', inputSchema: z.object(mailBody).strict() },
      { id: 'gmail.create_draft', mutation: true, inputSchema: z.object(mailBody).strict() },
      { id: 'gmail.modify_labels', mutation: true, inputSchema: z.object({ messageId: identifier, addLabelIds: z.array(identifier).max(50).default([]), removeLabelIds: z.array(identifier).max(50).default([]) }).strict() },
    ],
  },
  slack: {
    id: 'slack', version: '1.0.0', auth: 'token', secretSlots: 1,
    hosts: ['slack.com'],
    actions: [
      { id: 'slack.send_message', mutation: true, risk: 'external_publication', inputSchema: z.object({ channel: identifier.optional(), text: shortText, threadTs: identifier.optional() }).strict() },
      { id: 'slack.list_channels', mutation: false, inputSchema: z.object({ limit: z.number().int().min(1).max(200).default(100), cursor: identifier.optional() }).strict() },
      { id: 'slack.read_messages', mutation: false, inputSchema: z.object({ channel: identifier, limit: z.number().int().min(1).max(100).default(25), cursor: identifier.optional() }).strict() },
    ],
  },
  telegram: {
    id: 'telegram', version: '1.0.0', auth: 'token', secretSlots: 1,
    hosts: ['api.telegram.org'],
    actions: [
      { id: 'telegram.send_message', mutation: true, risk: 'external_publication', inputSchema: z.object({ chatId: identifier.optional(), text: shortText, disableNotification: z.boolean().default(false) }).strict() },
      { id: 'telegram.send_document', mutation: true, risk: 'external_publication', inputSchema: z.object({ chatId: identifier.optional(), path: attachment.shape.path, filename: attachment.shape.filename, caption: z.string().max(1_024).default('') }).strict() },
      { id: 'telegram.read_updates', mutation: false, inputSchema: z.object({ offset: z.number().int().min(0).optional(), timeout: z.number().int().min(0).max(25).default(0), limit: z.number().int().min(1).max(100).default(25) }).strict() },
    ],
  },
  whatsapp: {
    id: 'whatsapp', version: '1.0.0', auth: 'token', secretSlots: 1,
    hosts: ['graph.facebook.com'],
    actions: [
      { id: 'whatsapp.send_message', mutation: true, risk: 'external_publication', inputSchema: z.object({ to: z.string().regex(/^\+?\d{7,20}$/).optional(), text: shortText, previewUrl: z.boolean().default(false) }).strict() },
      { id: 'whatsapp.send_document', mutation: true, risk: 'external_publication', inputSchema: z.object({ to: z.string().regex(/^\+?\d{7,20}$/).optional(), link: z.string().url().max(4_096).refine((value) => new URL(value).protocol === 'https:'), filename: attachment.shape.filename, caption: z.string().max(1_024).default('') }).strict() },
    ],
  },
  webhook: {
    id: 'webhook', version: '1.0.0', auth: 'optional_token', secretSlots: 1,
    hosts: [],
    actions: [
      { id: 'webhook.send', mutation: true, risk: 'external_publication', inputSchema: z.object({ payload: z.unknown() }).strict() },
    ],
  },
};

export function integrationManifest(type: IntegrationType): IntegrationManifest {
  return integrationCatalog[type];
}

export function publicIntegrationCatalog() {
  return Object.values(integrationCatalog).map((manifest) => ({
    id: manifest.id,
    version: manifest.version,
    auth: manifest.auth,
    secretSlots: manifest.secretSlots,
    hosts: manifest.hosts,
    actions: manifest.actions.map(({ id, mutation, risk }) => ({ id, mutation, risk: risk ?? null })),
  }));
}
