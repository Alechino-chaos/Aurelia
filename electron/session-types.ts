export type Quote = { text: string; fileName: string; pages: number[] };
export type Status = 'streaming' | 'done' | 'cancelled' | 'error' | 'interrupted';
export type ChatEntry = { id: string; role: 'user' | 'assistant'; content: string; status: Status; error?: string; quote?: Quote };
export type Translation = { id: string; quote: Quote; language: string; content: string; status: Status; error?: string };
export type ChatSession = { id: string; createdAt: number; messages: ChatEntry[]; draft: string; quote?: Quote };
/** Fractions of the displayed PDF page, independent of zoom and screen density. */
export type HighlightRegion = { page: number; x: number; y: number; width: number; height: number };
export type Annotation = { id: string; createdAt: number; updatedAt: number; color: 'yellow' | 'green'; quote: Quote; note: string; regions: HighlightRegion[] };
export type ReadingSession = {
  version: 1; documentId: string; fileName: string; updatedAt: number;
  chats: ChatSession[]; activeChatId: string;
  translations: Translation[]; activeTranslationId: string | null;
  annotations: Annotation[];
};
export type SessionAction =
  | { type: 'annotation-add'; entry: Annotation }
  | { type: 'annotation-edit'; id: string; note?: string; color?: Annotation['color'] }
  | { type: 'annotation-delete'; id: string }
  | { type: 'draft'; chatId: string; draft: string; quote?: Quote }
  | { type: 'new-chat'; id: string }
  | { type: 'select-chat'; id: string }
  | { type: 'select-translation'; id: string }
  | { type: 'chat'; chatId: string; user: ChatEntry; answer: ChatEntry; replaceId?: string }
  | { type: 'translation'; entry: Translation };
export type SessionSaveEvent = { documentId: string; status: 'saving' | 'saved' | 'error'; message?: string };
