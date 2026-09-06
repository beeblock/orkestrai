import { FilesystemController } from '$lib/modules/agent-room/interface/http/controllers/FilesystemController.js';

const ctrl = new FilesystemController();
export const GET = ctrl.handle('gitWorkspace');
