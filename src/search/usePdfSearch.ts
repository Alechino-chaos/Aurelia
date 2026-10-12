import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { getPageText } from '../pdf/documentText';
import type { SearchIndex, SearchMatch } from '../pdf/search';
import { scanPages, type SearchProgress } from './scanPages';

export type SearchNavigation = { match: SearchMatch; serial: number };
export type SearchMemory = { open: boolean; query: string; caseSensitive: boolean; repairHyphens: boolean };
const noMatches: SearchMatch[] = [];

export function usePdfSearch(pdf: PDFDocumentProxy | null, autoColumns: boolean, initial?: SearchMemory) {
  const [open, setOpen] = useState(initial?.open ?? false), [query, setQuery] = useState(initial?.query ?? '');
  const [caseSensitive, setCaseSensitive] = useState(initial?.caseSensitive ?? false), [repairHyphens, setRepairHyphens] = useState(initial?.repairHyphens ?? false);
  const [composing, setComposing] = useState(false), [focusVersion, setFocusVersion] = useState(0), [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ key: string; pdf: PDFDocumentProxy; progress: SearchProgress } | null>(null);
  const [selection, setSelection] = useState<{ key: string; pdf: PDFDocumentProxy; navigation: SearchNavigation } | null>(null);
  const [notice, setNotice] = useState('');
  const serial = useRef(0);
  const key = JSON.stringify([query.trim(), autoColumns, caseSensitive, repairHyphens, retry]);
  const latest = useRef({ key, pdf, open, composing }); latest.current = { key, pdf, open, composing };
  // Retain only the current normalization/order variant; text extraction is shared separately.
  const cache = useMemo(() => new Map<number, SearchIndex>(), [pdf, autoColumns, caseSensitive, repairHyphens]);
  const progress = result?.pdf === pdf && result.key === key ? result.progress : null;
  const matches = progress?.matches ?? noMatches;
  const navigation = open && selection?.pdf === pdf && selection.key === key ? selection.navigation : null;
  const activeId = navigation?.match.id ?? null;
  const current = matches.findIndex(match => match.id === activeId);
  const busy = !!query.trim() && (!progress || !progress.done);
  const byPage = useMemo(() => {
    const pages = new Map<number, SearchMatch[]>();
    if (open) for (const match of matches) { const list = pages.get(match.page) ?? []; list.push(match); pages.set(match.page, list); }
    return pages;
  }, [matches, open]);

  const previousPdf = useRef(pdf);
  useEffect(() => {
    if (previousPdf.current === pdf) return;
    previousPdf.current = pdf;
    setOpen(false); setQuery(''); setResult(null); setSelection(null); setNotice(''); setComposing(false);
  }, [pdf]);

  useEffect(() => {
    setSelection(null); setNotice('');
    if (!pdf || !open || !query.trim() || composing) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void scanPages({ total: pdf.numPages, load: async page => (await getPageText(pdf, page, autoColumns)).entries,
        cache, query, options: { caseSensitive, repairHyphens }, signal: controller.signal,
        onProgress: progress => {
          if (!controller.signal.aborted && latest.current.pdf === pdf && latest.current.key === key && latest.current.open)
            setResult({ key, pdf, progress });
        },
      });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [pdf, open, query, autoColumns, caseSensitive, repairHyphens, composing, retry, cache, key]);

  const show = useCallback(() => { if (pdf) { setOpen(true); setFocusVersion(value => value + 1); } }, [pdf]);
  const close = useCallback(() => { setOpen(false); setComposing(false); setNotice(''); }, []);
  function move(direction: 1 | -1, page: number) {
    if (!pdf || composing) return;
    if (!matches.length) { if (busy) setNotice('正在搜索，请稍候…'); return; }
    let index = current < 0
      ? direction === 1 ? matches.findIndex(match => match.page >= page) : matches.reduce((last, match, i) => match.page <= page ? i : last, -1)
      : current + direction;
    // A later page may still contain a closer result. Do not wrap prematurely.
    if (busy && (index < 0 || index >= matches.length || direction === -1 && current < 0 && (progress?.processed ?? 0) < page)) {
      setNotice('正在搜索其余页面，请稍候…'); return;
    }
    let wrapped = '';
    if (index < 0 || index >= matches.length) {
      index = direction === 1 ? 0 : matches.length - 1;
      wrapped = direction === 1 ? '已回到搜索结果开头' : '已回到搜索结果末尾';
    }
    setNotice(wrapped);
    setSelection({ key, pdf, navigation: { match: matches[index], serial: ++serial.current } });
  }
  let status = '输入关键词搜索全文';
  if (query.trim()) {
    if (composing) status = '正在输入…';
    else if (busy) status = `正在搜索 ${progress?.processed ?? 0} / ${pdf?.numPages ?? 0} 页 · ${matches.length} 处匹配`;
    else if (matches.length) status = current >= 0 ? `${current + 1} / ${matches.length}` : `${matches.length} 处匹配`;
    else status = progress?.emptyPages === pdf?.numPages ? '这篇文档没有可搜索文本' : progress?.failed.length ? '已搜索页面未找到匹配' : '未找到匹配';
  }
  return { open, query, setQuery, caseSensitive, setCaseSensitive, repairHyphens, setRepairHyphens,
    composing, setComposing, focusVersion, show, close, move, status, notice, busy, progress, byPage, activeId, navigation,
    retry: () => { setResult(null); setRetry(value => value + 1); } };
}
export type PdfSearchController = ReturnType<typeof usePdfSearch>;
