import { mkdir, readFile, open, rename, copyFile, unlink, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { appError, isUiLocale, suggestUiLocale } from './i18n.js';
import type { AppSettings, UiLocale } from './i18n.js';
export type { AppSettings, UiLocale } from './i18n.js';

function confirmed(value: unknown): value is { locale: UiLocale } {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === 1 && isUiLocale((value as { locale?: unknown }).locale);
}

/** A separate, serialized preference; a suggestion is never a confirmed choice. */
export class AppSettingsStore {
  private state?: AppSettings;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly suggestedLocale: UiLocale;
  constructor(private directory: string, systemLocale: string) { this.suggestedLocale = suggestUiLocale(systemLocale); }
  private file() { return path.join(this.directory, 'app-settings.json'); }
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result;
  }
  private async read(): Promise<AppSettings> {
    let raw: string;
    try {
      const info = await stat(this.file());
      if (!info.isFile()) throw new Error('Settings path is not a file');
      if (info.size > 64 * 1024) return { locale: null, suggestedLocale: this.suggestedLocale, warning: 'invalid' };
      raw = await readFile(this.file(), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { locale: null, suggestedLocale: this.suggestedLocale };
      throw appError('无法读取界面语言设置，原文件已保留。请检查目录权限后重试。', { cause: error });
    }
    try {
      const value: unknown = JSON.parse(raw);
      if (confirmed(value)) return { locale: value.locale, suggestedLocale: this.suggestedLocale };
    } catch { /* Preserve malformed contents until the user explicitly confirms replacement. */ }
    return { locale: null, suggestedLocale: this.suggestedLocale, warning: 'invalid' };
  }
  load(): Promise<AppSettings> {
    return this.serialize(async () => {
      this.state = await this.read();
      return { ...this.state };
    });
  }
  get(): Promise<AppSettings> {
    return this.serialize(async () => { this.state ??= await this.read(); return { ...this.state }; });
  }
  save(input: { locale: UiLocale }): Promise<AppSettings> {
    if (!confirmed(input)) return Promise.reject(appError('请选择有效的界面语言。'));
    const locale = input.locale;
    return this.serialize(async () => {
      // Re-read before every write, protecting newly inaccessible/modified evidence.
      const disk = await this.read();
      const file = this.file(), temporary = `${file}.tmp-${randomUUID()}`;
      let ownsTemporary = false;
      try {
        await mkdir(this.directory, { recursive: true });
        const handle = await open(temporary, 'wx', 0o600);
        ownsTemporary = true;
        try { await handle.writeFile(JSON.stringify({ locale }, null, 2), 'utf8'); await handle.sync(); }
        finally { await handle.close(); }
        if (disk.warning === 'invalid') await copyFile(file, `${file}.corrupt-${Date.now()}-${randomUUID()}`);
        await rename(temporary, file);
        ownsTemporary = false;
        this.state = { locale, suggestedLocale: this.suggestedLocale };
        return { ...this.state };
      } catch (error) {
        throw appError('界面语言未能保存，请检查磁盘空间或目录权限后重试。', { cause: error });
      } finally {
        if (ownsTemporary) await unlink(temporary).catch(() => {});
      }
    });
  }
}
