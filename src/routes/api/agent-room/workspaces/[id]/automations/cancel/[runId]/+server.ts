import { AutomationController } from '$lib/modules/agent-room/interface/http/controllers/AutomationController.js';

const controller = new AutomationController();

export const POST = controller.handle('cancel');
