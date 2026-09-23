import { KnowledgeController } from '$lib/modules/agent-room/interface/http/controllers/KnowledgeController.js';
export const GET = (event: any) => new KnowledgeController().file(event);
