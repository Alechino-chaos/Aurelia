import { useEffect, useRef } from 'react';
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import type { PdfSearchController } from '../search/usePdfSearch';

export function SearchBar({ search, page, onClose }: { search: PdfSearchController; page: number; onClose: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus({ preventScroll: true }); input.current?.select(); }, [search.focusVersion]);
  return <div className="search-bar" role="search" aria-label="论文全文搜索">
    <div className="search-controls">
      <div className="search-input-wrap"><Search size={15} /><input ref={input} type="text" autoComplete="off" spellCheck={false} aria-label="搜索论文全文"
        placeholder="搜索论文中的文字" value={search.query} maxLength={512}
        onChange={event => search.setQuery(event.target.value)}
        onCompositionStart={() => search.setComposing(true)} onCompositionEnd={() => search.setComposing(false)}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || search.composing) return;
          if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); search.move(event.shiftKey ? -1 : 1, page); }
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
        }} /></div>
      <span className="search-status" role="status" aria-live="polite" data-testid="search-status">{search.status}</span>
      <button className="icon-button small" aria-label="上一处匹配" title="上一处匹配 (Shift+Enter)" disabled={!search.progress?.matches.length || search.composing} onClick={() => search.move(-1, page)}><ChevronUp /></button>
      <button className="icon-button small" aria-label="下一处匹配" title="下一处匹配 (Enter)" disabled={!search.progress?.matches.length || search.composing} onClick={() => search.move(1, page)}><ChevronDown /></button>
      <button className="icon-button small" aria-label="关闭全文搜索" title="关闭 (Esc)" onClick={onClose}><X /></button>
    </div>
    <div className="search-options">
      <label><input type="checkbox" checked={search.caseSensitive} onChange={event => search.setCaseSensitive(event.target.checked)} />区分大小写</label>
      <label><input type="checkbox" checked={search.repairHyphens} onChange={event => search.setRepairHyphens(event.target.checked)} />忽略行末连字符</label>
      <span className="search-notice" role="status" data-testid="search-notice">{search.notice}</span>
      {!!search.progress?.failed.length && <span className="search-warning">第 {search.progress.failed.join('、')} 页搜索失败 <button className="text-button" onClick={search.retry}>重试</button></span>}
      {search.progress?.truncated && <span className="search-warning">仅显示前 10000 处匹配，请缩小关键词范围</span>}
      {!!search.progress?.emptyPages && search.progress.emptyPages !== search.progress.total && <span className="search-note">{search.progress.emptyPages} 页没有可搜索文本</span>}
    </div>
  </div>;
}
