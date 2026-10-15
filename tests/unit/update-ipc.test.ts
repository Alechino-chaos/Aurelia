import { mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const host = vi.hoisted(() => ({ directory: '', callbacks: new Map<string, (...args: any[]) => any>(), windows: [] as any[],
  checks: 0, downloads: 0, installs: 0, saveFailure: false, frozen: false, saveOrder: [] as string[], external: '', capture: true,
  delayPreferences: false, pendingRenames: [] as { resolve(): void; reject(error: Error): void }[], closeCount: 0, warnings: 0,
  registrations: 0, delaySessions: false, completeSessions: undefined as (() => void) | undefined,
  delayCheck: false, completeCheck: undefined as (() => void) | undefined, closingStates: [] as boolean[] }));
vi.mock('node:fs/promises', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs/promises')>();
  return { ...fs, rename: (...args: Parameters<typeof fs.rename>) => {
    if (!host.delayPreferences || !String(args[1]).endsWith('update-preferences.json')) return fs.rename(...args);
    return new Promise<void>((resolve, reject) => host.pendingRenames.push({
      resolve: () => { void fs.rename(...args).then(resolve, reject); }, reject,
    }));
  } };
});
vi.mock('electron', () => ({
  app: { isPackaged: true, setName() {}, commandLine: { hasSwitch: () => true }, getPath: () => host.directory,
    setPath() {}, setAppUserModelId() {}, requestSingleInstanceLock: () => true, on() {}, quit() {},
    whenReady: () => Promise.resolve(), getLocale: () => 'en', getVersion: () => '0.10.0' },
  BrowserWindow: class {
    static getAllWindows() { return host.windows; }
    webContents = { mainFrame: { url: '' }, send(channel: string, token: string) {
      if (channel === 'app:closing') host.closingStates.push(token as unknown as boolean);
      if (channel === 'library:before-close' && host.capture) {
        host.saveOrder.push('capture'); void host.callbacks.get('library:close-captured')!(sender(), token);
      }
    }, isDestroyed: () => false, setWindowOpenHandler() {}, on() {},
    session: { setPermissionRequestHandler() {} }, setVisualZoomLevelLimits() {} };
    constructor() { host.windows.push(this); } isDestroyed() { return false; }
    events = new Map<string, ((...args: any[]) => void)[]>();
    once() {} on(name: string, callback: (...args: any[]) => void) { this.events.set(name, [...(this.events.get(name) ?? []), callback]); }
    emit(name: string, ...args: any[]) { for (const listener of this.events.get(name) ?? []) listener(...args); }
    close() { host.closeCount++; this.emit('close', { preventDefault() {} }); }
    loadFile() {} loadURL() {}
  },
  ipcMain: { handle: (channel: string, callback: (...args: any[]) => any) => host.callbacks.set(channel, callback) },
  Menu: { buildFromTemplate: (template: unknown) => template, setApplicationMenu() {} },
  dialog: { async showMessageBox() { host.warnings++; return { response: 1 }; } }, clipboard: {}, shell: { async openExternal(url: string) { host.external = url; } },
}));
vi.mock('../../electron/update-runtime', () => ({ isUpdateTestBuild: () => false, preserveUpdateTestProfile() {}, registeredInstallDirectory: async () => { host.registrations++; return 'C:\\Installed'; },
  createUpdateDriver: () => ({ async check() { host.checks++; if (host.delayCheck) await new Promise<void>(resolve => { host.completeCheck = resolve; }); return { version: '0.11.0' }; },
    download() { host.downloads++; return { promise: Promise.resolve(), cancel() {} }; }, async validateDownloaded() {}, async install() { host.installs++; } }) }));
vi.mock('../../electron/ai-service', () => ({ loadAiSettings: async () => {}, getAiSettings() {}, saveAiSettings() {}, runAi() {}, cancelAi() {}, cancelAllAi() {},
  hasActiveAi: () => false, async cancelAllAiAndWait() { host.saveOrder.push('AI settled'); }, async flushAiSettings() { host.saveOrder.push('AI settings saved'); } }));
vi.mock('../../electron/session-store', () => ({ SessionStore: class { async close() {
  host.saveOrder.push('sessions saved'); if (host.saveFailure) throw new Error('disk failure');
  if (host.delaySessions) await new Promise<void>(resolve => { host.completeSessions = resolve; });
} } }));
vi.mock('../../electron/library-store', () => ({ LibraryStore: class { async load() {} async flush() { host.saveOrder.push('library saved'); } } }));
vi.mock('../../electron/library-files', () => ({ LibraryFiles: class {} }));
function sender(foreign = false) {
  const target = host.windows[0].webContents;
  const url = new URL('../../dist/index.html', import.meta.url).href;
  target.mainFrame.url = url;
  return { sender: target, senderFrame: foreign ? { url } : target.mainFrame };
}
function invoke(channel: string, ...args: unknown[]) { return host.callbacks.get(channel)!(sender(), ...args); }
beforeEach(async () => {
  vi.resetModules(); host.directory = await mkdtemp(path.join(os.tmpdir(), 'aurelia-update-ipc-'));
  host.callbacks.clear(); host.windows.length = 0; host.checks = 0; host.downloads = 0; host.installs = 0; host.saveFailure = false; host.capture = true; host.saveOrder = [];
  host.delayPreferences = false; host.pendingRenames = []; host.closeCount = 0; host.warnings = 0;
  host.registrations = 0; host.delaySessions = false; host.completeSessions = undefined;
  host.delayCheck = false; host.completeCheck = undefined; host.closingStates = [];
  await import('../../electron/main'); await vi.waitFor(() => expect(host.windows).toHaveLength(1));
});
afterEach(async () => { vi.useRealTimers(); await rm(host.directory, { recursive: true, force: true }); });
describe('trusted update IPC and real main shutdown bridge', () => {
  it('blocks new mutations synchronously during normal close, while draining an already accepted save', async () => {
    host.delaySessions = true;
    const accepted = invoke('app:save-settings', { locale: 'en' });
    host.windows[0].emit('close', { preventDefault() {} });
    expect(() => invoke('app:save-settings', { locale: 'zh-CN' })).toThrow();
    expect(() => invoke('update:install')).toThrow();
    expect(() => invoke('ai:start', {})).toThrow();
    expect(() => invoke('session:suspend', 'late')).toThrow();
    await accepted;
    await vi.waitFor(() => expect(host.completeSessions).toBeDefined());
    expect(host.closeCount).toBe(0); expect(host.closingStates).toEqual([true]);
    host.completeSessions!(); await vi.waitFor(() => expect(host.closeCount).toBe(1));
    expect(JSON.parse(await readFile(path.join(host.directory, 'app-settings.json'), 'utf8')).locale).toBe('en');
  });
  it('does not wait for a network check or enqueue its late timestamp after ordinary close', async () => {
    host.delayCheck = true;
    const check = invoke('update:check'); await vi.waitFor(() => expect(host.completeCheck).toBeDefined());
    host.windows[0].emit('close', { preventDefault() {} });
    try { await vi.waitFor(() => expect(host.closeCount).toBe(1), { timeout: 500 }); }
    finally { host.completeCheck!(); await check; }
    await expect(readFile(path.join(host.directory, 'update-preferences.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(host.installs).toBe(0);
  });
  it('restores editing and checking when failed normal close is cancelled', async () => {
    host.saveFailure = true; await invoke('update:get-state');
    host.windows[0].emit('close', { preventDefault() {} });
    await vi.waitFor(() => expect(host.closingStates).toEqual([true, false]));
    await invoke('app:save-settings', { locale: 'en' });
    await invoke('update:check'); expect(host.checks).toBe(1); expect(host.closeCount).toBe(0);
    host.saveFailure = false; host.windows[0].emit('close', { preventDefault() {} });
    await vi.waitFor(() => expect(host.closeCount).toBe(1));
  });
  it('rejects foreign frames on every update method and fixes the release-page destination', async () => {
    for (const channel of ['update:get-state', 'update:check', 'update:download', 'update:cancel', 'update:install', 'update:set-auto-check', 'update:ready', 'update:release-page'])
      expect(() => host.callbacks.get(channel)!(sender(true))).toThrow('Unsupported sender');
    await invoke('update:release-page', 'http://evil.test'); expect(host.external).toBe('https://github.com/Alechino-chaos/Aurelia/releases/latest');
  });
  it('waits for a confirmed locale and renderer readiness before scheduling an automatic check', async () => {
    vi.useFakeTimers(); await invoke('update:ready'); await vi.advanceTimersByTimeAsync(10_001); expect(host.checks).toBe(0);
    await invoke('app:save-settings', { locale: 'en' }); await invoke('update:ready'); await vi.advanceTimersByTimeAsync(10_001);
    await vi.waitFor(() => expect(host.checks).toBe(1)); expect(host.downloads).toBe(0);
  });
  it('checks on focus after 24 hours only after renderer and confirmed language readiness', async () => {
    vi.useFakeTimers(); const target = host.windows[0]; target.emit('focus'); await vi.advanceTimersByTimeAsync(10_001); expect(host.checks).toBe(0);
    await invoke('app:save-settings', { locale: 'en' }); target.emit('focus'); await vi.advanceTimersByTimeAsync(10_001); expect(host.checks).toBe(0);
    await invoke('update:ready'); await vi.advanceTimersByTimeAsync(10_001); await vi.waitFor(() => expect(host.checks).toBe(1));
    target.emit('focus'); await vi.advanceTimersByTimeAsync(10_001); expect(host.checks).toBe(1);
    await vi.advanceTimersByTimeAsync(86_400_000); target.emit('focus'); await vi.advanceTimersByTimeAsync(10_001);
    await vi.waitFor(() => expect(host.checks).toBe(2)); expect(host.downloads).toBe(0);
    await invoke('update:set-auto-check', false); await vi.advanceTimersByTimeAsync(86_400_000); target.emit('focus'); await vi.advanceTimersByTimeAsync(10_001);
    expect(host.checks).toBe(2);
  });
  it('ordinary close waits for a pending update preference write without launching an installer', async () => {
    await invoke('update:get-state'); host.delayPreferences = true;
    const toggle = invoke('update:set-auto-check', false); await vi.waitFor(() => expect(host.pendingRenames).toHaveLength(1));
    host.windows[0].emit('close', { preventDefault() {} });
    await vi.waitFor(() => expect(host.saveOrder).toContain('AI settled'));
    expect(host.closeCount).toBe(0); host.pendingRenames[0].resolve(); await toggle;
    await vi.waitFor(() => expect(host.closeCount).toBe(1)); expect(host.installs).toBe(0);
  });
  it('ordinary close reports a failed update preference write and keeps the application open', async () => {
    await invoke('update:get-state'); host.delayPreferences = true;
    const toggle = invoke('update:set-auto-check', false); await vi.waitFor(() => expect(host.pendingRenames).toHaveLength(1));
    host.windows[0].emit('close', { preventDefault() {} });
    await vi.waitFor(() => expect(host.saveOrder).toContain('AI settled'));
    host.pendingRenames[0].reject(new Error('rename denied')); await toggle;
    await vi.waitFor(() => expect(host.warnings).toBe(1)); expect(host.closeCount).toBe(0); expect(host.installs).toBe(0);
  });
  it('ordinary close drains an in-progress check timestamp write', async () => {
    await invoke('update:get-state'); host.delayPreferences = true;
    const check = invoke('update:check'); await vi.waitFor(() => expect(host.pendingRenames).toHaveLength(1));
    host.windows[0].emit('close', { preventDefault() {} });
    await vi.waitFor(() => expect(host.saveOrder).toContain('sessions saved')); expect(host.closeCount).toBe(0);
    host.pendingRenames[0].resolve(); await check; await vi.waitFor(() => expect(host.closeCount).toBe(1));
  });
  it('ordinary close does not initialize an unused updater', async () => {
    host.windows[0].emit('close', { preventDefault() {} });
    await vi.waitFor(() => expect(host.closeCount).toBe(1)); expect(host.registrations).toBe(0); expect(host.checks).toBe(0);
  });
  it('freezes new preference mutations while an install waits for durable saves', async () => {
    await invoke('library:close-listener', true); await invoke('update:check'); await invoke('update:download'); host.delaySessions = true;
    const install = invoke('update:install'); await vi.waitFor(() => expect(host.completeSessions).toBeDefined());
    expect(() => invoke('update:set-auto-check', false)).toThrow('Preparing the update');
    host.completeSessions!(); await install; expect(host.installs).toBe(1);
  });
  it('captures reading state and blocks installer launch when any save fails, then retries safely', async () => {
    await invoke('library:close-listener', true); await invoke('update:check'); await invoke('update:download'); host.saveFailure = true;
    expect((await invoke('update:install')).error).toBe('save'); expect(host.installs).toBe(0);
    expect(host.saveOrder.slice(0, 2)).toEqual(['AI settled', 'capture']);
    host.saveFailure = false; expect((await invoke('update:install')).phase).toBe('preparing'); expect(host.installs).toBe(1);
  });
});
