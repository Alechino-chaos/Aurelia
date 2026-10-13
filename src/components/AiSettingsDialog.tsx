import { useLanguage } from '../i18n/LanguageProvider';
import { useState } from 'react';
import { Check, LoaderCircle } from 'lucide-react';
import type { AiController } from '../ai/useAi';
import { translateBackendMessage } from '../../electron/i18n';
import { targetLabel } from '../../electron/i18n-renderer';

export function AiSettingsForm({ ai, onBusy }: { ai: AiController; onBusy: (busy: boolean) => void }) {
  const { t, display, locale } = useLanguage();
  const [baseUrl, setBaseUrl] = useState(ai.settings?.baseUrl ?? 'https://api.openai.com/v1');
  const [model, setModel] = useState(ai.settings?.model ?? '');
  const [targetLanguage, setTargetLanguage] = useState(ai.settings?.targetLanguage ?? '简体中文');
  const [apiKey, setApiKey] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function submit(test = false) {
    setBusy(true); onBusy(true); setError(''); setNotice('');
    try {
      await ai.save({ baseUrl, model, targetLanguage, ...(apiKey ? { apiKey } : {}), clearKey });
      setApiKey(''); setClearKey(false); setNotice('设置已保存。');
      if (test) { setTesting(true); await ai.testConnection(); setNotice('连接成功，模型已返回回答。'); }
    } catch (reason) { setError((reason instanceof Error ? reason.message : String(reason)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }
    finally { setBusy(false); onBusy(false); setTesting(false); }
  }
  return <form className="ai-settings-form" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <p className="ai-subtitle">{t("配置 API 地址、密钥与模型。")}</p>
      <fieldset disabled={busy}>
        <label>{t("API 地址")}<input aria-label={t("API 地址")} type="url" value={baseUrl} onChange={event => setBaseUrl(event.target.value)} required placeholder="https://api.example.com/v1" spellCheck={false} /></label>
        <p className="field-help">{t("支持 OpenAI 兼容的 Chat Completions 接口。填写服务商提供的地址（通常以 /v1 结尾），本机服务可用 HTTP。")}</p>
        <label>API Key<input aria-label="API Key" type="password" autoComplete="off" value={apiKey} disabled={clearKey} onChange={event => setApiKey(event.target.value)} placeholder={ai.settings?.hasApiKey ? t("已保存，留空保持不变") : t("输入 Key；无鉴权的本机服务可留空")} /></label>
        <label className="ai-clear-key"><input type="checkbox" checked={clearKey} onChange={event => { setClearKey(event.target.checked); if (event.target.checked) setApiKey(''); }} />{t("清除已保存的 Key")}</label>
        <p className="field-help">{t("Key 使用系统加密后保存在本机。更换服务商时，请填写对应的 Key。")}</p>
        <label>{t("模型名称")}<input aria-label={t("模型名称")} value={model} onChange={event => setModel(event.target.value)} required placeholder={t("填写服务商提供的模型 ID")} spellCheck={false} maxLength={200} /></label>
        <label>{t("翻译目标语言")}<select aria-label={t("翻译目标语言")} value={targetLanguage} onChange={event => setTargetLanguage(event.target.value)}>{['简体中文', '繁體中文', 'English', '日本語', 'Deutsch', 'Français'].map(value => <option key={value} value={value}>{targetLabel(value, locale)}</option>)}</select></label>
      </fieldset>
      <p className="ai-privacy">{t("翻译发送选中的文字；对话发送消息、对话历史与主动引用的片段。原 PDF 不会上传。请求按服务商规则计费，连接测试也会发送一条短消息。")}</p>
      {(error || ai.settingsError || ai.settings?.keyError) && <div className="ai-error" role="alert">{translateBackendMessage(error || ai.settingsError || ai.settings?.keyError || '', locale)}</div>}
      {notice && <div className="ai-notice" role="status"><Check size={14} />{display(notice)}</div>}
      <div className="ai-settings-actions">{testing ? <button type="button" className="text-button" onClick={() => ai.stop('test')}>{t("停止测试")}</button> : <button type="button" className="text-button" disabled={busy} onClick={() => void submit(true)}>{t("保存并测试")}</button>}<button className="primary-button" type="submit" disabled={busy}>{busy && <LoaderCircle size={14} className="spin" />}{t("保存设置")}</button></div>
    </form>
  ;
}
