import { expect, it } from 'vitest';
import { rasterPlan, visibleTiles, queueRaster } from '../src/pdf/raster';

it('uses the actual display density, including displays above 2x', () => {
  expect(rasterPlan(612, 792, 3)).toMatchObject({ tiled: false, pixelWidth: 1836, pixelHeight: 2376, previewRatio: 3 });
});

it('bounds oversized fallback bitmaps while covering the visible area with full resolution tiles', () => {
  const plan = rasterPlan(4000, 6000, 3);
  expect(plan.tiled).toBe(true);
  expect(4000 * 6000 * plan.previewRatio ** 2).toBeLessThanOrEqual(2_000_001);
  const view = { x: 11000, y: 17000, width: 1000, height: 1000 };
  const tiles = visibleTiles(plan.pixelWidth, plan.pixelHeight, view);
  for (let y = view.y; y < 18000; y += 100) for (let x = view.x; x < 12000; x += 100) {
    expect(tiles.some(tile => x >= tile.x && x < tile.x + tile.width && y >= tile.y && y < tile.y + tile.height)).toBe(true);
  }
  expect(tiles.every(tile => tile.width <= 1024 && tile.height <= 1024)).toBe(true);
  expect(visibleTiles(12000, 18000, { x: 0, y: 18001, width: 900, height: 500 })).toEqual([]);
});

it('prioritizes visible rendering, cancels stale queued jobs and continues after errors', async () => {
  const order: string[] = [];
  const signal = new AbortController().signal;
  const abort = new AbortController();
  const low = queueRaster(async () => { order.push('prefetch'); }, () => 1, signal);
  const stale = queueRaster(async () => { order.push('stale'); }, () => 0, abort.signal).catch(error => error.name);
  const failed = queueRaster(async () => { order.push('visible'); throw new Error('failed page'); }, () => 0, signal).catch(error => error.message);
  abort.abort();
  expect(await stale).toBe('AbortError');
  expect(await failed).toBe('failed page');
  await low;
  expect(order).toEqual(['visible', 'prefetch']);
});
