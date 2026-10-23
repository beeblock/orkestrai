import type { z } from 'zod/v3';

export const COLLABORATION_PROTOCOL: 'orkestrai-collaboration.v1';
export const MAX_ENCRYPTED_FRAME_BYTES: number;
export const MAX_PLAINTEXT_BYTES: number;
export const opaqueIdSchema: z.ZodString;
export const collaborationRoleSchema: z.ZodEnum<['viewer', 'collaborator', 'operator', 'administrator']>;
export const collaborationMessageSchema: z.ZodTypeAny;
export const collaborationEnvelopeSchema: z.ZodTypeAny;

export function assertOpaqueId(value: unknown, label: string): string;
export function assertPairingSecret(value: string): string;
export function createInviteUri(shareId: string, pairingSecret: string): string;
export function createWebInviteUri(baseUrl: string, shareId: string, pairingSecret: string): string;
export function parseInviteUri(uri: string): { shareId: string; pairingSecret: string };
