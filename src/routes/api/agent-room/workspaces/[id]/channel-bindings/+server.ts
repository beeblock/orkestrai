import { ChannelBindingController } from '$lib/modules/agent-room/interface/http/controllers/ChannelBindingController.js';

const controller = new ChannelBindingController();
export const GET = controller.handle('index');
export const POST = controller.handle('store');
