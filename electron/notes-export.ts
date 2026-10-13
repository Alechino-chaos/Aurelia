import { appError } from './i18n.js';
import { link, open, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { SessionStore } from './session-store.js';
import { renderNotesMarkdown, suggestNotesFileName } from './notes-markdown.js';

export type NotesExportResult = { status: 'saved' | 'cancelled' };

export async function exportNotes(store: SessionStore, key: string, fileName: string,
  choosePath: (suggested: string) => Promise<string | null>): Promise<NotesExportResult> {
  if (typeof fileName !== 'string' || !fileName.trim() || fileName.length > 1000 || /[/\\\u0000-\u001f]/.test(fileName)) {
    throw appError('论文文件名无效。');
  }
  await store.flush(key);
  // Freeze both content and filename before awaiting a native dialog.
  const markdown = renderNotesMarkdown(fileName, store.annotationSnapshot(key));
  const selected = await choosePath(suggestNotesFileName(fileName));
  if (selected === null) return { status: 'cancelled' };
  if (typeof selected !== 'string' || !path.isAbsolute(selected)) throw appError('保存位置无效。');
  const extension = path.extname(selected);
  if (extension && extension.toLowerCase() !== '.md') throw appError('请选择 .md 文件，不能覆盖 PDF 或其他格式的文件。');
  const destination = extension ? selected : `${selected}.md`;
  const temporary = path.join(path.dirname(destination), `.aurelia-notes-${randomUUID()}.tmp`);
  let owned = false;
  try {
    const handle = await open(temporary, 'wx', 0o600); owned = true;
    try { await handle.writeFile(markdown, 'utf8'); await handle.sync(); }
    finally { await handle.close(); }
    if (extension) {
      await rename(temporary, destination);
      owned = false;
    } else {
      // The native dialog did not confirm replacing the appended .md path.
      // Atomically create it without replacement, even if another file appears
      // after the dialog closes. Both paths are on the same filesystem.
      await link(temporary, destination);
    }
    return { status: 'saved' };
  } catch (error) {
    if (!extension && (error as NodeJS.ErrnoException).code === 'EEXIST') throw appError('补全 .md 后的文件已存在，请重新选择完整文件名并确认覆盖，或使用其他名称。');
    throw appError('笔记未能导出，请检查保存位置、磁盘空间或文件是否被占用后重试。');
  } finally {
    if (owned) await unlink(temporary).catch(() => {});
  }
}
