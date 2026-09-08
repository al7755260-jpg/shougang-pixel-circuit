/** Keep large/high-DPI windows within a predictable GPU pixel budget. */
export function renderPixelRatio({width, height, devicePixelRatio = 1, mobile = false, pixelSize = 1, scale = 1}) {
  const maxPixels = mobile ? 1280 * 720 : 1920 * 1080;
  const sizeLimit = Math.sqrt(maxPixels / Math.max(1, width * height));
  return Math.min(mobile ? 1.25 : 1.5, devicePixelRatio, sizeLimit) / pixelSize * scale;
}

/** Preserve fractional RAF time, avoiding a 30 FPS cap accidentally becoming 20. */
export class FramePacer {
  constructor() { this.reset(); }
  reset() { this.next = 0; this.fps = 0; }
  due(now, fps = 0) {
    if (this.fps !== fps) { this.next = now; this.fps = fps; }
    if (!fps) return true;
    if (now + .75 < this.next) return false;
    this.next = Math.max(this.next + 1000 / fps, now);
    return true;
  }
}
