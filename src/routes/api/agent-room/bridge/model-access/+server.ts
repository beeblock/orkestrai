import { ModelAccessBridgeController } from '$lib/modules/model-access/interface/http/controllers/ModelAccessBridgeController.js';
const controller = new ModelAccessBridgeController();
export const POST = controller.handle('command');
