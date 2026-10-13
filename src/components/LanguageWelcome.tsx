import { useState } from 'react';
import { ArrowRight, Check, LoaderCircle } from 'lucide-react';
import type { UiLocale } from '../../electron/i18n';
import { translateBackendMessage } from '../../electron/i18n';
import { useLanguage } from '../i18n/LanguageProvider';

export function LanguageWelcome() {
  const language = useLanguage();
  const { t } = language;
  const [choice, setChoice] = useState<UiLocale>(language.settings?.suggestedLocale ?? 'zh-CN');
  return <main className="language-welcome language-welcome--choice">
    <aside className="welcome-art" aria-label="Aurelia">
      <img className="welcome-art-image" src="./branding/welcome-reading.png" alt="" />
      <div className="welcome-brand"><img src="./branding/aurelia.png" alt="" /><span>Aurelia</span></div>
      <div className="welcome-motto">
        <p lang="zh-CN"><span>{t('welcomeMottoFirst')}</span><span>{t('welcomeMottoSecond')}</span></p>
        <p lang="en">{t('welcomeMottoEnglish')}</p>
      </div>
    </aside>
    <section className="welcome-content">
      <form className="welcome-form" onSubmit={event => { event.preventDefault(); void language.save(choice); }}>
        <header>
          <h1 className="welcome-greeting" aria-label={t('welcomeTitle')}><span lang="zh-CN">{t('welcomeGreetingChinese')}</span><span aria-hidden="true"> / </span><span lang="en">{t('welcomeGreetingEnglish')}</span></h1>
          <h2 className="welcome-heading" lang="zh-CN">{t('welcomeChooseChinese')}</h2>
          <p className="welcome-heading-english" lang="en">{t('welcomeChooseEnglish')}</p>
        </header>
        {language.settings?.warning && <p className="welcome-notice" role="alert">{t('invalidPreference')}</p>}
        <fieldset className="welcome-languages" disabled={language.saving}>
          <legend className="welcome-visually-hidden">{t('languageLegend')}</legend>
          {(['zh-CN', 'en'] as const).map(locale => <label key={locale} className="welcome-language">
            <span className="welcome-language-copy"><strong lang={locale}>{t(locale === 'zh-CN' ? 'welcomeChineseName' : 'welcomeEnglishName')}</strong><small lang={locale === 'zh-CN' ? 'en' : 'zh-CN'}>{t(locale === 'zh-CN' ? 'welcomeChineseTranslation' : 'welcomeEnglishTranslation')}</small></span>
            <input type="radio" name="language" aria-label={t(locale === 'zh-CN' ? 'welcomeChineseName' : 'welcomeEnglishName')} checked={choice === locale} onChange={() => setChoice(locale)} />
            <span className="welcome-radio" aria-hidden="true"><Check size={16} /></span>
          </label>)}
        </fieldset>
        {language.error && <div className="welcome-notice" role="alert"><p>{t('firstSaveFailure')}</p><small>{translateBackendMessage(language.error, language.locale)}</small></div>}
        <button type="submit" className="welcome-continue" aria-label={t('confirmLanguage')} disabled={language.saving}>
          <span><strong lang="zh-CN">{t('welcomeContinueChinese')}</strong><small lang="en">{t('welcomeContinueEnglish')}</small></span>
          {language.saving ? <LoaderCircle size={22} className="spin" aria-hidden="true" /> : <ArrowRight size={24} aria-hidden="true" />}
        </button>
        <p className="welcome-later"><span lang="zh-CN">{t('welcomeLaterChinese')}</span><span lang="en">{t('welcomeLaterEnglish')}</span></p>
      </form>
    </section>
  </main>;
}
export function LanguageGate({ children }: { children: React.ReactNode }) {
  const language = useLanguage();
  if (!language.ready) return <main className="language-welcome" role="status">{language.t('loadingPreference')}</main>;
  if (!language.settings) return <main className="language-welcome"><div role="alert"><h1>{language.t('preferenceLoadFailure')}</h1><p>{language.t('preferenceLoadHelp')}</p><small>{translateBackendMessage(language.error, language.locale)}</small><p><button className="primary-button" onClick={() => void language.retry()}>{language.t('retryPreference')}</button></p></div></main>;
  return language.settings.locale ? children : <LanguageWelcome />;
}
