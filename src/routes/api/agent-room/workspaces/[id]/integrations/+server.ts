import { IntegrationController } from '$lib/modules/agent-room/interface/http/controllers/IntegrationController.js';

const controller = new IntegrationController();
export const GET = controller.handle('index');
export const POST = controller.handle('store');
