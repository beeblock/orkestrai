import { IntegrationController } from '$lib/modules/agent-room/interface/http/controllers/IntegrationController.js';

const controller = new IntegrationController();
export const POST = controller.handle('check');
