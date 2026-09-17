import { CreativeMediaController } from '$lib/modules/creative-media/interface/http/controllers/CreativeMediaController.js';
const controller = new CreativeMediaController();
export const PUT = controller.handle('saveProfile');
export const DELETE = controller.handle('removeProfile');
