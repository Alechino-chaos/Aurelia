import { appError } from './i18n.js';
/** Shared pure validator; the trusted main-process IPC must call this again. */
export function validateExternalUrl(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 8192 || value.trim() !== value || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) {
    throw appError('外部链接地址无效。');
  }
  let url: URL;
  try { url = new URL(value); } catch { throw appError('外部链接地址无效。'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.href.length > 8192) {
    throw appError('仅支持无登录信息的 HTTP(S) 外部链接。');
  }
  return url.href;
}
