/** A display-only bitmap; never changes the source image or workspace file. */
export const IMAGE_OVERVIEW_EDGE = 256;

/** Keep vector/known animated formats on their original browser renderer. */
export function canCacheImageOverview(path: string | undefined): boolean {
  return typeof path === 'string' && /\.(?:png|jpe?g|bmp)$/i.test(path);
}

export function imageOverviewSize(width: number, height: number): { width: number; height: number } | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const scale = Math.min(1, IMAGE_OVERVIEW_EDGE / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function paintImageOverview(image: HTMLImageElement, canvas: HTMLCanvasElement): boolean {
  if (!image.complete) return false;
  const size = imageOverviewSize(image.naturalWidth, image.naturalHeight);
  if (!size) return false;
  // Keep a small CPU-backed raster, not a deferred drawing list that can
  // decode the original again whenever the compositor repaints the canvas.
  const context = canvas.getContext('2d', { alpha: true, willReadFrequently: true });
  if (!context) return false;
  canvas.width = size.width;
  canvas.height = size.height;
  try {
    context.drawImage(image, 0, 0, size.width, size.height);
    return true;
  } catch {
    return false;
  }
}
