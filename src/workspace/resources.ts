import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PageSize } from '../types';

export type PdfResource = { pdf: PDFDocumentProxy; sizes: PageSize[]; name: string; documentId: string; bytes: number };

/** Owns loaded resources only; tab metadata survives all evictions. */
export class ResourceCache<T extends { bytes: number }> {
  private values = new Map<string, T>();
  private active: string | null = null;
  constructor(private release: (value: T) => void) {}
  get(id: string) {
    const value = this.values.get(id);
    if (value) { this.values.delete(id); this.values.set(id, value); }
    return value;
  }
  activate(id: string | null) { this.active = id; this.prune(); }
  put(id: string, value: T) {
    if (this.values.get(id) !== value) this.delete(id);
    this.values.delete(id); this.values.set(id, value); this.prune();
  }
  delete(id: string) { const value = this.values.get(id); if (value) { this.values.delete(id); this.release(value); } }
  clear() { for (const id of [...this.values.keys()]) this.delete(id); }
  private prune() {
    for (const [id, value] of this.values) if (id !== this.active && value.bytes > 32 * 1024 * 1024) this.delete(id);
    while (this.values.size > 2) {
      const oldest = [...this.values.keys()].find(id => id !== this.active);
      if (oldest === undefined) break;
      this.delete(oldest);
    }
  }
}
