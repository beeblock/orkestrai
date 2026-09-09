import { WorkspaceController } from '$lib/modules/agent-room/interface/http/controllers/WorkspaceController.js';
import { AgentRuntimeController } from '$lib/modules/agent-room/interface/http/controllers/AgentRuntimeController.js';

const workspaceController = new WorkspaceController();
const runtimeController = new AgentRuntimeController();

export const GET = runtimeController.handle('show');
export const PATCH = runtimeController.handle('update');
export const POST = runtimeController.handle('action');
export const PUT = workspaceController.handle('changeTerminalRuntime');
