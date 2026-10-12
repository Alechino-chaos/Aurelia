import { describe, expect, it } from 'vitest';
import type { TextContent, TextItem } from 'pdfjs-dist/types/src/display/api';
import { orderText } from '../src/pdf/readingOrder';
import { buildSearchIndex, findMatches } from '../src/pdf/search';

function item(str: string, x = 40, y = 700, width = 210): TextItem {
  return { str, dir: 'ltr', transform: [10, 0, 0, 10, x, y], width, height: 10, fontName: 'f1', hasEOL: true };
}
const entries = (items: TextItem[]) => orderText({ items, styles: {}, lang: null } as TextContent, 612).entries;
const search = (items: TextItem[], query: string, options = { caseSensitive: false, repairHyphens: false }) =>
  findMatches(buildSearchIndex(entries(items), options), query, 1);

describe('PDF text search with source offsets', () => {
  it('matches a phrase across lines and maps only the matching characters', () => {
    const result = search([item('A Neural', 40, 700), item('network works.', 40, 686)], 'neural network');
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].ranges).toEqual([{ item: 0, start: 2, end: 8 }, { item: 1, start: 0, end: 7 }]);
  });
  it('never joins separate columns or paragraph blocks', () => {
    const items: TextItem[] = [];
    for (let i = 0; i < 4; i++) items.push(item(`Left${i}`, 40, 700 - i * 14), item(`Right${i}`, 330, 700 - i * 14));
    expect(search(items, 'Left3 Right0').matches).toEqual([]);
    expect(search(items, 'Left0 Left1').matches).toHaveLength(1);
    expect(search([item('end'), item('start', 40, 640)], 'end start').matches).toEqual([]);
  });
  it('expands ligatures without losing original offsets or duplicating one glyph', () => {
    expect(search([item('efﬁcient')], 'efficient').matches[0].ranges).toEqual([{ item: 0, start: 0, end: 8 }]);
    expect(search([item('ﬃ')], 'f').matches).toHaveLength(1);
  });
  it('joins Chinese lines, handles spaces and keeps math distinct', () => {
    expect(search([item('表示学习'), item('方法', 40, 686)], '学习方法').matches[0].ranges)
      .toEqual([{ item: 0, start: 2, end: 4 }, { item: 1, start: 0, end: 2 }]);
    expect(search([item('alpha  beta')], ' alpha\t beta ').matches).toHaveLength(1);
    expect(search([item('x² + y₁')], 'x2').matches).toEqual([]);
  });
  it('removes soft hyphens but requires opt-in for visible line-end hyphens', () => {
    expect(search([item('frame\u00ad'), item('work', 40, 686)], 'framework').matches).toHaveLength(1);
    const items = [item('frame-'), item('work', 40, 686)];
    expect(search(items, 'framework').matches).toEqual([]);
    expect(search(items, 'frame-work').matches).toHaveLength(1);
    expect(search(items, 'framework', { caseSensitive: false, repairHyphens: true }).matches).toHaveLength(1);
    expect(search([item('well-known')], 'wellknown', { caseSensitive: false, repairHyphens: true }).matches).toEqual([]);
  });
  it('supports case sensitivity and UTF-16 positions after astral characters', () => {
    expect(search([item('😀 Neural neural')], 'Neural', { caseSensitive: true, repairHyphens: false }).matches[0].ranges)
      .toEqual([{ item: 0, start: 3, end: 9 }]);
    expect(search([item('İ test')], 'test').matches[0].ranges).toEqual([{ item: 0, start: 2, end: 6 }]);
    expect(search([item('Neural neural')], 'neural').matches).toHaveLength(2);
  });
  it('reports truncation only when more matches exist and rejects empty queries', () => {
    const index = buildSearchIndex(entries([item('a a a')]), { caseSensitive: false, repairHyphens: false });
    expect(findMatches(index, 'a', 8, 2)).toMatchObject({ truncated: true, matches: [{ page: 8 }, { page: 8 }] });
    expect(findMatches(index, 'a', 8, 3).truncated).toBe(false);
    expect(findMatches(index, '  ', 8).matches).toEqual([]);
  });
  it('follows source order when requested and preserves separate text-run offsets', () => {
    const original = orderText({ items: [item('Right', 330), item('Left', 40)], styles: {}, lang: null }, 612, false);
    const index = buildSearchIndex(original.entries, { caseSensitive: false, repairHyphens: false });
    const result = findMatches(index, 'right left', 1);
    expect(result.matches[0].ranges).toEqual([{ item: 0, start: 0, end: 5 }, { item: 1, start: 0, end: 4 }]);
    expect(findMatches(index, 'left right', 1).matches).toEqual([]);
  });
});
