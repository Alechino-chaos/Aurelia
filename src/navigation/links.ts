import type { PageViewport } from 'pdfjs-dist';
import { validateExternalUrl } from '../../electron/external-url';

export type NativeNavigationAction = 'GoBack' | 'GoForward' | 'NextPage' | 'PrevPage' | 'FirstPage' | 'LastPage';
export type NativeLinkTarget =
  | { kind: 'destination'; destination: string | unknown[] }
  | { kind: 'action'; action: NativeNavigationAction }
  | { kind: 'external'; url: string }
  | { kind: 'unsupported' };
export interface NativeLinkRect { x: number; y: number; width: number; height: number }
const actions: string[] = ['GoBack', 'GoForward', 'NextPage', 'PrevPage', 'FirstPage', 'LastPage'];

/** Classifies PDF.js Link annotations only. Never executes or launches any target. */
export function classifyNativeLink(annotation: unknown): NativeLinkTarget | null {
  if (!annotation || typeof annotation !== 'object') return null;
  const data = annotation as Record<string, unknown>;
  if (data.subtype !== 'Link') return null;
  const unsupported: NativeLinkTarget = { kind: 'unsupported' };
  if (data.attachment || data.file || data.js || data.isTooltipOnly) return unsupported;
  const hasDest = data.dest !== undefined && data.dest !== null;
  const hasUrl = data.url != null || data.unsafeUrl != null;
  const hasAction = data.action != null;
  if (Number(hasDest) + Number(hasUrl) + Number(hasAction) !== 1) return unsupported;
  if (hasDest) {
    if (typeof data.dest === 'string' && data.dest.length) return { kind: 'destination', destination: data.dest };
    if (Array.isArray(data.dest) && data.dest.length >= 2) return { kind: 'destination', destination: data.dest };
    return unsupported;
  }
  if (hasAction) return typeof data.action === 'string' && actions.includes(data.action)
    ? { kind: 'action', action: data.action as NativeNavigationAction } : unsupported;
  try { return { kind: 'external', url: validateExternalUrl(data.unsafeUrl ?? data.url) }; } catch { return unsupported; }
}

/** Normalized displayed bounds suitable for a percentage-positioned React hit region. */
export function nativeLinkRect(rect: unknown, viewport: PageViewport): NativeLinkRect | null {
  if (!Array.isArray(rect) || rect.length !== 4 || !rect.every(value => typeof value === 'number' && Number.isFinite(value))
    || !Number.isFinite(viewport.width) || !Number.isFinite(viewport.height) || viewport.width <= 0 || viewport.height <= 0) return null;
  const [x1, y1] = viewport.convertToViewportPoint(rect[0], rect[1]);
  const [x2, y2] = viewport.convertToViewportPoint(rect[2], rect[3]);
  const left = Math.max(0, Math.min(x1, x2));
  const top = Math.max(0, Math.min(y1, y2));
  const right = Math.min(viewport.width, Math.max(x1, x2));
  const bottom = Math.min(viewport.height, Math.max(y1, y2));
  if (right <= left || bottom <= top) return null;
  return { x: left / viewport.width, y: top / viewport.height, width: (right - left) / viewport.width, height: (bottom - top) / viewport.height };
}
