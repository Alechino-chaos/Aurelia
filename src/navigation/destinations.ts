import type { PDFDocumentProxy } from 'pdfjs-dist';
import { appError } from '../../electron/i18n';

export interface ResolvedDestination { page: number; x: number | null; y: number | null }
const fail = (): never => { throw appError('无法定位此 PDF 链接的目标。'); };
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const optional = (value: unknown): value is number | null => value === null || finite(value);
const clamp = (value: number) => Math.max(0, Math.min(1, value));

/** Resolve native destinations in displayed-page axes; destination zoom never escapes. */
export async function resolveDestination(pdf: PDFDocumentProxy, destination: unknown): Promise<ResolvedDestination> {
  const dest = typeof destination === 'string' && destination.length ? await pdf.getDestination(destination) : destination;
  if (!Array.isArray(dest) || dest.length < 2) return fail();
  const mode = dest[1]?.name;
  const length = mode === 'XYZ' ? 5 : ['FitH', 'FitBH', 'FitV', 'FitBV'].includes(mode) ? 3 : mode === 'FitR' ? 6 : ['Fit', 'FitB'].includes(mode) ? 2 : 0;
  if (!length || dest.length !== length) return fail();
  let index: number;
  if (Number.isInteger(dest[0])) index = dest[0];
  else if (dest[0] && Number.isInteger(dest[0].num) && dest[0].num > 0 && Number.isInteger(dest[0].gen) && dest[0].gen >= 0) index = await pdf.getPageIndex(dest[0]);
  else return fail();
  if (!Number.isInteger(index) || index < 0 || index >= pdf.numPages) return fail();
  if (mode === 'XYZ' && (!optional(dest[2]) || !optional(dest[3]) || !optional(dest[4]) || (finite(dest[4]) && dest[4] < 0))) return fail();
  if (length === 3 && !optional(dest[2])) return fail();
  if (mode === 'FitR' && (!dest.slice(2).every(finite) || dest[2] >= dest[4] || dest[3] >= dest[5])) return fail();
  const page = await pdf.getPage(index + 1);
  const viewport = page.getViewport({ scale: 1 });
  if (!(viewport.width > 0 && viewport.height > 0 && Number.isFinite(viewport.width) && Number.isFinite(viewport.height))) return fail();
  if (mode === 'Fit' || mode === 'FitB') return { page: index + 1, x: 0, y: 0 };
  if (mode === 'FitR') {
    const rect = [...viewport.convertToViewportPoint(dest[2], dest[3]), ...viewport.convertToViewportPoint(dest[4], dest[5])];
    return { page: index + 1, x: clamp(Math.min(rect[0], rect[2]) / viewport.width), y: clamp(Math.min(rect[1], rect[3]) / viewport.height) };
  }
  const horizontal = mode === 'FitH' || mode === 'FitBH';
  const vertical = mode === 'FitV' || mode === 'FitBV';
  const left = vertical ? dest[2] : horizontal ? null : dest[2];
  const top = horizontal ? dest[2] : vertical ? null : dest[3];
  const [x, y] = viewport.convertToViewportPoint(left ?? page.view[0], top ?? page.view[3]);
  // At 90/270 degrees PDF left controls displayed y, and PDF top controls displayed x.
  const xInput = viewport.transform[0] !== 0 ? left : top;
  const yInput = viewport.transform[1] !== 0 ? left : top;
  return {
    page: index + 1,
    x: xInput === null ? (horizontal || vertical ? 0 : null) : clamp(x / viewport.width),
    y: yInput === null ? (horizontal || vertical ? 0 : null) : clamp(y / viewport.height),
  };
}
