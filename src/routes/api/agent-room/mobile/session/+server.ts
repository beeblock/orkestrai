import { MobileAccessController } from '$lib/modules/agent-room/interface/http/controllers/MobileAccessController.js';

const controller = new MobileAccessController();
export const GET = controller.handle('session');
