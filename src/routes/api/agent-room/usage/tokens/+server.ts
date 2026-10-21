import { UsageController } from '$lib/modules/agent-room/interface/http/controllers/UsageController.js';

const ctrl = new UsageController();
export const GET = ctrl.handle('getTokens');
