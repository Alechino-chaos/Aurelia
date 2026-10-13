import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { AiEvent, AiRequest, AiSettingsInput } from './ai-types.js';
import type { SessionAction, SessionSaveEvent } from './session-types.js';
import type { LibraryAction } from './library-types.js';

contextBridge.exposeInMainWorld('paperdesk', {
  openPdf: () => ipcRenderer.invoke('pdf:open'),
  getRecent: () => ipcRenderer.invoke('pdf:recent'),
  openRecent: (id: string) => ipcRenderer.invoke('pdf:open-recent', id),
  openDropped: (file: File) => ipcRenderer.invoke('pdf:open-drop', webUtils.getPathForFile(file)),
  getLibrary: () => ipcRenderer.invoke('library:get'),
  updateLibrary: (action: LibraryAction) => ipcRenderer.invoke('library:update', action),
  importPapers: (groupId?: string) => ipcRenderer.invoke('library:import', groupId),
  importDroppedPapers: (files: File[], groupId?: string) => ipcRenderer.invoke('library:import-drop', files.map(file => webUtils.getPathForFile(file)), groupId),
  openLibraryPaper: (id: string) => ipcRenderer.invoke('library:open', id),
  relocateLibraryPaper: (id: string) => ipcRenderer.invoke('library:relocate', id),
  acceptRelocationImport: (id: string) => ipcRenderer.invoke('library:accept-relocation-import', id),
  revealLibraryPaper: (id: string) => ipcRenderer.invoke('library:reveal', id),
  onBeforeClose: (callback: () => Promise<void>) => {
    const listener = (_event: Electron.IpcRendererEvent, token: string) => {
      void Promise.resolve().then(callback).then(
        () => ipcRenderer.invoke('library:close-captured', token),
        error => ipcRenderer.invoke('library:close-captured', token, error instanceof Error ? error.message.slice(0, 2000) : '阅读位置未能保存。'),
      ).catch(() => {});
    };
    ipcRenderer.on('library:before-close', listener);
    void ipcRenderer.invoke('library:close-listener', true).catch(() => {});
    return () => {
      ipcRenderer.removeListener('library:before-close', listener);
      void ipcRenderer.invoke('library:close-listener', false).catch(() => {});
    };
  },
  writeClipboard: (text: string) => ipcRenderer.invoke('clipboard:write', text),
  openExternalUrl: (url: string) => ipcRenderer.invoke('navigation:open-external', url),
  getAiSettings: () => ipcRenderer.invoke('ai:settings'),
  saveAiSettings: (settings: AiSettingsInput) => ipcRenderer.invoke('ai:save-settings', settings),
  startAi: (request: AiRequest, documentId?: string) => ipcRenderer.invoke('ai:start', request, documentId),
  loadReadingSession: (documentId: string, fileName: string) => ipcRenderer.invoke('session:load', documentId, fileName),
  updateReadingSession: (documentId: string, action: SessionAction) => ipcRenderer.invoke('session:update', documentId, action),
  suspendReadingSession: (documentId: string) => ipcRenderer.invoke('session:suspend', documentId),
  flushReadingSession: (documentId: string) => ipcRenderer.invoke('session:flush', documentId),
  exportReadingNotes: (documentId: string, fileName: string) => ipcRenderer.invoke('session:export-notes', documentId, fileName),
  onSessionSaveEvent: (callback: (event: SessionSaveEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: SessionSaveEvent) => callback(data);
    ipcRenderer.on('session:save-event', listener);
    return () => ipcRenderer.removeListener('session:save-event', listener);
  },
  cancelAi: (id: string) => ipcRenderer.invoke('ai:cancel', id),
  onAiEvent: (callback: (event: AiEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: AiEvent) => callback(data);
    ipcRenderer.on('ai:event', listener);
    return () => ipcRenderer.removeListener('ai:event', listener);
  },
  onOpenRequested: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('open-requested', listener);
    return () => ipcRenderer.removeListener('open-requested', listener);
  },
});
