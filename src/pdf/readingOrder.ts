import type { TextContent, TextItem } from 'pdfjs-dist/types/src/display/api';

export type LayoutItem = {
  item: TextItem; x: number; y: number; width: number; height: number;
  line: number; block: number; spaceBefore: boolean;
};
type Row = { y: number; height: number; items: LayoutItem[] };
type Run = { left: number; right: number };

/** Reorder the selectable DOM, never the painted PDF. Coordinates are at scale 1.
 * A repeated central gutter is required; full-width rows separate column zones.
 * Rotated/vertical/RTL content falls back to the PDF's own order.
 */
export function orderText(content: TextContent, pageWidth: number, autoColumns = true) {
  const source = content.items.filter((item): item is TextItem => 'str' in item && !!item.str.trim());
  const entries: LayoutItem[] = source.map(item => ({
    item, x: item.transform[4], y: -item.transform[5],
    width: Math.abs(item.width), height: Math.max(1, Math.hypot(item.transform[2], item.transform[3])),
    line: 0, block: 0, spaceBefore: false,
  }));
  if (!autoColumns || entries.some(entry => entry.item.dir !== 'ltr' || Math.abs(entry.item.transform[1]) > 0.5)) {
    let line = 0;
    for (let i = 0; i < entries.length; i++) {
      const previous = entries[i - 1];
      if (previous && (previous.item.hasEOL || Math.abs(previous.y - entries[i].y) > previous.height * .5)) line++;
      entries[i].line = line;
      entries[i].spaceBefore = !!previous && previous.line === line && entries[i].x - previous.x - previous.width > entries[i].height * .12;
    }
    return { entries, columns: 1, content: { ...content, items: entries.map((entry, i) => ({ ...entry.item, hasEOL: entries[i + 1]?.line !== entry.line })) } };
  }

  const rows: Row[] = [];
  for (const entry of [...entries].sort((a, b) => a.y - b.y || a.x - b.x)) {
    // Baseline tolerance also keeps modest superscripts attached to their line.
    const row = rows.slice(-3).find(candidate => Math.abs(candidate.y - entry.y) <= Math.max(candidate.height, entry.height) * .45);
    if (row) { row.items.push(entry); row.height = Math.max(row.height, entry.height); }
    else rows.push({ y: entry.y, height: entry.height, items: [entry] });
  }
  rows.sort((a, b) => a.y - b.y);
  const runs = rows.map(row => {
    row.items.sort((a, b) => a.x - b.x);
    const merged: Run[] = [];
    for (const entry of row.items) {
      const last = merged.at(-1);
      if (last && entry.x - last.right < Math.max(12, row.height * 1.2)) last.right = Math.max(last.right, entry.x + entry.width);
      else merged.push({ left: entry.x, right: entry.x + entry.width });
    }
    return merged;
  });

  const candidates: number[] = [];
  for (const lineRuns of runs) {
    for (let i = 1; i < lineRuns.length; i++) {
      const gap = lineRuns[i].left - lineRuns[i - 1].right;
      const mid = (lineRuns[i].left + lineRuns[i - 1].right) / 2;
      if (gap >= Math.max(18, pageWidth * .025) && mid > pageWidth * .28 && mid < pageWidth * .72) candidates.push(mid);
    }
  }
  let gutter: number | null = null;
  let bestScore = 0;
  for (const candidate of candidates) {
    let support = 0;
    let crossings = 0;
    for (const lineRuns of runs) {
      const crossing = lineRuns.some(run => run.left < candidate && run.right > candidate);
      if (crossing) crossings++;
      else if (lineRuns.some(run => run.right <= candidate) && lineRuns.some(run => run.left >= candidate)) support++;
    }
    const score = support - crossings * .2 - Math.abs(candidate - pageWidth / 2) / pageWidth;
    if (support >= 4 && score > bestScore) { gutter = candidate; bestScore = score; }
  }

  const ordered: LayoutItem[] = [];
  let lineId = 0;
  let blockId = 0;
  const appendRows = (group: Row[], column?: 'left' | 'right') => {
    if (group.length === 0) return;
    let previousY: number | undefined;
    let previousHeight = 0;
    blockId++;
    for (const row of group) {
      const items = row.items.filter(entry => !column || (column === 'left' ? entry.x + entry.width / 2 < gutter! : entry.x + entry.width / 2 >= gutter!));
      if (!items.length) continue;
      if (previousY !== undefined && row.y - previousY > Math.max(row.height, previousHeight) * 1.9) blockId++;
      items.forEach((entry, i) => {
        const previous = items[i - 1];
        entry.line = lineId;
        entry.block = blockId;
        entry.spaceBefore = !!previous && entry.x - previous.x - previous.width > row.height * .12;
        ordered.push(entry);
      });
      lineId++;
      previousY = row.y;
      previousHeight = row.height;
    }
  };
  if (gutter === null) appendRows(rows);
  else {
    let zone: Row[] = [];
    let spanningRows: Row[] = [];
    const flush = () => { appendRows(zone, 'left'); appendRows(zone, 'right'); zone = []; };
    const flushSpanning = () => { appendRows(spanningRows); spanningRows = []; };
    rows.forEach((row, i) => {
      if (runs[i].some(run => run.left < gutter! && run.right > gutter!)) {
        flush();
        spanningRows.push(row);
      } else { flushSpanning(); zone.push(row); }
    });
    flush();
    flushSpanning();
  }
  return {
    entries: ordered, columns: gutter === null ? 1 : 2,
    content: { ...content, items: ordered.map((entry, i) => ({ ...entry.item, hasEOL: ordered[i + 1]?.line !== entry.line })) },
  };
}
