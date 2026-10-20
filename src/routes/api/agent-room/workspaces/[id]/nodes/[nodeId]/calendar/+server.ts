import { PlanNodeController } from '$lib/modules/agent-room/interface/http/controllers/PlanNodeController.js';

const controller = new PlanNodeController();
export const GET = controller.handle('calendar');
export const POST = controller.handle('updateCalendar');
