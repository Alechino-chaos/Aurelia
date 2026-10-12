import type { LayoutItem } from '../pdf/readingOrder';
import { buildSearchIndex, findMatches, MAX_SEARCH_MATCHES, type SearchIndex, type SearchMatch, type SearchOptions } from '../pdf/search';

export type SearchProgress = { matches: SearchMatch[]; processed: number; total: number; failed: number[]; emptyPages: number; truncated: boolean; done: boolean };

export async function scanPages({ total, load, cache, query, options, signal, onProgress }: {
  total: number; load: (page: number) => Promise<LayoutItem[]>; cache: Map<number, SearchIndex>;
  query: string; options: SearchOptions; signal: AbortSignal; onProgress: (state: SearchProgress) => void;
}) {
  const matches: SearchMatch[] = [], failed: number[] = [];
  let emptyPages = 0, truncated = false;
  for (let page = 1; page <= total; page++) {
    if (signal.aborted) return;
    try {
      let index = cache.get(page);
      if (!index) {
        const entries = await load(page);
        if (signal.aborted) return;
        index = buildSearchIndex(entries, options); cache.set(page, index);
      }
      if (!index.segments.some(s => s.text)) emptyPages++;
      const result = findMatches(index, query, page, MAX_SEARCH_MATCHES - matches.length);
      matches.push(...result.matches); truncated ||= result.truncated;
    } catch { if (signal.aborted) return; failed.push(page); }
    if (signal.aborted) return;
    onProgress({ matches: [...matches], processed: page, total, failed: [...failed], emptyPages, truncated, done: page === total || truncated });
    if (truncated) return;
    // Let input, scrolling and page rendering run between extraction/matching jobs.
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}
