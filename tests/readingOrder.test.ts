import { describe, expect, it } from 'vitest';
import type { TextContent, TextItem } from 'pdfjs-dist/types/src/display/api';
import { orderText } from '../src/pdf/readingOrder';
import { cleanText } from '../src/pdf/selection';

function item(str: string, x: number, y: number, width = 210): TextItem {
  return { str, dir: 'ltr', transform: [10, 0, 0, 10, x, y], width, height: 10, fontName: 'f1', hasEOL: true };
}
function content(items: TextItem[]): TextContent { return { items, styles: {}, lang: null }; }

describe('academic reading order', () => {
  it('keeps a full-width heading before complete columns, despite interleaved source commands', () => {
    const items = [item('A FULL WIDTH HEADING', 50, 760, 510)];
    for (let i = 0; i < 6; i++) items.push(item(`L${i}`, 50, 700 - i * 14), item(`R${i}`, 330, 700 - i * 14));
    const result = orderText(content(items), 612);
    expect(result.columns).toBe(2);
    expect(result.entries.map(entry => entry.item.str)).toEqual(['A FULL WIDTH HEADING', 'L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'R0', 'R1', 'R2', 'R3', 'R4', 'R5']);
  });
  it('restarts columns below a spanning section heading', () => {
    const items: TextItem[] = [];
    for (let i = 0; i < 4; i++) items.push(item(`A${i}`, 50, 700 - i * 14), item(`B${i}`, 330, 700 - i * 14));
    items.push(item('SPANNING', 50, 620, 510));
    for (let i = 0; i < 4; i++) items.push(item(`C${i}`, 50, 590 - i * 14), item(`D${i}`, 330, 590 - i * 14));
    expect(orderText(content(items), 612).entries.map(entry => entry.item.str)).toEqual(['A0', 'A1', 'A2', 'A3', 'B0', 'B1', 'B2', 'B3', 'SPANNING', 'C0', 'C1', 'C2', 'C3', 'D0', 'D1', 'D2', 'D3']);
  });
  it('does not infer columns from a single large word gap', () => {
    const result = orderText(content([item('Left label', 50, 700, 90), item('Right label', 340, 700, 100), item('Normal full-width body.', 50, 680, 500)]), 612);
    expect(result.columns).toBe(1);
  });
  it('preserves source order on request', () => {
    const input = content([item('Right', 330, 700), item('Left', 50, 700)]);
    expect(orderText(input, 612, false).entries.map(entry => entry.item.str)).toEqual(['Right', 'Left']);
  });
  it('marks real paragraph gaps without splitting wrapped lines', () => {
    const result = orderText(content([item('One', 50, 700), item('two', 50, 686), item('Paragraph', 50, 650)]), 612);
    expect(result.entries[0].block).toBe(result.entries[1].block);
    expect(result.entries[2].block).not.toBe(result.entries[1].block);
  });
});

describe('conservative copying', () => {
  it('joins wrapped lines and preserves paragraph boundaries', () => {
    expect(cleanText('A sentence\nacross lines.\n\nNext paragraph.')).toBe('A sentence across lines.\n\nNext paragraph.');
  });
  it('keeps meaningful visible hyphens by default', () => {
    expect(cleanText('state-\nof-the-art')).toBe('state-of-the-art');
    expect(cleanText('frame-\nwork')).toBe('frame-work');
  });
  it('requires opt-in to remove visible end-of-line hyphens', () => {
    expect(cleanText('frame-\nwork', true)).toBe('framework');
    expect(cleanText('well-known', true)).toBe('well-known');
  });
  it('removes soft hyphens and expands ligatures without corrupting math', () => {
    expect(cleanText('efﬁcient frame\u00ad\nwork: x² + y₁ ≠ α')).toBe('efficient framework: x² + y₁ ≠ α');
  });
  it('joins Chinese lines without introducing an extra space', () => {
    expect(cleanText('表示学习\n方法。')).toBe('表示学习方法。');
  });
});
