import { CoreRuntimeController } from '$lib/modules/agent-room/interface/http/controllers/CoreRuntimeController.js';

const controller = new CoreRuntimeController();

export const GET = controller.handle('health');
