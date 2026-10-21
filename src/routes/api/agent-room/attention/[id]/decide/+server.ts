import { AttentionController } from '$lib/modules/agent-room/interface/http/controllers/AttentionController.js';

const controller = new AttentionController();
export const POST = controller.handle('decide');
