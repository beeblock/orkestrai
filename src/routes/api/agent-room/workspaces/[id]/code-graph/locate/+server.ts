import { CodeGraphController } from '$lib/modules/agent-room/interface/http/controllers/CodeGraphController.js';

const controller = new CodeGraphController();

export const GET = controller.handle('locate');
