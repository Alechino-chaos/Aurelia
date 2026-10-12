import { mkdir, readFile, writeFile, rename, copyFile, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { applyLibraryAction, emptyLibrary, libraryId, normalizeLibraryPath, validateLibrary } from './library-model.js';
import type { LibraryAction, LibraryEntry, LibraryState } from './library-types.js';
const MAX_BYTES = 16 * 1024 * 1024;
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
export class LibraryStore {
  private state?: LibraryState;
  private loading?: Promise<LibraryState>;
  private queue: Promise<unknown> = Promise.resolve();
  private revision = 0;
  private saved = 0;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private directory: string) { }
  private file() { return path.join(this.directory, 'library.json'); }
  private async read(file: string) {
    if ((await stat(file)).size > MAX_BYTES)
      throw new Error('论文库文件过大，原文件已保留。');
    return validateLibrary(JSON.parse(await readFile(file, 'utf8')));
  }
  async load(recent: {
    path: string;
    name: string;
  }[] = []): Promise<LibraryState> {
    if (this.state)
      return structuredClone(this.state);
    if (this.loading)
      return structuredClone(await this.loading);
    this.loading = (async () => {
      const file = this.file();
      let data: LibraryState;
      let primaryMissing = false;
      try {
        data = await this.read(file);
      }
      catch (error) {
        if (error instanceof Error && error.message.includes('较新版本'))
          throw error;
        primaryMissing = missing(error);
        let recovered: LibraryState | undefined, source: 'backup' | 'temporary' | undefined, candidateExists = false;
        for (const [candidate, kind] of [[`${file}.bak`, 'backup'], [`${file}.tmp`, 'temporary']] as const) {
          try {
            recovered = await this.read(candidate);
            source = kind;
            candidateExists = true;
            break;
          }
          catch (backupError) {
            if (backupError instanceof Error && backupError.message.includes('较新版本'))
              throw backupError;
            if (!missing(backupError))
              candidateExists = true;
          }
        }
        if (recovered && source) {
          if (!primaryMissing)
            await copyFile(file, `${file}.corrupt-${Date.now()}-${randomUUID()}`);
          // Copy to a separate recovery file so a valid temporary candidate is never truncated.
          const recoveryFile = `${file}.recover`;
          await copyFile(source === 'backup' ? `${file}.bak` : `${file}.tmp`, recoveryFile);
          await rename(recoveryFile, file);
          data = { ...recovered, recovery: { source, message: '论文库已从可用副本恢复，原文件已保留。' } };
        }
        else if (primaryMissing && !candidateExists) {
          data = emptyLibrary();
          const known = new Set<string>();
          for (const item of recent.slice(0, 8)) {
            try {
              const normalized = normalizeLibraryPath(item.path);
              if (known.has(normalized) || path.win32.extname(item.path).toLowerCase() !== '.pdf')
                continue;
              known.add(normalized);
              data.entries.push({ id: randomUUID(), path: path.win32.normalize(item.path), name: path.win32.basename(item.path), groupId: null, documentId: null });
            }
            catch { /* Invalid legacy entries are not trusted. */ }
          }
          this.state = data;
          this.revision++;
          await this.persist();
        }
        else
          throw new Error('无法读取论文库，原文件已保留。请检查本机存储或恢复备份。');
      }
      this.state = data;
      return structuredClone(data);
    })();
    try {
      return await this.loading;
    }
    finally {
      this.loading = undefined;
    }
  }
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => { });
    return result;
  }
  async get() { await this.load(); await this.queue; return structuredClone(this.state!); }
  async entry(id: unknown): Promise<LibraryEntry> {
    const data = await this.get(), found = data.entries.find(e => e.id === libraryId(id));
    if (!found)
      throw new Error('未找到这篇论文。');
    return found;
  }
  async update(action: LibraryAction): Promise<LibraryState> {
    await this.load();
    return this.serialize(async () => {
      this.state = applyLibraryAction(this.state!, action);
      this.revision++;
      if (action.type === 'view') {
        if (!this.timer)
          this.timer = setTimeout(() => { this.timer = undefined; void this.flush().catch(() => { }); }, 200);
      }
      else
        await this.persist();
      return structuredClone(this.state);
    });
  }
  async register(input: {
    path: string;
    name: string;
    documentId: string;
  }, groupId: string | null = null): Promise<LibraryEntry> {
    await this.load();
    return this.serialize(async () => {
      const canonical = normalizeLibraryPath(input.path);
      if (groupId !== null && !this.state!.groups.some(g => g.id === libraryId(groupId)))
        throw new Error('未找到这个分组。');
      const data = structuredClone(this.state!);
      let entry = data.entries.find(e => normalizeLibraryPath(e.path) === canonical);
      if (entry) {
        if (entry.documentId !== null && entry.documentId !== input.documentId)
          delete entry.view;
        entry.documentId = input.documentId;
      }
      else {
        entry = { id: randomUUID(), path: path.win32.normalize(input.path), name: input.name, documentId: input.documentId, groupId };
        data.entries.push(entry);
      }
      this.state = { ...validateLibrary(data), ...(this.state!.recovery ? { recovery: this.state!.recovery } : {}) };
      this.revision++;
      await this.persist();
      return structuredClone(entry);
    });
  }
  async relocate(id: string, newPath: string, documentId: string): Promise<{
    state: LibraryState;
    existingId?: string;
  }> {
    await this.load();
    return this.serialize(async () => {
      const data = structuredClone(this.state!), entry = data.entries.find(e => e.id === libraryId(id));
      if (!entry)
        throw new Error('未找到这篇论文。');
      if (entry.documentId !== null && entry.documentId !== documentId)
        throw new Error('重新定位的文件内容不一致。');
      const canonical = normalizeLibraryPath(newPath), existing = data.entries.find(e => e.id !== id && normalizeLibraryPath(e.path) === canonical);
      if (existing)
        return { state: structuredClone(this.state!), existingId: existing.id };
      entry.path = path.win32.normalize(newPath);
      entry.name = path.win32.basename(newPath);
      entry.documentId = documentId;
      this.state = { ...validateLibrary(data), ...(this.state!.recovery ? { recovery: this.state!.recovery } : {}) };
      this.revision++;
      await this.persist();
      return { state: structuredClone(this.state) };
    });
  }
  async refresh(id: string, input: {
    path: string;
    documentId: string;
  }): Promise<LibraryEntry> {
    await this.load();
    return this.serialize(async () => {
      const data = structuredClone(this.state!), entry = data.entries.find(e => e.id === libraryId(id));
      if (!entry || normalizeLibraryPath(entry.path) !== normalizeLibraryPath(input.path))
        throw new Error('论文条目已改变，请重新打开。');
      if (entry.documentId !== null && entry.documentId !== input.documentId)
        delete entry.view;
      entry.documentId = input.documentId;
      this.state = { ...validateLibrary(data), ...(this.state!.recovery ? { recovery: this.state!.recovery } : {}) };
      this.revision++;
      await this.persist();
      return structuredClone(entry);
    });
  }
  private async persist() {
    if (this.saved === this.revision)
      return;
    const revision = this.revision, json = JSON.stringify(this.state);
    if (Buffer.byteLength(json) > MAX_BYTES)
      throw new Error('论文库超过本机容量限制。');
    const file = this.file();
    await mkdir(this.directory, { recursive: true });
    await writeFile(`${file}.tmp`, json, { encoding: 'utf8', mode: 0o600, flush: true });
    try {
      await copyFile(file, `${file}.bak`);
    }
    catch (error) {
      if (!missing(error))
        throw error;
    }
    await rename(`${file}.tmp`, file);
    this.saved = revision;
  }
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    await this.load();
    await this.serialize(() => this.persist());
  }
}
