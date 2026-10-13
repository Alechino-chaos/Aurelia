import { appMessages } from './i18n-app-messages.js';
export { appMessages } from './i18n-app-messages.js';

export type UiLocale = 'zh-CN' | 'en';
export type AppSettings = { locale: UiLocale | null; suggestedLocale: UiLocale; warning?: 'invalid' };
export const isUiLocale = (value: unknown): value is UiLocale => value === 'zh-CN' || value === 'en';
export function suggestUiLocale(value: string): UiLocale { return /^zh(?:[-_]|$)/i.test(value) ? 'zh-CN' : 'en'; }
let currentLocale: UiLocale = 'zh-CN';
export function getUiLocale(): UiLocale { return currentLocale; }
export function setUiLocale(value: UiLocale): void {
  if (!isUiLocale(value)) throw new Error('Unsupported interface language');
  currentLocale = value;
}

type Slots<S extends string> = S extends `${string}{${infer P}}${infer Rest}` ? P | Slots<Rest> : never;
export type MessageParameters<S extends string> = { [P in Slots<S>]: string | number };
type Arguments<S extends string> = [Slots<S>] extends [never]
  ? [parameters?: Record<string, never>, locale?: UiLocale]
  : [parameters: MessageParameters<S>, locale?: UiLocale];

/** Both runtimes can define feature catalogs without importing Node or Electron. */
export function createTranslator<const T extends Record<string, string>>(zh: T, en: { [K in keyof T]: string }) {
  const keys = Object.keys(zh).sort();
  if (JSON.stringify(keys) !== JSON.stringify(Object.keys(en).sort())) throw new Error('Translation catalog keys differ');
  const slots = (value: string) => [...new Set([...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]))].sort().join(',');
  for (const key of keys) if (slots(zh[key]) !== slots(en[key])) throw new Error(`Translation parameters differ: ${key}`);
  return <K extends keyof T>(key: K, ...args: Arguments<T[K]>): string => {
    const [parameters, locale = currentLocale] = args;
    const template = locale === 'en' ? en[key] : zh[key];
    // One replacement pass protects literal braces inside names, paths and user data.
    return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
      const value = (parameters as Record<string, string | number> | undefined)?.[name];
      if (value === undefined) throw new Error(`Missing translation parameter: ${name}`);
      return String(value);
    });
  };
}

/** Original application text is a typed key; only app-authored message call sites use it. */
export function appMessage(value: keyof typeof appMessages, locale: UiLocale = currentLocale): string {
  return locale === 'en' ? appMessages[value] : value;
}
const http = createTranslator({ http: 'AI 服务返回 HTTP {status}，请稍后重试。' } as const,
  { http: 'The AI service returned HTTP {status}. Please try again later.' });
export function httpStatusMessage(status: number, locale: UiLocale = currentLocale): string {
  return http('http', { status }, locale);
}

/** Exact app-error/status boundary for cached errors; never call on PDF, notes, server or AI content. */
export function translateAppMessage(value: string, locale: UiLocale = currentLocale): string {
  for (const [zh, en] of Object.entries(appMessages)) if (value === zh || value === en) return locale === 'en' ? en : zh;
  const match = /^(?:AI 服务返回 HTTP (\d+)，请稍后重试。|The AI service returned HTTP (\d+)\. Please try again later\.)$/.exec(value);
  return match ? httpStatusMessage(Number(match[1] ?? match[2]), locale) : value;
}

/** Carries application provenance until a transport encodes it. Its message stays readable for native code. */
export class AppUiError extends Error {}
export function appError(key: keyof typeof appMessages, options?: ErrorOptions): AppUiError {
  return new AppUiError(appMessage(key), options);
}
const marker = '[[aurelia-ui]]';
/** Only call for text authored by Aurelia; third-party details must use backendErrorMessage. */
export function encodeAppMessage(value: string): string { return marker + translateAppMessage(value, 'zh-CN'); }
export function backendErrorMessage(error: unknown): string {
  return error instanceof AppUiError ? encodeAppMessage(error.message)
    : error instanceof Error ? error.message : String(error);
}
/** Relocalize marked backend errors/status only; raw external details remain byte-for-byte. */
export function translateBackendMessage(value: string, locale: UiLocale = currentLocale): string {
  const match = /^(?:Error invoking remote method '[^']+': (?:Error: )?)?\[\[aurelia-ui\]\]([\s\S]*)$/.exec(value);
  return match ? translateAppMessage(match[1], locale) : value;
}
