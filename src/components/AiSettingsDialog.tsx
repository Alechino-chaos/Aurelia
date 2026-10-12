import { useEffect, useRef, useState } from 'react';
import { Check, KeyRound, LoaderCircle, X } from 'lucide-react';
import type { AiController } from '../ai/useAi';

export function AiSettingsDialog({ ai }: { ai: AiController }) {
  const [baseUrl, setBaseUrl] = useState(ai.settings?.baseUrl ?? 'https://api.openai.com/v1');
  const [model, setModel] = useState(ai.settings?.model ?? '');
  const [targetLanguage, setTargetLanguage] = useState(ai.settings?.targetLanguage ?? '简体中文');
  const [apiKey, setApiKey] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const dialog = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLInputElement>('input')?.focus();
    return () => { previous?.focus(); };
  }, []);
  async function submit(test = false) {
    setBusy(true); setError(''); setNotice('');
    try {
      await ai.save({ baseUrl, model, targetLanguage, ...(apiKey ? { apiKey } : {}), clearKey });
      setApiKey(''); setClearKey(false); setNotice('设置已保存。');
      if (test) { setTesting(true); await ai.testConnection(); setNotice('连接成功，模型已返回回答。'); }
    } catch (reason) { setError((reason instanceof Error ? reason.message : String(reason)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }
    finally { setBusy(false); setTesting(false); }
  }
  function close() { if (!busy) ai.setSettingsOpen(false); }
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <form ref={dialog} className="ai-settings" role="dialog" aria-modal="true" aria-labelledby="ai-settings-title" onSubmit={event => { event.preventDefault(); void submit(); }} onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); close(); }
      if (event.key === 'Tab') {
        const items = Array.from(dialog.current!.querySelectorAll<HTMLElement>('input:not(:disabled), select:not(:disabled), button:not(:disabled)'));
        const first = items[0]; const last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <div className="ai-settings-heading"><div><KeyRound size={20} /><h2 id="ai-settings-title">AI 服务设置</h2></div><button type="button" className="icon-button" aria-label="关闭 AI 设置" disabled={busy} onClick={close}><X /></button></div>
      <p className="ai-subtitle">配置 API 地址、密钥与模型。</p>
      <fieldset disabled={busy}>
        <label>API 地址<input aria-label="API 地址" type="url" value={baseUrl} onChange={event => setBaseUrl(event.target.value)} required placeholder="https://api.example.com/v1" spellCheck={false} /></label>
        <p className="field-help">支持 OpenAI 兼容的 Chat Completions 接口。填写服务商提供的地址（通常以 /v1 结尾），本机服务可用 HTTP。</p>
        <label>API Key<input aria-label="API Key" type="password" autoComplete="off" value={apiKey} disabled={clearKey} onChange={event => setApiKey(event.target.value)} placeholder={ai.settings?.hasApiKey ? '已保存，留空保持不变' : '输入 Key；无鉴权的本机服务可留空'} /></label>
        <label className="ai-clear-key"><input type="checkbox" checked={clearKey} onChange={event => { setClearKey(event.target.checked); if (event.target.checked) setApiKey(''); }} />清除已保存的 Key</label>
        <p className="field-help">Key 使用系统加密后保存在本机。更换服务商时，请填写对应的 Key。</p>
        <label>模型名称<input aria-label="模型名称" value={model} onChange={event => setModel(event.target.value)} required placeholder="填写服务商提供的模型 ID" spellCheck={false} maxLength={200} /></label>
        <label>翻译目标语言<select aria-label="翻译目标语言" value={targetLanguage} onChange={event => setTargetLanguage(event.target.value)}><option>简体中文</option><option>繁體中文</option><option>English</option><option>日本語</option><option>Deutsch</option><option>Français</option></select></label>
      </fieldset>
      <p className="ai-privacy">翻译发送选中的文字；对话发送消息、对话历史与主动引用的片段。原 PDF 不会上传。请求按服务商规则计费，连接测试也会发送一条短消息。</p>
      {(error || ai.settingsError || ai.settings?.keyError) && <div className="ai-error" role="alert">{error || ai.settingsError || ai.settings?.keyError}</div>}
      {notice && <div className="ai-notice" role="status"><Check size={14} />{notice}</div>}
      <div className="ai-settings-actions">{testing ? <button type="button" className="text-button" onClick={() => ai.stop('test')}>停止测试</button> : <button type="button" className="text-button" disabled={busy} onClick={() => void submit(true)}>保存并测试</button>}<button className="primary-button" type="submit" disabled={busy}>{busy && <LoaderCircle size={14} className="spin" />}保存设置</button></div>
    </form>
  </div>;
}
