import { useEffect, useRef, useState } from 'react';
import { getUiLocale, type UiLocale } from '../../electron/i18n';
import { uiText } from '../../electron/i18n-renderer';
import { useLanguage } from '../i18n/LanguageProvider';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { classifyNativeLink, nativeLinkRect, type NativeLinkRect, type NativeLinkTarget } from '../navigation/links';

type Link = { id: string; rect: NativeLinkRect; target: NativeLinkTarget };
const actionLabels = { GoBack: '后退', GoForward: '前进', NextPage: '下一页', PrevPage: '上一页', FirstPage: '第一页', LastPage: '最后一页' } as const;
export function linkLabel(target: NativeLinkTarget, locale: UiLocale = getUiLocale()) {
  return target.kind === 'external' ? uiText('webLink', { url: target.url }, locale) : target.kind === 'destination'
    ? uiText('destinationLink', { destination: typeof target.destination === 'string' ? target.destination : uiText('文档位置', {}, locale) }, locale)
    : target.kind === 'action' ? uiText('actionLink', { action: uiText(actionLabels[target.action], {}, locale) }, locale) : uiText('不支持的 PDF 链接', {}, locale);
}
export function PdfLinkLayer({ pdf, number, visited, pageElement, onLink }: {
  pdf: PDFDocumentProxy; number: number; visited: boolean; pageElement: React.RefObject<HTMLDivElement | null>;
  onLink(target: NativeLinkTarget): void;
}) {
  const { locale, t } = useLanguage();
  const localeRef = useRef(locale); localeRef.current = locale;
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
        if (target && rect) next.push({ id: annotation.id, rect, target });
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
      page.title = link ? linkLabel(link.target, localeRef.current) : '';
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
  useEffect(() => { const link = links.find(item => item.id === hover); if (pageElement.current) pageElement.current.title = link ? linkLabel(link.target, locale) : ''; }, [locale, hover, links, pageElement]);
  return <div className="native-link-layer">{links.map(link => <button key={link.id} className={`native-pdf-link${hover === link.id ? ' hovered' : ''}`}
    aria-label={linkLabel(link.target, locale)} title={linkLabel(link.target, locale)} style={{ left: `${link.rect.x * 100}%`, top: `${link.rect.y * 100}%`, width: `${link.rect.width * 100}%`, height: `${link.rect.height * 100}%` }}
    onClick={event => { if (event.detail === 0) onLink(link.target); }} />)}
    {failed && <button className="native-link-retry" onClick={() => { setFailed(false); setRetry(value => value + 1); }}>{t('链接加载失败 · 重试')}</button>}
  </div>;
}
