import { CreativeAssetReviewController } from '$lib/modules/creative-media/interface/http/controllers/CreativeAssetReviewController.js';
const controller = new CreativeAssetReviewController();
export const GET = (event: any) => controller.command(event);
export const POST = (event: any) => controller.command(event);
