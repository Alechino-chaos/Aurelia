import { translateBackendMessage } from '../../electron/i18n';
import { targetLabel } from '../../electron/i18n-renderer';
import { useLanguage } from '../i18n/LanguageProvider';
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Copy, Languages, LoaderCircle, Plus, RotateCcw, Send, MessageSquare, Square, X } from 'lucide-react';
import type { AiController, Quote } from '../ai/useAi';
import { AiMarkdown } from './AiMarkdown';

export function AiPanel({ ai, tab, currentQuote, onPage, noteTarget, onSaveNote }: { ai: AiController; tab: 'translation' | 'chat'; currentQuote?: Quote; onPage: (page: number) => void; noteTarget?: string; onSaveNote?: (text: string) => void }) {
  const { t, display, locale } = useLanguage();
  const scroll = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const input = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState('');
  const [copyError, setCopyError] = useState('');
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(''), 1800); return () => clearTimeout(timer); }, [copied]);
  useEffect(() => {
    if (tab === 'chat' && stickToBottom.current && scroll.current) scroll.current.scrollTop = ai.messages.length ? scroll.current.scrollHeight : 0;
  }, [ai.messages, tab]);
  useEffect(() => { stickToBottom.current = true; if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; }, [ai.session?.documentId, ai.session?.activeChatId]);
  useEffect(() => { if (tab === 'chat' && ai.quote) input.current?.focus(); }, [ai.quote, tab]);
  async function copy(text: string, id: string) {
    try { await window.paperdesk?.writeClipboard(text); setCopied(id); setCopyError(''); }
    catch { setCopyError('复制失败，请手动选择回答并复制。'); }
  }
  const quoteCard = (quote: Quote, removable = false) => <div className="ai-quote"><div><button type="button" className="ai-source" title={quote.fileName} onClick={() => onPage(quote.pages[0])}>{t('source', { name: quote.fileName, pages: quote.pages.join(locale === 'en' ? ', ' : '、') })} <ArrowUpRight size={12} /></button>{removable && <button type="button" className="icon-button small" aria-label={t("移除引用")} onClick={() => ai.setQuote(undefined)}><X /></button>}</div><p>{quote.text}</p></div>;
  const configure = !ai.settings?.model || !!ai.settings?.keyError;
  return <div className="ai-panel">
    <div className="ai-panel-heading"><span title={ai.settings?.model}>{ai.settings?.model || t("尚未配置模型")}</span>{tab === 'chat' && <button className="icon-button small" disabled={!ai.sessionReady} aria-label={t("新建对话")} title={t("新建对话，保留历史记录")} onClick={() => { ai.newChat(); stickToBottom.current = true; }}><Plus /></button>}</div>
    <div className="session-status" data-testid="session-status">{ai.sessionLoading ? t("正在恢复阅读记录…") : ai.sessionError || ai.storageError ? t("记录尚未保存或恢复") : !ai.session ? t("打开论文后自动保存阅读记录") : ai.saveState === 'saving' ? t("正在保存到本机…") : t("已保存到本机")}</div>
    {(ai.sessionError || ai.storageError) && <div className="ai-error session-error" role="alert">{translateBackendMessage(ai.sessionError || ai.storageError?.message || '', locale)}<button className="text-button" onClick={() => void ai.retrySessionSave()}>{t("重试保存或恢复")}</button></div>}
    {tab === 'chat' && ai.session && ai.session.chats.length > 1 && <label className="session-history">{t("对话记录")}<select aria-label={t("对话记录")} value={ai.session.activeChatId} disabled={!ai.sessionReady} onChange={event => ai.selectChat(event.target.value)}>{ai.session.chats.map((chat, index) => <option key={chat.id} value={chat.id}>{index + 1}. {chat.messages.find(m => m.role === 'user')?.content.slice(0, 44) || t("新对话")}</option>)}</select></label>}
    {tab === 'translation' && ai.session && ai.session.translations.length > 1 && <label className="session-history">{t("翻译记录")}<select aria-label={t("翻译记录")} value={ai.session.activeTranslationId ?? ''} disabled={!ai.sessionReady} onChange={event => ai.selectTranslation(event.target.value)}>{ai.session.translations.map((item, index) => <option key={item.id} value={item.id}>{index + 1}. {item.quote.text.slice(0, 44)} · {targetLabel(item.language, locale)}</option>)}</select></label>}
    {configure && <div className="ai-configure"><span>{t("配置你的 API Key 和模型后开始使用。")}</span><button onClick={() => ai.openSettings('ai')}>{t("打开设置")} <ArrowUpRight size={12} /></button></div>}
    {copyError && <div className="ai-error" role="alert">{display(copyError)}</div>}
    {tab === 'translation' ? <div className="ai-scroll">
      <div className="translation-actions"><button className="primary-button" disabled={!ai.sessionReady || !currentQuote || ai.session?.translations.some(t => t.status === 'streaming')} onClick={() => currentQuote && ai.translate(currentQuote)}><Languages size={15} />{t("翻译当前选区")}</button><span>→ {targetLabel(ai.settings?.targetLanguage ?? '简体中文', locale)}</span></div>
      {ai.translation ? <>
        {quoteCard(ai.translation.quote)}
        <div className="ai-result-heading"><span>{t('translationHeading', { language: targetLabel(ai.translation.language, locale) })}</span>{ai.translation.status === 'streaming' ? <button className="text-button" onClick={() => ai.stop('translation')}><Square size={12} />{t("停止翻译")}</button> : <button className="icon-button small" disabled={!ai.sessionReady || ai.session?.translations.some(t => t.status === 'streaming')} aria-label={t("重新翻译")} onClick={() => ai.translate(ai.translation!.quote)}><RotateCcw /></button>}</div>
        <div className="ai-response translation-result" data-testid="translation-result">{ai.translation.content ? <AiMarkdown text={ai.translation.content} /> : (ai.translation.status === 'streaming' ? t("正在翻译…") : t("暂无译文。"))}{ai.translation.status === 'streaming' && <span className="stream-cursor" />}</div>
        {ai.translation.error && <div className="ai-error" role="alert">{translateBackendMessage(ai.translation.error, locale)}</div>}
        {ai.translation.status === 'cancelled' && <p className="field-help">{t("已停止，以上为已接收的部分译文。")}</p>}
        {ai.translation.status === 'interrupted' && <p className="field-help">{t("上次翻译已中断，已保留收到的内容。可点击重新翻译。")}</p>}
        {!!ai.translation.content && <button className="ai-copy" onClick={() => void copy(ai.translation!.content, 'translation')}><Copy size={13} />{copied === 'translation' ? t("已复制") : t("复制译文")}</button>}
      </> : <div className="ai-empty"><Languages size={30} strokeWidth={1.2} /><h2>{t("翻译选区")}</h2><p>{t("选中文字后，点击浮动工具栏的“翻译”。")}<br />{t("保留原文对照，也可以复制译文。")}</p></div>}
    </div> : <>
      <div className="ai-scroll chat-scroll" ref={scroll} onScroll={() => { const el = scroll.current!; stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
        {!ai.messages.length && <div className="ai-empty"><MessageSquare size={30} strokeWidth={1.2} /><h2>{t("关于这篇论文")}</h2><p>{t("引用选区后提问，或直接输入问题。")}</p><div className="ai-suggestions">{(['解释这段话的核心意思', '梳理这段方法的步骤', '这段论证有哪些假设？'] as const).map(prompt => <button key={prompt} onClick={() => { ai.setDraft(prompt); if (currentQuote) ai.setQuote(currentQuote); input.current?.focus(); }}>{t(prompt)}<ArrowUpRight size={12} /></button>)}</div></div>}
        {ai.messages.map((message, index) => <article className={`chat-message ${message.role}`} key={message.id}>
          <div className="message-label">{message.role === 'user' ? t("你") : 'Aurelia'}{message.status === 'streaming' && <LoaderCircle size={12} className="spin" />}</div>
          {message.quote && quoteCard(message.quote)}
          <div className="ai-response" data-testid={message.role === 'assistant' ? 'ai-answer' : undefined}>{message.content ? (message.role === 'assistant' ? <AiMarkdown text={message.content} /> : message.content) : (message.status === 'streaming' ? t("正在思考…") : '')}{message.status === 'streaming' && !!message.content && <span className="stream-cursor" />}</div>
          {message.error && <div className="ai-error" role="alert">{translateBackendMessage(message.error, locale)}</div>}
          {message.status === 'cancelled' && <p className="field-help">{t("已停止，回答可能不完整。")}</p>}
          {message.status === 'interrupted' && <p className="field-help">{t("上次回答已中断，已保留收到的内容。可重试生成。")}</p>}
          {message.role === 'assistant' && message.content && message.status !== 'streaming' && onSaveNote && <button className="ai-copy" title={t("saveToNote", { note: noteTarget ?? "" })} onClick={() => onSaveNote(message.content)}><Plus size={12} />{t("保存到当前批注")}</button>}
          {message.role === 'assistant' && <div className="message-actions">{!!message.content && <button className="ai-copy" onClick={() => void copy(message.content, message.id)}><Copy size={12} />{copied === message.id ? t("已复制") : t("复制")}</button>}{index === ai.messages.length - 1 && ['error', 'cancelled', 'interrupted'].includes(message.status) && <button className="ai-copy" onClick={() => ai.retryChat()}><RotateCcw size={12} />{t("重试")}</button>}</div>}
        </article>)}
      </div>
      <form className="chat-compose" onSubmit={event => { event.preventDefault(); stickToBottom.current = true; ai.sendChat(); }}>
        {ai.quote && quoteCard(ai.quote, true)}
        {!ai.quote && currentQuote && <button type="button" className="attach-selection" onClick={() => ai.setQuote(currentQuote)}><Plus size={12} />{t("引用当前选区")}</button>}
        <textarea ref={input} disabled={!ai.sessionReady} aria-label={t("AI 消息")} placeholder={t("向 Aurelia 提问…")} value={ai.draft} maxLength={30000} rows={3} onChange={event => ai.setDraft(event.target.value)} onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); stickToBottom.current = true; ai.sendChat(); }
        }} />
        <div className="compose-bottom"><span>{t("Enter 发送 · Shift Enter 换行")}</span>{ai.chatBusy ? <button type="button" className="send-button" aria-label={t("停止回答")} onClick={() => ai.stop('chat')}><Square size={14} />{t("停止")}</button> : <button className="send-button" type="submit" disabled={!ai.sessionReady || !ai.draft.trim()} aria-label={t("发送消息")}><Send size={14} />{t("发送")}</button>}</div>
        <p className="chat-footnote">{t("记录按论文保存在本机 · 仅发送对话和主动引用的文字")}</p>
      </form>
    </>}
  </div>;
}
