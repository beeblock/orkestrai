import { MobileAccessController } from '$lib/modules/agent-room/interface/http/controllers/MobileAccessController.js';

const controller = new MobileAccessController();
export const GET = controller.handle('show');
export const POST = controller.handle('pair');
export const DELETE = controller.handle('destroy');
