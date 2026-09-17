import { CreativeMediaController } from '$lib/modules/creative-media/interface/http/controllers/CreativeMediaController.js';
const controller = new CreativeMediaController();
export const GET = controller.handle('models');
