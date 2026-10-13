import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const host = vi.hoisted(() => ({ directory: '', locale: 'en-US', callbacks: new Map<string, (...args: any[]) => any>(), windows: [] as any[], menus: [] as any[] }));
vi.mock('electron', () => ({
  app: { isPackaged: true, setName() {}, commandLine: { hasSwitch: () => true }, getPath: () => host.directory,
    setPath() {}, setAppUserModelId() {}, requestSingleInstanceLock: () => true, on() {}, quit() {},
    whenReady: () => Promise.resolve(), getLocale: () => host.locale },
  BrowserWindow: class {
    static getAllWindows() { return host.windows; }
    webContents = { mainFrame: { url: '' }, send() {}, isDestroyed: () => false, setWindowOpenHandler() {}, on() {},
      session: { setPermissionRequestHandler() {} }, setVisualZoomLevelLimits() {} };
    constructor() { host.windows.push(this); }
    once() {} on() {} loadFile() {} loadURL() {}
  },
  ipcMain: { handle: (channel: string, callback: (...args: any[]) => any) => host.callbacks.set(channel, callback) },
  Menu: { buildFromTemplate: (template: any) => template, setApplicationMenu: (menu: any) => host.menus.push(menu) },
  dialog: {}, clipboard: {}, shell: {},
}));
vi.mock('../electron/ai-service', () => ({ loadAiSettings: async () => {}, getAiSettings() {}, saveAiSettings() {}, runAi() {}, cancelAi() {}, cancelAllAi() {} }));
vi.mock('../electron/session-store', () => ({ SessionStore: class {} }));
vi.mock('../electron/library-store', () => ({ LibraryStore: class { async load() {} } }));
vi.mock('../electron/library-files', () => ({ LibraryFiles: class {} }));

function sender(foreign = false) {
  const target = host.windows[0].webContents;
  const url = new URL('../dist/index.html', new URL('../electron/main.ts', import.meta.url)).href;
  target.mainFrame.url = url;
  return { sender: target, senderFrame: foreign ? { url } : target.mainFrame };
}
beforeEach(async () => {
  vi.resetModules();
  host.directory = await mkdtemp(path.join(os.tmpdir(), 'aurelia-settings-ipc-'));
  host.callbacks.clear(); host.windows.length = 0; host.menus.length = 0;
  await import('../electron/main');
  await vi.waitFor(() => expect(host.windows).toHaveLength(1));
});
afterEach(async () => { await rm(host.directory, { recursive: true, force: true }); });

describe('trusted desktop language bridge', () => {
  it('creates a recovery window when preference reading fails and supports load retry', async () => {
    vi.resetModules(); host.windows.length = 0; host.callbacks.clear();
    const file = path.join(host.directory, 'app-settings.json');
    await mkdir(file);
    await import('../electron/main');
    await vi.waitFor(() => expect(host.windows).toHaveLength(1));
    const get = host.callbacks.get('app:get-settings')!;
    await expect(get(sender())).rejects.toThrow('[[aurelia-ui]]');
    expect(await readFile(file, 'utf8').catch(() => 'protected')).toBe('protected');
    await rm(file, { recursive: true });
    expect((await get(sender())).locale).toBeNull();
  });
  it('loads a saved preference before building native menus', async () => {
    vi.resetModules(); host.windows.length = 0; host.callbacks.clear(); host.menus.length = 0;
    await writeFile(path.join(host.directory, 'app-settings.json'), '{"locale":"zh-CN"}');
    await import('../electron/main');
    await vi.waitFor(() => expect(host.windows).toHaveLength(1));
    expect(host.menus.at(-1)[0].label).toBe('文件');
    expect((await host.callbacks.get('app:get-settings')!(sender())).locale).toBe('zh-CN');
  });
  it('requires the trusted main frame for both preference channels', async () => {
    for (const channel of ['app:get-settings', 'app:save-settings']) {
      expect(() => host.callbacks.get(channel)!(sender(true), { locale: 'en' })).toThrow('Unsupported sender');
    }
  });
  it('rejects malformed input and refreshes native menus only after a durable save', async () => {
    const get = host.callbacks.get('app:get-settings')!, save = host.callbacks.get('app:save-settings')!;
    expect(await get(sender())).toEqual({ locale: null, suggestedLocale: 'en' });
    expect(host.menus.at(-1)[0].label).toBe('File');
    const count = host.menus.length;
    await expect(save(sender(), { locale: 'fr' })).rejects.toThrow();
    expect(host.menus).toHaveLength(count);
    await mkdir(path.join(host.directory, 'app-settings.json.tmp'));
    await expect(save(sender(), { locale: 'zh-CN' })).rejects.toThrow('[[aurelia-ui]]');
    expect(host.menus).toHaveLength(count);
    expect((await get(sender())).locale).toBeNull();
    await rm(path.join(host.directory, 'app-settings.json.tmp'), { recursive: true });
    expect((await save(sender(), { locale: 'zh-CN' })).locale).toBe('zh-CN');
    expect(JSON.parse(await readFile(path.join(host.directory, 'app-settings.json'), 'utf8')).locale).toBe('zh-CN');
    expect(host.menus.at(-1)[0].label).toBe('文件');
  });
});
