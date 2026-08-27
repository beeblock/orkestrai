import { ImageWorkflowController } from '$lib/modules/agent-room/interface/http/controllers/ImageWorkflowController.js';

const controller = new ImageWorkflowController();

export const GET = controller.handle('status');
export const POST = controller.handle('run');
export const DELETE = controller.handle('cancel');
