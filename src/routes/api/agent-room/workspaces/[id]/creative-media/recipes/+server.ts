import { CreativeRecipeController } from '$lib/modules/creative-media/interface/http/controllers/CreativeRecipeController.js';
const controller = new CreativeRecipeController();
export const GET = controller.handle('command');
export const POST = controller.handle('command');
