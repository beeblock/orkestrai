import { MachineController } from '$lib/modules/agent-room/interface/http/controllers/MachineController.js';

const controller = new MachineController();
export const GET = controller.handle('index');
