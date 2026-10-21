import { ChannelBindingController } from '$lib/modules/agent-room/interface/http/controllers/ChannelBindingController.js';

const controller = new ChannelBindingController();
export const PATCH = controller.handle('update');
export const DELETE = controller.handle('destroy');
