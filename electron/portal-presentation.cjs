// Native child views do not reliably inherit their parent's clipping on every OS.
// Bound the actual web surface. Origin crops use the DOM preview: CDP's screenshot
// viewport override breaks input coordinates and pins scroll to a document offset.
function portalPresentation({ bounds, clip, zoom, viewport }) {
  const width = viewport?.width ?? Math.max(1, Math.round(bounds.width / zoom));
  const height = viewport?.height ?? Math.max(1, Math.round(bounds.height / zoom));
  const x = Math.max(bounds.x, clip.x), y = Math.max(bounds.y, clip.y);
  const right = Math.min(bounds.x + bounds.width, clip.x + clip.width);
  const bottom = Math.min(bounds.y + bounds.height, clip.y + clip.height);
  const frame = { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
  return {
    frame,
    previewOnly: x !== bounds.x || y !== bounds.y,
    metrics: {
      width, height, deviceScaleFactor: 0, mobile: false, scale: zoom,
      // WebContentsView owns the clipped native size. Chromium's implicit resize
      // dereferences a missing RenderWidgetHostView on new or crashed pages.
      dontSetVisibleSize: true,
    },
  };
}

function validPortalGeometry(geometry) {
  if (!geometry || typeof geometry.visible !== 'boolean'
    || !Number.isFinite(geometry.zoom) || geometry.zoom < 0.05 || geometry.zoom > 5
    || (geometry.moving !== undefined && typeof geometry.moving !== 'boolean')) return false;
  for (const rect of [geometry.bounds, geometry.clip]) {
    if (!rect || !['x', 'y', 'width', 'height'].every(key => Number.isInteger(rect[key]) && Math.abs(rect[key]) < 100000)
      || rect.width < 0 || rect.height < 0) return false;
  }
  return !!geometry.viewport && ['width', 'height'].every(key =>
    Number.isInteger(geometry.viewport[key]) && geometry.viewport[key] > 0 && geometry.viewport[key] <= 16384);
}

module.exports = { portalPresentation, validPortalGeometry };
