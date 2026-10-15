import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const host = vi.hoisted(() => ({ directory: '', failRename: false }));
vi.mock('electron', () => ({ app: { getPath: () => host.directory }, net: {}, safeStorage: { isEncryptionAvailable: () => false } }));
vi.mock('node:fs/promises', async original => {
  const fs = await original<typeof import('node:fs/promises')>();
  return { ...fs, rename: (...args: Parameters<typeof fs.rename>) => {
    if (host.failRename) return Promise.reject(new Error('disk rename failed')); return fs.rename(...args);
  } };
});
beforeEach(async () => { vi.resetModules(); host.failRename = false; host.directory = await mkdtemp(path.join(os.tmpdir(), 'aurelia-ai-save-')); });
afterEach(async () => { await rm(host.directory, { recursive: true, force: true }); });
describe('AI settings close drain', () => {
  it('does not make an input-validation error block normal close', async () => {
    const { saveAiSettings, flushAiSettings } = await import('../../electron/ai-service');
    await expect(saveAiSettings({ baseUrl: 'https://example.com/v1', model: '', targetLanguage: '日本語' })).rejects.toThrow();
    await expect(flushAiSettings()).resolves.toBeUndefined();
  });
  it('retains actual storage failures until a successful retry, and ignores later invalid input', async () => {
    const { saveAiSettings, flushAiSettings } = await import('../../electron/ai-service');
    const valid = { baseUrl: 'https://example.com/v1', model: 'test-model', targetLanguage: '日本語' };
    host.failRename = true; await expect(saveAiSettings(valid)).rejects.toThrow('disk rename');
    await expect(flushAiSettings()).rejects.toThrow('disk rename');
    host.failRename = false; await saveAiSettings(valid);
    await expect(saveAiSettings({ ...valid, model: '' })).rejects.toThrow();
    await expect(flushAiSettings()).resolves.toBeUndefined();
    expect(JSON.parse(await readFile(path.join(host.directory, 'ai-settings.json'), 'utf8')).model).toBe('test-model');
  });
});
