import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { AiEvent, AiRequest, AiSettingsInput } from './ai-types.js';
import type { SessionAction, SessionSaveEvent } from './session-types.js';

contextBridge.exposeInMainWorld('paperdesk', {
  openPdf: () => ipcRenderer.invoke('pdf:open'),
  getRecent: () => ipcRenderer.invoke('pdf:recent'),
  openRecent: (id: string) => ipcRenderer.invoke('pdf:open-recent', id),
  openDropped: (file: File) => ipcRenderer.invoke('pdf:open-drop', webUtils.getPathForFile(file)),
  writeClipboard: (text: string) => ipcRenderer.invoke('clipboard:write', text),
  getAiSettings: () => ipcRenderer.invoke('ai:settings'),
  saveAiSettings: (settings: AiSettingsInput) => ipcRenderer.invoke('ai:save-settings', settings),
  startAi: (request: AiRequest, documentId?: string) => ipcRenderer.invoke('ai:start', request, documentId),
  loadReadingSession: (documentId: string, fileName: string) => ipcRenderer.invoke('session:load', documentId, fileName),
  updateReadingSession: (documentId: string, action: SessionAction) => ipcRenderer.invoke('session:update', documentId, action),
  suspendReadingSession: (documentId: string) => ipcRenderer.invoke('session:suspend', documentId),
  flushReadingSession: (documentId: string) => ipcRenderer.invoke('session:flush', documentId),
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
