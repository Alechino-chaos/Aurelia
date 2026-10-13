import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { isUiLocale, setUiLocale, suggestUiLocale, type AppSettings, type UiLocale } from '../../electron/i18n';
import { uiText, displayMessage } from '../../electron/i18n-renderer';

const storageKey = 'aurelia:app-settings';
async function loadSettings(): Promise<AppSettings> {
  if (window.paperdesk) return window.paperdesk.getAppSettings();
  const suggestedLocale = suggestUiLocale(navigator.language), raw = localStorage.getItem(storageKey);
  if (raw === null) return { locale: null, suggestedLocale };
  try { const value = JSON.parse(raw); if (value && Object.keys(value).length === 1 && isUiLocale(value.locale)) return { locale: value.locale, suggestedLocale }; } catch { /* Explicit confirmation preserves malformed evidence below. */ }
  return { locale: null, suggestedLocale, warning: 'invalid' };
}
async function persistSettings(locale: UiLocale): Promise<AppSettings> {
  if (window.paperdesk) return window.paperdesk.saveAppSettings({ locale });
  const prior = await loadSettings();
  if (prior.warning) { const raw = localStorage.getItem(storageKey); if (raw !== null) localStorage.setItem(`${storageKey}:corrupt:${crypto.randomUUID()}`, raw); }
  localStorage.setItem(storageKey, JSON.stringify({ locale }));
  return { locale, suggestedLocale: suggestUiLocale(navigator.language) };
}
type LanguageState = { locale: UiLocale; ready: boolean; settings: AppSettings | null; error: string; saving: boolean;
  retry: () => Promise<void>; save: (locale: UiLocale) => Promise<boolean>; t: typeof uiText; display: (message: string) => string };
const fallback: LanguageState = { locale: 'zh-CN', ready: true, settings: { locale: 'zh-CN', suggestedLocale: 'zh-CN' }, error: '', saving: false,
  retry: async () => {}, save: async () => false, t: ((key, ...args: any[]) => (uiText as any)(key, args[0], 'zh-CN')) as typeof uiText, display: value => displayMessage(value, 'zh-CN') };
const Context = createContext<LanguageState>(fallback);
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings | null>(null), [ready, setReady] = useState(false), [error, setError] = useState(''), [saving, setSaving] = useState(false);
  const busy = useRef(false), alive = useRef(true);
  const retry = useCallback(async () => {
    setError(''); setReady(false);
    try { const next = await loadSettings(); if (alive.current) setSettings(next); }
    catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (alive.current) setReady(true); }
  }, []);
  useEffect(() => { alive.current = true; void retry(); return () => { alive.current = false; }; }, [retry]);
  const locale = settings?.locale ?? settings?.suggestedLocale ?? 'zh-CN';
  useEffect(() => { document.documentElement.lang = locale; setUiLocale(locale); }, [locale]);
  const save = useCallback(async (choice: UiLocale) => {
    if (busy.current) return false;
    busy.current = true; setSaving(true); setError('');
    try { const next = await persistSettings(choice); if (alive.current) setSettings(next); return true; }
    catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : String(reason)); return false; }
    finally { busy.current = false; if (alive.current) setSaving(false); }
  }, []);
  // Context changes presentation only; the provider and its already-confirmed children retain identity.
  const t: typeof uiText = (key, ...args: any[]) => (uiText as any)(key, args[0], locale);
  return <Context.Provider value={{ locale, settings, ready, error, saving, retry, save, t, display: message => displayMessage(message, locale) }}>{children}</Context.Provider>;
}
export const useLanguage = () => useContext(Context);
