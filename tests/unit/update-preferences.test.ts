import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { UpdatePreferencesStore } from '../../electron/update-preferences';
describe('separate update preferences', () => {
  it('keeps locale/AI data intact and persists checks with atomic replacement', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'aurelia-update-'));
    try {
      await writeFile(path.join(dir, 'app-settings.json'), '{"locale":"en"}');
      const store = new UpdatePreferencesStore(dir);
      expect(await store.load()).toEqual({ autoCheck: true, lastCheckedAt: null });
      await Promise.all([store.save({ autoCheck: false, lastCheckedAt: 10 }), store.save({ autoCheck: true, lastCheckedAt: 20 })]);
      expect(await new UpdatePreferencesStore(dir).load()).toEqual({ autoCheck: true, lastCheckedAt: 20 });
      expect(await readFile(path.join(dir, 'app-settings.json'), 'utf8')).toBe('{"locale":"en"}');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('preserves malformed evidence and refuses to overwrite an unreadable path', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'aurelia-update-'));
    try {
      const file = path.join(dir, 'update-preferences.json'); await writeFile(file, '{broken');
      const store = new UpdatePreferencesStore(dir); expect((await store.load()).autoCheck).toBe(true);
      expect(await readFile(file, 'utf8')).toBe('{broken');
      await rm(file); await mkdir(file);
      await expect(store.save({ autoCheck: false, lastCheckedAt: null })).rejects.toThrow();
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
