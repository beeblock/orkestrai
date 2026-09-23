import { KnowledgeController } from '$lib/modules/agent-room/interface/http/controllers/KnowledgeController.js';
const controller = new KnowledgeController();
export const POST = controller.handle('upload');
