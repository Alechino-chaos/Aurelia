import { appError, backendErrorMessage } from './i18n.js';
import { open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { LibraryStore } from './library-store.js';
import { libraryId, normalizeLibraryPath } from './library-model.js';
import type { LibraryImportResult, LibraryOpenedFile, LibraryRelocateResult } from './library-types.js';
import type { SessionStore } from './session-store.js';
export async function readPdf(filePath: unknown) {
  normalizeLibraryPath(filePath);
  const absolute = path.win32.normalize(filePath as string);
  if (path.win32.extname(absolute).toLowerCase() !== '.pdf')
    throw appError('请选择 PDF 文件。');
  const file = await open(absolute, 'r');
  try {
    const info = await file.stat();
    if (!info.isFile())
      throw appError('这不是一个可读取的文件。');
    if (info.size > 250 * 1024 * 1024)
      throw appError('第一版支持 250 MB 以内的 PDF。请先压缩此文件。');
    // Bound reads even if the source grows between stat and read; never allocate from renderer input.
    const bytes = Buffer.alloc(info.size);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await file.read(bytes, offset, bytes.length - offset, offset);
      if (result.bytesRead === 0)
        throw appError('文件在读取时改变，请重试。');
      offset += result.bytesRead;
    }
    const after = await file.stat();
    if (after.size !== info.size || after.mtimeMs !== info.mtimeMs)
      throw appError('文件在读取时改变，请重试。');
    if (!bytes.subarray(0, 1024).includes(Buffer.from('%PDF-')))
      throw appError('文件内容不是有效的 PDF。');
    return { path: absolute, name: path.win32.basename(absolute), bytes: new Uint8Array(bytes), documentId: createHash('sha256').update(bytes).digest('hex') };
  }
  finally {
    await file.close();
  }
}
export class LibraryFiles {
  private relocationCandidates = new Map<string, string>();
  constructor(private store: LibraryStore, private reader: typeof readPdf = readPdf) { }
  async openPath(filePath: string): Promise<LibraryOpenedFile> {
    const generation = this.store.beginRead(filePath);
    const pdf = await this.reader(filePath), entry = await this.store.register(pdf, null, generation);
    return { name: entry.name, bytes: pdf.bytes, id: createHash('sha256').update(entry.path).digest('hex').slice(0, 20), documentId: pdf.documentId, libraryId: entry.id, view: entry.view };
  }
  async open(id: string): Promise<LibraryOpenedFile> {
    const previous = await this.store.entry(id), generation = this.store.beginRead(previous.path);
    const pdf = await this.reader(previous.path), entry = await this.store.refresh(id, pdf, generation);
    return { name: entry.name, bytes: pdf.bytes, id: createHash('sha256').update(entry.path).digest('hex').slice(0, 20), documentId: pdf.documentId, libraryId: entry.id, view: entry.view };
  }
  async importPaths(paths: string[], groupId?: string): Promise<LibraryImportResult> {
    if (!Array.isArray(paths) || paths.length > 1000 || paths.some(p => typeof p !== 'string'))
      throw appError('无效的导入列表。');
    const initial = await this.store.get();
    if (groupId !== undefined && !initial.groups.some(g => g.id === libraryId(groupId)))
      throw appError('未找到这个分组。');
    const importedIds: string[] = [], errors: LibraryImportResult['errors'] = [];
    for (const filePath of paths) {
      try {
        const generation = this.store.beginRead(filePath);
        const pdf = await this.reader(filePath), before = await this.store.get();
        const existing = before.entries.some(e => normalizeLibraryPath(e.path) === normalizeLibraryPath(pdf.path));
        const entry = await this.store.register(pdf, groupId ?? null, generation);
        if (!existing)
          importedIds.push(entry.id);
      }
      catch (error) {
        errors.push({ name: path.win32.basename(filePath), message: backendErrorMessage(error instanceof Error ? error : appError('论文未能导入。')) });
      }
    }
    return { state: await this.store.get(), importedIds, errors };
  }
  async relocate(id: string, filePath: string): Promise<LibraryRelocateResult> {
    const entry = await this.store.entry(id), generation = this.store.beginRead(filePath), pdf = await this.reader(filePath);
    this.relocationCandidates.delete(id);
    if (entry.documentId !== null && entry.documentId !== pdf.documentId) {
      this.relocationCandidates.set(id, pdf.path);
      return { state: await this.store.get(), outcome: 'mismatch', candidateName: pdf.name };
    }
    const result = await this.store.relocate(id, pdf.path, pdf.documentId, generation);
    return { ...result, outcome: result.existingId ? 'existing' : 'relocated' };
  }
  async acceptRelocationImport(id: string): Promise<LibraryImportResult> {
    const entry = await this.store.entry(id), candidate = this.relocationCandidates.get(id);
    if (!candidate)
      throw appError('请先选择重新定位的文件。');
    const result = await this.importPaths([candidate], entry.groupId ?? undefined);
    this.relocationCandidates.delete(id);
    return result;
  }
  async reveal(id: string, reveal: (filePath: string) => void): Promise<void> {
    const entry = await this.store.entry(id);
    reveal(entry.path);
  }
  async remove(id: string, sessions: SessionStore, cancel: (requestId: string) => void) {
    const state = await this.store.get(), entry = state.entries.find(e => e.id === libraryId(id));
    if (!entry) throw appError('未找到这篇论文。');
    if (entry.documentId) {
      let pending: string[] = [], loaded = false;
      try { pending = sessions.pendingIds(entry.documentId); loaded = true; }
      catch { /* An inactive paper may never have loaded its session. */ }
      const activeSibling = state.entries.find(e => e.id === state.activeId && e.id !== id && e.documentId === entry.documentId);
      if (activeSibling) {
        // Sessions belong to content; removing a display copy must not stop its active sibling.
        if (loaded) await sessions.flush(entry.documentId);
      } else {
        for (const requestId of pending) cancel(requestId);
        await sessions.suspend(entry.documentId);
      }
    }
    return this.store.update({ type: 'entry-remove', id });
  }
}
