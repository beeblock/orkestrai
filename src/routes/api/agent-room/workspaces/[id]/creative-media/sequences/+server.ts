import { CreativeSequenceController } from '$lib/modules/creative-media/interface/http/controllers/CreativeSequenceController.js';
const controller = new CreativeSequenceController();
export const GET = controller.handle('command');
export const POST = controller.handle('command');
