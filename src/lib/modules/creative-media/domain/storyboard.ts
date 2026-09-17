import type { StoryboardDocument, StoryboardOperation, StoryboardScene } from '../contracts/schemas/creative-storyboard.schema.js';
import { storyboardDocumentSchema, storyboardSceneSchema } from '../contracts/schemas/creative-storyboard.schema.js';
import { CreativeMediaError } from './types.js';
import { uuidv7 } from '@beeblock/svelar/support';

export type CreativeStoryboard = { id: string; workspaceId: string; nodeId: string; revision: number; document: StoryboardDocument };
export type StoryboardSceneProgress = { id: string; image: string; video: string; imageStale: boolean; videoStale: boolean; outputs: Array<{ id: string; type: string; title: string }> };
export type StoryboardRead = { storyboard: CreativeStoryboard; progress: StoryboardSceneProgress[]; inputs: Array<{ id: string; type: string; title: string; path?: string }>; executors: Array<{ id: string; title: string }> };

export function sceneBrief(scene: StoryboardScene) {
  return { title: scene.title, direction: scene.direction, dialogue: scene.dialogue, language: scene.language, duration: scene.duration, aspectRatio: scene.aspectRatio, shot: scene.shot, characterIds: scene.characterIds, referenceNodeIds: scene.referenceNodeIds };
}
export function applyStoryboardOperations(source: StoryboardDocument, operations: StoryboardOperation[]): StoryboardDocument {
  const document = structuredClone(source);
  for (const operation of operations) {
    if (operation.type === 'rename') { document.title = operation.title; continue; }
    if (operation.type === 'add') {
      if (document.scenes.some(scene => scene.id === operation.scene.id)) throw new CreativeMediaError('creative_duplicate_input');
      const index = operation.beforeId ? document.scenes.findIndex(scene => scene.id === operation.beforeId) : document.scenes.length;
      if (index < 0) throw new CreativeMediaError('creative_storyboard_scene_missing', 404);
      document.scenes.splice(index, 0, storyboardSceneSchema.parse({ ...operation.scene, id: operation.scene.id ?? uuidv7() }));
      continue;
    }
    const index = document.scenes.findIndex(scene => scene.id === operation.id);
    if (index < 0) throw new CreativeMediaError('creative_storyboard_scene_missing', 404);
    const scene = document.scenes[index];
    if (operation.type === 'update') Object.assign(scene, operation.patch);
    if (operation.type === 'remove') document.scenes.splice(index, 1);
    if (operation.type === 'duplicate') document.scenes.splice(index + 1, 0, storyboardSceneSchema.parse({ ...sceneBrief(scene), executorNodeId: scene.executorNodeId, id: operation.newId ?? uuidv7() }));
    if (operation.type === 'link') {
      scene[operation.kind === 'image' ? 'imageWorkflowNodeId' : 'videoWorkflowNodeId'] = operation.nodeId;
      scene[operation.kind === 'image' ? 'imageBriefHash' : 'videoBriefHash'] = null;
    }
    if (operation.type === 'move' && operation.beforeId !== scene.id) {
      document.scenes.splice(index, 1);
      const before = operation.beforeId ? document.scenes.findIndex(item => item.id === operation.beforeId) : document.scenes.length;
      if (before < 0) throw new CreativeMediaError('creative_storyboard_scene_missing', 404);
      document.scenes.splice(before, 0, scene);
    }
  }
  return storyboardDocumentSchema.parse(document);
}

export function transferStoryboard(source: StoryboardDocument, ids: ReadonlyMap<string, string>) {
  return storyboardDocumentSchema.parse({ ...source, scenes: source.scenes.map(scene => ({ ...scene,
    executorNodeId: scene.executorNodeId ? ids.get(scene.executorNodeId) ?? null : null,
    referenceNodeIds: scene.referenceNodeIds.map(id => ids.get(id) ?? id),
    imageWorkflowNodeId: scene.imageWorkflowNodeId ? ids.get(scene.imageWorkflowNodeId) ?? null : null,
    videoWorkflowNodeId: scene.videoWorkflowNodeId ? ids.get(scene.videoWorkflowNodeId) ?? null : null,
    imageBriefHash: null, videoBriefHash: null,
  })) });
}
