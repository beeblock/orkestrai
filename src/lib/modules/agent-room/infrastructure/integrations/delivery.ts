import { createHash } from 'node:crypto';

export type IntegrationReceipt = {
  state: 'accepted';
  evidence: 'provider_message_id' | 'http_response';
  messageIds: string[];
};

const RECEIPT_ACTIONS = new Set(['slack.send_message', 'telegram.send_message', 'telegram.send_document', 'whatsapp.send_message', 'whatsapp.send_document', 'gmail.send_email', 'gmail.create_draft', 'webhook.send']);

export function integrationDeliveryState(event: { direction: string; kind: string; status: string; requestDigest: unknown; receipt: IntegrationReceipt | null }) {
  if (event.direction !== 'outbound' || !RECEIPT_ACTIONS.has(event.kind)) return null;
  if (event.status === 'uncertain' || event.status === 'dispatching') return 'uncertain';
  if (event.status === 'running') return 'pending';
  if (event.status === 'failed' && typeof event.requestDigest === 'string' && /^[a-f0-9]{64}$/.test(event.requestDigest)) return 'not_submitted';
  if (event.status === 'succeeded' && event.receipt) return 'accepted';
  return 'unknown';
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Record<string, unknown>)[key])]));
  return value;
}

export function integrationRequestDigest(action: string, input: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(canonical({ action, input }))).digest('hex');
}

export function integrationReceiptId(value: unknown): string | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  return typeof value === 'string' && /^[a-zA-Z0-9._:@+/=-]{1,512}$/.test(value) ? value : null;
}

export function storedIntegrationReceipt(value: unknown): IntegrationReceipt | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const receipt = value as Record<string, unknown>;
  if (receipt.state !== 'accepted' || !['provider_message_id', 'http_response'].includes(String(receipt.evidence)) || !Array.isArray(receipt.messageIds) || receipt.messageIds.length > 20) return null;
  if (receipt.evidence === 'provider_message_id' && !receipt.messageIds.length) return null;
  if (receipt.evidence === 'http_response' && receipt.messageIds.length) return null;
  const ids = receipt.messageIds.map(integrationReceiptId);
  if (ids.some(id => id === null)) return null;
  return { state: 'accepted', evidence: receipt.evidence as IntegrationReceipt['evidence'], messageIds: ids as string[] };
}

// Provider acceptance is not proof of delivery to, or reading by, the recipient.
export function integrationReceipt(action: string, result: Record<string, unknown>): IntegrationReceipt | null {
  let ids: unknown[];
  if (action === 'slack.send_message') ids = [result.ts];
  else if (action === 'telegram.send_message' || action === 'telegram.send_document') ids = [result.messageId];
  else if (action === 'whatsapp.send_message' || action === 'whatsapp.send_document') ids = Array.isArray(result.messageIds) ? result.messageIds : [];
  else if (action === 'gmail.send_email' || action === 'gmail.create_draft') ids = [result.id];
  else if (action === 'webhook.send') {
    if (typeof result.status !== 'number' || result.status < 200 || result.status >= 300) throw new Error('Integration acceptance could not be confirmed. Do not resend automatically.');
    return { state: 'accepted', evidence: 'http_response', messageIds: [] };
  } else return null;
  const messageIds = ids.map(integrationReceiptId);
  if (!messageIds.length || messageIds.length > 20 || messageIds.some(id => id === null)) throw new Error('Integration acceptance could not be confirmed. Do not resend automatically.');
  return { state: 'accepted', evidence: 'provider_message_id', messageIds: messageIds as string[] };
}
