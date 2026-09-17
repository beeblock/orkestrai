import { CreativeBrandKitController } from '$lib/modules/creative-media/interface/http/controllers/CreativeBrandKitController.js';
const controller = new CreativeBrandKitController();
export const GET = controller.handle('command');
export const POST = controller.handle('command');
