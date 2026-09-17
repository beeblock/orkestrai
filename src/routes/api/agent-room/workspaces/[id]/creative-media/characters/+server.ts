import { CreativeCharacterController } from '$lib/modules/creative-media/interface/http/controllers/CreativeCharacterController.js';
const controller = new CreativeCharacterController();
export const GET = controller.handle('index');
export const POST = controller.handle('command');
