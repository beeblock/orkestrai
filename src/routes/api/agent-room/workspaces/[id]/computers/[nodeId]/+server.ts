import { ComputerController } from '$lib/modules/agent-room/interface/http/controllers/ComputerController.js';

const controller = new ComputerController();
export const PATCH = controller.handle('configure');
