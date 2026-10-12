import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowUpRight, BookOpen, Check, ChevronLeft, ChevronRight, Columns2, Copy, FileText, FolderOpen, GripVertical, Highlighter, Languages, LoaderCircle, Maximize, Minus, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Plus, Search, Settings, MessageSquare, TextSelect, X } from 'lucide-react';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import { PdfPage } from './components/PdfPage';
import { loadPdf } from './pdf/engine';
import { cleanText, readSelection } from './pdf/selection';
import type { OpenedFile, PageSize, RecentFile, SelectedText } from './types';
import { useAi } from './ai/useAi';
import { AiPanel } from './components/AiPanel';
import { AiSettingsDialog } from './components/AiSettingsDialog';
import { AnnotationsPanel } from './components/AnnotationsPanel';
import type { Annotation } from '../electron/session-types';
import { usePdfSearch } from './search/usePdfSearch';
import { SearchBar } from './components/SearchBar';
import { releaseDocumentText } from './pdf/documentText';
import type { SearchMatch } from './pdf/search';

const noSearchMatches: SearchMatch[] = [];

function readSetting<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(`paperdesk:${key}`) ?? 'null') ?? fallback; } catch { return fallback; }
}
function saveSetting(key: string, value: unknown) {
  try { localStorage.setItem(`paperdesk:${key}`, JSON.stringify(value)); } catch { /* Storage may be disabled. */ }
}
function safeWidth(value: unknown) { return typeof value === 'number' && Number.isFinite(value) ? Math.max(280, Math.min(580, value)) : 400; }

export default function App() {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [fileName, setFileName] = useState('');
  const [documentKey, setDocumentKey] = useState<string | null>(null);
  const [sizes, setSizes] = useState<PageSize[]>([]);
  const [recent, setRecent] = useState<RecentFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [activePage, setActivePage] = useState(1);
  const [pageDraft, setPageDraft] = useState('1');
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const [readerWidth, setReaderWidth] = useState(850);
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const [pixelRatio, setPixelRatio] = useState(window.devicePixelRatio || 1);
  const [panelWidth, setPanelWidth] = useState(() => safeWidth(readSetting('panelWidth', 400)));
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelTab, setPanelTab] = useState<'selection' | 'translation' | 'chat' | 'annotations'>('selection');
  const ai = useAi(documentKey, fileName, pdf?.loadingTask.docId);
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null);
  const [annotationEditRequest, setAnnotationEditRequest] = useState(0);
  const [highlightColor, setHighlightColor] = useState<Annotation['color']>('yellow');
  const [deletedAnnotation, setDeletedAnnotation] = useState<Annotation | null>(null);
  const annotations = ai.session?.annotations ?? [];
  const activeAnnotation = annotations.find(a => a.id === activeAnnotationId);
  const [navOpen, setNavOpen] = useState(false);
  const maxPanelWidth = Math.min(580, Math.max(280, windowWidth - (navOpen ? (windowWidth <= 1100 ? 133 : 168) : 0) - 425));
  const effectivePanelWidth = Math.min(panelWidth, maxPanelWidth);
  const [resizing, setResizing] = useState(false);
  const [autoColumns, setAutoColumns] = useState(true);
  const search = usePdfSearch(pdf, autoColumns);
  const [repairHyphens, setRepairHyphens] = useState(false);
  const [selection, setSelection] = useState<SelectedText | null>(null);
  const [showSelectionTools, setShowSelectionTools] = useState(false);
  const [preview, setPreview] = useState<'clean' | 'raw'>('clean');
  const [draggingFile, setDraggingFile] = useState(false);
  const [passwordPrompt, setPasswordPrompt] = useState('');
  const [password, setPassword] = useState('');
  const passwordCallback = useRef<((password: string) => void) | null>(null);
  const reader = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const pending = useRef<PDFDocumentLoadingTask | null>(null);
  const generation = useRef(0);
  const anchor = useRef<{ number: number; y: number; x: number } | null>(null);
  const dragDepth = useRef(0);
  const frame = useRef(0);
  const restorePage = useRef<number | null>(null);
  const scale = zoom === 'fit' ? Math.max(.25, Math.min(2.5, (readerWidth - 72) / Math.max(612, ...sizes.map(size => size.width)))) : zoom;
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const clean = selection ? cleanText(selection.raw, repairHyphens) : '';
  const currentQuote = selection && clean ? { text: clean, fileName, pages: selection.pages } : undefined;
  const translateSelection = () => {
    if (!currentQuote) return;
    setPanelOpen(true); setPanelTab('translation'); setShowSelectionTools(false);
    ai.translate(currentQuote);
  };
  const askSelection = () => {
    if (!currentQuote) return;
    ai.setQuote(currentQuote); setPanelOpen(true); setPanelTab('chat'); setShowSelectionTools(false);
  };

  useEffect(() => { setActiveAnnotationId(null); setDeletedAnnotation(null); setAnnotationEditRequest(0); }, [documentKey]);
  const selectAnnotation = (id: string) => {
    setActiveAnnotationId(id); setPanelOpen(true); setPanelTab('annotations'); setShowSelectionTools(false);
  };
  const addAnnotation = (note = false, color = highlightColor) => {
    if (!selection?.regions.length || !currentQuote || !ai.sessionReady) return;
    const existing = annotations.find(a => JSON.stringify(a.regions) === JSON.stringify(selection.regions));
    const id = existing?.id ?? crypto.randomUUID();
    if (!existing) {
      const now = Date.now();
      void ai.commitSession({ type: 'annotation-add', entry: { id, createdAt: now, updatedAt: now, color, quote: currentQuote, note: '', regions: selection.regions } }).catch(() => {});
    }
    selectAnnotation(id);
    if (note) setAnnotationEditRequest(value => value + 1);
    window.getSelection()?.removeAllRanges();
  };
  const deleteAnnotation = (entry: Annotation) => {
    setDeletedAnnotation(entry);
    if (activeAnnotationId === entry.id) setActiveAnnotationId(null);
    void ai.commitSession({ type: 'annotation-delete', id: entry.id }).catch(() => {});
  };
  const undoAnnotation = () => {
    if (!deletedAnnotation || !ai.sessionReady) return;
    void ai.commitSession({ type: 'annotation-add', entry: deletedAnnotation }).catch(() => {});
    setActiveAnnotationId(deletedAnnotation.id); setDeletedAnnotation(null);
  };
  const askAnnotation = (entry: Annotation) => {
    setActiveAnnotationId(entry.id); ai.setQuote(entry.quote); setPanelOpen(true); setPanelTab('chat');
  };
  const saveAnswerToAnnotation = (text: string) => {
    if (!activeAnnotation || !ai.sessionReady) return;
    const note = [activeAnnotation.note, `AI 回答：\n${text}`].filter(Boolean).join('\n\n');
    if (note.length > 100000) { setToast('笔记过长，请缩短后再保存。'); return; }
    void ai.commitSession({ type: 'annotation-edit', id: activeAnnotation.id, note }).catch(() => {});
    selectAnnotation(activeAnnotation.id);
  };

  const notify = useCallback((message: string) => setToast(message), []);
  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(''), 2300);
    return () => clearTimeout(timeout);
  }, [toast]);
  useEffect(() => { void window.paperdesk?.getRecent().then(setRecent).catch(() => {}); }, []);
  useEffect(() => () => { if (pdf) { releaseDocumentText(pdf); void pdf.loadingTask.destroy(); } }, [pdf]);
  useEffect(() => () => { generation.current++; void pending.current?.destroy(); }, []);
  useEffect(() => { setPageDraft(String(activePage)); }, [activePage]);
  useEffect(() => { saveSetting('panelWidth', panelWidth); }, [panelWidth]);
  useEffect(() => {
    const resize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  useEffect(() => {
    const changed = () => setPixelRatio(window.devicePixelRatio || 1);
    const query = window.matchMedia(`(resolution: ${pixelRatio}dppx)`);
    query.addEventListener('change', changed);
    window.addEventListener('resize', changed);
    return () => { query.removeEventListener('change', changed); window.removeEventListener('resize', changed); };
  }, [pixelRatio]);
  useEffect(() => {
    if (pdf) saveSetting(`position:${pdf.fingerprints[0]}`, activePage);
  }, [pdf, activePage]);

  const captureAnchor = useCallback(() => {
    const root = reader.current;
    if (!root) return;
    const rootRect = root.getBoundingClientRect();
    const page = Array.from(root.querySelectorAll<HTMLElement>('.pdf-page')).find(page => page.getBoundingClientRect().bottom > rootRect.top);
    if (!page) return;
    const rect = page.getBoundingClientRect();
    anchor.current = { number: Number(page.dataset.pageNumber), y: (rootRect.top - rect.top) / scaleRef.current, x: root.scrollLeft / scaleRef.current };
  }, []);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => { captureAnchor(); setReaderWidth(entry.contentRect.width); });
    observer.observe(reader.current!);
    return () => observer.disconnect();
  }, [captureAnchor]);
  useLayoutEffect(() => {
    const root = reader.current;
    const saved = anchor.current;
    if (root && saved) {
      const page = root.querySelector<HTMLElement>(`[data-page-number="${saved.number}"]`);
      if (page) root.scrollTop += page.getBoundingClientRect().top - root.getBoundingClientRect().top + saved.y * scale;
      root.scrollLeft = saved.x * scale;
      anchor.current = null;
    }
    window.getSelection()?.removeAllRanges();
    setShowSelectionTools(false);
  }, [scale]);

  const goToPage = useCallback((number: number) => {
    if (!pdf || !reader.current) return;
    const target = Math.max(1, Math.min(pdf.numPages, Math.round(number) || 1));
    const element = reader.current.querySelector<HTMLElement>(`[data-page-number="${target}"]`);
    if (element) {
      reader.current.scrollTop += element.getBoundingClientRect().top - reader.current.getBoundingClientRect().top - 24;
      setActivePage(target);
      setPageDraft(String(target));
    }
  }, [pdf]);
  useEffect(() => {
    if (search.navigation) goToPage(search.navigation.match.page);
  }, [search.navigation, goToPage]);
  const closeSearch = useCallback(() => {
    search.close(); reader.current?.focus({ preventScroll: true });
  }, [search.close]);
  const locateAnnotation = (id: string) => {
    const entry = annotations.find(a => a.id === id);
    if (!entry || !reader.current) return;
    selectAnnotation(id);
    // After opening the panel, allow its width/fit-zoom update to settle first.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const root = reader.current, region = entry.regions[0];
      const page = root?.querySelector<HTMLElement>(`[data-page-number="${region.page}"]`);
      if (!root || !page) return;
      const bounds = page.getBoundingClientRect(), view = root.getBoundingClientRect();
      root.scrollTop += bounds.top - view.top + region.y * bounds.height - 90;
      root.scrollLeft += bounds.left - view.left + region.x * bounds.width - 48;
      setActivePage(region.page); setPageDraft(String(region.page));
    }));
  };
  useEffect(() => {
    if (pdf && restorePage.current) { goToPage(restorePage.current); restorePage.current = null; }
  }, [pdf, sizes, goToPage]);

  const openData = useCallback(async (file: OpenedFile) => {
    const ticket = ++generation.current;
    void pending.current?.destroy();
    pending.current = null;
    setLoading(true); setProgress(0); setError(''); setPasswordPrompt('');
    try {
      const documentKey = file.documentId ?? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(file.bytes)))).map(byte => byte.toString(16).padStart(2, '0')).join('');
      if (ticket !== generation.current) return;
      const task = loadPdf(new Uint8Array(file.bytes));
      pending.current = task;
      task.onProgress = ({ loaded, total }: { loaded: number; total: number }) => { if (ticket === generation.current && total) setProgress(Math.round(loaded / total * 90)); };
      task.onPassword = (update: (password: string) => void, reason: number) => {
        if (ticket !== generation.current) return;
        passwordCallback.current = update;
        setPassword('');
        setPasswordPrompt(reason === 2 ? '密码不正确，请重试' : '此 PDF 需要密码');
      };
      const document = await task.promise;
      const dimensions: PageSize[] = [];
      for (let start = 1; start <= document.numPages; start += 12) {
        const batch = await Promise.all(Array.from({ length: Math.min(12, document.numPages - start + 1) }, async (_, i) => {
          const page = await document.getPage(start + i);
          const view = page.getViewport({ scale: 1 });
          return { width: view.width, height: view.height, rotation: view.rotation };
        }));
        dimensions.push(...batch);
        if (ticket !== generation.current) { void task.destroy(); return; }
      }
      setPasswordPrompt(''); passwordCallback.current = null;
      window.getSelection()?.removeAllRanges();
      setSelection(null); setShowSelectionTools(false);
      const saved = readSetting<number>(`position:${document.fingerprints[0]}`, 1);
      const page = Number.isFinite(saved) ? Math.max(1, Math.min(document.numPages, saved)) : 1;
      restorePage.current = page;
      anchor.current = null;
      setPdf(document); setSizes(dimensions); setFileName(file.name); setDocumentKey(documentKey); setActivePage(page); setZoom('fit');
      setProgress(100);
      window.document.title = `${file.name} — Aurelia`;
      if (reader.current) { reader.current.scrollTop = 0; reader.current.scrollLeft = 0; }
      void window.paperdesk?.getRecent().then(setRecent).catch(() => {});
      pending.current = null;
    } catch (reason) {
      if (ticket === generation.current) {
        const detail = reason instanceof Error ? reason.message : String(reason);
        setError(/Invalid PDF|InvalidPDF/i.test(detail) ? '无法打开：文件已损坏或不是有效的 PDF。' : `打开失败：${detail}`);
        void pending.current?.destroy(); pending.current = null;
      }
    } finally { if (ticket === generation.current) { setLoading(false); setPasswordPrompt(''); } }
  }, []);

  const openFile = useCallback(async () => {
    if (!window.paperdesk) { fileInput.current?.click(); return; }
    try { const file = await window.paperdesk.openPdf(); if (file) await openData(file); }
    catch (reason) { setError(`无法打开文件：${reason instanceof Error ? reason.message : reason}`); }
  }, [openData]);
  const loadBrowserFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf')) { setError('请选择 .pdf 文件。'); return; }
    if (file.size > 250 * 1024 * 1024) { setError('第一版支持 250 MB 以内的 PDF。'); return; }
    await openData({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
  };
  useEffect(() => window.paperdesk?.onOpenRequested(() => { void openFile(); }), [openFile]);
  const changeZoom = useCallback((next: number | 'fit') => {
    captureAnchor();
    setZoom(next === 'fit' ? next : Math.min(3, Math.max(.25, Math.round(next * 100) / 100)));
  }, [captureAnchor]);

  const copyText = useCallback(async (mode: 'clean' | 'raw' | 'citation', selected = selection) => {
    if (!selected) return;
    let value = mode === 'raw' ? selected.raw : cleanText(selected.raw, repairHyphens);
    if (mode === 'citation') value += `\n\n— ${fileName}，第 ${selected.pages.join('、')} 页`;
    try {
      if (window.paperdesk) await window.paperdesk.writeClipboard(value);
      else await navigator.clipboard.writeText(value);
      notify(mode === 'raw' ? '已复制原始文本' : mode === 'citation' ? '已复制文本和出处' : '已复制清理后的文本');
    } catch { setError('无法写入剪贴板，请在右侧预览中手动选择并复制。'); }
  }, [selection, repairHyphens, fileName, notify]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229 || document.querySelector('.modal-backdrop')) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f' && pdf && !loading) {
        event.preventDefault(); search.show(); return;
      }
      if (event.key === 'Escape' && search.open) { event.preventDefault(); closeSearch(); return; }
      const input = event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable="true"]');
      if (event.key === 'Escape') { setShowSelectionTools(false); window.getSelection()?.removeAllRanges(); }
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === 'o' && !window.paperdesk) { event.preventDefault(); void openFile(); }
      if (!input && ['+', '=', '-', '0'].includes(event.key)) {
        event.preventDefault();
        changeZoom(event.key === '0' ? 'fit' : scaleRef.current + (event.key === '-' ? -.1 : .1));
      }
      if (event.shiftKey && event.key.toLowerCase() === 'c') {
        const current = reader.current && readSelection(reader.current, repairHyphens);
        if (current) { event.preventDefault(); void copyText('raw', current); }
      }
    };
    const copy = (event: ClipboardEvent) => {
      if (!reader.current) return;
      const selected = readSelection(reader.current, repairHyphens);
      if (selected && event.clipboardData) {
        event.preventDefault(); event.clipboardData.setData('text/plain', selected.clean); notify('已复制清理后的文本');
      }
    };
    window.addEventListener('keydown', keydown);
    document.addEventListener('copy', copy);
    return () => { window.removeEventListener('keydown', keydown); document.removeEventListener('copy', copy); };
  }, [openFile, changeZoom, copyText, repairHyphens, notify, pdf, loading, search.show, search.open, closeSearch]);

  useEffect(() => {
    let timeout = 0;
    let dragging = false;
    const update = () => {
      if (!reader.current) return;
      const current = readSelection(reader.current, repairHyphens);
      if (current) { setSelection(current); setShowSelectionTools(true); }
      else setShowSelectionTools(false);
    };
    const changed = () => {
      clearTimeout(timeout);
      if (!dragging) timeout = window.setTimeout(update, 60);
    };
    const down = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('.textLayer')) {
        dragging = true; clearTimeout(timeout); setShowSelectionTools(false);
      }
    };
    const up = () => { if (dragging) { dragging = false; clearTimeout(timeout); update(); } };
    document.addEventListener('selectionchange', changed);
    document.addEventListener('pointerdown', down);
    document.addEventListener('pointerup', up);
    return () => { clearTimeout(timeout); document.removeEventListener('selectionchange', changed); document.removeEventListener('pointerdown', down); document.removeEventListener('pointerup', up); };
  }, [repairHyphens]);

  useEffect(() => {
    const root = reader.current!;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) { event.preventDefault(); changeZoom(scaleRef.current + (event.deltaY < 0 ? .1 : -.1)); }
    };
    root.addEventListener('wheel', wheel, { passive: false });
    return () => root.removeEventListener('wheel', wheel);
  }, [changeZoom]);

  const onScroll = () => {
    setShowSelectionTools(false);
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      if (!reader.current) return;
      const top = reader.current.getBoundingClientRect().top + 100;
      const pages = Array.from(reader.current.querySelectorAll<HTMLElement>('.pdf-page'));
      const current = pages.find(page => page.getBoundingClientRect().bottom > top);
      if (current) setActivePage(Number(current.dataset.pageNumber));
    });
  };

  const cancelLoading = () => {
    generation.current++; void pending.current?.destroy(); pending.current = null;
    setLoading(false); setPasswordPrompt(''); passwordCallback.current = null;
  };

  return <div className={`app ${resizing ? 'is-resizing' : ''}`} onDragEnter={event => {
    if (Array.from(event.dataTransfer.types).includes('Files')) { event.preventDefault(); dragDepth.current++; setDraggingFile(true); }
  }} onDragLeave={() => { dragDepth.current--; if (dragDepth.current <= 0) setDraggingFile(false); }}
  onDragOver={event => { if (Array.from(event.dataTransfer.types).includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } }}
  onDrop={async event => {
    event.preventDefault(); dragDepth.current = 0; setDraggingFile(false);
    const file = event.dataTransfer.files[0];
    if (!file) return;
    try {
      if (window.paperdesk) await openData(await window.paperdesk.openDropped(file));
      else await loadBrowserFile(file);
    } catch (reason) { setError(`无法读取文件：${reason instanceof Error ? reason.message : reason}`); }
  }}>
    <header className="titlebar">
      <div className="brand"><img className="brand-icon" src={`${import.meta.env.BASE_URL}branding/aurelia-32.png`} alt="" /><span>Aurelia</span></div>
      <span className="window-caption">你的论文阅读工作台</span>
    </header>
    <div className="workspace-toolbar">
      <div className="document-actions">
        <button className="icon-button" title={navOpen ? '收起页码导航' : '展开页码导航'} aria-label="切换页码导航" onClick={() => setNavOpen(value => !value)}>{navOpen ? <PanelLeftClose /> : <PanelLeftOpen />}</button>
        <button className="open-button" onClick={() => void openFile()} disabled={loading}><FolderOpen size={16} /><span>打开 PDF</span></button>
        <span className="toolbar-divider" />
        <button className={`icon-button${search.open ? ' active' : ''}`} title="全文搜索 (Ctrl+F)" aria-label="全文搜索" aria-expanded={search.open} disabled={!pdf || loading} onClick={search.show}><Search /></button>
        <div className="document-label" title={fileName || '尚未打开文档'}>{pdf && <FileText size={15} />}<span>{fileName || '阅读工作区'}</span></div>
      </div>
        <div className="reading-toolbar">
          <div className="page-controls">
            <button className="icon-button small" title="上一页" aria-label="上一页" disabled={!pdf || activePage <= 1} onClick={() => goToPage(activePage - 1)}><ChevronLeft /></button>
            <input aria-label="页码" className="page-input" inputMode="numeric" value={pdf ? pageDraft : '—'} disabled={!pdf} onChange={event => setPageDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { goToPage(Number(pageDraft)); event.currentTarget.blur(); } }} onBlur={() => { if (pdf) goToPage(Number(pageDraft)); }} />
            <span className="page-count">/ {pdf?.numPages ?? '—'}</span>
            <button className="icon-button small" title="下一页" aria-label="下一页" disabled={!pdf || activePage >= pdf.numPages} onClick={() => goToPage(activePage + 1)}><ChevronRight /></button>
          </div>
          <div className="zoom-controls">
            <button className="icon-button small" title="缩小 (Ctrl+-)" aria-label="缩小" disabled={!pdf || scale <= .25} onClick={() => changeZoom(scale - .1)}><Minus /></button>
            <select className="zoom-select" aria-label="缩放比例" disabled={!pdf} value={zoom === 'fit' ? 'fit' : String(scale)} onChange={event => changeZoom(event.target.value === 'fit' ? 'fit' : Number(event.target.value))}>
              <option value="fit">适合宽度</option>
              {[...new Set([.5, .75, 1, 1.25, 1.5, 2, 3, ...(zoom === 'fit' ? [] : [scale])])].sort((a, b) => a - b).map(value => <option key={value} value={value}>{Math.round(value * 100)}%</option>)}
            </select>
            <button className="icon-button small" title="放大 (Ctrl++)" aria-label="放大" disabled={!pdf || scale >= 3} onClick={() => changeZoom(scale + .1)}><Plus /></button>
            <button className="icon-button small fit-button" title="适合宽度 (Ctrl+0)" aria-label="适合宽度" disabled={!pdf} onClick={() => changeZoom('fit')}><Maximize /></button>
          </div>

        </div>
      <div className="document-actions toolbar-settings"><button className="icon-button" title="AI 服务设置" aria-label="AI 服务设置" onClick={() => ai.setSettingsOpen(true)}><Settings /></button><button className={`icon-button panel-toggle ${panelOpen ? 'active' : ''}`} title={panelOpen ? '收起右侧面板' : '展开右侧面板'} aria-label="切换右侧面板" onClick={() => setPanelOpen(value => !value)}>{panelOpen ? <PanelRightClose /> : <PanelRightOpen />}</button></div>
    </div>
    <main className="workspace">
      {navOpen && <nav className="page-nav" aria-label="页码导航">
        <div className="nav-title">文档页码 <span>{pdf?.numPages ?? 0}</span></div>
        {pdf ? <div className="page-list">{sizes.map((_, index) => <button key={index} className={`page-link ${activePage === index + 1 ? 'current' : ''}`} onClick={() => goToPage(index + 1)} aria-current={activePage === index + 1 ? 'page' : undefined}><FileText size={16} /><span>第 {index + 1} 页</span>{activePage === index + 1 && <span className="current-dot" />}</button>)}</div> : <p className="nav-empty">打开 PDF 后<br />在这里切换页面</p>}
        <div className="nav-footer"><BookOpen size={14} /> 连续阅读</div>
      </nav>}
      <div className="reading-workspace">
        {search.open && <SearchBar search={search} page={activePage} onClose={closeSearch} />}
        {error && <div className="error-banner" role="alert"><span>{error}</span><button className="icon-button small" aria-label="关闭错误提示" onClick={() => setError('')}><X /></button></div>}
        <div className={`reader ${!pdf ? 'reader-empty' : ''}`} ref={reader} onScroll={onScroll} tabIndex={0} aria-label="PDF 连续阅读区">
          {pdf ? <div className="pages" key={pdf.loadingTask.docId} data-document-id={pdf.loadingTask.docId}>{sizes.map((size, index) => <PdfPage key={index} pdf={pdf} number={index + 1} size={size} scale={scale} dpr={pixelRatio} autoColumns={autoColumns} scrollRoot={reader} annotations={annotations} activeAnnotationId={activeAnnotationId} onAnnotationSelect={selectAnnotation}
            searchMatches={search.byPage.get(index + 1) ?? noSearchMatches} searchActiveId={search.activeId}
            searchNavigation={search.navigation?.match.page === index + 1 ? search.navigation : null} />)}<div className="document-end">— 已到文档末尾 —</div></div> : <div className="welcome">
            <img className="welcome-logo" src={import.meta.env.BASE_URL + 'branding/aurelia.png'} alt="" />
            <h1>打开论文</h1>
            <p>打开或拖入 PDF，开始阅读、选取和翻译。</p>
            <button className="primary-button" onClick={() => void openFile()} disabled={loading}><FolderOpen size={17} /> 打开本地 PDF <span>Ctrl O</span></button>
            <button className="sample-button" disabled={loading} onClick={async () => {
              try { const response = await fetch(`${import.meta.env.BASE_URL}examples/reading-demo.pdf`); if (!response.ok) throw new Error('示例文件不存在'); await openData({ name: 'Aurelia · 双栏阅读示例.pdf', bytes: new Uint8Array(await response.arrayBuffer()) }); }
              catch { setError('无法加载内置示例，请打开本地 PDF。'); }
            }}>体验双栏示例 <ArrowUpRight size={14} /></button>
            {recent.length > 0 && <div className="recent-files"><div className="recent-title">最近阅读</div>{recent.slice(0, 3).map(file => <button key={file.id} disabled={loading} onClick={async () => { try { await openData(await window.paperdesk!.openRecent(file.id)); } catch { setError('文件可能已移动或删除，请重新打开。'); } }}><FileText size={16} /><span>{file.name}</span><ChevronRight size={14} /></button>)}</div>}
            <div className="welcome-footnote"><span className="local-dot" /> 文件保留在本机，无需上传</div>
          </div>}
        </div>
        {loading && !passwordPrompt && <div className="loading-overlay" role="status"><LoaderCircle className="spin" size={28} /><strong>正在打开论文</strong><span>{progress > 0 ? `${progress}%` : '读取文档中…'}</span><button className="text-button" onClick={cancelLoading}>取消</button></div>}
      </div>
      {panelOpen && <><div className="resize-handle" role="separator" aria-orientation="vertical" aria-label="调整右侧面板宽度" tabIndex={0} aria-valuemin={280} aria-valuemax={maxPanelWidth} aria-valuenow={Math.round(effectivePanelWidth)} onDoubleClick={() => setPanelWidth(400)} onKeyDown={event => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setPanelWidth(Math.min(maxPanelWidth, safeWidth(effectivePanelWidth + (event.key === 'ArrowLeft' ? 20 : -20)))); }
      }} onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); setResizing(true); }} onPointerMove={event => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) setPanelWidth(Math.min(maxPanelWidth, safeWidth(window.innerWidth - event.clientX)));
      }} onPointerUp={event => { event.currentTarget.releasePointerCapture(event.pointerId); setResizing(false); }} onLostPointerCapture={() => setResizing(false)}><GripVertical size={12} /></div>
      <aside className="inspector" style={{ width: effectivePanelWidth } as CSSProperties} aria-label="右侧上下文面板">
        <div className="inspector-tabs" role="tablist" aria-label="阅读助手">{([['selection', '选区'], ['translation', '翻译'], ['chat', '对话'], ['annotations', '批注']] as const).map(([tab, label]) => <button key={tab} role="tab" aria-selected={panelTab === tab} className={`inspector-tab ${panelTab === tab ? 'selected' : ''}`} onClick={() => setPanelTab(tab)}>{label}</button>)}</div>
        {panelTab === 'selection' ? <><div className="inspector-content">
          {selection ? <>
            <div className="selection-source"><button className="source-link" title={fileName} onClick={() => goToPage(selection.pages[0])}><FileText size={16} /><span>{fileName} · 第 {selection.pages.join('、')} 页</span></button><button className="icon-button small" title="清空选区" aria-label="清空选区" onClick={() => { setSelection(null); window.getSelection()?.removeAllRanges(); }}><X /></button></div>
            <div className="preview-switch" role="group" aria-label="选区预览模式"><button className={preview === 'clean' ? 'selected' : ''} onClick={() => setPreview('clean')}>清理后</button><button className={preview === 'raw' ? 'selected' : ''} onClick={() => setPreview('raw')}>原始文本</button><span>{clean.length} 字符</span></div>
            <blockquote className="selection-preview" data-testid="selection-preview">{preview === 'clean' ? clean : selection.raw}</blockquote>
            <div className="selection-actions">
              <button className="primary-button" aria-label="复制清理文本" title="复制清理文本 (Ctrl+C)" onClick={() => void copyText('clean')}><Copy size={16} />复制</button>
              <button aria-label="翻译选区" onClick={translateSelection}><Languages size={16} />翻译</button>
              <button aria-label="引用到对话" onClick={askSelection}><MessageSquare size={16} />提问</button>
            </div>
          </> : <div className="inspector-empty"><TextSelect size={24} strokeWidth={1.5} /><h2>未选择文字</h2><p>在论文中拖动选取文字，<br />查看原文、复制或翻译。</p></div>}
          <details className="copy-options"><summary>复制选项<ChevronRight size={15} /></summary>
            <div className="setting-row"><span>文本顺序</span><div className="order-control"><Columns2 size={14} /><select aria-label="文本阅读顺序" value={autoColumns ? 'auto' : 'source'} onChange={event => { window.getSelection()?.removeAllRanges(); setSelection(null); setAutoColumns(event.target.value === 'auto'); }}><option value="auto">自动分栏</option><option value="source">PDF 原始顺序</option></select></div></div>
            {selection && <div className="copy-actions"><button onClick={() => void copyText('raw')}>原样复制</button><button onClick={() => void copyText('citation')}>带出处复制 <ArrowUpRight size={12} /></button></div>}
            <div className="setting-row"><span>合并段内换行</span><span className="enabled-value"><Check size={13} /> 已启用</span></div>
            <label className="setting-checkbox"><span>删除行末断词连字符</span><input type="checkbox" checked={repairHyphens} onChange={event => setRepairHyphens(event.target.checked)} /></label>
            <p className="setting-help">默认保留可见连字符。开启后请核对复合词与公式，避免改变原意。</p>
          </details>
        </div>
        </> : panelTab === 'annotations' ? <AnnotationsPanel key={documentKey} ai={ai} activeId={activeAnnotationId} editRequest={annotationEditRequest} onSelect={setActiveAnnotationId} onLocate={locateAnnotation} onDelete={deleteAnnotation} onUndo={undoAnnotation} undoAvailable={!!deletedAnnotation} onAsk={askAnnotation} /> : <AiPanel ai={ai} tab={panelTab} currentQuote={currentQuote} onPage={goToPage} noteTarget={activeAnnotation?.quote.text} onSaveNote={activeAnnotation ? saveAnswerToAnnotation : undefined} />}
      </aside></>}
    </main>
    <footer className="statusbar"><div><span className="local-dot" /><span>本地阅读</span><span className="status-separator">/</span><span>{pdf ? `${pdf.numPages} 页` : '尚未打开文档'}</span></div><div>{pdf && <span>{Math.round(scale * 100)}%</span>}<span><TextSelect size={12} /> {autoColumns ? '自动分栏选择' : '原始文本顺序'}</span><span className="status-shortcut">Ctrl C 复制 · Ctrl Shift C 原样复制</span></div></footer>
    {selection && showSelectionTools && <div className="selection-toolbar" role="toolbar" aria-label="选区操作" style={{ left: Math.max(12, Math.min(selection.rect.left, window.innerWidth - 544)), top: selection.rect.top > 180 ? selection.rect.top - 44 : selection.rect.bottom + 8 }} onMouseDown={event => event.preventDefault()}>
      <button onClick={() => void copyText('clean')}><Copy size={14} />复制</button><button disabled={!ai.sessionReady} onClick={() => addAnnotation()}><Highlighter size={14} />高亮</button><button disabled={!ai.sessionReady} onClick={() => addAnnotation(true)}><MessageSquare size={14} />批注</button><span /><button onClick={translateSelection}><Languages size={14} />翻译</button><button onClick={askSelection}><MessageSquare size={14} />问 AI</button><span /><div className="highlight-colors" role="group" aria-label="新高亮颜色">{(['yellow', 'green'] as const).map(color => <button key={color} className={`color-swatch ${color}`} aria-label={color === 'yellow' ? '使用浅黄' : '使用浅绿'} aria-pressed={highlightColor === color} onClick={() => setHighlightColor(color)} />)}</div><button title="查看选区" aria-label="查看选区" onClick={() => { setPanelOpen(true); setPanelTab('selection'); setShowSelectionTools(false); }}><TextSelect size={14} /></button>
    </div>}
    <input ref={fileInput} className="hidden" type="file" accept=".pdf,application/pdf" aria-label="选择 PDF 文件" onChange={async event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) { try { await loadBrowserFile(file); } catch { setError('无法读取文件。'); } } }} />
    {toast && <div className="toast" role="status"><Check size={15} />{toast}</div>}
    {ai.settingsOpen && <AiSettingsDialog ai={ai} />}
    {draggingFile && <div className="drop-overlay"><FolderOpen size={42} /><h2>松开以打开 PDF</h2><p>文件只在本机读取</p></div>}
    {passwordPrompt && <div className="modal-backdrop"><form className="password-dialog" onSubmit={event => { event.preventDefault(); passwordCallback.current?.(password); setPasswordPrompt(''); }}><BookOpen size={26} /><h2>{passwordPrompt}</h2><input autoFocus type="password" aria-label="PDF 密码" value={password} onChange={event => setPassword(event.target.value)} /><div><button type="button" className="text-button" onClick={cancelLoading}>取消</button><button type="submit" className="primary-button">解锁 PDF</button></div></form></div>}
  </div>;
}
