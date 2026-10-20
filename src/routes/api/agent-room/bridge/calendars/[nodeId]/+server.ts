import { BridgeController } from '$lib/modules/agent-room/interface/http/controllers/BridgeController.js';

const controller = new BridgeController();

export const GET = controller.handle('calendarRead');
export const POST = controller.handle('calendarUpdate');
