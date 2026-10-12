import type { SelectedText } from '../types';
import type { HighlightRegion } from '../../electron/session-types';

/** No NFKC: it can change mathematical symbols, superscripts, and subscripts. */
export function cleanText(raw: string, repairHyphens = false): string {
  const ligatures: Record<string, string> = { 'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st' };
  let value = raw.replace(/\r\n?/g, '\n').replace(/[ﬀﬁﬂﬃﬄﬅﬆ]/g, char => ligatures[char]);
  value = value.replace(/\u00ad[ \t]*\n[ \t]*/g, '').replace(/\u00ad/g, '').replace(/\u00a0/g, ' ');
  if (repairHyphens) value = value.replace(/([a-zA-Z])-[ \t]*\n(?!\n)[ \t]*([a-z])/g, '$1$2');
  // Keep visible hyphens by default: "state-\nof-the-art" must retain its hyphen.
  value = value.replace(/-[ \t]*\n(?!\n)[ \t]*/g, '-');
  return value.split(/\n[ \t]*\n+/).map(paragraph => paragraph
    .replace(/([\p{Script=Han}])[ \t]*\n[ \t]*(?=[\p{Script=Han}])/gu, '$1')
    .replace(/\n/g, ' ').replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n\n');
}

export function readSelection(root: HTMLElement, repairHyphens = false): SelectedText | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  // Never intercept copying from the inspector, inputs, or other application UI.
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  // A whitespace endpoint can be a child offset on the text layer itself.
  const textLayerOf = (node: Node) => (node instanceof Element ? node : node.parentElement)?.closest('.textLayer');
  if (!textLayerOf(range.startContainer) || !textLayerOf(range.endContainer)) return null;
  let raw = '';
  let previous: { page: string; line: string; block: string } | null = null;
  const pages = new Set<number>();
  const regions: HighlightRegion[] = [];
  for (const span of root.querySelectorAll<HTMLElement>('.textLayer [data-line]')) {
    if (!range.intersectsNode(span)) continue;
    const part = document.createRange();
    part.selectNodeContents(span);
    if (range.compareBoundaryPoints(Range.START_TO_START, part) > 0) part.setStart(range.startContainer, range.startOffset);
    if (range.compareBoundaryPoints(Range.END_TO_END, part) < 0) part.setEnd(range.endContainer, range.endOffset);
    const text = part.toString();
    if (!text) continue;
    const page = span.closest<HTMLElement>('[data-page-number]')!.dataset.pageNumber!;
    const bounds = span.closest<HTMLElement>('.pdf-page')!.getBoundingClientRect();
    // Measure only the selected character range in each text span: the whole
    // browser range can include container rectangles spanning both columns.
    for (const rect of part.getClientRects()) {
      const left = Math.max(bounds.left, rect.left), top = Math.max(bounds.top, rect.top);
      const right = Math.min(bounds.right, rect.right), bottom = Math.min(bounds.bottom, rect.bottom);
      if (right - left < .1 || bottom - top < .1 || !bounds.width || !bounds.height) continue;
      regions.push({ page: Number(page), x: (left - bounds.left) / bounds.width, y: (top - bounds.top) / bounds.height,
        width: (right - left) / bounds.width, height: (bottom - top) / bounds.height });
    }
    const line = span.dataset.line!;
    const block = span.dataset.block!;
    if (previous) {
      if (previous.page !== page || previous.block !== block) raw += '\n\n';
      else if (previous.line !== line) raw += '\n';
      else if (span.dataset.spaceBefore === 'true' && !/\s$/.test(raw) && !/^\s/.test(text)) raw += ' ';
    }
    raw += text;
    pages.add(Number(page));
    previous = { page, line, block };
  }
  if (!raw.trim()) return null;
  const rects = range.getClientRects();
  const rect = Array.from(rects).find(rect => rect.width > 0 && rect.bottom >= root.getBoundingClientRect().top) ?? range.getBoundingClientRect();
  return { raw, clean: cleanText(raw, repairHyphens), pages: [...pages], regions, rect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right } };
}
