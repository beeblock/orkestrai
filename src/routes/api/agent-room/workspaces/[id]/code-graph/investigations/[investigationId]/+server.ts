import { CodeGraphController } from '$lib/modules/agent-room/interface/http/controllers/CodeGraphController.js';

const controller = new CodeGraphController();

export const GET = controller.handle('investigation');
export const PATCH = controller.handle('updateInvestigation');
export const DELETE = controller.handle('deleteInvestigation');
