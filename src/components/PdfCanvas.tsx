import { useLanguage } from '../i18n/LanguageProvider';
import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PageSize } from '../types';
import { queueRaster, rasterPlan, visibleTiles, ZOOM_SETTLE_MS, type Tile } from '../pdf/raster';

type Props = {
  pdf: PDFDocumentProxy; number: number; size: PageSize; scale: number; dpr: number;
  near: boolean; retry: number;
  scrollRoot: React.RefObject<HTMLDivElement | null>;
  pageElement: React.RefObject<HTMLDivElement | null>;
  onError: (message: string) => void;
};
type Raster = { scale: number; dpr: number; layer: HTMLDivElement; tiles: Map<string, HTMLCanvasElement> };

function release(canvas: HTMLCanvasElement) { canvas.remove(); canvas.width = 0; canvas.height = 0; }
function releaseRaster(raster: Raster) {
  raster.layer.querySelectorAll('canvas').forEach(release);
  raster.layer.remove();
}

export function PdfCanvas({ pdf, number, size, scale, dpr, near, retry, scrollRoot, pageElement, onError }: Props) {
  const { t, display, locale } = useLanguage();
  const host = useRef<HTMLDivElement>(null);
  const current = useRef<Raster | null>(null);
  const [hasImage, setHasImage] = useState(false);
  const [tileKey, setTileKey] = useState('');
  const width = size.width * scale, height = size.height * scale;

  function tilesInView(): Tile[] {
    const plan = rasterPlan(width, height, dpr);
    if (!plan.tiled || !pageElement.current || !scrollRoot.current) return [];
    const page = pageElement.current.getBoundingClientRect();
    const root = scrollRoot.current.getBoundingClientRect();
    return visibleTiles(plan.pixelWidth, plan.pixelHeight, {
      x: (root.left - page.left) * dpr, y: (root.top - page.top) * dpr,
      width: scrollRoot.current.clientWidth * dpr, height: scrollRoot.current.clientHeight * dpr,
    });
  }
  function priority() {
    const page = pageElement.current?.getBoundingClientRect();
    const root = scrollRoot.current?.getBoundingClientRect();
    return page && root && page.bottom > root.top && page.top < root.bottom ? 0 : 1;
  }

  useEffect(() => {
    if (!near) return;
    const root = scrollRoot.current!;
    let frame = 0;
    const measure = () => setTileKey(tilesInView().map(tile => tile.key).join(','));
    const scrolled = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    measure();
    root.addEventListener('scroll', scrolled, { passive: true });
    const observer = new ResizeObserver(scrolled);
    observer.observe(root);
    return () => { cancelAnimationFrame(frame); root.removeEventListener('scroll', scrolled); observer.disconnect(); };
  }, [near, width, height, dpr, scrollRoot]);

  useEffect(() => {
    const element = pageElement.current!;
    if (!near) {
      if (current.current) releaseRaster(current.current);
      current.current = null;
      element.removeAttribute('data-render-scale');
      element.dataset.rasterReady = 'false';
      setHasImage(false);
      return;
    }
    const abort = new AbortController();
    const signal = abort.signal;
    const previous = current.current;
    const reuse = previous?.scale === scale && previous.dpr === dpr;
    const pendingCanvases = new Set<HTMLCanvasElement>();
    element.dataset.rasterReady = 'false';

    async function draw(raster: Raster, ratio: number, tile?: Tile) {
      const canvas = document.createElement('canvas');
      pendingCanvases.add(canvas);
      await queueRaster(async () => {
        const page = await pdf.getPage(number);
        if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        const viewport = page.getViewport({ scale });
        canvas.width = tile?.width ?? Math.ceil(viewport.width * ratio);
        canvas.height = tile?.height ?? Math.ceil(viewport.height * ratio);
        canvas.dataset.pixelRatio = String(ratio);
        canvas.dataset.renderScale = String(scale);
        if (tile) {
          canvas.dataset.tile = tile.key;
          canvas.style.left = `${tile.x / (width * dpr) * 100}%`;
          canvas.style.top = `${tile.y / (height * dpr) * 100}%`;
          canvas.style.width = `${tile.width / (width * dpr) * 100}%`;
          canvas.style.height = `${tile.height / (height * dpr) * 100}%`;
        } else {
          canvas.dataset.preview = 'true';
          canvas.style.width = '100%'; canvas.style.height = '100%';
        }
        const task = page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport,
          transform: [ratio, 0, 0, ratio, -(tile?.x ?? 0), -(tile?.y ?? 0)] });
        const cancel = () => task.cancel();
        signal.addEventListener('abort', cancel, { once: true });
        try { await task.promise; } finally { signal.removeEventListener('abort', cancel); }
      }, priority, signal);
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      raster.layer.append(canvas);
      pendingCanvases.delete(canvas);
      if (tile) raster.tiles.set(tile.key, canvas);
    }

    const delay = previous && !reuse ? ZOOM_SETTLE_MS : 0;
    const timer = window.setTimeout(() => {
      void (async () => {
        const plan = rasterPlan(width, height, dpr);
        const tiles = tilesInView();
        const raster: Raster = reuse ? previous : { scale, dpr, layer: document.createElement('div'), tiles: new Map() };
        raster.layer.className = 'pdf-raster';
        let committed = reuse;
        try {
          if (!reuse) await draw(raster, plan.previewRatio);
          for (const tile of tiles) if (!raster.tiles.has(tile.key)) await draw(raster, dpr, tile);
          if (signal.aborted) return;
          // Keep the previous image until the requested visible area is sharp.
          if (!reuse) {
            host.current!.replaceChildren(raster.layer);
            current.current = raster;
            committed = true;
            if (previous) releaseRaster(previous);
          }
          const keep = new Set(tiles.map(tile => tile.key));
          for (const [key, canvas] of raster.tiles) if (!keep.has(key)) { release(canvas); raster.tiles.delete(key); }
          element.dataset.renderScale = String(scale);
          element.dataset.renderDpr = String(dpr);
          element.dataset.rasterMode = plan.tiled ? 'tiles' : 'full';
          element.dataset.rasterReady = 'true';
          setHasImage(true);
        } finally {
          if (!committed) releaseRaster(raster);
        }
      })().catch(reason => {
        if (!signal.aborted && reason?.name !== 'RenderingCancelledException') {
          console.error('PDF page render failed', number, reason);
          onError('此页渲染失败');
        }
      }).finally(() => pendingCanvases.forEach(release));
    }, delay);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [pdf, number, width, height, scale, dpr, near, retry, tileKey]);

  useEffect(() => () => { if (current.current) releaseRaster(current.current); current.current = null; }, []);

  return <><div ref={host} className="canvas-host" aria-hidden="true" />
    {!hasImage && <div className="page-loading" aria-hidden="true">{near ? t("正在渲染页面…") : t('pages', { pages: number })}</div>}
  </>;
}
