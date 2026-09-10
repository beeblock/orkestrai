import { AgentWorkspaceToolController } from '$lib/modules/agent-room/interface/http/controllers/AgentWorkspaceToolController.js';

const controller = new AgentWorkspaceToolController();
export const POST = controller.handle('rollback');
