import { ChannelController } from '$lib/modules/agent-room/interface/http/controllers/ChannelController.js';

const controller = new ChannelController();
export const GET = controller.handle('messages');
export const POST = controller.handle('store');
