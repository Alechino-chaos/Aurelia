import type { LayoutItem } from './readingOrder';

export type SearchOptions = { caseSensitive: boolean; repairHyphens: boolean };
export type TextRange = { item: number; start: number; end: number };
export type SearchMatch = { id: string; page: number; ranges: TextRange[] };
type Segment = { text: string; items: Int32Array; starts: Uint32Array; ends: Uint32Array };
export type SearchIndex = { segments: Segment[]; options: SearchOptions };
export const MAX_SEARCH_MATCHES = 10_000;
const ligatures: Record<string, string> = { 'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st' };

/** Map each normalized UTF-16 unit back to a full original code point. No NFKC. */
function normalize(raw: string, sourceItems: number[], sourceOffsets: number[], options: SearchOptions): Segment {
  const skip = new Uint8Array(raw.length);
  const omit = (pattern: RegExp, keepPrefix = 0) => {
    for (const match of raw.matchAll(pattern)) skip.fill(1, match.index! + keepPrefix, match.index! + match[0].length);
  };
  omit(/\u00ad[ \t]*\n[ \t]*/g);
  if (options.repairHyphens) omit(/(?<=[a-zA-Z])-[ \t]*\n[ \t]*(?=[a-z])/g);
  omit(/-[ \t]*\n[ \t]*/g, 1);
  omit(/(?<=\p{Script=Han})[ \t]*\n[ \t]*(?=\p{Script=Han})/gu);
  const chars: string[] = [], items: number[] = [], starts: number[] = [], ends: number[] = [];
  let offset = 0, previousSpace = true;
  for (const point of raw) {
    const start = offset; offset += point.length;
    if (skip[start] || point === '\u00ad') continue;
    const space = /\s/u.test(point);
    if (space && previousSpace) continue;
    let value = space ? ' ' : ligatures[point] ?? point;
    if (!options.caseSensitive) value = value.toLowerCase();
    chars.push(value);
    for (let i = 0; i < value.length; i++) {
      items.push(sourceItems[start] ?? -1);
      starts.push(sourceOffsets[start] ?? 0);
      ends.push((sourceOffsets[start] ?? 0) + point.length);
    }
    previousSpace = space;
  }
  if (previousSpace && chars.length) { chars.pop(); items.pop(); starts.pop(); ends.pop(); }
  return { text: chars.join(''), items: Int32Array.from(items), starts: Uint32Array.from(starts), ends: Uint32Array.from(ends) };
}

export function buildSearchIndex(entries: LayoutItem[], options: SearchOptions): SearchIndex {
  const segments: Segment[] = [];
  let raw: string[] = [], items: number[] = [], offsets: number[] = [];
  const flush = () => {
    if (raw.length) segments.push(normalize(raw.join(''), items, offsets, options));
    raw = []; items = []; offsets = [];
  };
  entries.forEach((entry, index) => {
    const previous = entries[index - 1];
    if (previous && previous.block !== entry.block) flush();
    else if (previous && (previous.line !== entry.line || entry.spaceBefore)) {
      raw.push(previous.line !== entry.line ? '\n' : ' '); items.push(-1); offsets.push(0);
    }
    raw.push(entry.item.str);
    for (let i = 0; i < entry.item.str.length; i++) { items.push(index); offsets.push(i); }
  });
  flush();
  return { segments, options: { ...options } };
}

export function findMatches(index: SearchIndex, query: string, page: number, limit = MAX_SEARCH_MATCHES) {
  const needle = normalize(query, [], [], index.options).text;
  const matches: SearchMatch[] = [], seen = new Set<string>();
  if (!needle) return { matches, truncated: false };
  for (const segment of index.segments) {
    let cursor = 0;
    while (cursor <= segment.text.length - needle.length) {
      const start = segment.text.indexOf(needle, cursor);
      if (start < 0) break;
      cursor = start + needle.length;
      const ranges: TextRange[] = [];
      for (let i = start; i < cursor; i++) {
        const item = segment.items[i];
        if (item < 0) continue;
        const last = ranges.at(-1);
        if (last?.item === item) last.end = Math.max(last.end, segment.ends[i]);
        else ranges.push({ item, start: segment.starts[i], end: segment.ends[i] });
      }
      if (!ranges.length) continue;
      const id = `${page}:${ranges.map(r => `${r.item}:${r.start}:${r.end}`).join(';')}`;
      if (seen.has(id)) continue;
      if (matches.length >= limit) return { matches, truncated: true };
      seen.add(id); matches.push({ id, page, ranges });
    }
  }
  return { matches, truncated: false };
}
