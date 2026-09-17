import { CreativeStoryboardController } from '$lib/modules/creative-media/interface/http/controllers/CreativeStoryboardController.js';
const controller = new CreativeStoryboardController();
export const GET = (event: any) => controller.command(event);
export const POST = (event: any) => controller.command(event);
