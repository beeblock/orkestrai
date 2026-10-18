import { CanvasTidyController } from '$lib/modules/agent-room/interface/http/controllers/CanvasTidyController.js';

const controller = new CanvasTidyController();
export const POST = controller.handle('tidy');
