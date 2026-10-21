import { CanvasTidyController } from '$lib/modules/agent-room/interface/http/controllers/CanvasTidyController.js';

const controller = new CanvasTidyController();
export const GET = controller.handle('archived');
export const POST = controller.handle('restore');
