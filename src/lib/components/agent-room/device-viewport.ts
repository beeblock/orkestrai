export const DEVICE_ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2] as const;

type FitDeviceViewportInput = {
  contentWidth: number;
  contentHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  horizontalPadding?: number;
  verticalPadding?: number;
};

export function fitDeviceViewportScale({
  contentWidth,
  contentHeight,
  viewportWidth,
  viewportHeight,
  horizontalPadding = 36,
  verticalPadding = 80,
}: FitDeviceViewportInput): number {
  if (![contentWidth, contentHeight, viewportWidth, viewportHeight, horizontalPadding, verticalPadding].every(Number.isFinite)
    || contentWidth <= 0 || contentHeight <= 0 || viewportWidth <= 0 || viewportHeight <= 0) return 1;
  // Collapsed/hidden panels are not measured viewports. Fitting one pixel of
  // available height would lock a newly mounted screen into a near-zero zoom.
  const availableWidth = viewportWidth - Math.max(0, horizontalPadding);
  const availableHeight = viewportHeight - Math.max(0, verticalPadding);
  if (availableWidth <= 0 || availableHeight <= 0) return 1;
  return Math.min(1, availableWidth / contentWidth, availableHeight / contentHeight);
}

export function stepDeviceViewportScale(current: number, direction: -1 | 1): number {
  const epsilon = 0.005;
  if (direction > 0) {
    return DEVICE_ZOOM_STEPS.find((step) => step > current + epsilon) ?? DEVICE_ZOOM_STEPS.at(-1)!;
  }
  return [...DEVICE_ZOOM_STEPS].reverse().find((step) => step < current - epsilon) ?? DEVICE_ZOOM_STEPS[0];
}
