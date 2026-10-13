import { afterEach, describe, expect, it } from 'vitest';
import { appMessage, appError, backendErrorMessage, createTranslator, getUiLocale, setUiLocale, suggestUiLocale, translateAppMessage, translateBackendMessage, appMessages } from '../electron/i18n';
import { normalizeBaseUrl, httpError } from '../electron/ai-protocol';
import { validateExternalUrl } from '../electron/external-url';

afterEach(() => setUiLocale('zh-CN'));
describe('shared interface translations', () => {
  it('suggests Chinese locales and English otherwise without confirming a choice', () => {
    for (const locale of ['zh', 'zh-CN', 'zh-TW', 'ZH_hk']) expect(suggestUiLocale(locale)).toBe('zh-CN');
    for (const locale of ['en-US', 'de-DE', '', 'zht']) expect(suggestUiLocale(locale)).toBe('en');
  });
  it('uses identical catalog keys and typed interpolation with intact dynamic values', () => {
    const translate = createTranslator({ hello: '你好 {name}，第 {page} 页' } as const, { hello: 'Hello {name}, page {page}' });
    expect(translate('hello', { name: 'A {page}.pdf', page: 17 }, 'en')).toBe('Hello A {page}.pdf, page 17');
    for (const [zh, en] of Object.entries(appMessages)) { expect(zh).toBeTruthy(); expect(en).toBeTruthy(); }
  });
  it('defaults deterministically to Chinese and localizes backend validation at emission', () => {
    expect(getUiLocale()).toBe('zh-CN');
    expect(() => normalizeBaseUrl(null)).toThrow('请填写有效的 API 地址。');
    setUiLocale('en');
    expect(() => normalizeBaseUrl(null)).toThrow('Enter a valid API URL.');
    expect(() => validateExternalUrl('file:///private.pdf')).toThrow('Only HTTP(S) external links without login credentials are supported.');
    expect(httpError(503)).toBe('The AI service returned HTTP 503. Please try again later.');
  });
  it('relocalizes exact known application errors in either language, preserving other content', () => {
    const old = appMessage('请填写有效的 API 地址。', 'en');
    expect(translateAppMessage(old, 'zh-CN')).toBe('请填写有效的 API 地址。');
    expect(translateAppMessage('AI 服务返回 HTTP 503，请稍后重试。', 'en')).toBe('The AI service returned HTTP 503. Please try again later.');
    expect(translateAppMessage('Provider: 请填写有效的 API 地址。', 'en')).toBe('Provider: 请填写有效的 API 地址。');
    expect(translateAppMessage('A paper title', 'en')).toBe('A paper title');
  });
  it('preserves raw third-party errors even when they coincide with an app catalog message', () => {
    const raw = new Error('请填写有效的 API 地址。');
    expect(translateBackendMessage(backendErrorMessage(raw), 'en')).toBe(raw.message);
    const authored = backendErrorMessage(appError('请填写有效的 API 地址。'));
    expect(translateBackendMessage(authored, 'en')).toBe('Enter a valid API URL.');
    expect(translateBackendMessage(`Error invoking remote method 'ai:start': Error: ${authored}`, 'en')).toBe('Enter a valid API URL.');
    expect(translateBackendMessage(authored, 'zh-CN')).toBe('请填写有效的 API 地址。');
  });
  it('rejects catalog key and interpolation-slot mismatches', () => {
    expect(() => createTranslator({ text: '第 {page} 页' } as const, { text: 'Page {number}' })).toThrow();
    expect(() => createTranslator({ text: '文字' }, {} as never)).toThrow();
  });
});
