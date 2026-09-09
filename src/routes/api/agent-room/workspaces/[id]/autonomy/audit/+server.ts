import { AutonomyPolicyController } from '$lib/modules/agent-room/interface/http/controllers/AutonomyPolicyController.js';

const controller = new AutonomyPolicyController();
export const GET = controller.handle('audit');
