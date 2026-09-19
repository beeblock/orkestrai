import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import { CreativeMediaError, type CreativeActor, type CreativeMediaReference } from '../../domain/types.js';
import { creativeCharacterRepository, type CreativeCharacterRepository } from '../../infrastructure/repositories/CreativeCharacterRepository.js';
import { creativeCharacterCommandSchema, type CreativeCharacterCommand } from '../../contracts/schemas/creative-character.schema.js';
import { creativeConfigSchema, type CreativeConfig } from '../../contracts/schemas/creative-media.schema.js';
import type { CharacterSnapshot } from '../../domain/character.js';
import { concreteSchema, modelMediaSlots, type FalModelContract, type ModelSchema } from '../../domain/model-contract.js';
import { bindModelMedia } from '../../domain/model-input.js';
import { CreativeMediaFiles } from './CreativeMediaFiles.js';
import { withCreativeProfileLock } from './creative-profile-lock.js';
import { autonomyPolicyService } from '$lib/modules/agent-room/application/services/AutonomyPolicyService.js';
import { creativeWorkspaceGateway, type CreativeWorkspaceGateway } from '$lib/modules/agent-room/application/services/CreativeWorkspaceGateway.js';
import { Connection } from '@beeblock/svelar/database';
import { resolveCharacterMentions, suggestCharacterBinding } from '../../domain/character-binding.js';
import { falModelCatalog } from './FalModelCatalogService.js';

function inputAt(schema: ModelSchema, pointer: string): ModelSchema | null {
  let current = schema;
  for (const key of pointer.slice(1).split('/')) {
    current = concreteSchema(current);
    const next = current.type === 'array' && /^\d+$/.test(key) && Number(key) < Math.min(current.maxItems ?? 50, 50) ? current.items : current.properties?.[key];
    if (!next) return null;
    current = next;
  }
  return concreteSchema(current);
}

function referenceLabel(endpoint: string, pointer: string) {
  if (endpoint === 'bytedance/seedance-2.5/reference-to-video') {
    const match = /^\/(image|audio|video)_urls\/(\d+)$/.exec(pointer);
    if (match) return `@${match[1][0].toUpperCase()}${match[1].slice(1)}${Number(match[2]) + 1}`;
  }
  if (/^fal-ai\/kling-video\/v2\.6\//.test(endpoint)) {
    const match = /^\/voice_ids\/(\d+)$/.exec(pointer);
    if (match) return `<<<voice_${Number(match[1]) + 1}>>>`;
  }
  return pointer;
}

export class CreativeCharacterService {
  constructor(readonly repository: CreativeCharacterRepository = creativeCharacterRepository, readonly files = new CreativeMediaFiles(), readonly workspace: CreativeWorkspaceGateway = creativeWorkspaceGateway) {}
  async read(workspaceId: string, id: string) {
    const record = await this.repository.read(workspaceId, id);
    if (!record) throw new CreativeMediaError('creative_character_not_found', 404);
    return record;
  }
  async execute(workspaceId: string, raw: CreativeCharacterCommand, actor: CreativeActor) {
    const input = creativeCharacterCommandSchema.parse(raw);
    if (input.command === 'list') return this.repository.list(workspaceId);
    if (input.command === 'read') return this.read(workspaceId, input.id!);
    if (input.command === 'binding') {
      const character = await this.read(workspaceId, input.id!);
      const contract = await falModelCatalog.contract(input.config!.modelId);
      return suggestCharacterBinding(character, contract, input.config!);
    }
    if (input.command === 'library') {
      if (actor.type !== 'user') throw new CreativeMediaError('creative_owner_required', 403);
      const records = await this.repository.library();
      const workspaces = new Map<string, string>();
      for (const record of records) {
        if (!workspaces.has(record.workspaceId)) {
          const source = await this.workspace.workspace(record.workspaceId);
          if (source) workspaces.set(record.workspaceId, source.name);
        }
      }
      const seen = new Set<string>();
      return records.filter(record => {
        const key = `${record.familyId}:${record.version}`;
        if (!workspaces.has(record.workspaceId) || seen.has(key)) return false;
        seen.add(key); return true;
      }).map(record => ({ ...record, workspaceName: workspaces.get(record.workspaceId)! }));
    }
    if (input.command === 'place') {
      const sourceId = input.sourceWorkspaceId ?? workspaceId;
      if (actor.type !== 'user' && sourceId !== workspaceId) throw new CreativeMediaError('creative_owner_required', 403);
      return withCreativeProfileLock('character-library', async () => {
        const source = await this.read(sourceId, input.id!);
        if (source.state !== 'locked' || !source.snapshot) throw new CreativeMediaError('creative_character_lock_required');
        await this.workspace.characterDestination(workspaceId, input.floorId ?? null);
        const existing = await this.repository.imported(workspaceId, source);
        if (existing && existing.snapshot?.digest !== source.snapshot.digest) throw new CreativeMediaError('creative_reference_changed', 409);
        // Keep the exact relative paths and snapshot digest; never copy account grants.
        const references = [...source.snapshot.images, ...(source.snapshot.voice ? [source.snapshot.voice] : [])];
        await this.files.freezeMany(workspaceId, references.map(reference => ({ reference, path: reference.path })), sourceId);
        const result = await Connection.transaction(async () => {
          const character = await this.repository.importLocked(workspaceId, source);
          return { character, ...await this.workspace.placeCharacter(character, input.position, input.floorId ?? null) };
        });
        await autonomyPolicyService.recordSemanticEffect({ workspaceId, capability: 'filesystem', operation: 'creative.character.place', actorType: actor.type, actorId: actor.type === 'agent' ? actor.nodeId : null, input: { sourceWorkspaceId: sourceId, sourceId: source.id } }, { id: result.character.id, digest: source.snapshot.digest });
        this.workspace.broadcast(workspaceId);
        return result;
      });
    }
    if (input.command === 'lock' && actor.type !== 'user') throw new CreativeMediaError('creative_owner_required', 403);
    return withCreativeProfileLock('character-library', async () => {
      const record = input.id ? await this.read(workspaceId, input.id) : null;
      let result;
      if (input.command === 'create') result = await this.repository.create(workspaceId, input.definition!);
      else if (input.command === 'fork') {
        if (record!.state !== 'locked') throw new CreativeMediaError('creative_character_lock_required');
        result = await this.repository.create(workspaceId, record!.definition, record!.familyId);
      } else {
        if (record!.state !== 'draft') throw new CreativeMediaError('creative_character_locked_or_changed', 409);
        if (record!.revision !== input.revision) throw new CreativeMediaError('creative_revision_conflict', 409);
        if (input.command === 'remove') { await this.repository.remove(workspaceId, record!.id, input.revision!); result = { removed: true }; }
        else if (input.command === 'update') result = await this.repository.update(workspaceId, record!.id, input.revision!, input.definition!);
        else {
          const definition = structuredClone(record!.definition);
          if (!definition.appearance || !definition.images.length || definition.voice.kind === 'unassigned') throw new CreativeMediaError('creative_character_incomplete');
          const sources: Array<{ reference: CreativeMediaReference; path: string }> = [];
          const folder = `generated/characters/${record!.familyId}/v${record!.version}/r${record!.revision}`;
          let total = 0;
          for (let index = 0; index < definition.images.length; index++) {
            const source = await this.files.media(workspaceId, { path: definition.images[index] });
            total += source.size;
            if (!source.mimeType.startsWith('image/') || total > 100 * 1024 * 1024) throw new CreativeMediaError('creative_character_reference_invalid');
            sources.push({ reference: source, path: `${folder}/image-${index + 1}-${source.sha256.slice(0, 12)}${extname(source.path).toLowerCase()}` });
          }
          if (definition.voice.kind === 'audio') {
            const source = await this.files.media(workspaceId, { path: definition.voice.path });
            if (!source.mimeType.startsWith('audio/') || source.size + total > 100 * 1024 * 1024) throw new CreativeMediaError('creative_character_reference_invalid');
            sources.push({ reference: source, path: `${folder}/voice-${source.sha256.slice(0, 12)}${extname(source.path).toLowerCase()}` });
          }
          const copies = await this.files.freezeMany(workspaceId, sources);
          const images = copies.slice(0, definition.images.length);
          const voice = definition.voice.kind === 'audio' ? copies.at(-1)! : null;
          definition.images = images.map(image => image.path);
          if (definition.voice.kind === 'audio') definition.voice.path = voice!.path;
          const content = { definition, images, voice };
          const snapshot: CharacterSnapshot = { ...content, digest: createHash('sha256').update(JSON.stringify(content)).digest('hex') };
          result = await this.repository.update(workspaceId, record!.id, input.revision!, definition, snapshot);
        }
      }
      await autonomyPolicyService.recordSemanticEffect({ workspaceId, capability: 'filesystem', operation: `creative.character.${input.command}`, actorType: actor.type, actorId: actor.type === 'agent' ? actor.nodeId : null, input: { id: record?.id, revision: input.revision } }, { id: 'id' in result ? result.id : record?.id, state: 'state' in result ? result.state : 'removed' });
      return result;
    });
  }

  async resolve(workspaceId: string, source: CreativeConfig, contract?: FalModelContract) {
    const config = structuredClone(source);
    const characters: Array<{ id: string; version: number; digest: string; name: string }> = [];
    const directions: string[] = [];
    if (!config.characterBindings.length) {
      if (/@\{[^}\n]+\}/.test(config.prompt)) throw new CreativeMediaError('creative_reference_alias_missing');
      return { config, characters, directions };
    }
    if (!contract) throw new CreativeMediaError('creative_character_model_incompatible');
    const used = config.characterBindings.flatMap(binding => [...binding.imagePointers, binding.voicePointer]);
    const slots = modelMediaSlots(contract.schema, used);
    const mentions: Array<{ alias?: string; name: string }> = [];
    for (const binding of config.characterBindings) {
      const character = await this.read(workspaceId, binding.id);
      const frozen = character.snapshot;
      if (character.state !== 'locked' || !frozen || frozen.definition.voice.kind === 'unassigned') throw new CreativeMediaError('creative_character_lock_required');
      if (binding.imagePointers.length !== frozen.images.length) throw new CreativeMediaError('creative_character_binding_required');
      const references = [...frozen.images, ...(frozen.voice ? [frozen.voice] : [])];
      for (const reference of references) {
        const current = await this.files.media(workspaceId, { path: reference.path });
        if (current.sha256 !== reference.sha256 || current.mimeType !== reference.mimeType) throw new CreativeMediaError('creative_reference_changed', 409);
      }
      for (let index = 0; index < frozen.images.length; index++) {
        const pointer = binding.imagePointers[index];
        if (!slots.includes(pointer) || !/image|frame/i.test(pointer) || inputAt(contract.schema, pointer)?.type !== 'string') throw new CreativeMediaError('creative_character_model_incompatible');
        config.mediaBindings.push({ pointer, path: frozen.images[index].path });
      }
      const voice = frozen.definition.voice;
      if (/^fal-ai\/kling-video\/v2\.6\//.test(config.modelId) && !/^(en|zh)(?:-|$)/i.test(voice.language)) throw new CreativeMediaError('creative_character_model_incompatible');
      if (voice.kind === 'audio') {
        if (!frozen.voice || !slots.includes(binding.voicePointer) || !/audio|voice/i.test(binding.voicePointer) || inputAt(contract.schema, binding.voicePointer)?.type !== 'string') throw new CreativeMediaError('creative_character_model_incompatible');
        config.mediaBindings.push({ pointer: binding.voicePointer, path: frozen.voice.path });
      } else {
        if (voice.profileId !== config.profileId || !voice.modelIds.includes(config.modelId) || !/\/voice_ids?(?:\/\d+)?$/.test(binding.voicePointer) || inputAt(contract.schema, binding.voicePointer)?.type !== 'string') throw new CreativeMediaError('creative_character_model_incompatible');
        bindModelMedia(config.parameters, binding.voicePointer, voice.voiceId);
      }
      const audio = contract.schema.properties?.generate_audio;
      if (audio && (config.parameters.generate_audio ?? audio.default) !== true) throw new CreativeMediaError('creative_character_audio_required');
      characters.push({ id: character.id, version: character.version, digest: frozen.digest, name: frozen.definition.name });
      mentions.push({ alias: binding.alias, name: frozen.definition.name });
      // Production notes and approval/version provenance belong to the local
      // snapshot, never to material the model might render or speak.
      directions.push(`Casting instructions only, not dialogue, narration or on-screen text. Speak only the dialogue explicitly requested in the scene direction; do not read casting descriptions or repeat reference audio transcripts as additional dialogue.\nCharacter ${frozen.definition.name}: ${frozen.definition.appearance}\nVisual references: ${binding.imagePointers.map(pointer => referenceLabel(config.modelId, pointer)).join(', ')}. Voice reference: ${referenceLabel(config.modelId, binding.voicePointer)}. Language: ${voice.language}. Vocal delivery instructions: ${voice.style}. Preserve the supplied visual identity and voice; do not replace either.\nEnd casting instructions.`);
    }
    // Expanded references are fixed run inputs; character IDs remain separately
    // in provenance instead of colliding with their resolved media pointers.
    config.characterBindings = [];
    try { config.prompt = resolveCharacterMentions(config.prompt, mentions); }
    catch { throw new CreativeMediaError('creative_reference_alias_missing'); }
    return { config: creativeConfigSchema.parse(config), characters, directions };
  }
}
export const creativeCharacterService = new CreativeCharacterService();
