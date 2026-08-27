import { BridgeController } from '$lib/modules/agent-room/interface/http/controllers/BridgeController.js';

const controller = new BridgeController();

export const GET = controller.handle('readImageWorkflow');
export const POST = controller.handle('runImageWorkflow');
export const DELETE = controller.handle('cancelImageWorkflow');
