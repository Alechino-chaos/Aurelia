import { expect, it } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { getPageText, releaseDocumentText } from '../src/pdf/documentText';

it('shares extraction between reading and searching, retries failures and isolates document instances', async () => {
  let calls = 0, fail = true;
  const pdf = { getPage: async () => ({ view: [0, 0, 612, 792], rotate: 0, getTextContent: async () => {
    calls++;
    if (fail) throw new Error('page unavailable');
    return { items: [{ str: 'hello', dir: 'ltr', transform: [10, 0, 0, 10, 40, 700], width: 50, height: 10, fontName: 'f1', hasEOL: false }], styles: {}, lang: null };
  } }) } as unknown as PDFDocumentProxy;
  await expect(getPageText(pdf, 1, true)).rejects.toThrow('page unavailable');
  fail = false;
  const [a, b] = await Promise.all([getPageText(pdf, 1, true), getPageText(pdf, 1, false)]);
  expect(a.entries[0].item.str).toBe('hello');
  expect(b.entries[0].item.str).toBe('hello');
  expect(calls).toBe(2);
  await getPageText(pdf, 1, true);
  expect(calls).toBe(2);
  await getPageText({ ...pdf } as PDFDocumentProxy, 1, true);
  expect(calls).toBe(3);
  releaseDocumentText(pdf);
  await getPageText(pdf, 1, true);
  expect(calls).toBe(4);
});
