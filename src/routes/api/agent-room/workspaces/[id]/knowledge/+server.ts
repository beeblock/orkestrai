import { KnowledgeController } from '$lib/modules/agent-room/interface/http/controllers/KnowledgeController.js';
const controller = new KnowledgeController();
export const GET = controller.handle('index');
export const POST = controller.handle('store');
