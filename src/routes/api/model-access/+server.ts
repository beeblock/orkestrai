import { ModelAccessController } from '$lib/modules/model-access/interface/http/controllers/ModelAccessController.js';
const controller = new ModelAccessController();
export const GET = controller.handle('index');
export const POST = controller.handle('create');
