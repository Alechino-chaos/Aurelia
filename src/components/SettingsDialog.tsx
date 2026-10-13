import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, Settings, X } from 'lucide-react';
import type { UiLocale } from '../../electron/i18n';
import { translateBackendMessage } from '../../electron/i18n';
import type { AiController } from '../ai/useAi';
import { useLanguage } from '../i18n/LanguageProvider';
import { AiSettingsForm } from './AiSettingsDialog';

export function SettingsDialog({ ai }: { ai: AiController }) {
  const language = useLanguage(), { t } = language;
  const [section, setSection] = useState<'general' | 'ai'>(ai.settingsSection);
  const [choice, setChoice] = useState<UiLocale>(language.locale), [saved, setSaved] = useState(false), [aiBusy, setAiBusy] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const busy = aiBusy || language.saving;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>('[role="tab"]')?.focus();
    return () => previous?.focus({ preventScroll: true });
  }, []);
  const close = () => { if (!busy) ai.setSettingsOpen(false); };
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <div className="ai-settings settings-dialog" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="settings-title" onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); close(); }
      if (event.key === 'Tab') {
        const items = Array.from(dialog.current!.querySelectorAll<HTMLElement>('input:not(:disabled), select:not(:disabled), button:not(:disabled)')).filter(item => item.getClientRects().length);
        const first = items[0], last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <div className="ai-settings-heading"><div><Settings size={20} /><h2 id="settings-title">{t('设置')}</h2></div><button className="icon-button" aria-label={t('关闭设置')} disabled={busy} onClick={close}><X /></button></div>
      <div className="settings-tabs" role="tablist" aria-label={t('设置')}>{(['general', 'ai'] as const).map(item => <button type="button" role="tab" aria-selected={section === item} id={`settings-${item}-tab`} aria-controls={`settings-${item}`} key={item} onClick={() => setSection(item)} onKeyDown={event => {
        if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 'general' : event.key === 'End' ? 'ai' : item === 'general' ? 'ai' : 'general'; setSection(next); dialog.current?.querySelector<HTMLButtonElement>(`#settings-${next}-tab`)?.focus(); }
      }}>{t(item === 'general' ? '常规' : 'AI 服务')}</button>)}</div>
      <section role="tabpanel" id="settings-general" aria-labelledby="settings-general-tab" hidden={section !== 'general'}>
        <form onSubmit={event => { event.preventDefault(); void language.save(choice).then(success => setSaved(success)); }}>
          <label>{t('界面语言')}<select aria-label={t('界面语言')} value={choice} disabled={language.saving} onChange={event => { setChoice(event.target.value as UiLocale); setSaved(false); }}><option value="zh-CN">简体中文</option><option value="en">English</option></select></label>
          <p className="field-help">{t('界面语言不会更改翻译目标、模型或对话。')}</p>
          {language.error && <div className="ai-error" role="alert">{t('无法保存语言设置，请重试。')}<p>{translateBackendMessage(language.error, language.locale)}</p></div>}
          {saved && <p className="ai-notice" role="status">{t('语言已保存。')}</p>}
          <div className="ai-settings-actions"><button type="submit" className="primary-button" disabled={language.saving}>{language.saving && <LoaderCircle size={14} className="spin" />}{t('保存语言')}</button></div>
        </form>
      </section>
      <section role="tabpanel" id="settings-ai" aria-labelledby="settings-ai-tab" hidden={section !== 'ai'}><AiSettingsForm ai={ai} onBusy={setAiBusy} /></section>
    </div>
  </div>;
}
