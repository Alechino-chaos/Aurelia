import { useLanguage } from '../i18n/LanguageProvider';
import { useEffect, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { classifyNativeLink, type NativeLinkTarget } from '../navigation/links';

type Outline = NonNullable<Awaited<ReturnType<PDFDocumentProxy['getOutline']>>>;
export function DocumentOutline({ pdf, onLink }: { pdf: PDFDocumentProxy | null; onLink(target: NativeLinkTarget): void }) {
  const { t, display, locale } = useLanguage();
  const [outline, setOutline] = useState<Outline | null>(null), [failed, setFailed] = useState(false), [retry, setRetry] = useState(0);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set()), [active, setActive] = useState('');
  useEffect(() => {
    let disposed = false; setOutline(null); setFailed(false); setCollapsed(new Set()); setActive('');
    if (pdf) void pdf.getOutline().then(items => { if (!disposed) setOutline(items ?? []); }).catch(() => { if (!disposed) setFailed(true); });
    return () => { disposed = true; };
  }, [pdf, retry]);
  const entries = (items: Outline, parent = '', depth = 0): React.ReactNode => items.map((entry, index) => {
    const key = `${parent}/${index}`, open = !collapsed.has(key), title = entry.title || t("未命名章节");
    return <li key={key}><div className={`outline-row${active === key ? ' current' : ''}`} style={{ paddingLeft: 6 + Math.min(depth, 12) * 12 }}>
      {entry.items.length ? <button className="outline-expand" aria-label={t(open ? 'collapseOutline' : 'expandOutline', { title })} aria-expanded={open}
        onClick={() => setCollapsed(previous => { const next = new Set(previous); if (next.has(key)) next.delete(key); else next.add(key); return next; })}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button> : <span className="outline-indent" />}
      <button className="outline-entry" title={title} aria-current={active === key ? 'location' : undefined} onClick={() => {
        setActive(key); onLink(classifyNativeLink({ ...entry, subtype: 'Link' }) ?? { kind: 'unsupported' });
      }}>{title}</button></div>{entry.items.length > 0 && open && <ul>{entries(entry.items, key, depth + 1)}</ul>}</li>;
  });
  return <div className="document-outline" aria-label={t("文档目录")}>{!pdf ? <p className="nav-empty">{t("打开 PDF 后查看目录")}</p> : failed
    ? <p className="nav-empty">{t("目录加载失败")}<br /><button onClick={() => setRetry(value => value + 1)}>{t("重试目录")}</button></p>
    : outline === null ? <p className="nav-empty" role="status">{t("正在读取目录…")}</p>
    : outline.length === 0 ? <p className="nav-empty">{t("这篇 PDF 没有目录")}<br /><small>{t("可切换到页码导航")}</small></p>
    : <ul>{entries(outline)}</ul>}</div>;
}
