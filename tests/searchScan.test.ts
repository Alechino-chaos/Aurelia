import { expect, it } from 'vitest';
import { scanPages } from '../src/search/scanPages';
import type { LayoutItem } from '../src/pdf/readingOrder';
const row = (str: string): LayoutItem[] => [{ item: { str, dir: 'ltr', transform: [10, 0, 0, 10, 0, 0], width: 100, height: 10, fontName: 'f1', hasEOL: false }, x: 0, y: 0, width: 100, height: 10, line: 0, block: 0, spaceBefore: false }];
const options = { caseSensitive: false, repairHyphens: false };
it('keeps partial results and identifies failed and textless pages for retry', async () => {
  let failed = true;
  const cache = new Map();
  const load = async (page: number) => { if (page === 2 && failed) throw new Error('read error'); return page === 3 ? [] : row('needle'); };
  const updates: any[] = [];
  await scanPages({ total: 3, load, cache, query: 'needle', options, signal: new AbortController().signal, onProgress: state => updates.push(state) });
  expect(updates.at(-1)).toMatchObject({ done: true, processed: 3, failed: [2], emptyPages: 1, matches: [{ page: 1 }] });
  failed = false;
  await scanPages({ total: 3, load, cache, query: 'needle', options, signal: new AbortController().signal, onProgress: state => updates.push(state) });
  expect(updates.at(-1)).toMatchObject({ done: true, failed: [], matches: [{ page: 1 }, { page: 2 }] });
});
it('discards a late page after cancellation', async () => {
  const controller = new AbortController(), updates: any[] = [];
  let finish!: (value: LayoutItem[]) => void;
  const task = scanPages({ total: 1, load: () => new Promise(resolve => { finish = resolve; }), cache: new Map(), query: 'needle', options,
    signal: controller.signal, onProgress: state => updates.push(state) });
  controller.abort(); finish(row('needle')); await task;
  expect(updates).toEqual([]);
});

it('enforces the result limit across pages and marks the count incomplete', async () => {
  const updates: any[] = [];
  await scanPages({ total: 3, load: async () => row('a '.repeat(6000)), cache: new Map(), query: 'a', options,
    signal: new AbortController().signal, onProgress: state => updates.push(state) });
  const last = updates.at(-1);
  expect(last.matches).toHaveLength(10000);
  expect(last).toMatchObject({ processed: 2, total: 3, done: true, truncated: true });
});
