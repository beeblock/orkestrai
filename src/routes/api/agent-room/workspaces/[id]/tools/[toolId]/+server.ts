import { AgentWorkspaceToolController } from '$lib/modules/agent-room/interface/http/controllers/AgentWorkspaceToolController.js';

const controller = new AgentWorkspaceToolController();
export const GET = controller.handle('show');
export const PUT = controller.handle('update');
export const DELETE = controller.handle('archive');
