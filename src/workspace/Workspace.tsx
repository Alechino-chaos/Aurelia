import { useCallback, useEffect, useRef, useState } from 'react';
import type { PDFDocumentLoadingTask } from 'pdfjs-dist';
import { BookOpen, FolderTree, GripVertical, LoaderCircle, PanelsTopLeft, X } from 'lucide-react';
import Reader, { type ReaderHandle, type ReaderSnapshot } from '../Reader';
import type { LibraryAction, LibraryImportResult, LibraryState, OpenedFile, ReadingView } from '../types';
import type { SearchMemory } from '../search/usePdfSearch';
import { loadPdf } from '../pdf/engine';
import { releaseDocumentText } from '../pdf/documentText';
import { LibraryPanel } from './LibraryPanel';
import { ResourceCache, type PdfResource } from './resources';
import './workspace.css';

const message = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const defaultView: ReadingView = { page: 1, anchorY: 0, anchorX: 0, zoom: 'fit', panelOpen: true, panelTab: 'selection' };
type Current = { id: string; resource: PdfResource; view: ReadingView; epoch: number };
export function Workspace() {
  const bridge = window.paperdesk!;
  const [library, setLibrary] = useState<LibraryState | null>(null), state = useRef<LibraryState | null>(null);
  const [fatal, setFatal] = useState(''), [notice, setNotice] = useState(''), [loading, setLoading] = useState(false), [current, setCurrent] = useState<Current | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({}), [drawer, setDrawer] = useState(false), [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [pagesNavigation, setPagesNavigation] = useState(false), [width, setWidth] = useState(window.innerWidth);
  const [password, setPassword] = useState(''), [passwordPrompt, setPasswordPrompt] = useState(''), [mismatch, setMismatch] = useState<{ id: string; name: string } | null>(null);
  const reader = useRef<ReaderHandle>(null), rendered = useRef<Current | null>(null); rendered.current = current;
  const actions = useRef<Promise<unknown>>(Promise.resolve()), generation = useRef(0), pending = useRef<PDFDocumentLoadingTask | null>(null);
  const passwordCallback = useRef<((value: string) => void) | null>(null), live = useRef(true);
  const searches = useRef(new Map<string, SearchMemory>()), snapshots = useRef(new Map<string, ReaderSnapshot>()), viewTimer = useRef(0);
  const cache = useRef(new ResourceCache<PdfResource>(resource => { releaseDocumentText(resource.pdf); void resource.pdf.loadingTask.destroy().catch(() => {}); }));
  const publish = useCallback((next: LibraryState) => { state.current = next; if (live.current) setLibrary(next); }, []);
  function ordered<T>(operation: () => Promise<T>): Promise<T> { const next = actions.current.then(operation); actions.current = next.catch(() => {}); return next; }
  const action = useCallback((operation: LibraryAction) => ordered(async () => {
    try { const next = await bridge.updateLibrary(operation); publish(next); return next; }
    catch (reason) { if (live.current) setNotice(`论文库操作或保存失败：${message(reason)}`); throw reason; }
  }), [bridge, publish]);
  const change = (operation: LibraryAction) => { void action(operation).catch(() => {}); };
  const persist = useCallback(async (id: string, snapshot: ReaderSnapshot) => {
    snapshots.current.set(id, snapshot); searches.current.set(id, snapshot.search);
    const entry = state.current?.entries.find(entry => entry.id === id);
    if (id === 'sample' || !snapshot.documentId || !entry || entry.documentId !== snapshot.documentId) return;
    await action({ type: 'view', id, view: snapshot.view, documentId: snapshot.documentId });
  }, [action]);
  const capture = useCallback(async () => {
    clearTimeout(viewTimer.current); const owner = rendered.current, handle = reader.current;
    if (!owner || !handle) return;
    await persist(owner.id, handle.capture()); await handle.suspend(); window.getSelection()?.removeAllRanges();
  }, [persist]);
  const recordView = useCallback((snapshot: ReaderSnapshot) => {
    const owner = rendered.current;
    if (!owner || owner.resource.documentId !== snapshot.documentId) return;
    snapshots.current.set(owner.id, snapshot); searches.current.set(owner.id, snapshot.search); clearTimeout(viewTimer.current);
    viewTimer.current = window.setTimeout(() => { void persist(owner.id, snapshot).catch(reason => { if (live.current) setNotice(`阅读位置保存失败：${message(reason)}`); }); }, 200);
  }, [persist]);
  function cancelPending() { const task = pending.current; pending.current = null; if (task) void task.destroy().catch(() => {}); passwordCallback.current = null; setPasswordPrompt(''); }
  async function load(id: string, ticket: number, opened?: OpenedFile) {
    if (ticket !== generation.current) return;
    setLoading(true); setErrors(old => { const next = { ...old }; delete next[id]; return next; });
    try {
      const previousIdentity = snapshots.current.get(id)?.documentId ?? state.current?.entries.find(entry => entry.id === id)?.documentId;
      const file = opened ?? await bridge.openLibraryPaper(id);
      if (ticket !== generation.current || !live.current) return;
      const refreshed = await bridge.getLibrary();
      if (ticket !== generation.current || !live.current) return;
      // A read refreshes this entry's identity/view. It does not own workspace activation.
      const entry = refreshed.entries.find(entry => entry.id === id);
      if (entry && state.current) publish({ ...state.current, entries: state.current.entries.map(old => old.id === id ? entry : old) });
      const documentId = file.documentId ?? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(file.bytes)))).map(byte => byte.toString(16).padStart(2, '0')).join('');
      if (ticket !== generation.current) return;
      let resource = cache.current.get(id);
      if (resource && resource.documentId !== documentId) { cache.current.delete(id); resource = undefined; }
      if (previousIdentity && previousIdentity !== documentId) { searches.current.delete(id); snapshots.current.delete(id); }
      if (!resource) {
        const byteLength = file.bytes.byteLength, task = loadPdf(new Uint8Array(file.bytes)); pending.current = task;
        task.onPassword = (update: (value: string) => void, reason: number) => { if (ticket === generation.current) { passwordCallback.current = update; setPassword(''); setPasswordPrompt(reason === 2 ? '密码不正确，请重试' : '此 PDF 需要密码'); } };
        const pdf = await task.promise;
        if (ticket !== generation.current || !live.current) { void task.destroy().catch(() => {}); return; }
        const sizes = [];
        for (let start = 1; start <= pdf.numPages; start += 12) {
          sizes.push(...await Promise.all(Array.from({ length: Math.min(12, pdf.numPages - start + 1) }, async (_, offset) => { const page = await pdf.getPage(start + offset), view = page.getViewport({ scale: 1 }); return { width: view.width, height: view.height, rotation: view.rotation }; })));
          if (ticket !== generation.current || !live.current) { void task.destroy().catch(() => {}); return; }
        }
        resource = { pdf, sizes, name: file.name, documentId, bytes: byteLength }; pending.current = null;
        cache.current.activate(id); cache.current.put(id, resource);
      } else cache.current.activate(id);
      if (ticket !== generation.current) return;
      let view = file.view;
      if (!view) {
        let page = 1;
        try { const old = JSON.parse(localStorage.getItem(`paperdesk:position:${resource.pdf.fingerprints[0]}`) ?? '1'); if (typeof old === 'number' && Number.isFinite(old)) page = old; } catch { /* Invalid legacy position uses first page. */ }
        view = { ...defaultView, page: Math.max(1, Math.min(resource.pdf.numPages, page)) };
      } else view = { ...view, page: Math.max(1, Math.min(resource.pdf.numPages, view.page)) };
      setCurrent({ id, resource, view, epoch: ticket }); window.document.title = `${file.name} — Aurelia`;
    } catch (reason) { if (ticket === generation.current && live.current) { setErrors(old => ({ ...old, [id]: `无法打开论文：${message(reason)}` })); cancelPending(); } }
    finally { if (ticket === generation.current && live.current) { setLoading(false); setPasswordPrompt(''); } }
  }
  async function activate(id: string, opened?: OpenedFile) {
    const ticket = ++generation.current; cancelPending(); setDrawer(false);
    try {
      await capture(); if (ticket !== generation.current) return;
      await action({ type: state.current?.openIds.includes(id) ? 'tab-activate' : 'tab-open', id }); if (ticket !== generation.current) return;
      setCurrent(null); cache.current.activate(id); await load(id, ticket, opened);
    } catch (reason) { if (ticket === generation.current) setNotice(`无法切换论文：${message(reason)}`); }
  }
  async function close(id: string, remove = false) {
    try {
      const active = state.current?.activeId === id; let ticket = generation.current;
      if (active) { ticket = ++generation.current; cancelPending(); await capture(); }
      const next = await action({ type: remove ? 'entry-remove' : 'tab-close', id });
      searches.current.delete(id); snapshots.current.delete(id); cache.current.delete(id);
      if (active) { setCurrent(null); if (next.activeId) await load(next.activeId, ticket); else { cache.current.activate(null); window.document.title = 'Aurelia'; } }
    } catch (reason) { setNotice(`无法${remove ? '移出' : '关闭'}论文，记录尚未保存：${message(reason)}`); }
  }
  async function imports(result: LibraryImportResult, ticket?: number) {
    const next = await ordered(async () => { const fresh = await bridge.getLibrary(); publish(fresh); return fresh; });
    if (result.errors.length) setNotice(result.errors.map(error => `${error.name}：${error.message}`).join('\n'));
    if (ticket !== undefined && ticket !== generation.current) return;
    if (result.importedIds[0]) await activate(result.importedIds[0]); else if (!result.errors.length && next.entries.length) setNotice('已存在的论文保留在原分组。');
  }
  const importPapers = () => { const ticket = ++generation.current; cancelPending(); setLoading(false); void bridge.importPapers(selectedGroup ?? undefined).then(result => imports(result, ticket)).catch(reason => setNotice(`导入失败：${message(reason)}`)); };
  async function openData(file: OpenedFile, expected = generation.current) {
    if (expected !== generation.current) return;
    if (file.libraryId) { await ordered(async () => publish(await bridge.getLibrary())); if (expected === generation.current) await activate(file.libraryId, file); return; }
    const ticket = ++generation.current; cancelPending(); await capture(); setCurrent(null); await load('sample', ticket, file);
  }
  async function readRequest(read: () => Promise<OpenedFile | null>) {
    const ticket = ++generation.current; cancelPending(); setLoading(false);
    try { const file = await read(); if (file && ticket === generation.current) await openData(file, ticket); }
    catch (reason) { if (ticket === generation.current) setNotice(`无法打开文件：${message(reason)}`); }
  }
  const open = useCallback(async () => readRequest(() => bridge.openPdf()), [bridge, capture, action]);
  async function relocate(id: string) {
    try {
      const result = await bridge.relocateLibraryPaper(id), fresh = await bridge.getLibrary(); publish(fresh);
      if (result.outcome === 'mismatch') setMismatch({ id, name: result.candidateName ?? '选中的文件' });
      if (result.outcome === 'relocated') { cache.current.delete(id); await activate(id); }
      if (result.outcome === 'existing' && result.existingId) { setNotice('选中的文件已在论文库中，请按需移出旧条目。'); await activate(result.existingId); }
    } catch (reason) { setNotice(`重新定位失败：${message(reason)}`); }
  }
  useEffect(() => {
    live.current = true; const ticket = ++generation.current;
    void bridge.getLibrary().then(next => { if (live.current && ticket === generation.current) { publish(next); if (next.activeId) void load(next.activeId, ticket); } }).catch(reason => { if (live.current) setFatal(message(reason)); });
    return () => { live.current = false; generation.current++; clearTimeout(viewTimer.current); void pending.current?.destroy().catch(() => {}); pending.current = null; cache.current.clear(); };
  }, []);
  const closingCapture = useRef(capture); closingCapture.current = capture;
  useEffect(() => bridge.onBeforeClose(async () => { await closingCapture.current(); await actions.current; }), [bridge]);
  useEffect(() => bridge.onOpenRequested(() => { void open(); }), [bridge, open]);
  const commands = useRef({ activate, close }); commands.current = { activate, close };
  useEffect(() => {
    const resize = () => setWidth(window.innerWidth); window.addEventListener('resize', resize);
    const keydown = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229 || document.querySelector('.ai-settings')) return;
      const current = state.current; if (!(event.ctrlKey || event.metaKey) || !current?.activeId) return;
      if (event.key === 'Tab' && current.openIds.length) { event.preventDefault(); const index = current.openIds.indexOf(current.activeId), step = event.shiftKey ? -1 : 1; void commands.current.activate(current.openIds[(index + step + current.openIds.length) % current.openIds.length]); }
      else if (event.key.toLowerCase() === 'w') { event.preventDefault(); void commands.current.close(current.activeId); }
    };
    window.addEventListener('keydown', keydown); return () => { window.removeEventListener('resize', resize); window.removeEventListener('keydown', keydown); };
  }, []);
  useEffect(() => { document.querySelector<HTMLElement>('.paper-tabs [aria-selected="true"]')?.closest('.paper-tab')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [library?.activeId, library?.mode]);

  if (!library) return <div className="workspace-start" data-workspace-ready={fatal ? 'error' : 'loading'}><BookOpen size={28} /><strong>Aurelia</strong>{fatal ? <div role="alert">论文库无法恢复：{fatal}<button onClick={() => { setFatal(''); void bridge.getLibrary().then(publish).catch(reason => setFatal(message(reason))); }}>重试恢复</button></div> : <p>正在恢复论文库…</p>}</div>;
  const effectiveWidth = Math.min(library.sidebarWidth, Math.max(180, width - 720));
  const panel = (dismiss?: () => void) => <LibraryPanel state={library} selectedGroup={selectedGroup} onGroup={setSelectedGroup} onAction={action} onImport={importPapers} onOpen={id => { void activate(id); }} onClose={id => { void close(id); }} onRemove={id => { void close(id, true); }}
    onReveal={id => { void bridge.revealLibraryPaper(id).catch(reason => setNotice(`无法显示文件：${message(reason)}`)); }} onRelocate={id => { void relocate(id); }} onDismiss={dismiss} />;
  const sidebar = library.mode === 'sidebar' ? <div className="library-sidebar" style={{ width: effectiveWidth }}>{panel()}<div className="library-resize" role="separator" aria-label="调整论文库宽度" aria-orientation="vertical" tabIndex={0} aria-valuemin={180} aria-valuemax={520} aria-valuenow={Math.round(effectiveWidth)}
    onKeyDown={event => { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); change({ type: 'sidebar', width: library.sidebarWidth + (event.key === 'ArrowLeft' ? -20 : 20) }); } }}
    onPointerDown={event => event.currentTarget.setPointerCapture(event.pointerId)} onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) { const parent = event.currentTarget.parentElement!; parent.style.width = `${Math.max(180, Math.min(520, event.clientX - parent.getBoundingClientRect().left))}px`; } }}
    onPointerUp={event => { const actual = event.currentTarget.parentElement!.getBoundingClientRect().width; event.currentTarget.releasePointerCapture(event.pointerId); change({ type: 'sidebar', width: actual }); }}><GripVertical size={12} /></div></div> : undefined;
  const activeError = library.activeId ? errors[library.activeId] : null;
  return <div className={`paper-workspace navigation-${library.mode}`} data-workspace-ready="true">
    <div className="library-navigation"><div className="library-mode" role="group" aria-label="论文导航模式"><button aria-pressed={library.mode === 'sidebar'} onClick={() => change({ type: 'mode', mode: 'sidebar' })}><FolderTree size={15} />文件树模式</button><button aria-pressed={library.mode === 'tabs'} onClick={() => change({ type: 'mode', mode: 'tabs' })}><PanelsTopLeft size={15} />标签模式</button></div>
      {(library.mode === 'tabs' || pagesNavigation) && <button className="library-drawer-button" onClick={() => setDrawer(value => !value)}><BookOpen size={16} />论文库</button>}
      {library.mode === 'tabs' && <div className="paper-tabs" role="tablist" aria-label="打开的论文">{library.openIds.map(id => { const entry = library.entries.find(entry => entry.id === id)!; return <div key={id} className={`paper-tab ${library.activeId === id ? 'current' : ''}`}><button role="tab" title={entry.path} aria-label={`打开论文 ${entry.path}`} aria-selected={library.activeId === id} onClick={() => { void activate(id); }}>{entry.name}</button><button className="icon-button small" aria-label={`关闭论文 ${entry.path}`} onClick={() => { void close(id); }}><X size={13} /></button></div>; })}</div>}
    </div>
    {library.recovery && <div className="workspace-notice" role="status">{library.recovery.message}</div>}
    {notice && <div className="workspace-notice" role="alert"><span>{notice}</span><button aria-label="关闭错误提示" onClick={() => setNotice('')}><X size={16} /></button></div>}
    <div className="workspace-reader-host" data-reader-id={current?.id} data-reader-generation={current?.epoch}><Reader key={current ? `${current.id}/${current.resource.pdf.loadingTask.docId}/${current.epoch}` : `empty/${library.activeId ?? ''}`} managed handle={reader} resource={current?.resource} initialView={current?.view} initialSearch={current ? searches.current.get(current.id) : undefined}
      onOpen={open} onOpenData={openData} onRecent={id => readRequest(() => bridge.openRecent(id))} onSample={() => readRequest(async () => { const response = await fetch(`${import.meta.env.BASE_URL}examples/reading-demo.pdf`); if (!response.ok) throw new Error('示例文件不存在'); return { name: 'Aurelia · 双栏阅读示例.pdf', bytes: new Uint8Array(await response.arrayBuffer()) }; })}
      onDrop={async files => { const ticket = ++generation.current; cancelPending(); setLoading(false); await imports(await bridge.importDroppedPapers(files, selectedGroup ?? undefined), ticket); }} onView={recordView} navigation={sidebar} onPagesNavigation={setPagesNavigation} libraryWidth={library.mode === 'sidebar' && !pagesNavigation ? effectiveWidth : 0} />
      {(loading || activeError) && <div className="workspace-load-state" style={{ left: library.mode === 'sidebar' ? effectiveWidth : 0 }}>{loading ? <><LoaderCircle className="spin" size={24} /><strong>正在打开论文</strong><button onClick={() => { generation.current++; cancelPending(); setLoading(false); if (library.activeId) setErrors(old => ({ ...old, [library.activeId!]: '已取消打开论文。可以重新打开或切换其他论文。' })); }}>取消打开</button></> : <div role="alert"><strong>{activeError}</strong><div><button onClick={() => { void activate(library.activeId!); }}>重新打开</button><button onClick={() => { void relocate(library.activeId!); }}>重新定位</button></div></div>}</div>}
      {passwordPrompt && <form className="workspace-password" style={{ left: library.mode === 'sidebar' ? effectiveWidth : 0 }} onSubmit={event => { event.preventDefault(); passwordCallback.current?.(password); setPasswordPrompt(''); }}><strong>{passwordPrompt}</strong><input autoFocus type="password" aria-label="PDF 密码" value={password} onChange={event => setPassword(event.target.value)} /><div><button type="button" onClick={() => { generation.current++; cancelPending(); setLoading(false); if (library.activeId) setErrors(old => ({ ...old, [library.activeId!]: '已取消打开加密论文。' })); }}>取消密码</button><button type="submit">解锁 PDF</button></div></form>}
    </div>
    {drawer && <div className="library-drawer">{panel(() => setDrawer(false))}</div>}
    {mismatch && <div className="relocation-notice" role="dialog" aria-label="文件内容不同"><strong>文件内容不同</strong><p>{mismatch.name} 与原论文内容不同。作为另一篇论文导入后，原论文与笔记将保留。</p><button onClick={() => { setMismatch(null); }}>取消</button><button onClick={() => { const id = mismatch.id; setMismatch(null); void bridge.acceptRelocationImport(id).then(imports).catch(reason => setNotice(message(reason))); }}>作为新论文导入</button></div>}
  </div>;
}
