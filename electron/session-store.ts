import { appError, backendErrorMessage } from './i18n.js';
import { mkdir, readFile, writeFile, rename, copyFile, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { AiEvent } from './ai-types.js';
import type { Annotation, ReadingSession, SessionAction, SessionSaveEvent } from './session-types.js';
import { applySessionAction, applySessionEvent, documentKey, emptySession, interruptSession, MAX_SESSION_BYTES, validateSession } from './session-model.js';

type Entry = { data: ReadingSession; revision: number; saved: number; writing?: Promise<void>; timer?: ReturnType<typeof setTimeout> };
export class SessionStore {
  private entries = new Map<string, Entry>();
  private loading = new Map<string, Promise<ReadingSession>>();
  constructor(private directory: string, private notify: (event: SessionSaveEvent) => void = () => {}) {}
  private file(key: string) { return path.join(this.directory, `${documentKey(key)}.json`); }
  private async read(file: string, key: string) {
    if ((await stat(file)).size > MAX_SESSION_BYTES) throw appError('历史记录文件过大。');
    return validateSession(JSON.parse(await readFile(file, 'utf8')), key);
  }
  async load(key: string, fileName: string): Promise<ReadingSession> {
    documentKey(key);
    const cached = this.entries.get(key);
    if (cached) { await this.flush(key); return cached.data; }
    const pending = this.loading.get(key);
    if (pending) return pending;
    const operation = (async () => {
      let data: ReadingSession;
      try { data = await this.read(this.file(key), key); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') data = emptySession(key, fileName, randomUUID());
        else {
          // Never replace an unreadable history with an empty document.
          try { data = await this.read(`${this.file(key)}.bak`, key); }
          catch { throw appError('无法读取这篇论文的历史记录，原文件已保留。请重试或检查本机存储。'); }
          // Preserve the corrupt primary before recovering the last good copy.
          await copyFile(this.file(key), `${this.file(key)}.corrupt-${Date.now()}`);
          await copyFile(`${this.file(key)}.bak`, this.file(key));
        }
      }
      data = interruptSession(data);
      this.entries.set(key, { data, revision: 0, saved: 0 });
      return data;
    })();
    this.loading.set(key, operation);
    try { return await operation; } finally { this.loading.delete(key); }
  }
  private entry(key: string) {
    const entry = this.entries.get(documentKey(key));
    if (!entry) throw appError('请先打开这篇论文的阅读记录。');
    return entry;
  }
  annotationSnapshot(key: string): Annotation[] {
    return structuredClone(this.entry(key).data.annotations);
  }
  private changed(key: string, data: ReadingSession) {
    const entry = this.entry(key);
    entry.data = data; entry.revision++;
    this.notify({ documentId: key, status: 'saving' });
    if (!entry.timer) entry.timer = setTimeout(() => {
      entry.timer = undefined;
      void this.flush(key).catch(() => {});
    }, 200);
  }
  async update(key: string, action: SessionAction) {
    this.changed(key, applySessionAction(this.entry(key).data, action));
    try { await this.flush(key); }
    catch (error) {
      const id = action.type === 'chat' ? action.answer.id : action.type === 'translation' ? action.entry.id : undefined;
      if (id) this.changed(key, applySessionEvent(this.entry(key).data, { id, type: 'error', message: backendErrorMessage(error) }));
      throw error;
    }
  }
  record(key: string, event: AiEvent) {
    this.changed(key, applySessionEvent(this.entry(key).data, event));
    if (event.type !== 'delta') void this.flush(key).catch(() => {});
  }
  pendingIds(key: string, kind?: 'chat') {
    const data = this.entry(key).data;
    return [...data.chats.flatMap(c => c.messages), ...(kind === 'chat' ? [] : data.translations)].filter(e => e.status === 'streaming').map(e => e.id);
  }
  hasRequest(key: string, id: string, kind: string) {
    const data = this.entry(key).data;
    return (kind === 'chat' ? data.chats.flatMap(c => c.messages) : data.translations).some(e => e.id === id && e.status === 'streaming');
  }
  async suspend(key: string) {
    if (!this.entries.has(documentKey(key))) return;
    this.changed(key, interruptSession(this.entry(key).data));
    await this.flush(key);
  }
  async flush(key: string): Promise<void> {
    const entry = this.entry(key);
    if (entry.timer) { clearTimeout(entry.timer); entry.timer = undefined; }
    if (entry.writing) return entry.writing;
    if (entry.saved === entry.revision) return;
    const operation = (async () => {
      try {
        await mkdir(this.directory, { recursive: true });
        while (entry.saved !== entry.revision) {
          const revision = entry.revision;
          const json = JSON.stringify(entry.data);
          if (Buffer.byteLength(json, 'utf8') > MAX_SESSION_BYTES) throw appError('记录超过本机单篇容量限制。');
          const file = this.file(key), temp = `${file}.tmp`;
          await writeFile(temp, json, { encoding: 'utf8', mode: 0o600, flush: true });
          try { await copyFile(file, `${file}.bak`); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
          await rename(temp, file);
          entry.saved = revision;
        }
        this.notify({ documentId: key, status: 'saved' });
      } catch {
        const error = appError('阅读记录未能保存到本机，请检查磁盘空间或目录权限后重试。');
        this.notify({ documentId: key, status: 'error', message: backendErrorMessage(error) });
        throw error;
      }
    })();
    entry.writing = operation;
    try { await operation; } finally { entry.writing = undefined; }
  }
  async close() {
    for (const [key, entry] of this.entries) this.changed(key, interruptSession(entry.data));
    await Promise.all([...this.entries.keys()].map(key => this.flush(key)));
  }
}
