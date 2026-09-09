import { ComputerController } from '$lib/modules/agent-room/interface/http/controllers/ComputerController.js';

const controller = new ComputerController();
export const GET = controller.handle('index');
export const POST = controller.handle('command');
