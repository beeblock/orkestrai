type GraphSurface = { resize(force?: boolean): unknown; render(): unknown };

/** Never expose resized/cleared picking buffers before their matching draw. */
export function synchronizeGraphSurface(renderer: GraphSurface): void {
  renderer.resize(true);
  renderer.render();
}
