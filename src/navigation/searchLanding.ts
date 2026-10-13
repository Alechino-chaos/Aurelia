import type { SearchMatch } from '../pdf/search';

/** Wait for the requested page's text, without moving the viewport to make it visible. */
export function searchLanding(root: HTMLElement, match: SearchMatch, signal: AbortSignal): Promise<{ page: number; x: number; y: number }> {
  return new Promise((resolve, reject) => {
    let frame = 0, attempts = 0;
    const cleanup = () => { cancelAnimationFrame(frame); signal.removeEventListener('abort', abort); };
    const abort = () => { cleanup(); reject(new Error('已取消')); };
    const measure = () => {
      if (signal.aborted) { abort(); return; }
      const page = root.querySelector<HTMLElement>(`[data-page-number="${match.page}"]`);
      if (page?.dataset.textReady === 'true') {
        const spans = page.querySelectorAll('.textLayer [data-line]'), bounds = page.getBoundingClientRect();
        const source = match.ranges[0], node = spans[source?.item]?.firstChild;
        if (source && node instanceof Text && source.end <= node.length && bounds.width && bounds.height) {
          const range = document.createRange(); range.setStart(node, source.start); range.setEnd(node, source.end);
          const rect = range.getBoundingClientRect(); cleanup();
          resolve({ page: match.page, x: (rect.left - bounds.left) / bounds.width, y: (rect.top - bounds.top) / bounds.height }); return;
        }
      }
      if (++attempts > 600) { cleanup(); reject(new Error('搜索位置暂时无法读取，请重试')); return; }
      frame = requestAnimationFrame(measure);
    };
    // TextLayer updates its metrics during layout; measure the next completed frame.
    signal.addEventListener('abort', abort, { once: true }); frame = requestAnimationFrame(measure);
  });
}
