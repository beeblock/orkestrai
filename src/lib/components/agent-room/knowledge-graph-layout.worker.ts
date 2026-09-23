import { layoutKnowledgeGraph, knowledgeCommunities, type LayoutInput } from './knowledge-graph-layout.js';
self.onmessage = (event: MessageEvent<LayoutInput & { revision: number }>) => {
  self.postMessage({ revision: event.data.revision, positions: layoutKnowledgeGraph(event.data), groups: knowledgeCommunities(event.data.ids, event.data.links) });
};
