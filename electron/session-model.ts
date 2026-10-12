import type { AiEvent } from './ai-types.js';
import type { Annotation, ChatEntry, Quote, ReadingSession, SessionAction, Status, Translation } from './session-types.js';

export const MAX_SESSION_BYTES = 32 * 1024 * 1024;
export function documentKey(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error('无效的论文标识。');
  return value;
}
const obj = (value: unknown): Record<string, any> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('阅读记录格式不正确。');
  return value as Record<string, any>;
};
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max) throw new Error('阅读记录内容无效或过长。');
  return value;
}
function id(value: unknown) {
  const result = text(value, 80);
  if (!/^[\w-]{8,80}$/.test(result)) throw new Error('无效的记录编号。');
  return result;
}
function quote(value: unknown): Quote | undefined {
  if (value === undefined) return;
  const v = obj(value);
  if (!Array.isArray(v.pages) || !v.pages.length || v.pages.length > 10000 || v.pages.some((p: unknown) => !Number.isInteger(p) || Number(p) < 1)) throw new Error('引用页码无效。');
  return { text: text(v.text, 100_000), fileName: text(v.fileName, 1000), pages: [...v.pages] };
}
function status(value: unknown): Status {
  if (!['streaming', 'done', 'cancelled', 'error', 'interrupted'].includes(String(value))) throw new Error('记录状态无效。');
  return value as Status;
}
function message(value: unknown): ChatEntry {
  const v = obj(value);
  if (v.role !== 'user' && v.role !== 'assistant') throw new Error('消息角色无效。');
  return { id: id(v.id), role: v.role, content: text(v.content, 1_000_000), status: status(v.status),
    error: v.error === undefined ? undefined : text(v.error, 5000), quote: quote(v.quote) };
}
function translation(value: unknown): Translation {
  const v = obj(value), source = quote(v.quote);
  if (!source) throw new Error('翻译原文缺失。');
  return { id: id(v.id), quote: source, language: text(v.language, 50), content: text(v.content, 1_000_000), status: status(v.status), error: v.error === undefined ? undefined : text(v.error, 5000) };
}
function timestamp(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('记录时间无效。');
  return value;
}
function unique(values: string[]) { if (new Set(values).size !== values.length) throw new Error('记录编号重复。'); }

function annotation(value: unknown): Annotation {
  const v = obj(value), source = quote(v.quote);
  if (!source || !Array.isArray(v.regions) || !v.regions.length || v.regions.length > 10000) throw new Error('批注缺少有效选区。');
  if (v.color !== 'yellow' && v.color !== 'green') throw new Error('高亮颜色无效。');
  const regions = v.regions.map((raw: unknown) => {
    const r = obj(raw);
    if (!Number.isInteger(r.page) || !source.pages.includes(r.page) ||
      [r.x, r.y, r.width, r.height].some(n => typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1) ||
      r.width <= 0 || r.height <= 0 || r.x + r.width > 1.000001 || r.y + r.height > 1.000001) throw new Error('高亮位置无效。');
    return { page: r.page, x: r.x, y: r.y, width: r.width, height: r.height };
  });
  if (source.pages.some(p => !regions.some(r => r.page === p))) throw new Error('批注页码与位置不一致。');
  return { id: id(v.id), createdAt: timestamp(v.createdAt), updatedAt: timestamp(v.updatedAt), color: v.color, quote: source, note: text(v.note, 100_000), regions };
}

export function validateSession(value: unknown, expectedId: string): ReadingSession {
  const v = obj(value);
  if (v.version !== 1 || documentKey(v.documentId) !== documentKey(expectedId)) throw new Error('阅读记录版本或论文标识不匹配。');
  if (!Array.isArray(v.chats) || !v.chats.length || v.chats.length > 1000 || !Array.isArray(v.translations) || v.translations.length > 5000) throw new Error('阅读记录数量无效。');
  const chats = v.chats.map((raw: unknown) => {
    const c = obj(raw);
    if (!Array.isArray(c.messages) || c.messages.length > 10000 || c.messages.length % 2) throw new Error('对话消息不完整。');
    const messages = c.messages.map(message);
    if (messages.some((m: ChatEntry, i: number) => m.role !== (i % 2 ? 'assistant' : 'user'))) throw new Error('对话顺序无效。');
    unique(messages.map((m: ChatEntry) => m.id));
    return { id: id(c.id), createdAt: timestamp(c.createdAt), messages, draft: text(c.draft, 30000), quote: quote(c.quote) };
  });
  const translations = v.translations.map(translation);
  // 0.3.5 sessions have no annotations field; preserve all existing history.
  if (v.annotations !== undefined && (!Array.isArray(v.annotations) || v.annotations.length > 5000)) throw new Error('批注数量无效。');
  const annotations = (v.annotations ?? []).map(annotation) as Annotation[];
  unique(annotations.map(a => a.id));
  unique(chats.map(c => c.id)); unique(translations.map(t => t.id));
  if (!chats.some(c => c.id === v.activeChatId) || (v.activeTranslationId !== null && !translations.some(t => t.id === v.activeTranslationId))) throw new Error('当前阅读记录不存在。');
  return { version: 1, documentId: v.documentId, fileName: text(v.fileName, 1000), updatedAt: timestamp(v.updatedAt), chats, activeChatId: v.activeChatId, translations, activeTranslationId: v.activeTranslationId, annotations };
}

export function emptySession(key: string, name: string, chatId: string): ReadingSession {
  return { version: 1, documentId: documentKey(key), fileName: text(name, 1000), updatedAt: Date.now(),
    chats: [{ id: id(chatId), createdAt: Date.now(), messages: [], draft: '' }], activeChatId: chatId, translations: [], activeTranslationId: null, annotations: [] };
}

export function interruptSession(session: ReadingSession, next: Status = 'interrupted'): ReadingSession {
  const stop = <T extends { status: Status }>(entry: T): T => entry.status === 'streaming' ? { ...entry, status: next } : entry;
  return { ...session, chats: session.chats.map(chat => ({ ...chat, messages: chat.messages.map(stop) })), translations: session.translations.map(stop) };
}

export function applySessionAction(session: ReadingSession, raw: SessionAction): ReadingSession {
  const action = obj(raw);
  let next: ReadingSession = { ...session, updatedAt: Date.now() };
  switch (action.type) {
    case 'annotation-add': {
      const entry = annotation(action.entry);
      if (session.annotations.some(a => a.id === entry.id)) throw new Error('批注编号重复。');
      next.annotations = [...session.annotations, entry]; break;
    }
    case 'annotation-edit': {
      const key = id(action.id), current = session.annotations.find(a => a.id === key);
      if (!current) throw new Error('批注不存在。');
      const edited = annotation({ ...current, note: action.note ?? current.note, color: action.color ?? current.color, updatedAt: Date.now() });
      next.annotations = session.annotations.map(a => a.id === key ? edited : a); break;
    }
    case 'annotation-delete':
      if (!session.annotations.some(a => a.id === id(action.id))) throw new Error('批注不存在。');
      next.annotations = session.annotations.filter(a => a.id !== action.id); break;
    case 'draft': {
      const chatId = id(action.chatId);
      if (!session.chats.some(c => c.id === chatId)) throw new Error('对话不存在。');
      const draft = text(action.draft, 30000), attachment = quote(action.quote);
      next.chats = session.chats.map(c => c.id === chatId ? { ...c, draft, quote: attachment } : c);
      break;
    }
    case 'new-chat': {
      const chatId = id(action.id);
      if (session.chats.some(c => c.id === chatId)) throw new Error('对话编号重复。');
      next.chats = interruptSession(next, 'cancelled').chats;
      next.chats = [...next.chats, { id: chatId, createdAt: Date.now(), messages: [], draft: '' }];
      next.activeChatId = chatId;
      break;
    }
    case 'select-chat':
      if (!session.chats.some(c => c.id === action.id)) throw new Error('对话不存在。');
      next.chats = interruptSession(next, 'cancelled').chats; next.activeChatId = action.id; break;
    case 'select-translation':
      if (!session.translations.some(t => t.id === action.id)) throw new Error('翻译记录不存在。');
      next.activeTranslationId = action.id; break;
    case 'chat': {
      const chatId = id(action.chatId), user = message(action.user), answer = message(action.answer);
      const chat = session.chats.find(c => c.id === chatId);
      if (!chat || user.role !== 'user' || user.status !== 'done' || answer.role !== 'assistant' || answer.status !== 'streaming' || answer.content || chat.messages.some(m => m.status === 'streaming')) throw new Error('无法开始这条对话。');
      if (action.replaceId !== undefined && (chat.messages.at(-1)?.id !== action.replaceId || !['error', 'cancelled', 'interrupted'].includes(chat.messages.at(-1)!.status))) throw new Error('重试的消息已改变。');
      const previous = action.replaceId ? chat.messages.slice(0, -2) : chat.messages;
      next.chats = session.chats.map(c => c.id === chatId ? { ...c, messages: [...previous, user, answer], draft: '', quote: undefined } : c);
      break;
    }
    case 'translation': {
      const entry = translation(action.entry);
      if (entry.status !== 'streaming' || entry.content || session.translations.some(t => t.id === entry.id || t.status === 'streaming')) throw new Error('无法开始这条翻译。');
      next.translations = [...session.translations, entry]; next.activeTranslationId = entry.id; break;
    }
    default: throw new Error('未知的阅读记录操作。');
  }
  return validateSession(next, session.documentId);
}

export function applySessionEvent(session: ReadingSession, event: AiEvent): ReadingSession {
  const update = <T extends { id: string; content: string; status: Status; error?: string }>(entry: T): T => {
    if (entry.id !== event.id || entry.status !== 'streaming') return entry;
    return event.type === 'delta' ? { ...entry, content: entry.content + event.text }
      : { ...entry, status: event.type === 'error' ? 'error' : event.type, error: event.type === 'error' ? event.message : undefined };
  };
  return { ...session, updatedAt: Date.now(), chats: session.chats.map(c => ({ ...c, messages: c.messages.map(update) })), translations: session.translations.map(update) };
}
