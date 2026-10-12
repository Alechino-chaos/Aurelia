import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;
export function loadPdf(bytes: Uint8Array) {
  const assets = new URL(`${import.meta.env.BASE_URL}pdf-assets/`, window.location.href).href;
  return getDocument({
    data: bytes, cMapUrl: `${assets}cmaps/`, cMapPacked: true,
    standardFontDataUrl: `${assets}standard_fonts/`, wasmUrl: `${assets}wasm/`,
  });
}
