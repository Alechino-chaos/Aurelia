import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AppSettingsStore } from '../electron/app-settings';

const directories: string[] = [];
async function profile() { const dir = await mkdtemp(path.join(os.tmpdir(), 'aurelia-settings-')); directories.push(dir); return dir; }
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
describe('separate desktop language preference', () => {
  it('leaves a missing preference unconfirmed without creating files', async () => {
    const dir = await profile();
    expect(await new AppSettingsStore(dir, 'zh-TW').load()).toEqual({ locale: null, suggestedLocale: 'zh-CN' });
    expect(await readdir(dir)).toEqual([]);
  });
  it('persists only a confirmed locale and leaves unrelated profile data unchanged', async () => {
    const dir = await profile();
    await writeFile(path.join(dir, 'ai-settings.json'), 'AI settings original');
    await writeFile(path.join(dir, 'library.json'), 'library original');
    const store = new AppSettingsStore(dir, 'de-DE');
    expect(await store.save({ locale: 'zh-CN' })).toEqual({ locale: 'zh-CN', suggestedLocale: 'en' });
    expect(JSON.parse(await readFile(path.join(dir, 'app-settings.json'), 'utf8'))).toEqual({ locale: 'zh-CN' });
    expect(await new AppSettingsStore(dir, 'en-US').get()).toEqual({ locale: 'zh-CN', suggestedLocale: 'en' });
    expect(await readFile(path.join(dir, 'ai-settings.json'), 'utf8')).toBe('AI settings original');
    expect(await readFile(path.join(dir, 'library.json'), 'utf8')).toBe('library original');
  });
  it.each(['{broken', '{"locale":"fr"}', '{"locale":null}', '{"locale":"en","apiKey":"secret"}'])('preserves malformed evidence until explicit save: %s', async raw => {
    const dir = await profile(), file = path.join(dir, 'app-settings.json');
    await writeFile(file, raw);
    const store = new AppSettingsStore(dir, 'en-US');
    expect(await store.load()).toEqual({ locale: null, suggestedLocale: 'en', warning: 'invalid' });
    expect(await readFile(file, 'utf8')).toBe(raw);
    expect(await readdir(dir)).toEqual(['app-settings.json']);
    await store.save({ locale: 'en' });
    const backup = (await readdir(dir)).find(name => name.startsWith('app-settings.json.corrupt-'))!;
    expect(await readFile(path.join(dir, backup), 'utf8')).toBe(raw);
    expect(await store.get()).toEqual({ locale: 'en', suggestedLocale: 'en' });
  });
  it('rejects unsupported or malformed input before touching disk', async () => {
    const dir = await profile(), store = new AppSettingsStore(dir, 'en');
    for (const value of [null, { locale: 'fr' }, { locale: 'en', extra: 1 }, ['en']]) await expect(store.save(value as never)).rejects.toThrow();
    expect(await readdir(dir)).toEqual([]);
  });
  it('protects unreadable settings and allows load retry after the obstruction is repaired', async () => {
    const dir = await profile(), file = path.join(dir, 'app-settings.json');
    await mkdir(file);
    const store = new AppSettingsStore(dir, 'en');
    await expect(store.load()).rejects.toThrow();
    await expect(store.save({ locale: 'en' })).rejects.toThrow();
    expect(await readdir(file)).toEqual([]);
    await rm(file, { recursive: true });
    await writeFile(file, '{"locale":"zh-CN"}');
    expect((await store.load()).locale).toBe('zh-CN');
  });
  it('preserves memory and the previous disk choice on failed save then supports retry', async () => {
    const dir = await profile(), store = new AppSettingsStore(dir, 'en');
    await store.save({ locale: 'zh-CN' });
    // A directory occupying the fixed temporary path reproduces a real write failure.
    await mkdir(path.join(dir, 'app-settings.json.tmp'));
    await expect(store.save({ locale: 'en' })).rejects.toThrow();
    expect((await store.get()).locale).toBe('zh-CN');
    expect(JSON.parse(await readFile(path.join(dir, 'app-settings.json'), 'utf8')).locale).toBe('zh-CN');
    await rm(path.join(dir, 'app-settings.json.tmp'), { recursive: true });
    expect((await store.save({ locale: 'en' })).locale).toBe('en');
  });
  it('serializes concurrent writes and publishes each durable result in invocation order', async () => {
    const dir = await profile(), store = new AppSettingsStore(dir, 'en');
    const results = await Promise.all([store.save({ locale: 'en' }), store.save({ locale: 'zh-CN' }), store.save({ locale: 'en' })]);
    expect(results.map(value => value.locale)).toEqual(['en', 'zh-CN', 'en']);
    expect((await new AppSettingsStore(dir, 'en').load()).locale).toBe('en');
  });
});
