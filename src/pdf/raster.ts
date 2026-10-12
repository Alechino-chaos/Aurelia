export const ZOOM_SETTLE_MS = 150;
export const FULL_PAGE_PIXELS = 16_000_000;
export const TILE_SIZE = 1024;
export type PixelRect = { x: number; y: number; width: number; height: number };
export type Tile = PixelRect & { key: string };

export function rasterPlan(width: number, height: number, dpr: number) {
  const pixelWidth = Math.ceil(width * dpr);
  const pixelHeight = Math.ceil(height * dpr);
  const tiled = pixelWidth * pixelHeight > FULL_PAGE_PIXELS || Math.max(pixelWidth, pixelHeight) > 8192;
  return { pixelWidth, pixelHeight, tiled,
    // This reduced bitmap is a fallback ONLY; visible tiles retain the full DPR.
    previewRatio: tiled ? Math.min(dpr, Math.sqrt(2_000_000 / (width * height)), 4096 / Math.max(width, height)) : dpr };
}

export function visibleTiles(width: number, height: number, view: PixelRect): Tile[] {
  if (view.x >= width || view.y >= height || view.x + view.width <= 0 || view.y + view.height <= 0) return [];
  const padding = 256;
  const left = Math.max(0, Math.floor((view.x - padding) / TILE_SIZE));
  const top = Math.max(0, Math.floor((view.y - padding) / TILE_SIZE));
  const right = Math.min(Math.ceil(width / TILE_SIZE), Math.ceil((view.x + view.width + padding) / TILE_SIZE));
  const bottom = Math.min(Math.ceil(height / TILE_SIZE), Math.ceil((view.y + view.height + padding) / TILE_SIZE));
  const tiles: Tile[] = [];
  for (let row = top; row < bottom; row++) for (let col = left; col < right; col++) {
    const x = col * TILE_SIZE, y = row * TILE_SIZE;
    tiles.push({ key: `${col}:${row}`, x, y, width: Math.min(TILE_SIZE, width - x), height: Math.min(TILE_SIZE, height - y) });
  }
  return tiles;
}

type Job = { run: () => Promise<void>; priority: () => number; signal: AbortSignal; resolve: () => void; reject: (error: unknown) => void; abort: () => void };
const queue: Job[] = [];
let scheduled = false;

// Share one raster queue across pages. Visible pages precede prefetch pages;
// cancelled zooms leave the queue without allocating a new bitmap.
async function pump() {
  try {
    while (queue.length) {
      queue.sort((a, b) => a.priority() - b.priority());
      const job = queue.shift()!;
      job.signal.removeEventListener('abort', job.abort);
      if (job.signal.aborted) { job.reject(new DOMException('Cancelled', 'AbortError')); continue; }
      try { await job.run(); job.resolve(); } catch (error) { job.reject(error); }
    }
  } finally { scheduled = false; }
}

export function queueRaster(run: () => Promise<void>, priority: () => number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Cancelled', 'AbortError')); return; }
    const job: Job = { run, priority, signal, resolve, reject, abort: () => {
      const index = queue.indexOf(job);
      if (index >= 0) { queue.splice(index, 1); reject(new DOMException('Cancelled', 'AbortError')); }
    } };
    signal.addEventListener('abort', job.abort, { once: true });
    queue.push(job);
    if (!scheduled) { scheduled = true; setTimeout(() => void pump(), 0); }
  });
}
