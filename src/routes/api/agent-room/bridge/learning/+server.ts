import { AgentLearningController } from '$lib/modules/agent-room/interface/http/controllers/AgentLearningController.js';
const controller = new AgentLearningController();
export const GET = controller.handle('index');
export const POST = controller.handle('store');
