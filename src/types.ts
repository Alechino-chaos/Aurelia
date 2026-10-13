import type { AiEvent, AiRequest, AiSettings, AiSettingsInput } from '../electron/ai-types';
import type { HighlightRegion, ReadingSession, SessionAction, SessionSaveEvent } from '../electron/session-types';
import type { NotesExportResult } from '../electron/notes-export';
import type { LibraryAction, LibraryState, LibraryImportResult, LibraryRelocateResult, ReadingView } from '../electron/library-types';
import type { AppSettings, UiLocale } from '../electron/i18n';
export type { AppSettings, UiLocale } from '../electron/i18n';
export type { LibraryAction, LibraryState, LibraryImportResult, LibraryRelocateResult, ReadingView, LibraryEntry, LibraryGroup } from '../electron/library-types';
export type OpenedFile = { name: string; bytes: Uint8Array; id?: string; documentId?: string; libraryId?: string; view?: ReadingView };
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
      getAppSettings(): Promise<AppSettings>;
      saveAppSettings(input: { locale: UiLocale }): Promise<AppSettings>;
      openPdf(): Promise<OpenedFile | null>;
      getRecent(): Promise<RecentFile[]>;
      openRecent(id: string): Promise<OpenedFile>;
      openDropped(file: File): Promise<OpenedFile>;
      getLibrary(): Promise<LibraryState>;
      updateLibrary(action: LibraryAction): Promise<LibraryState>;
      importPapers(groupId?: string): Promise<LibraryImportResult>;
      importDroppedPapers(files: File[], groupId?: string): Promise<LibraryImportResult>;
      openLibraryPaper(id: string): Promise<OpenedFile>;
      relocateLibraryPaper(id: string): Promise<LibraryRelocateResult>;
      acceptRelocationImport(id: string): Promise<LibraryImportResult>;
      revealLibraryPaper(id: string): Promise<void>;
      onBeforeClose(callback: () => Promise<void>): () => void;
      writeClipboard(text: string): Promise<void>;
      openExternalUrl(url: string): Promise<void>;
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
