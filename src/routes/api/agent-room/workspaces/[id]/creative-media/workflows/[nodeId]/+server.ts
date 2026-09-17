import { CreativeMediaController } from '$lib/modules/creative-media/interface/http/controllers/CreativeMediaController.js';
const controller = new CreativeMediaController();
export const GET = controller.handle('read');
export const PUT = controller.handle('update');
export const DELETE = controller.handle('remove');
