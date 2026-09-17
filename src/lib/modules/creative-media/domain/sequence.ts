import type { SequenceDocument } from '../contracts/schemas/creative-sequence.schema.js';
export type SequenceExport = { id: string; revision: number; state: 'running' | 'completed' | 'failed' | 'cancelled'; progress: number; error: string | null; outputNodeId: string | null; path: string | null; sha256: string | null; startedAt: string };
export type CreativeSequence = { id: string; workspaceId: string; nodeId: string; revision: number; document: SequenceDocument; export: SequenceExport | null };
export const sequenceDuration = (document: SequenceDocument) => document.clips.reduce((duration, clip) => duration + clip.out - clip.in, 0);
