import { translateBackendMessage } from '../../electron/i18n';
import { useLanguage } from '../i18n/LanguageProvider';
import { useState } from 'react';
import { BookOpen, ChevronDown, ChevronRight, FileText, FolderOpen, MoreHorizontal, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { LibraryAction, LibraryState } from '../types';

type Props = { state: LibraryState; selectedGroup: string | null; onGroup: (id: string | null) => void;
  onAction: (action: LibraryAction) => Promise<LibraryState>; onImport: () => void; onOpen: (id: string) => void;
  onClose: (id: string) => void; onRemove: (id: string) => void; onReveal: (id: string) => void; onRelocate: (id: string) => void; onDismiss?: () => void };
export function LibraryPanel({ state, selectedGroup, onGroup, onAction, onImport, onOpen, onClose, onRemove, onReveal, onRelocate, onDismiss }: Props) {
  const { t, display, locale } = useLanguage();
  const [form, setForm] = useState<{ id?: string; name: string } | null>(null), [error, setError] = useState('');
  const groups = [{ id: 'ungrouped', name: t("未分组") }, ...state.groups];
  const change = (action: LibraryAction) => { void onAction(action).catch(() => {}); };
  const toggle = (id: string) => change({ type: 'sidebar', collapsedGroupIds: state.collapsedGroupIds.includes(id) ? state.collapsedGroupIds.filter(value => value !== id) : [...state.collapsedGroupIds, id] });
  return <nav className="library-panel" aria-label={t("论文库列表")}>
    <div className="library-heading"><BookOpen size={17} /><strong>{t("论文库")}</strong><span>{state.entries.length}</span>{onDismiss && <button className="icon-button small" aria-label={t("关闭论文库")} onClick={onDismiss}><X /></button>}</div>
    <div className="library-actions"><button onClick={onImport}><FolderOpen size={15} />{t("导入论文")}</button><button aria-label={t("新建分组")} title={t("新建分组")} onClick={() => { setForm({ name: '' }); setError(''); }}><Plus size={17} /></button></div>
    <div className="library-import-target">{t('importTarget', { name: state.groups.find(group => group.id === selectedGroup)?.name ?? t('未分组') })}</div>
    {form && <form className="library-group-form" onSubmit={async event => {
      event.preventDefault();
      try { const next = await onAction(form.id ? { type: 'group-rename', id: form.id, name: form.name } : { type: 'group-create', name: form.name }); if (!form.id) onGroup(next.groups.at(-1)!.id); setForm(null); setError(''); }
      catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    }}><label>{t("分组名称")}<input autoFocus aria-label={t("分组名称")} maxLength={80} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label><div><button type="submit">{t("保存分组")}</button><button type="button" onClick={() => { setForm(null); setError(''); }}>{t("取消")}</button></div>{error && <p role="alert">{translateBackendMessage(error, locale)}</p>}</form>}
    <div className="library-groups">{groups.map(group => {
      const groupId = group.id === 'ungrouped' ? null : group.id, collapsed = state.collapsedGroupIds.includes(group.id), entries = state.entries.filter(entry => entry.groupId === groupId);
      return <section className={`library-group ${selectedGroup === groupId ? 'selected-group' : ''}`} key={group.id}
        onDragOver={event => { if (event.dataTransfer.types.includes('application/aurelia-paper')) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } }}
        onDrop={event => { const id = event.dataTransfer.getData('application/aurelia-paper'); if (id) { event.preventDefault(); event.stopPropagation(); change({ type: 'entry-move', id, groupId }); } }}>
        <div className="library-group-heading"><button className="group-toggle" aria-label={t(collapsed ? 'expandGroup' : 'collapseGroup', { name: group.name })} aria-expanded={!collapsed} onClick={() => { onGroup(groupId); toggle(group.id); }}>{collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}<span>{group.name}</span><small>{entries.length}</small></button>
          {groupId && <><button className="icon-button small" aria-label={t('renameGroup', { name: group.name })} onClick={() => { setForm({ id: group.id, name: group.name }); setError(''); }}><Pencil size={12} /></button><button className="icon-button small" aria-label={t('deleteGroup', { name: group.name })} title={t("删除分组，论文移入未分组")} onClick={() => { change({ type: 'group-delete', id: group.id }); if (selectedGroup === group.id) onGroup(null); }}><Trash2 size={12} /></button></>}
        </div>
        {!collapsed && <div className="library-group-papers">{entries.map(entry => {
          const active = state.activeId === entry.id, open = state.openIds.includes(entry.id), parent = entry.path.slice(0, Math.max(entry.path.lastIndexOf('\\'), entry.path.lastIndexOf('/')));
          return <article key={entry.id} className={`library-entry ${active ? 'current' : ''}`} data-library-id={entry.id} draggable onDragStart={event => { event.dataTransfer.setData('application/aurelia-paper', entry.id); event.dataTransfer.effectAllowed = 'move'; }}>
            <button className="paper-open" data-paper-path={entry.path} title={entry.path} aria-label={t('openPaper', { path: entry.path })} aria-current={active ? 'true' : undefined} onClick={() => onOpen(entry.id)}><FileText size={16} /><span><strong>{entry.name}</strong><small className="paper-folder">{parent.slice(Math.max(parent.lastIndexOf('\\'), parent.lastIndexOf('/')) + 1) || parent}</small><small className="paper-path">{parent}</small><small className="paper-status">{active ? t("当前阅读") : open ? t("已打开") : t("点击阅读")}</small></span></button>
            <div className="paper-actions">{open && <button className="icon-button small" aria-label={t('closePaper', { path: entry.path })} title={t("关闭阅读项，保留论文库")} onClick={() => onClose(entry.id)}><X size={13} /></button>}<details className="paper-menu"><summary aria-label={t('paperActions', { path: entry.path })} title={t("论文操作")}><MoreHorizontal size={17} /></summary><div>
              <button onClick={() => onReveal(entry.id)}>{t("在文件夹中显示")}</button><button onClick={() => onRelocate(entry.id)}>{t("重新定位")}</button><label>{t("移动到分组")}<select aria-label={t("移动到分组")} value={entry.groupId ?? ''} onChange={event => change({ type: 'entry-move', id: entry.id, groupId: event.target.value || null })}><option value="">{t("未分组")}</option>{state.groups.map(group => <option value={group.id} key={group.id}>{group.name}</option>)}</select></label><button className="remove-paper" title={t("仅移除条目，保留原 PDF 和笔记")} onClick={() => onRemove(entry.id)}>{t("移出论文库")}</button>
            </div></details></div>
          </article>;
        })}{!entries.length && <p className="library-group-empty">{t("导入论文到此分组")}</p>}</div>}
      </section>;
    })}</div><p className="library-footnote">{t("分组保存在本机 · 原 PDF 保留原处")}</p>
  </nav>;
}
