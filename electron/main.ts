import { appError, appMessage, backendErrorMessage, setUiLocale, suggestUiLocale } from './i18n.js';
import { AppSettingsStore } from './app-settings.js';
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell } from 'electron';
import { validateExternalUrl } from './external-url.js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cancelAi, cancelAllAi, cancelAllAiAndWait, hasActiveAi, flushAiSettings, getAiSettings, loadAiSettings, runAi, saveAiSettings } from './ai-service.js';
import { SessionStore } from './session-store.js';
import { validateRequest } from './ai-protocol.js';
import { exportNotes } from './notes-export.js';
import type { SessionAction } from './session-types.js';
import { LibraryStore } from './library-store.js';
import { LibraryFiles } from './library-files.js';
import { applyLibraryAction } from './library-model.js';
import type { LibraryAction } from './library-types.js';
import { UpdateService } from './update-service.js';
import { UpdatePreferencesStore } from './update-preferences.js';
import { createUpdateDriver, isUpdateTestBuild, preserveUpdateTestProfile, registeredInstallDirectory } from './update-runtime.js';
import { UPDATE_RELEASE_PAGE } from './update-policy.js';

const here = path.dirname(fileURLToPath(import.meta.url));
app.setName('Aurelia');
// Keep the original profile so renaming the app preserves reading history and settings.
// Explicit profiles (including packaged smoke tests) must remain isolated.
if (!app.commandLine.hasSwitch('user-data-dir')) app.setPath('userData', path.join(app.getPath('appData'), 'paperdesk'));
preserveUpdateTestProfile();
if (process.platform === 'win32') app.setAppUserModelId('com.aurelia.reader');
const developmentUrl = !app.isPackaged ? process.env.PAPERDESK_DEV_URL : undefined;
if (process.env.PAPERDESK_TEST_DIR && !app.isPackaged) app.setPath('userData', process.env.PAPERDESK_TEST_DIR);
// One writer per profile: two processes otherwise overwrite each other's sessions.
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
let window: BrowserWindow | null = null;
app.on('second-instance', () => {
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.show(); window.focus();
});
const sessions = new SessionStore(path.join(app.getPath('userData'), 'reading-sessions'), event => {
  if (window && !window.webContents.isDestroyed()) window.webContents.send('session:save-event', event);
});
const library = new LibraryStore(app.getPath('userData'));
const libraryFiles = new LibraryFiles(library);
let appSettings: AppSettingsStore;
let updatePreparing = false, updateExitReady = false;
let ordinaryClosing = false, updateInstallRequests = 0;
let rendererUpdateReady = false;
const pendingOperations = new Set<Promise<unknown>>();
const mutationChannels = new Set(['app:save-settings', 'ai:save-settings', 'ai:start', 'session:update', 'session:suspend',
  'session:export-notes', 'pdf:open', 'pdf:open-recent', 'pdf:open-drop', 'library:update', 'library:import',
  'library:import-drop', 'library:open', 'library:relocate', 'library:accept-relocation-import', 'update:set-auto-check']);
async function settlePendingOperations() {
  while (pendingOperations.size) await Promise.all([...pendingOperations]);
}
let updater: Promise<UpdateService> | undefined;
let updateTimer: ReturnType<typeof setTimeout> | undefined;
function getUpdater(): Promise<UpdateService> {
  return updater ??= (async () => {
    const testBuild = isUpdateTestBuild(), directory = await registeredInstallDirectory(testBuild);
    const preferences = new UpdatePreferencesStore(app.getPath('userData'));
    let preferenceError = false;
    const saved = await preferences.load().catch(() => { preferenceError = true; return { autoCheck: true, lastCheckedAt: null }; });
    const service = new UpdateService({ currentVersion: app.getVersion(), supported: !!directory, preferences: saved,
      savePreferences: value => preferences.save(value),
      notify: state => { if (window && !window.webContents.isDestroyed()) window.webContents.send('update:state', state); },
      driver: createUpdateDriver({ installDirectory: directory ?? '', testBuild, onInstallStarted: () => { updateExitReady = true; } }),
      shutdown: {
        hasActiveAi,
        confirmStopAi: async () => {
          if (!window || window.isDestroyed()) return false;
          const result = await dialog.showMessageBox(window, { type: 'question', title: appMessage('停止 AI 并更新？'),
            message: appMessage('AI 正在生成。更新前需要停止生成并保存已接收的内容。'),
            buttons: [appMessage('停止生成并更新'), appMessage('继续阅读')], defaultId: 1, cancelId: 1 });
          return result.response === 0;
        },
        freeze: () => { updatePreparing = true; }, stopAi: cancelAllAiAndWait,
        capture: async () => {
          if (!window || window.isDestroyed() || !closeCaptureEnabled) throw new Error('Reading capture unavailable');
          await settlePendingOperations(); await captureBeforeClose(window);
        },
        persist: async () => { await settlePendingOperations(); await Promise.all([sessions.close(), library.flush(), appSettings.flush(), flushAiSettings(), preferences.flush()]); },
        resume: () => { updatePreparing = false; updateExitReady = false; },
      },
    });
    if (ordinaryClosing) service.pauseChecks();
    if (preferenceError) await service.setAutoCheck(saved.autoCheck);
    return service;
  })();
}
async function scheduleAutomaticUpdateCheck() {
  if (!rendererUpdateReady || updatePreparing || ordinaryClosing || updateTimer) return;
  const settings = await appSettings.get();
  if (!settings.locale) return;
  updateTimer = setTimeout(() => {
    updateTimer = undefined;
    if (!rendererUpdateReady || updatePreparing || ordinaryClosing) return;
    void getUpdater().then(service => service.check(false)).catch(() => {});
  }, 10_000);
  updateTimer.unref();
}
async function flushInitializedUpdater() { if (updater) await (await updater).flush(); }
let closeCaptureEnabled = false;
let pendingCloseCapture: { token: string; complete: (error?: string) => void } | undefined;
async function captureBeforeClose(target: BrowserWindow) {
  if (!closeCaptureEnabled || target.webContents.isDestroyed()) return;
  await new Promise<void>((resolve, reject) => {
    const token = randomUUID();
    const timer = setTimeout(() => { pendingCloseCapture = undefined; reject(appError('阅读位置尚未确认保存。')); }, 5000);
    pendingCloseCapture = { token, complete: error => {
      clearTimeout(timer); pendingCloseCapture = undefined;
      if (error) reject(new Error(error)); else resolve();
    } };
    target.webContents.send('library:before-close', token);
  });
}
type Recent = { id: string; name: string; path: string; openedAt: number };
let recent: Recent[] = [];
const recentFile = () => path.join(app.getPath('userData'), 'recent.json');
const productionUrl = pathToFileURL(path.join(here, '../dist/index.html')).href;

async function saveRecent() {
  await mkdir(app.getPath('userData'), { recursive: true });
  await writeFile(recentFile(), JSON.stringify(recent, null, 2), 'utf8');
}

async function openDocument(filePath: string) {
  const opened = await libraryFiles.openPath(filePath);
  const registered = await library.entry(opened.libraryId);
  const entry: Recent = {
    id: opened.id, name: opened.name, path: registered.path, openedAt: Date.now(),
  };
  recent = [entry, ...recent.filter((item) => item.id !== entry.id)].slice(0, 8);
  await saveRecent().catch(() => { /* Reading still works if the recent list cannot be persisted. */ });
  return opened;
}

function handle(channel: string, callback: (...args: any[]) => unknown) {
  ipcMain.handle(channel, (event, ...args) => {
    const url = event.senderFrame?.url;
    const trustedUrl = url === productionUrl || (!!developmentUrl && (url === developmentUrl || url === `${developmentUrl}/`));
    if (!url || !trustedUrl || event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame) {
      throw appError('不支持的请求来源。');
    }
    const captureWrite = channel === 'library:update' && args[0]?.type === 'view' || channel === 'session:suspend';
    if (ordinaryClosing && (mutationChannels.has(channel) || ['update:check', 'update:download', 'update:install'].includes(channel))
      && !(captureWrite && pendingCloseCapture)) throw appError('正在保存并关闭，请稍候。');
    if (updatePreparing && mutationChannels.has(channel) && !captureWrite) throw appError('正在准备更新，请等待保存完成。');
    if (channel === 'update:install') updateInstallRequests++;
    // Electron strips custom Error fields. Encode only errors with application provenance.
    const operation = Promise.resolve().then(() => {
      if (updatePreparing && mutationChannels.has(channel) && !captureWrite) throw appError('正在准备更新，请等待保存完成。');
      return callback(...args);
    }).catch(error => { throw new Error(backendErrorMessage(error)); });
    if (mutationChannels.has(channel)) {
      pendingOperations.add(operation);
      void operation.then(() => pendingOperations.delete(operation), () => pendingOperations.delete(operation));
    }
    if (channel === 'update:install') void operation.then(() => { updateInstallRequests--; }, () => { updateInstallRequests--; });
    return operation;
  });
}

function createWindow() {
  rendererUpdateReady = false;
  window = new BrowserWindow({
    width: 1440, height: 940, minWidth: 960, minHeight: 640,
    title: 'Aurelia', backgroundColor: '#f6f5f1', show: false,
    icon: path.join(here, developmentUrl ? '../public/branding/aurelia.ico' : '../dist/branding/aurelia.ico'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#eaf0e7', symbolColor: '#253b30', height: 38 },
    webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  window.once('ready-to-show', () => window?.show());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.setVisualZoomLevelLimits(1, 1);
  if (developmentUrl) void window.loadURL(developmentUrl);
  else void window.loadFile(path.join(here, '../dist/index.html'));
  const resetRendererUpdateReadiness = () => {
    rendererUpdateReady = false;
    if (updateTimer) clearTimeout(updateTimer);
    updateTimer = undefined;
    cancelAllAi();
  };
  window.webContents.on('render-process-gone', resetRendererUpdateReadiness);
  window.webContents.on('did-start-loading', resetRendererUpdateReadiness);
  window.on('focus', () => { void scheduleAutomaticUpdateCheck().catch(() => {}); });
  const target = window;
  let closing = false, canClose = false;
  target.on('close', event => {
    if (canClose || updateExitReady) return;
    event.preventDefault();
    if (updatePreparing || updateInstallRequests) return;
    if (closing) return;
    closing = true;
    ordinaryClosing = true;
    target.webContents.send('app:closing', true);
    if (updateTimer) clearTimeout(updateTimer);
    updateTimer = undefined;
    void Promise.resolve(updater?.then(service => service.pauseChecks()))
      .then(() => cancelAllAiAndWait()).then(() => captureBeforeClose(target)).then(() => settlePendingOperations())
      .then(() => Promise.all([sessions.close(), library.flush(), appSettings.flush(), flushAiSettings(), flushInitializedUpdater()])).then(() => { canClose = true; target.close(); }).catch(async () => {
      const result = await dialog.showMessageBox(target, { type: 'warning', title: appMessage('阅读记录尚未保存'),
        message: appMessage('阅读记录或论文库未能写入本机。'), detail: appMessage('请检查磁盘空间或目录权限。继续关闭可能丢失最近的内容和阅读位置。'),
        buttons: [appMessage('重试保存'), appMessage('取消关闭'), appMessage('仍然关闭')], defaultId: 0, cancelId: 1 });
      closing = false;
      ordinaryClosing = false;
      if (updater) (await updater).resumeChecks();
      target.webContents.send('app:closing', false);
      if (result.response === 0) target.close();
      else if (result.response === 2) { canClose = true; target.close(); }
    });
  });
  window.on('closed', () => { resetRendererUpdateReadiness(); closeCaptureEnabled = false; pendingCloseCapture?.complete(appMessage('窗口已经关闭。')); window = null; });
  refreshApplicationMenu();
}

function refreshApplicationMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: appMessage('文件'), submenu: [
      { label: appMessage('打开 PDF…'), accelerator: 'CmdOrCtrl+O', click: () => window?.webContents.send('open-requested') },
      { type: 'separator' }, { role: 'quit', label: appMessage('退出') },
    ] },
    { label: appMessage('编辑'), submenu: [{ role: 'copy', label: appMessage('复制') }, { role: 'selectAll', label: appMessage('全选') }] },
    { label: appMessage('视图'), submenu: [
      { role: 'togglefullscreen', label: appMessage('全屏') },
      ...(!app.isPackaged ? [{ role: 'toggleDevTools' as const, label: appMessage('开发者工具') }] : []),
    ] },
  ]));
}

void app.whenReady().then(async () => {
if (!primaryInstance) return;
appSettings = new AppSettingsStore(app.getPath('userData'), app.getLocale());
setUiLocale(suggestUiLocale(app.getLocale()));
// Leave startup usable when permissions block the preference; the first-run gate can retry its load.
await appSettings.load().then(settings => setUiLocale(settings.locale ?? settings.suggestedLocale)).catch(() => {});
await loadAiSettings();
try {
  const value: unknown = JSON.parse(await readFile(recentFile(), 'utf8'));
  if (Array.isArray(value)) recent = value.filter((item): item is Recent =>
    item && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.path === 'string',
  ).slice(0, 8);
} catch { /* First launch. */ }
// Keep the window usable for a visible recovery error; getLibrary continues to reject protected files.
await library.load(recent).catch(() => {});

handle('app:get-settings', () => appSettings.load());
handle('app:get-closing', () => ordinaryClosing);
handle('app:save-settings', async (input: Parameters<AppSettingsStore['save']>[0]) => {
  const settings = await appSettings.save(input);
  setUiLocale(settings.locale!);
  refreshApplicationMenu();
  return settings;
});
handle('update:get-state', async () => (await getUpdater()).getState());
handle('update:check', async () => (await getUpdater()).check(true));
handle('update:download', async () => (await getUpdater()).download());
handle('update:cancel', async () => (await getUpdater()).cancelDownload());
handle('update:install', async () => (await getUpdater()).install());
handle('update:set-auto-check', async (input: unknown) => (await getUpdater()).setAutoCheck(input));
handle('update:ready', () => { rendererUpdateReady = true; return scheduleAutomaticUpdateCheck(); });
handle('update:release-page', () => shell.openExternal(UPDATE_RELEASE_PAGE));

handle('pdf:open', async () => {
  const result = await dialog.showOpenDialog(window!, { title: appMessage('打开学术论文'), filters: [{ name: appMessage('PDF 文档'), extensions: ['pdf'] }], properties: ['openFile'] });
  return result.canceled ? null : openDocument(result.filePaths[0]);
});
handle('pdf:recent', () => recent.map(({ id, name, openedAt }) => ({ id, name, openedAt })));
handle('pdf:open-recent', async (id: unknown) => {
  const entry = recent.find((item) => item.id === id);
  if (!entry) throw appError('未找到这条最近记录，请重新打开文件。');
  return openDocument(entry.path);
});
handle('pdf:open-drop', (filePath: string) => openDocument(filePath));
handle('library:get', () => library.get());
handle('library:update', async (action: LibraryAction) => {
  const current = await library.get();
  // Validate before performing side effects, including session interruption on remove.
  applyLibraryAction(current, action);
  if (action.type === 'entry-remove') {
    return libraryFiles.remove(action.id, sessions, cancelAi);
  }
  return library.update(action);
});
handle('library:import', async (groupId?: string) => {
  const result = await dialog.showOpenDialog(window!, { title: appMessage('导入论文'), filters: [{ name: appMessage('PDF 文档'), extensions: ['pdf'] }], properties: ['openFile', 'multiSelections'] });
  return libraryFiles.importPaths(result.canceled ? [] : result.filePaths, groupId);
});
handle('library:import-drop', (filePaths: string[], groupId?: string) => libraryFiles.importPaths(filePaths, groupId));
handle('library:open', (id: string) => libraryFiles.open(id));
handle('library:relocate', async (id: string) => {
  await library.entry(id);
  const result = await dialog.showOpenDialog(window!, { title: appMessage('重新定位论文'), filters: [{ name: appMessage('PDF 文档'), extensions: ['pdf'] }], properties: ['openFile'] });
  return result.canceled ? { state: await library.get(), outcome: 'canceled' } : libraryFiles.relocate(id, result.filePaths[0]);
});
handle('library:accept-relocation-import', (id: string) => libraryFiles.acceptRelocationImport(id));
handle('library:reveal', (id: string) => libraryFiles.reveal(id, filePath => shell.showItemInFolder(filePath)));
handle('library:close-listener', (enabled: unknown) => {
  if (typeof enabled !== 'boolean') throw appError('无效的关闭通知设置。');
  closeCaptureEnabled = enabled;
});
handle('library:close-captured', (token: unknown, error?: unknown) => {
  if (typeof token !== 'string' || (error !== undefined && (typeof error !== 'string' || error.length > 2000))) throw appError('无效的关闭确认。');
  if (pendingCloseCapture?.token === token) pendingCloseCapture.complete(error as string | undefined);
});
handle('clipboard:write', (value: unknown) => {
  if (typeof value !== 'string' || value.length > 10_000_000) throw appError('无效的复制内容。');
  clipboard.writeText(value);
});
handle('navigation:open-external', (value: unknown) => shell.openExternal(validateExternalUrl(value)));
handle('ai:settings', getAiSettings);
handle('ai:save-settings', saveAiSettings);
handle('ai:cancel', cancelAi);
handle('session:load', (key: string, fileName: string) => sessions.load(key, fileName));
handle('session:update', (key: string, action: SessionAction) => {
  if (action?.type === 'new-chat' || action?.type === 'select-chat') for (const id of sessions.pendingIds(key, 'chat')) cancelAi(id);
  return sessions.update(key, action);
});
handle('session:suspend', (key: string) => {
  for (const id of sessions.pendingIds(key)) cancelAi(id);
  return sessions.suspend(key);
});
handle('session:flush', (key: string) => sessions.flush(key));
let notesExportPending = false;
handle('session:export-notes', async (key: string, fileName: string) => {
  if (notesExportPending) throw appError('已有笔记正在导出，请先完成或取消保存。');
  notesExportPending = true;
  try {
    return await exportNotes(sessions, key, fileName, async suggested => {
      const result = await dialog.showSaveDialog(window!, { title: appMessage('导出阅读笔记'), defaultPath: suggested,
        filters: [{ name: appMessage('Markdown 笔记'), extensions: ['md'] }], properties: ['showOverwriteConfirmation'] });
      return result.canceled ? null : result.filePath ?? null;
    });
  } finally { notesExportPending = false; }
});
handle('ai:start', (request: unknown, documentId?: string) => {
  const recipient = window?.webContents;
  const parsed = validateRequest(request);
  if (documentId !== undefined && !sessions.hasRequest(documentId, parsed.id, parsed.kind)) throw appError('这条请求的阅读记录尚未保存，请重试。');
  return runAi(parsed, event => {
    if (documentId && sessions.hasRequest(documentId, parsed.id, parsed.kind)) sessions.record(documentId, event);
    if (recipient && !recipient.isDestroyed()) recipient.send('ai:event', event);
  }).catch(error => {
    if (documentId && sessions.hasRequest(documentId, parsed.id, parsed.kind)) sessions.record(documentId, { id: parsed.id, type: 'error', message: backendErrorMessage(error instanceof Error ? error : appError('请求未能开始。')) });
    throw error;
  });
});
createWindow();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { if (updateTimer) clearTimeout(updateTimer); updateTimer = undefined; });
app.on('activate', () => { if (primaryInstance && BrowserWindow.getAllWindows().length === 0) createWindow(); });
