import { CreativeMediaController } from '$lib/modules/creative-media/interface/http/controllers/CreativeMediaController.js';
import type { RequestHandler } from './$types.js';
export const GET: RequestHandler = event => new CreativeMediaController().video(event);
export const HEAD = GET;
