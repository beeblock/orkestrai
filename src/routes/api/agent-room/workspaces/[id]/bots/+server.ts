import { PersonalBotController } from '$lib/modules/agent-room/interface/http/controllers/PersonalBotController.js';
const controller = new PersonalBotController();
export const GET = controller.handle('index');
export const POST = controller.handle('command');
