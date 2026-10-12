import { expect, it } from 'vitest';
import { mergeHighlightRegions } from '../src/pdf/highlightGeometry';
import type { HighlightRegion } from '../electron/session-types';

const size = { width: 600, height: 800 };
const rect = (x: number, y: number, width: number, height = 12, page = 1): HighlightRegion =>
  ({ page, x: x / 600, y: y / 800, width: width / 600, height: height / 800 });

it('joins justified word spaces and mixed bold/regular runs into one continuous line', () => {
  const input = [rect(40, 100, 32), rect(80, 99, 50, 13), rect(138, 100, 80)];
  const original = structuredClone(input);
  expect(mergeHighlightRegions(input, size)).toEqual([rect(40, 99, 178, 13)]);
  expect(input).toEqual(original);
});

it('retains partial first/last character boundaries and collapses duplicate rectangles', () => {
  const result = mergeHighlightRegions([rect(43.5, 100, 20), rect(43.5, 100, 20), rect(67, 100, 10.5)], size);
  expect(result).toEqual([rect(43.5, 100, 34)]);
});

it('keeps adjacent lines separate even with overlapping tall glyph boxes', () => {
  expect(mergeHighlightRegions([rect(40, 100, 60), rect(104, 100, 45), rect(40, 110, 60), rect(104, 110, 45)], size))
    .toEqual([rect(40, 100, 109), rect(40, 110, 109)]);
});

it('does not bridge a column gutter or separate pages', () => {
  const input = [rect(40, 100, 250), rect(308, 100, 240), rect(40, 100, 250, 12, 2)];
  expect(mergeHighlightRegions(input, size)).toEqual(input);
  // Large headings must not create correspondingly large space-filling thresholds.
  expect(mergeHighlightRegions([rect(40, 100, 250, 30), rect(308, 100, 240, 30)], size)).toHaveLength(2);
});

it('accounts for unequal page dimensions and is invariant to display scale', () => {
  const input = [rect(40, 100, 40), rect(89, 100, 50)];
  const result = mergeHighlightRegions(input, size);
  expect(result).toHaveLength(1);
  expect(mergeHighlightRegions(input, { width: 1200, height: 1600 })).toEqual(result);
});

it('joins rotated word runs along their reading axis without joining neighboring lines', () => {
  const input = [rect(40, 100, 32), rect(80, 100, 50), rect(40, 115, 50)];
  const rotate = (r: HighlightRegion): HighlightRegion => ({ page: r.page, x: 1 - r.y - r.height, y: r.x, width: r.height, height: r.width });
  const result = mergeHighlightRegions(input.map(rotate), { width: 800, height: 600, rotation: 90 });
  expect(result).toHaveLength(2);
  expect(result.map(r => r.height).sort()).toEqual([50 / 600, 90 / 600]);
});

it('handles empty selections', () => expect(mergeHighlightRegions([], size)).toEqual([]));
