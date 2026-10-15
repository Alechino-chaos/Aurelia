import { mkdir, readFile, open, rename, unlink, stat, copyFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { UpdatePreferences } from './update-service.js';
const defaults = (): UpdatePreferences => ({ autoCheck: true, lastCheckedAt: null });
function valid(value: unknown): value is UpdatePreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const input = value as UpdatePreferences;
  return Object.keys(value).length === 2 && typeof input.autoCheck === 'boolean'
    && (input.lastCheckedAt === null || (Number.isSafeInteger(input.lastCheckedAt) && input.lastCheckedAt >= 0));
}
export class UpdatePreferencesStore {
  private queue: Promise<unknown> = Promise.resolve();
  private pending?: Promise<void>;
  constructor(private directory: string) {}
  private file() { return path.join(this.directory, 'update-preferences.json'); }
  async load(): Promise<UpdatePreferences> {
    await this.queue;
    try {
      const info = await stat(this.file());
      if (!info.isFile()) throw new Error('Preference path is not a file');
      if (info.size > 64 * 1024) return defaults();
      let value: unknown; try { value = JSON.parse(await readFile(this.file(), 'utf8')); } catch (error) { if (error instanceof SyntaxError) return defaults(); throw error; }
      return valid(value) ? value : defaults();
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaults(); throw error; }
  }
  save(value: UpdatePreferences): Promise<void> {
    if (!valid(value)) return Promise.reject(new Error('Invalid update preferences'));
    const snapshot = { ...value };
    const operation = this.queue.then(async () => {
      const file = this.file(), temporary = `${file}.tmp-${randomUUID()}`;
      let ownsTemporary = false;
      try {
        // Preserve malformed preference evidence before an explicit change/next check.
        try {
          const info = await stat(file); if (!info.isFile()) throw new Error('Preference path is not a file');
          let validDisk = false;
          if (info.size <= 64 * 1024) { try { validDisk = valid(JSON.parse(await readFile(file, 'utf8'))); } catch (error) { if (!(error instanceof SyntaxError)) throw error; } }
          if (!validDisk) await copyFile(file, `${file}.corrupt-${Date.now()}-${randomUUID()}`);
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        await mkdir(this.directory, { recursive: true });
        const handle = await open(temporary, 'wx', 0o600); ownsTemporary = true;
        try { await handle.writeFile(JSON.stringify(snapshot, null, 2), 'utf8'); await handle.sync(); } finally { await handle.close(); }
        await rename(temporary, file); ownsTemporary = false;
      } finally { if (ownsTemporary) await unlink(temporary).catch(() => {}); }
    });
    this.pending = operation; this.queue = operation.catch(() => {}); return operation;
  }
  async flush(): Promise<void> { await this.pending; }
}
