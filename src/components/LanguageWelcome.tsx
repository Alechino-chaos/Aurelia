import { useState } from 'react';
import { BookOpen, LoaderCircle } from 'lucide-react';
import type { UiLocale } from '../../electron/i18n';
import { translateBackendMessage } from '../../electron/i18n';
import { useLanguage } from '../i18n/LanguageProvider';

export function LanguageWelcome() {
  const language = useLanguage();
  const { t } = language;
  const [choice, setChoice] = useState<UiLocale>(language.settings?.suggestedLocale ?? 'zh-CN');
  return <main className="language-welcome"><form onSubmit={event => { event.preventDefault(); void language.save(choice); }}>
    <BookOpen size={32} /><h1>{t('welcomeTitle')}</h1>
    <p>{t('welcomeHelp')}</p>
    {language.settings?.warning && <p role="alert">{t('invalidPreference')}</p>}
    <fieldset disabled={language.saving}><legend>{t('languageLegend')}</legend>
      <label><input type="radio" name="language" checked={choice === 'zh-CN'} onChange={() => setChoice('zh-CN')} />简体中文</label>
      <label><input type="radio" name="language" checked={choice === 'en'} onChange={() => setChoice('en')} />English</label>
    </fieldset>
    {language.error && <div role="alert"><p>{t('firstSaveFailure')}</p><small>{translateBackendMessage(language.error, language.locale)}</small></div>}
    <button type="submit" className="primary-button" disabled={language.saving}>{language.saving && <LoaderCircle size={16} className="spin" />}{t('confirmLanguage')}</button>
  </form></main>;
}
export function LanguageGate({ children }: { children: React.ReactNode }) {
  const language = useLanguage();
  if (!language.ready) return <main className="language-welcome" role="status">{language.t('loadingPreference')}</main>;
  if (!language.settings) return <main className="language-welcome"><div role="alert"><h1>{language.t('preferenceLoadFailure')}</h1><p>{language.t('preferenceLoadHelp')}</p><small>{translateBackendMessage(language.error, language.locale)}</small><p><button className="primary-button" onClick={() => void language.retry()}>{language.t('retryPreference')}</button></p></div></main>;
  return language.settings.locale ? children : <LanguageWelcome />;
}
