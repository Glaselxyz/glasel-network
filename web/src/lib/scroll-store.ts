/**
 * Tiny module-singleton store shared between the page (writer) and the R3F scene
 * (reader, every frame). A single full-page 3D canvas reads `progress` to scrub
 * its camera + objects, so the whole experience stays in sync with the scroll.
 */
export const scrollState = {
  /** 0 → 1 over the full scrollable page. */
  progress: 0,
  /** normalized pointer (-1 → 1) for subtle camera parallax. */
  mx: 0,
  my: 0,
};

/** Eased lerp helper. */
export const damp = (current: number, target: number, lambda: number, dt: number) =>
  current + (target - current) * (1 - Math.exp(-lambda * dt));
