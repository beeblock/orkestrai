import { IntegrationController } from '$lib/modules/agent-room/interface/http/controllers/IntegrationController.js';

const controller = new IntegrationController();
export const PATCH = controller.handle('update');
export const DELETE = controller.handle('destroy');
