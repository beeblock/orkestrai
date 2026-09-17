import type { CreativeCharacterDefinition } from '../contracts/schemas/creative-character.schema.js';
import type { CreativeMediaReference } from './types.js';

export type CharacterSnapshot = {
  definition: CreativeCharacterDefinition;
  images: CreativeMediaReference[];
  voice: CreativeMediaReference | null;
  digest: string;
};
export type CreativeCharacter = {
  id: string; workspaceId: string; familyId: string; version: number; revision: number;
  state: 'draft' | 'locked'; definition: CreativeCharacterDefinition;
  snapshot: CharacterSnapshot | null;
};
