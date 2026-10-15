import { Download, ExternalLink, LoaderCircle, RefreshCw, RotateCw, X } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageProvider';
import { useUpdates, type UpdateAction } from './UpdateProvider';
import { updateMessages } from './messages';

export function UpdateFailure() {
  const updates = useUpdates(), { locale } = useLanguage(), { text } = updateMessages(locale);
  if (!updates.failure) return null;
  const { action, preference } = updates.failure;
  const locked = updates.state?.phase === 'preparing' || updates.pending.includes('install') || updates.pending.includes('connect');
  const key = action === 'download' ? 'retryDownload' : action === 'install' ? 'retryInstall' : action === 'check' ? 'retryCheck' : 'retryConnection';
  return <div className="update-error" role="alert"><p>{text('transport')}</p><button type="button" disabled={locked || updates.pending.includes(action)} onClick={() => void updates.act(action, preference)}>{text(action === 'preference' ? 'preferenceRetry' : key)}</button></div>;
}
export function UpdatePreference() {
  const updates = useUpdates(), { locale } = useLanguage(), { text, error } = updateMessages(locale);
  const { state, pending } = updates;
  const locked = state?.phase === 'preparing' || pending.includes('install') || pending.includes('connect');
  return <div className="update-preference">
    <label><input type="checkbox" checked={pending.includes('preference') ? updates.preferenceAttempt ?? state?.autoCheck ?? false : state?.autoCheck ?? false} disabled={!state || pending.includes('preference') || locked} onChange={event => void updates.act('preference', event.target.checked)} />{text('autoCheck')}</label>
    <p className="field-help">{text('autoHelp')}</p>
    {state?.error === 'preferences' && <div className="update-error" role="alert"><p>{error('preferences')}</p><button type="button" disabled={locked || pending.includes('preference')} onClick={() => void updates.act('preference', updates.preferenceAttempt ?? state.autoCheck)}>{text('preferenceRetry')}</button></div>}
    <UpdateFailure />
  </div>;
}
export function UpdatePage({ onLater }: { onLater: () => void }) {
  const updates = useUpdates(), { locale } = useLanguage(), { text, phase, error } = updateMessages(locale);
  const { state, pending } = updates;
  const locked = pending.includes('connect') || pending.includes('check') || pending.includes('install') || state?.phase === 'checking' || state?.phase === 'preparing';
  const installing = state?.phase === 'downloaded' || state?.phase === 'error' && (state.error === 'save' || state.error === 'install');
  const downloadable = state?.phase === 'available' || state?.phase === 'cancelled' || state?.phase === 'error' && state.error === 'download';
  const failedCheck = state?.phase === 'error' && ['network', 'timeout', 'invalid-version'].includes(state.error ?? '');
  const percent = Math.min(100, Math.max(0, state?.percent ?? 0));
  const trigger = (action: UpdateAction) => () => void updates.act(action);
  return <div className="update-page">
    <div className="update-brand"><img src={`${import.meta.env.BASE_URL}branding/aurelia.png`} alt="" /><div><h3>Aurelia</h3><p>{text('about')}</p></div></div>
    <dl className="update-details"><div><dt>{text('version')}</dt><dd>{state?.currentVersion ?? '—'}</dd></div><div><dt>{text('lastCheck')}</dt><dd>{state?.lastCheckedAt ? new Date(state.lastCheckedAt).toLocaleString(locale) : text('never')}</dd></div></dl>
    <div className="update-status" role="status">{!updates.failure && (!state || ['checking', 'preparing'].includes(state.phase)) && <LoaderCircle size={18} className="spin" aria-hidden="true" />}<span>{updates.failure && ['check', 'connect'].includes(updates.failure.action) ? text('checkFailed') : state ? phase(state.phase) : text('loading')}</span></div>
    {state?.phase === 'unsupported' && <p className="update-help">{text('unsupportedHelp')}</p>}
    {state?.error && state.error !== 'preferences' && <div className="update-error" role="alert">{error(state.error)}</div>}
    {state?.error === 'preferences' && <div className="update-error" role="alert"><p>{error('preferences')}</p><button type="button" disabled={locked || pending.includes('preference')} onClick={() => void updates.act('preference', updates.preferenceAttempt ?? state.autoCheck)}>{text('preferenceRetry')}</button></div>}
    <UpdateFailure />
    {state?.phase === 'downloading' && <div className="update-progress"><progress aria-label={phase('downloading')} aria-valuenow={Math.round(percent)} max={100} value={percent} /><div><span>{Math.round(percent)}%</span><span>{((state.transferred ?? 0) / 1048576).toFixed(1)} MB{state.total ? ` / ${(state.total / 1048576).toFixed(1)} MB` : ''}</span></div><p className="update-help">{text('downloadHelp')}</p></div>}
    {state?.availableVersion && <section className="update-release"><h4>{text('summary')} · {state.availableVersion}</h4><p className="update-release-notes" data-testid="update-release-notes" lang={state.releaseNotes ? 'en' : locale}>{state.releaseNotes || text('noNotes')}</p><p className="update-help">{text('notesHelp')}</p></section>}
    {installing && <p className="update-help">{text('restartHelp')}</p>}
    <div className="update-actions">
      {downloadable && <button type="button" className="primary-button" disabled={locked || pending.includes('download')} onClick={trigger('download')}><Download size={16} />{text(state?.error === 'download' ? 'retryDownload' : 'download')}</button>}
      {state?.phase === 'downloading' && <button type="button" disabled={locked || pending.includes('cancel')} onClick={trigger('cancel')}><X size={16} />{text(pending.includes('cancel') ? 'cancelPending' : 'cancel')}</button>}
      {installing && <button type="button" className="primary-button" disabled={locked} onClick={trigger('install')}><RotateCw size={16} />{text(state?.phase === 'error' ? 'retryInstall' : 'restart')}</button>}
      {state?.supported && <button type="button" disabled={locked || ['downloading', 'downloaded'].includes(state.phase) || installing} onClick={trigger('check')}><RefreshCw size={16} />{text(failedCheck ? 'retryCheck' : 'check')}</button>}
      {(downloadable || installing) && <button type="button" disabled={locked} onClick={() => { updates.later(); onLater(); }}>{text('later')}</button>}
      <button type="button" disabled={locked || pending.includes('release')} onClick={trigger('release')}><ExternalLink size={16} />{text('releases')}</button>
    </div>
  </div>;
}
