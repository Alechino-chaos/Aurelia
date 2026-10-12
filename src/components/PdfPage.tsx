import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { TextLayer, type PDFDocumentProxy, type PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { TextContent } from 'pdfjs-dist/types/src/display/api';
import { orderText } from '../pdf/readingOrder';
import { guardTextSelection } from '../pdf/selectionGuard';
import type { PageSize } from '../types';
import { PdfCanvas } from './PdfCanvas';
import { AnnotationLayer } from './AnnotationLayer';
import type { Annotation } from '../../electron/session-types';

type Props = {
  pdf: PDFDocumentProxy; number: number; size: PageSize; scale: number; dpr: number;
  autoColumns: boolean; scrollRoot: React.RefObject<HTMLDivElement | null>;
  annotations: Annotation[]; activeAnnotationId: string | null; onAnnotationSelect: (id: string) => void;
};

export function PdfPage({ pdf, number, size, scale, dpr, autoColumns, scrollRoot, annotations, activeAnnotationId, onAnnotationSelect }: Props) {
  const pageElement = useRef<HTMLDivElement>(null);
  const textHost = useRef<HTMLDivElement>(null);
  const textContent = useRef<Promise<TextContent> | null>(null);
  const activeText = useRef<{ layer: TextLayer; container: HTMLDivElement; page: PDFPageProxy } | null>(null);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const [near, setNear] = useState(number <= 2);
  const [visited, setVisited] = useState(number <= 2);
  const [textReady, setTextReady] = useState(false);
  const [empty, setEmpty] = useState(false);
  const [columns, setColumns] = useState(1);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      // Rapid zooming can queue multiple visibility changes for this page.
      const entry = entries[entries.length - 1];
      setNear(entry.isIntersecting);
      if (entry.isIntersecting) setVisited(true);
    }, { root: scrollRoot.current, rootMargin: '400px 0px' });
    observer.observe(pageElement.current!);
    return () => observer.disconnect();
  }, [scrollRoot]);

  useLayoutEffect(() => {
    const active = activeText.current;
    if (!active) return;
    active.container.style.setProperty('--total-scale-factor', String(scale * active.page.userUnit));
    if (near) active.layer.update({ viewport: active.page.getViewport({ scale }) });
  }, [scale, dpr, near, textReady]);

  useEffect(() => {
    if (!visited) return;
    let disposed = false;
    let layer: TextLayer | undefined;
    let releaseSelectionGuard: (() => void) | undefined;
    const host = textHost.current!;
    const container = document.createElement('div');
    container.className = 'textLayer';
    setTextReady(false);
    host.replaceChildren();
    void (async () => {
      const page = await pdf.getPage(number);
      textContent.current ??= page.getTextContent({ disableNormalization: true });
      const content = await textContent.current;
      if (disposed) return;
      const ordered = orderText(content, page.view[2] - page.view[0], autoColumns && page.rotate === 0);
      // Keep the same spans and reading order during zoom. PDF.js can update
      // their metrics without extracting, sorting or rebuilding the text DOM.
      const viewport = page.getViewport({ scale: scaleRef.current });
      container.style.setProperty('--total-scale-factor', String(scaleRef.current * page.userUnit));
      layer = new TextLayer({ textContentSource: ordered.content, container, viewport });
      host.replaceChildren(container);
      await layer.render();
      if (disposed) return;
      layer.textDivs.forEach((span, i) => {
        const entry = ordered.entries[i];
        span.dataset.line = String(entry.line);
        span.dataset.block = String(entry.block);
        span.dataset.spaceBefore = String(entry.spaceBefore);
      });
      releaseSelectionGuard = guardTextSelection(container);
      activeText.current = { layer, container, page };
      setEmpty(ordered.entries.length === 0);
      setColumns(ordered.columns);
      setTextReady(true);
    })().catch(reason => {
      if (!disposed && reason?.name !== 'AbortException') { textContent.current = null; setError('此页文本层加载失败'); }
    });
    return () => { disposed = true; activeText.current = null; releaseSelectionGuard?.(); layer?.cancel(); container.remove(); };
  }, [pdf, number, visited, autoColumns, retry]);

  return <section className="page-shell" aria-label={`第 ${number} 页`}>
    <div className="page-caption"><span>{String(number).padStart(2, '0')}</span><span>{autoColumns && columns === 2 ? '双栏阅读顺序' : 'PDF 文本层'}</span></div>
    <div ref={pageElement} className="pdf-page" data-page-number={number} data-text-ready={textReady} data-text-scale={textReady ? scale : undefined}
      style={{ width: size.width * scale, height: size.height * scale, '--scale-factor': scale, '--total-scale-factor': scale, '--user-unit': 1 } as CSSProperties}>
      <PdfCanvas pdf={pdf} number={number} size={size} scale={scale} dpr={dpr} near={near} retry={retry} scrollRoot={scrollRoot} pageElement={pageElement} onError={setError} />
      <AnnotationLayer annotations={annotations} page={number} size={size} activeId={activeAnnotationId} onSelect={onAnnotationSelect} />
      <div ref={textHost} className="text-host" />
      {error && <div className="page-error">{error}<button onClick={() => { setError(''); setRetry(value => value + 1); }}>重试</button></div>}
      {empty && textReady && <div className="scan-notice">此页没有可选文本；扫描件的 OCR 将在后续版本支持。</div>}
    </div>
  </section>;
}
