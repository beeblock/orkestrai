import { ModelAccessController } from '$lib/modules/model-access/interface/http/controllers/ModelAccessController.js';
const controller = new ModelAccessController();
export const POST = controller.handle('join');
