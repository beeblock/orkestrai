import { AdventureController } from '$lib/modules/agent-room/interface/http/controllers/AdventureController.js';

const controller = new AdventureController();
export const GET = controller.handle('show');
