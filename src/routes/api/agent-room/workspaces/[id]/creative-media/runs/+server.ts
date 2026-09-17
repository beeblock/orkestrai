import { CreativeMediaController } from '$lib/modules/creative-media/interface/http/controllers/CreativeMediaController.js';
export const POST = new CreativeMediaController().handle('command');
