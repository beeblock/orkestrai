import { CodeGraphController } from '$lib/modules/agent-room/interface/http/controllers/CodeGraphController.js';

const controller = new CodeGraphController();

export const POST = controller.handle('handoff');
