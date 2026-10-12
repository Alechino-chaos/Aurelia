import { open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { LibraryStore } from './library-store.js';
import { libraryId, normalizeLibraryPath } from './library-model.js';
import type { LibraryImportResult, LibraryOpenedFile, LibraryRelocateResult } from './library-types.js';
async function readPdf(filePath: unknown) {
  normalizeLibraryPath(filePath);
  const absolute = path.win32.normalize(filePath as string);
  if (path.win32.extname(absolute).toLowerCase() !== '.pdf')
    throw new Error('请选择 PDF 文件。');
  const file = await open(absolute, 'r');
  try {
    const info = await file.stat();
    if (!info.isFile())
      throw new Error('这不是一个可读取的文件。');
    if (info.size > 250 * 1024 * 1024)
      throw new Error('第一版支持 250 MB 以内的 PDF。请先压缩此文件。');
    // Bound reads even if the source grows between stat and read; never allocate from renderer input.
    const bytes = Buffer.alloc(info.size);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await file.read(bytes, offset, bytes.length - offset, offset);
      if (result.bytesRead === 0)
        throw new Error('文件在读取时改变，请重试。');
      offset += result.bytesRead;
    }
    const after = await file.stat();
    if (after.size !== info.size || after.mtimeMs !== info.mtimeMs)
      throw new Error('文件在读取时改变，请重试。');
    if (!bytes.subarray(0, 1024).includes(Buffer.from('%PDF-')))
      throw new Error('文件内容不是有效的 PDF。');
    return { path: absolute, name: path.win32.basename(absolute), bytes: new Uint8Array(bytes), documentId: createHash('sha256').update(bytes).digest('hex') };
  }
  finally {
    await file.close();
  }
}
export class LibraryFiles {
  private relocationCandidates = new Map<string, string>();
  constructor(private store: LibraryStore) { }
  async openPath(filePath: string): Promise<LibraryOpenedFile> {
    const pdf = await readPdf(filePath), entry = await this.store.register(pdf);
    return { name: entry.name, bytes: pdf.bytes, id: createHash('sha256').update(entry.path).digest('hex').slice(0, 20), documentId: pdf.documentId, libraryId: entry.id, view: entry.view };
  }
  async open(id: string): Promise<LibraryOpenedFile> {
    const previous = await this.store.entry(id), pdf = await readPdf(previous.path), entry = await this.store.refresh(id, pdf);
    return { name: entry.name, bytes: pdf.bytes, id: createHash('sha256').update(entry.path).digest('hex').slice(0, 20), documentId: pdf.documentId, libraryId: entry.id, view: entry.view };
  }
  async importPaths(paths: string[], groupId?: string): Promise<LibraryImportResult> {
    if (!Array.isArray(paths) || paths.length > 1000 || paths.some(p => typeof p !== 'string'))
      throw new Error('无效的导入列表。');
    const initial = await this.store.get();
    if (groupId !== undefined && !initial.groups.some(g => g.id === libraryId(groupId)))
      throw new Error('未找到这个分组。');
    const importedIds: string[] = [], errors: LibraryImportResult['errors'] = [];
    for (const filePath of paths) {
      try {
        const pdf = await readPdf(filePath), before = await this.store.get();
        const existing = before.entries.some(e => normalizeLibraryPath(e.path) === normalizeLibraryPath(pdf.path));
        const entry = await this.store.register(pdf, groupId ?? null);
        if (!existing)
          importedIds.push(entry.id);
      }
      catch (error) {
        errors.push({ name: path.win32.basename(filePath), message: error instanceof Error ? error.message : '论文未能导入。' });
      }
    }
    return { state: await this.store.get(), importedIds, errors };
  }
  async relocate(id: string, filePath: string): Promise<LibraryRelocateResult> {
    const entry = await this.store.entry(id), pdf = await readPdf(filePath);
    this.relocationCandidates.delete(id);
    if (entry.documentId !== null && entry.documentId !== pdf.documentId) {
      this.relocationCandidates.set(id, pdf.path);
      return { state: await this.store.get(), outcome: 'mismatch', candidateName: pdf.name };
    }
    const result = await this.store.relocate(id, pdf.path, pdf.documentId);
    return { ...result, outcome: result.existingId ? 'existing' : 'relocated' };
  }
  async acceptRelocationImport(id: string): Promise<LibraryImportResult> {
    const entry = await this.store.entry(id), candidate = this.relocationCandidates.get(id);
    if (!candidate)
      throw new Error('请先选择重新定位的文件。');
    const result = await this.importPaths([candidate], entry.groupId ?? undefined);
    this.relocationCandidates.delete(id);
    return result;
  }
  async reveal(id: string, reveal: (filePath: string) => void): Promise<void> {
    const entry = await this.store.entry(id);
    reveal(entry.path);
  }
}
