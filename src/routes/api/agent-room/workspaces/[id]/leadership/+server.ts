import { WorkspaceLeadershipController } from '$lib/modules/agent-room/interface/http/controllers/WorkspaceLeadershipController.js';
const controller = new WorkspaceLeadershipController();
export const GET = controller.handle('show');
export const POST = controller.handle('command');
