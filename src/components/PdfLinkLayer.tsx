import { useEffect, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { classifyNativeLink, nativeLinkRect, type NativeLinkRect, type NativeLinkTarget } from '../navigation/links';

type Link = { id: string; rect: NativeLinkRect; target: NativeLinkTarget; label: string };
const actionLabels = { GoBack: '后退', GoForward: '前进', NextPage: '下一页', PrevPage: '上一页', FirstPage: '第一页', LastPage: '最后一页' };
export function linkLabel(target: NativeLinkTarget) {
  return target.kind === 'external' ? `打开网页 ${target.url}` : target.kind === 'destination'
    ? `跳转到 ${typeof target.destination === 'string' ? target.destination : '文档位置'}`
    : target.kind === 'action' ? `PDF 链接：${actionLabels[target.action]}` : '不支持的 PDF 链接';
}
export function PdfLinkLayer({ pdf, number, visited, pageElement, onLink }: {
  pdf: PDFDocumentProxy; number: number; visited: boolean; pageElement: React.RefObject<HTMLDivElement | null>;
  onLink(target: NativeLinkTarget): void;
}) {
  const [links, setLinks] = useState<Link[]>([]), [failed, setFailed] = useState(false), [retry, setRetry] = useState(0), [hover, setHover] = useState<string | null>(null);
  useEffect(() => {
    if (!visited) return;
    let disposed = false;
    void (async () => {
      const page = await pdf.getPage(number), viewport = page.getViewport({ scale: 1 });
      const annotations = await page.getAnnotations({ intent: 'display' });
      const next: Link[] = [];
      for (const annotation of annotations) {
        const target = classifyNativeLink(annotation), rect = nativeLinkRect(annotation.rect, viewport);
        if (target && rect) next.push({ id: annotation.id, rect, target, label: linkLabel(target) });
      }
      if (!disposed) { setLinks(next); setFailed(false); }
    })().catch(() => { if (!disposed) setFailed(true); });
    return () => { disposed = true; };
  }, [pdf, number, visited, retry]);
  useEffect(() => {
    const page = pageElement.current; if (!page) return;
    let press: { x: number; y: number; id: string; moved: boolean; selected: boolean } | null = null;
    const hit = (event: PointerEvent) => {
      const bounds = page.getBoundingClientRect(), x = (event.clientX - bounds.left) / bounds.width, y = (event.clientY - bounds.top) / bounds.height;
      return links.find(link => x >= link.rect.x && x <= link.rect.x + link.rect.width && y >= link.rect.y && y <= link.rect.y + link.rect.height);
    };
    const down = (event: PointerEvent) => {
      const link = hit(event);
      press = event.button === 0 && link ? { x: event.clientX, y: event.clientY, id: link.id, moved: false, selected: !window.getSelection()?.isCollapsed } : null;
    };
    const move = (event: PointerEvent) => {
      if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 4) press.moved = true;
      const link = hit(event); setHover(link?.id ?? null); page.style.cursor = link ? 'pointer' : '';
      page.title = link?.label ?? '';
    };
    const up = (event: PointerEvent) => {
      const started = press; press = null;
      if (!started || started.moved || started.selected || !window.getSelection()?.isCollapsed) return;
      const link = hit(event); if (link?.id === started.id) onLink(link.target);
    };
    const leave = () => { setHover(null); page.style.cursor = ''; page.title = ''; };
    const cancel = () => { press = null; };
    page.addEventListener('pointerdown', down); page.addEventListener('pointermove', move);
    page.addEventListener('pointerleave', leave); document.addEventListener('pointerup', up); document.addEventListener('pointercancel', cancel);
    return () => { page.removeEventListener('pointerdown', down); page.removeEventListener('pointermove', move); page.removeEventListener('pointerleave', leave);
      document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', cancel); leave(); };
  }, [links, pageElement, onLink]);
  return <div className="native-link-layer">{links.map(link => <button key={link.id} className={`native-pdf-link${hover === link.id ? ' hovered' : ''}`}
    aria-label={link.label} title={link.label} style={{ left: `${link.rect.x * 100}%`, top: `${link.rect.y * 100}%`, width: `${link.rect.width * 100}%`, height: `${link.rect.height * 100}%` }}
    onClick={event => { if (event.detail === 0) onLink(link.target); }} />)}
    {failed && <button className="native-link-retry" onClick={() => { setFailed(false); setRetry(value => value + 1); }}>链接加载失败 · 重试</button>}
  </div>;
}
