import { FilesystemController } from '$lib/modules/agent-room/interface/http/controllers/FilesystemController.js';

const controller = new FilesystemController();
export const POST = controller.handle('openFolder');
