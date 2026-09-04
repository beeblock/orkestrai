import { CanvasNodeTransferController } from '$lib/modules/agent-room/interface/http/controllers/CanvasNodeTransferController.js';

const controller = new CanvasNodeTransferController();
export const POST = controller.handle('store');
