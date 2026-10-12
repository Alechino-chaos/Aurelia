import type { PDFDocumentProxy, TextContent } from 'pdfjs-dist/types/src/display/api';
import { orderText } from './readingOrder';

type PageText = { content: TextContent; width: number; rotation: number; ordered: Map<boolean, ReturnType<typeof orderText>> };
const documents = new WeakMap<PDFDocumentProxy, Map<number, Promise<PageText>>>();

/** One extraction per page/document instance, shared by lazy rendering and search. */
export async function getPageText(pdf: PDFDocumentProxy, number: number, autoColumns: boolean) {
  let pages = documents.get(pdf);
  if (!pages) { pages = new Map(); documents.set(pdf, pages); }
  let pending = pages.get(number);
  if (!pending) {
    pending = (async () => {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent({ disableNormalization: true });
      return { content, width: page.view[2] - page.view[0], rotation: page.rotate, ordered: new Map() };
    })();
    pages.set(number, pending);
    const cache = pages;
    void pending.catch(() => { if (cache.get(number) === pending) cache.delete(number); });
  }
  const data = await pending;
  const mode = autoColumns && data.rotation === 0;
  let ordered = data.ordered.get(mode);
  if (!ordered) { ordered = orderText(data.content, data.width, mode); data.ordered.set(mode, ordered); }
  return ordered;
}

export function releaseDocumentText(pdf: PDFDocumentProxy) { documents.delete(pdf); }
