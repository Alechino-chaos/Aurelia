import { useLayoutEffect, useState } from 'react';
import type { SearchMatch } from '../pdf/search';

type Mark = { id: string; x: number; y: number; width: number; height: number };
export function SearchHighlights({ matches, activeId, pageElement, textHost, scrollRoot, ready, near, scale }: {
  matches: SearchMatch[]; activeId: string | null;
  pageElement: React.RefObject<HTMLDivElement | null>; textHost: React.RefObject<HTMLDivElement | null>;
  scrollRoot: React.RefObject<HTMLDivElement | null>; ready: boolean; near: boolean; scale: number;
}) {
  const [marks, setMarks] = useState<Mark[]>([]);
  useLayoutEffect(() => {
    if (!ready || !near || !matches.length) { setMarks([]); return; }
    // PDF.js updates text metrics in the parent layout effect. Measure on the next frame.
    const frame = requestAnimationFrame(() => {
      const page = pageElement.current, host = textHost.current, root = scrollRoot.current;
      if (!page || !host || !root) return;
      const bounds = page.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const spans = host.querySelectorAll<HTMLElement>('[data-line]');
      const next: Mark[] = [];
      for (const match of matches) for (const source of match.ranges) {
        const node = spans[source.item]?.firstChild;
        if (!(node instanceof Text) || source.end > node.length) continue;
        const range = document.createRange(); range.setStart(node, source.start); range.setEnd(node, source.end);
        for (const rect of range.getClientRects()) {
          const left = Math.max(bounds.left, rect.left), top = Math.max(bounds.top, rect.top);
          const right = Math.min(bounds.right, rect.right), bottom = Math.min(bounds.bottom, rect.bottom);
          if (right <= left || bottom <= top) continue;
          next.push({ id: match.id, x: (left - bounds.left) / bounds.width, y: (top - bounds.top) / bounds.height,
            width: (right - left) / bounds.width, height: (bottom - top) / bounds.height });
        }
      }
      setMarks(next);
    });
    return () => cancelAnimationFrame(frame);
  }, [matches, activeId, ready, near, scale, pageElement, textHost, scrollRoot]);
  return <div className="search-highlights" aria-hidden="true">{marks.map((mark, index) =>
    <span key={`${mark.id}:${index}`} className={`search-highlight${mark.id === activeId ? ' active' : ''}`} data-search-id={mark.id}
      style={{ left: `${mark.x * 100}%`, top: `${mark.y * 100}%`, width: `${mark.width * 100}%`, height: `${mark.height * 100}%` }} />)}</div>;
}
