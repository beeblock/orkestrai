import { describe, expect, it } from 'vitest';
import { integrationDeliveryState, integrationReceipt, integrationReceiptId, integrationRequestDigest, storedIntegrationReceipt } from '$lib/modules/agent-room/infrastructure/integrations/delivery.js';

describe('Integration receipts', () => {
  it('distinguishes historical unknown sends from confirmed pre-dispatch failures', () => {
    const event = { direction: 'outbound', kind: 'slack.send_message', status: 'succeeded', requestDigest: null, receipt: null };
    expect(integrationDeliveryState(event)).toBe('unknown');
    expect(integrationDeliveryState({ ...event, status: 'failed' })).toBe('unknown');
    expect(integrationDeliveryState({ ...event, status: 'failed', requestDigest: 'a'.repeat(64) })).toBe('not_submitted');
    expect(integrationDeliveryState({ ...event, status: 'failed', requestDigest: 'invalid' })).toBe('unknown');
    expect(integrationDeliveryState({ ...event, status: 'succeeded', receipt: integrationReceipt('slack.send_message', { ts: '123.456' }) })).toBe('accepted');
  });
  it('does not display inbound events or successful reads as unconfirmed sends', () => {
    const event = { direction: 'outbound', kind: 'slack.send_message', status: 'succeeded', requestDigest: null, receipt: null };
    expect(integrationDeliveryState({ ...event, direction: 'inbound' })).toBeNull();
    expect(integrationDeliveryState({ ...event, kind: 'slack.read_messages' })).toBeNull();
    expect(integrationDeliveryState({ ...event, kind: 'gmail.list_messages' })).toBeNull();
  });
  it('allowlists stored receipt fields and rejects malformed historical records', () => {
    expect(storedIntegrationReceipt({ state: 'accepted', evidence: 'provider_message_id', messageIds: ['abc'], private: 'secret' })).toEqual({ state: 'accepted', evidence: 'provider_message_id', messageIds: ['abc'] });
    for (const value of [null, {}, { state: 'accepted', evidence: 'provider_message_id', messageIds: [] }, { state: 'accepted', evidence: 'http_response', messageIds: ['abc'] }, { state: 'accepted', evidence: 'provider_message_id', messageIds: [{ malicious: true }] }]) expect(storedIntegrationReceipt(value)).toBeNull();
  });
  it('retains provider message identity without claiming end-recipient delivery', () => {
    expect(integrationReceipt('whatsapp.send_message', { messageIds: ['wamid.ABC123='], private: 'hidden' })).toEqual({ state: 'accepted', evidence: 'provider_message_id', messageIds: ['wamid.ABC123='] });
    expect(integrationReceipt('telegram.send_document', { messageId: 123 })).toMatchObject({ messageIds: ['123'] });
    expect(integrationReceipt('gmail.send_email', { id: 'abc123' })).toMatchObject({ messageIds: ['abc123'] });
  });
  it.each([null, {}, 'bad id with text', 'x'.repeat(513), Number.MAX_SAFE_INTEGER + 1])('rejects malformed provider ids: %j', value => {
    expect(integrationReceiptId(value)).toBeNull();
    expect(() => integrationReceipt('slack.send_message', { ts: value })).toThrow('could not be confirmed');
  });
  it('does not invent message receipts from HTTP success alone', () => {
    expect(() => integrationReceipt('whatsapp.send_message', { status: 200, messageIds: [] })).toThrow();
    expect(integrationReceipt('webhook.send', { status: 202 })).toMatchObject({ evidence: 'http_response', messageIds: [] });
    expect(integrationReceipt('slack.read_messages', { messages: [] })).toBeNull();
  });
  it('canonicalizes object order while retaining array order and action identity', () => {
    expect(integrationRequestDigest('send', { b: 2, a: 1 })).toBe(integrationRequestDigest('send', { a: 1, b: 2 }));
    expect(integrationRequestDigest('send', { a: [1, 2] })).not.toBe(integrationRequestDigest('send', { a: [2, 1] }));
    expect(integrationRequestDigest('read', {})).not.toBe(integrationRequestDigest('send', {}));
  });
});
