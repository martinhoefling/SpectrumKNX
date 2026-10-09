export const MIN_PANE_WIDTH = 220;
const MAX_PANE_WIDTH = 720;

/** Keeps a dragged pane width usable: never tiny, never more than 60% of the window. */
export const clampPaneWidth = (px: number, viewportWidth: number): number =>
  Math.round(Math.max(MIN_PANE_WIDTH, Math.min(px, MAX_PANE_WIDTH, viewportWidth * 0.6)));
