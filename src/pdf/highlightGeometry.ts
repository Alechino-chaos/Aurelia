import type { HighlightRegion } from '../../electron/session-types';
import type { PageSize } from '../types';

/** Paint a continuous strip through word spaces, retaining the original anchors on disk. */
export function mergeHighlightRegions(regions: HighlightRegion[], size: PageSize): HighlightRegion[] {
  // Work in page units: normalized X and Y have different scales. A quarter-turn
  // swaps the reading and line axes, so vertical displayed lines use the same rules.
  const vertical = Math.abs(size.rotation ?? 0) % 180 === 90;
  const width = vertical ? size.height : size.width, height = vertical ? size.width : size.height;
  const boxes = regions.map(r => ({ page: r.page,
    x: (vertical ? r.y : r.x) * width, y: (vertical ? r.x : r.y) * height,
    width: (vertical ? r.height : r.width) * width, height: (vertical ? r.width : r.height) * height,
  })).sort((a, b) => a.page - b.page || a.y + a.height / 2 - b.y - b.height / 2 || a.x - b.x);
  const lines: { anchor: typeof boxes[number]; boxes: typeof boxes }[] = [];
  for (const box of boxes) {
    const line = lines.find(({ anchor }) => anchor.page === box.page
      && Math.abs(anchor.y + anchor.height / 2 - box.y - box.height / 2) <= Math.max(anchor.height, box.height) * .35
      && Math.min(anchor.y + anchor.height, box.y + box.height) - Math.max(anchor.y, box.y) >= Math.min(anchor.height, box.height) * .6);
    if (line) line.boxes.push(box);
    else lines.push({ anchor: box, boxes: [box] });
  }
  const merged: typeof boxes = [];
  for (const line of lines) {
    line.boxes.sort((a, b) => a.x - b.x);
    let current: typeof boxes[number] | undefined;
    for (const box of line.boxes) {
      // Bound gap filling by both the font height and page width. This fills
      // justified word spaces without painting across ordinary column gutters.
      const maxGap = Math.min(Math.min(current?.height ?? box.height, box.height) * .85, width * .022);
      if (current && box.x - current.x - current.width <= maxGap) {
        const right = Math.max(current.x + current.width, box.x + box.width);
        const bottom = Math.max(current.y + current.height, box.y + box.height);
        current.y = Math.min(current.y, box.y);
        current.width = right - current.x; current.height = bottom - current.y;
      } else { current = { ...box }; merged.push(current); }
    }
  }
  return merged.map(r => vertical
    ? { page: r.page, x: r.y / height, y: r.x / width, width: r.height / height, height: r.width / width }
    : { page: r.page, x: r.x / width, y: r.y / height, width: r.width / width, height: r.height / height });
}
