import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Download, Highlighter, MessageSquare, Pencil, Trash2, Undo2 } from 'lucide-react';
import type { Annotation } from '../../electron/session-types';
import type { AiController } from '../ai/useAi';
import { orderedAnnotations } from '../../electron/notes-markdown';

export function AnnotationsPanel({ ai, activeId, editRequest, onSelect, onLocate, onDelete, onUndo, undoAvailable, onAsk }: {
  ai: AiController; activeId: string | null; editRequest: number;
  onSelect: (id: string) => void; onLocate: (id: string) => void;
  onDelete: (entry: Annotation) => void; onUndo: () => void; undoAvailable: boolean; onAsk: (entry: Annotation) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const [exportState, setExportState] = useState<'idle' | 'pending' | 'saved' | 'error'>('idle');
  const [exportError, setExportError] = useState('');
  const exporting = useRef(false), mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const entries = orderedAnnotations(ai.session?.annotations ?? []);
  const saveFailed = !!ai.sessionError || ai.storageError?.documentId === ai.session?.documentId;
  async function exportNotes() {
    if (exporting.current) return;
    exporting.current = true; setExportState('pending'); setExportError('');
    try {
      const result = await ai.exportNotes();
      if (mounted.current) setExportState(result.status === 'saved' ? 'saved' : 'idle');
    } catch (error) {
      if (mounted.current) {
        setExportState('error');
        setExportError((error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
      }
    } finally { exporting.current = false; }
  }
  useEffect(() => {
    if (editRequest && activeId) setEditing(activeId);
  }, [editRequest]);
  useEffect(() => {
    const card = Array.from(list.current?.querySelectorAll<HTMLElement>('.annotation-card') ?? []).find(el => el.dataset.annotationId === activeId);
    card?.scrollIntoView({ block: 'nearest' });
  }, [activeId]);
  const edit = (id: string, value: { note?: string; color?: Annotation['color'] }) => {
    void ai.commitSession({ type: 'annotation-edit', id, ...value }).catch(() => {});
  };
  return <div className="annotations-panel">
    <div className="annotations-heading"><span>本篇批注 <span className="annotation-count">{entries.length}</span></span>
      <span className="annotation-save-state" role="status">{ai.sessionLoading ? '正在恢复…' : ai.sessionError || ai.storageError ? '保存或恢复失败' : !ai.session ? '请打开论文' : ai.saveState === 'saving' ? '正在保存…' : '已保存到本机'}</span>
      <button className="notes-export-button" disabled={!ai.sessionReady || !entries.length || ai.saveState !== 'saved' || saveFailed || exportState === 'pending'}
        title={ai.saveState === 'saving' ? '笔记保存完成后即可导出' : !entries.length ? '添加高亮或批注后即可导出' : '将本篇摘录与笔记保存为 Markdown'}
        onClick={() => void exportNotes()}><Download size={14} />{exportState === 'pending' ? '正在导出…' : '导出笔记'}</button></div>
    {exportState === 'saved' && <p className="notes-export-status" role="status">笔记已导出</p>}
    {exportState === 'error' && <div className="ai-error" role="alert">{exportError}</div>}
    {(ai.sessionError || ai.storageError) && <div className="ai-error" role="alert">{ai.sessionError || ai.storageError?.message}<button className="text-button" onClick={() => void ai.retrySessionSave()}>重试</button></div>}
    {undoAvailable && <button className="annotation-undo" onClick={onUndo}><Undo2 size={14} />撤销删除</button>}
    <div className="annotations-list" ref={list}>
      {!entries.length && <div className="ai-empty"><Highlighter size={28} strokeWidth={1.4} /><h2>留下阅读时的想法</h2><p>选中文字后点击“高亮”或“批注”。<br />笔记随论文保存在本机。</p></div>}
      {entries.map(entry => <article key={entry.id} data-annotation-id={entry.id} className={`annotation-card ${entry.id === activeId ? 'selected' : ''}`}>
        <header><span className={`annotation-dot ${entry.color}`} /><span>第 {entry.quote.pages.join('、')} 页 · {entry.note ? '高亮与笔记' : '高亮'}</span>
          <button className="icon-button small" aria-label="删除批注" title="删除高亮和笔记，可撤销" disabled={!ai.sessionReady} onClick={() => onDelete(entry)}><Trash2 /></button></header>
        <button className="annotation-excerpt" title="定位原文" onClick={() => onLocate(entry.id)}>{entry.quote.text}</button>
        {(entry.note || editing === entry.id) && <div className="annotation-note"><span>我的笔记</span>{editing === entry.id ?
          <textarea autoFocus aria-label="批注笔记" value={entry.note} maxLength={100000} disabled={!ai.sessionReady}
            onChange={event => edit(entry.id, { note: event.target.value })} onBlur={() => setEditing(null)} placeholder="记下你的理解…" /> :
          <p onDoubleClick={() => { onSelect(entry.id); setEditing(entry.id); }}>{entry.note}</p>}</div>}
        <div className="annotation-actions"><button onClick={() => onLocate(entry.id)}>定位原文 <ArrowUpRight size={13} /></button>
          <button disabled={!ai.sessionReady} onClick={() => { onSelect(entry.id); setEditing(entry.id); }}><Pencil size={13} />{entry.note ? '编辑' : '添加笔记'}</button></div>
        {entry.id === activeId && <div className="annotation-options"><div role="group" aria-label="高亮颜色">{(['yellow', 'green'] as const).map(color =>
          <button key={color} className={`color-swatch ${color}`} aria-label={color === 'yellow' ? '浅黄高亮' : '浅绿高亮'} aria-pressed={entry.color === color}
            disabled={!ai.sessionReady} onClick={() => edit(entry.id, { color })} />)}</div><button onClick={() => onAsk(entry)}><MessageSquare size={13} />问 AI</button></div>}
      </article>)}
    </div>
    <p className="annotations-footnote">点击批注，回到原文位置</p>
  </div>;
}
