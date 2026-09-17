import { creativePolicySaveSchema, creativeProfileSaveSchema } from '../../contracts/schemas/creative-media.schema.js';

export class CreativeProviderDto {
  private constructor(readonly command: 'save' | 'policy' | 'remove', readonly input: unknown, readonly profileId?: string, readonly workspaceId?: string) {}
  static save(input: unknown, profileId?: string) { return new CreativeProviderDto('save', creativeProfileSaveSchema.parse(input), profileId); }
  static policy(workspaceId: string, profileId: string, input: unknown) { return new CreativeProviderDto('policy', creativePolicySaveSchema.parse(input), profileId, workspaceId); }
  static remove(profileId: string) { return new CreativeProviderDto('remove', undefined, profileId); }
}
