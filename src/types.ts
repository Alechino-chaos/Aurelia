import type { AiEvent, AiRequest, AiSettings, AiSettingsInput } from '../electron/ai-types';
import type { HighlightRegion, ReadingSession, SessionAction, SessionSaveEvent } from '../electron/session-types';
import type { NotesExportResult } from '../electron/notes-export';
export type OpenedFile = { name: string; bytes: Uint8Array; id?: string; documentId?: string };
export type RecentFile = { name: string; id: string; openedAt: number };
export type PageSize = { width: number; height: number; rotation?: number };
export type SelectedText = {
  raw: string;
  clean: string;
  pages: number[];
  regions: HighlightRegion[];
  rect: { top: number; left: number; right: number; bottom: number };
};

declare global {
  interface Window {
    paperdesk?: {
      openPdf(): Promise<OpenedFile | null>;
      getRecent(): Promise<RecentFile[]>;
      openRecent(id: string): Promise<OpenedFile>;
      openDropped(file: File): Promise<OpenedFile>;
      writeClipboard(text: string): Promise<void>;
      getAiSettings(): Promise<AiSettings>;
      saveAiSettings(settings: AiSettingsInput): Promise<AiSettings>;
      startAi(request: AiRequest, documentId?: string): Promise<void>;
      loadReadingSession(documentId: string, fileName: string): Promise<ReadingSession>;
      updateReadingSession(documentId: string, action: SessionAction): Promise<void>;
      suspendReadingSession(documentId: string): Promise<void>;
      flushReadingSession(documentId: string): Promise<void>;
      exportReadingNotes(documentId: string, fileName: string): Promise<NotesExportResult>;
      onSessionSaveEvent(callback: (event: SessionSaveEvent) => void): () => void;
      cancelAi(id: string): Promise<void>;
      onAiEvent(callback: (event: AiEvent) => void): () => void;
      onOpenRequested(callback: () => void): () => void;
    };
  }
}
