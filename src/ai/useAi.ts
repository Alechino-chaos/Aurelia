import { useEffect, useRef, useState } from 'react';
import type { AiEvent, AiMessage, AiRequest, AiSettings, AiSettingsInput } from '../../electron/ai-types';
import type { ChatEntry, Quote, ReadingSession, SessionAction } from '../../electron/session-types';
import { applySessionAction, applySessionEvent } from '../../electron/session-model';
import { backendErrorMessage, encodeAppMessage } from '../../electron/i18n';
export type { ChatEntry, Quote, Status, Translation } from '../../electron/session-types';

const errorText = (error: unknown) => backendErrorMessage(error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
export function quoteContent(content: string, quote?: Quote) {
  return quote ? `${content}\n\n引用资料（${quote.fileName}，第 ${quote.pages.join('、')} 页）：\n<quoted_text>\n${quote.text}\n</quoted_text>` : content;
}

export function useAi(documentId: string | null, fileName: string, instance?: string) {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<'general' | 'ai' | 'updates'>('general');
  function openSettings(section: 'general' | 'ai' | 'updates' = 'general') { setSettingsSection(section); setSettingsOpen(true); }
  const [settingsError, setSettingsError] = useState('');
  const [session, setSession] = useState<ReadingSession | null>(null);
  const sessionRef = useRef<ReadingSession | null>(null);
  const pendingUpdates = useRef(new Map<string, Set<Promise<void>>>());
  const currentIdentity = `${documentId ?? ''}/${instance ?? ''}`;
  const identityRef = useRef(currentIdentity);
  identityRef.current = currentIdentity;
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionError, setSessionError] = useState('');
  const [saveState, setSaveState] = useState<'saving' | 'saved' | 'error'>('saved');
  const [storageError, setStorageError] = useState<{ documentId: string; message: string } | null>(null);
  const [reload, setReload] = useState(0);
  const requests = useRef<{ chat?: string; translation?: string; test?: string }>({});
  const prepared = useRef<string | null>(null);
  const testResult = useRef<{ resolve: () => void; reject: (error: Error) => void } | null>(null);
  const visible = session?.documentId === documentId ? session : null;
  const chat = visible?.chats.find(c => c.id === visible.activeChatId);
  const messages = chat?.messages ?? [];
  const translation = visible?.translations.find(t => t.id === visible.activeTranslationId) ?? null;
  const chatBusy = messages.some(m => m.status === 'streaming');
  const sessionReady = !!visible && !sessionLoading && !sessionError;

  function display(value: ReadingSession | null) { sessionRef.current = value; setSession(value); }
  function receive(event: AiEvent) {
    const current = sessionRef.current;
    if (current) display(applySessionEvent(current, event));
  }
  useEffect(() => {
    const bridge = window.paperdesk;
    if (!bridge) { setSettingsError(encodeAppMessage('请在 Aurelia 桌面程序中配置和使用 AI。')); return; }
    let live = true;
    void bridge.getAiSettings().then(value => { if (live) setSettings(value); }).catch(error => { if (live) setSettingsError(errorText(error)); });
    const unsubscribeSave = bridge.onSessionSaveEvent(event => {
      if (event.documentId === sessionRef.current?.documentId) setSaveState(event.status);
      if (event.status === 'error') setStorageError({ documentId: event.documentId, message: event.message ?? encodeAppMessage('阅读记录保存失败。') });
      if (event.status === 'saved') setStorageError(old => old?.documentId === event.documentId ? null : old);
    });
    const unsubscribe = bridge.onAiEvent(event => {
      if (event.id === requests.current.test) {
        if (event.type === 'delta') return;
        delete requests.current.test;
        if (event.type === 'done') testResult.current?.resolve();
        else testResult.current?.reject(new Error(event.type === 'error' ? event.message : encodeAppMessage('连接测试已停止。')));
        testResult.current = null;
        return;
      }
      for (const kind of ['translation', 'chat'] as const) if (event.id === requests.current[kind]) {
        receive(event);
        if (event.type !== 'delta') delete requests.current[kind];
      }
    });
    return () => {
      live = false; unsubscribe(); unsubscribeSave();
      for (const id of Object.values(requests.current)) if (id) void bridge.cancelAi(id).catch(() => {});
    };
  }, []);

  useEffect(() => {
    let live = true, loaded = false;
    const bridge = window.paperdesk;
    prepared.current = null;
    display(null); setSessionError(''); setSaveState('saved');
    setSessionLoading(!!documentId);
    if (documentId && bridge) {
      void bridge.loadReadingSession(documentId, fileName).then(value => {
        if (!live) return;
        loaded = true; display(value); setSessionLoading(false);
      }).catch(error => { if (live) { setSessionError(errorText(error)); setSessionLoading(false); } });
    } else setSessionLoading(false);
    return () => {
      live = false;
      for (const kind of ['chat', 'translation'] as const) {
        const id = requests.current[kind];
        if (id) void bridge?.cancelAi(id).catch(() => {});
        delete requests.current[kind];
      }
      if (loaded && documentId && prepared.current !== documentId) void bridge?.suspendReadingSession(documentId).catch(error => setStorageError({ documentId, message: errorText(error) }));
    };
  }, [documentId, instance, reload]);

  function configured() {
    if (!sessionReady) return false;
    if (!window.paperdesk || !settings?.model || settings.keyError) { openSettings('ai'); return false; }
    return true;
  }
  async function commit(action: SessionAction): Promise<void> {
    const current = sessionRef.current;
    if (!current || current.documentId !== documentId || !window.paperdesk) return Promise.reject(new Error(encodeAppMessage('阅读记录尚未恢复。')));
    const next = applySessionAction(current, action);
    display(next); setSaveState('saving');
    const operation = window.paperdesk.updateReadingSession(current.documentId, action).catch(error => {
      setStorageError({ documentId: current.documentId, message: errorText(error) });
      throw error;
    });
    const pending = pendingUpdates.current.get(current.documentId) ?? new Set<Promise<void>>();
    pendingUpdates.current.set(current.documentId, pending); pending.add(operation);
    const settled = () => { pending.delete(operation); if (!pending.size) pendingUpdates.current.delete(current.documentId); };
    void operation.then(settled, settled);
    return operation;
  }
  async function exportNotes() {
    const current = sessionRef.current;
    if (!sessionReady || !current || current.documentId !== documentId || !window.paperdesk) throw new Error(encodeAppMessage('阅读记录尚未恢复。'));
    if (storageError?.documentId === documentId) throw new Error(encodeAppMessage('请先重试保存阅读记录，再导出笔记。'));
    // IPC responses may settle after the saved notification. Await the actual
    // update operations rather than relying on that visual status alone.
    while (pendingUpdates.current.get(current.documentId)?.size) {
      await Promise.all([...pendingUpdates.current.get(current.documentId)!]);
    }
    if (identityRef.current !== currentIdentity) throw new Error(encodeAppMessage('论文已切换，请在当前论文中重新导出。'));
    return window.paperdesk.exportReadingNotes(current.documentId, fileName);
  }
  async function prepareToLeave() {
    const key = documentId, bridge = window.paperdesk;
    if (!key || !bridge) return;
    try {
      while (pendingUpdates.current.get(key)?.size) await Promise.all([...pendingUpdates.current.get(key)!]);
      for (const kind of ['chat', 'translation'] as const) {
        const request = requests.current[kind];
        if (request) await bridge.cancelAi(request);
        delete requests.current[kind];
      }
      // Main owns the streamed bytes and persists interrupted status before the reader is removed.
      await bridge.suspendReadingSession(key);
      prepared.current = key;
    } catch (error) {
      setStorageError({ documentId: key, message: errorText(error) });
      throw error;
    }
  }
  function change(action: SessionAction) { void commit(action).catch(() => {}); }
  function setDraft(draft: string) {
    const current = sessionRef.current, chat = current?.chats.find(c => c.id === current.activeChatId);
    if (chat) change({ type: 'draft', chatId: chat.id, draft, quote: chat.quote });
  }
  function setQuote(quote?: Quote) {
    const current = sessionRef.current, chat = current?.chats.find(c => c.id === current.activeChatId);
    if (chat) change({ type: 'draft', chatId: chat.id, draft: chat.draft, quote });
  }
  function dispatch(request: AiRequest, saved: Promise<void>) {
    const key = documentId!;
    const kind = request.kind;
    void saved.then(() => {
      if (sessionRef.current?.documentId !== key || requests.current[kind] !== request.id) return;
      return window.paperdesk!.startAi(request, key);
    }).catch(error => {
      if (sessionRef.current?.documentId === key && requests.current[kind] === request.id) {
        receive({ id: request.id, type: 'error', message: errorText(error) });
        delete requests.current[kind];
      }
    });
  }
  function translate(selected: Quote) {
    if (!configured() || requests.current.translation) return;
    const id = crypto.randomUUID();
    requests.current.translation = id;
    dispatch({ id, kind: 'translation', text: selected.text }, commit({ type: 'translation', entry: { id, quote: selected, language: settings!.targetLanguage, content: '', status: 'streaming' } }));
  }
  function sendChat(content = chat?.draft ?? '', attachment = chat?.quote, retry = false) {
    if (!content.trim() || requests.current.chat || !configured()) return;
    const current = sessionRef.current!;
    const active = current.chats.find(c => c.id === current.activeChatId)!;
    const previous = retry ? active.messages.slice(0, -2) : active.messages;
    const history: AiMessage[] = [];
    for (let i = 0; i < previous.length - 1; i += 2) {
      if (previous[i].role === 'user' && previous[i + 1]?.status === 'done') history.push(
        { role: 'user', content: quoteContent(previous[i].content, previous[i].quote) }, { role: 'assistant', content: previous[i + 1].content });
    }
    const id = crypto.randomUUID();
    requests.current.chat = id;
    const user: ChatEntry = { id: crypto.randomUUID(), role: 'user', content: content.trim(), quote: attachment, status: 'done' };
    const answer: ChatEntry = { id, role: 'assistant', content: '', status: 'streaming' };
    dispatch({ id, kind: 'chat', messages: [...history, { role: 'user', content: quoteContent(content.trim(), attachment) }] },
      commit({ type: 'chat', chatId: active.id, user, answer, replaceId: retry ? active.messages.at(-1)?.id : undefined }));
  }
  function retryChat() {
    const user = chat?.messages.at(-2);
    if (user?.role === 'user') sendChat(user.content, user.quote, true);
  }
  function switchChat(action: SessionAction) {
    const id = requests.current.chat;
    if (id) void window.paperdesk?.cancelAi(id).catch(() => {});
    delete requests.current.chat;
    change(action);
  }
  function newChat() { if (sessionReady) switchChat({ type: 'new-chat', id: crypto.randomUUID() }); }
  function selectChat(id: string) { if (sessionReady) switchChat({ type: 'select-chat', id }); }
  function selectTranslation(id: string) { if (sessionReady) change({ type: 'select-translation', id }); }
  function stop(kind: 'chat' | 'translation' | 'test') {
    const id = requests.current[kind];
    if (id) void window.paperdesk?.cancelAi(id).catch(() => {});
  }
  async function retrySessionSave() {
    if (sessionError) { setReload(value => value + 1); return; }
    const key = storageError?.documentId ?? documentId;
    if (!key) return;
    try { await window.paperdesk?.flushReadingSession(key); setStorageError(null); setSaveState('saved'); }
    catch (error) { setStorageError({ documentId: key, message: errorText(error) }); }
  }
  async function save(input: AiSettingsInput) {
    if (!window.paperdesk) throw new Error(encodeAppMessage('请使用 Aurelia 桌面程序。'));
    const next = await window.paperdesk.saveAiSettings(input);
    setSettings(next); setSettingsError('');
    return next;
  }
  async function testConnection() {
    if (!window.paperdesk) throw new Error(encodeAppMessage('请使用 Aurelia 桌面程序。'));
    const id = crypto.randomUUID();
    requests.current.test = id;
    return new Promise<void>((resolve, reject) => {
      testResult.current = { resolve, reject };
      void window.paperdesk!.startAi({ id, kind: 'chat', messages: [{ role: 'user', content: 'Reply with only OK.' }] }).catch(error => {
        if (requests.current.test !== id) return;
        delete requests.current.test; testResult.current = null; reject(new Error(errorText(error)));
      });
    });
  }
  return { settings, settingsOpen, setSettingsOpen, settingsSection, openSettings, settingsError, translation, translate, messages,
    draft: chat?.draft ?? '', setDraft, quote: chat?.quote, setQuote, chatBusy, sendChat, retryChat, newChat, stop, save, testConnection,
    session: visible, sessionReady, sessionLoading, sessionError, saveState, storageError, retrySessionSave, selectChat, selectTranslation, commitSession: commit, exportNotes, prepareToLeave };
}
export type AiController = ReturnType<typeof useAi>;
