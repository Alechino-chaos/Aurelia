import { appError } from './i18n.js';
import type { Annotation } from './session-types.js';

export function orderedAnnotations(annotations: readonly Annotation[]): Annotation[] {
  return [...annotations].sort((a, b) => a.regions[0].page - b.regions[0].page || a.regions[0].y - b.regions[0].y || a.regions[0].x - b.regions[0].x || a.createdAt - b.createdAt);
}

const lines = (text: string) => text.replace(/\r\n?/g, '\n');
// CommonMark escapes all ASCII punctuation. Excerpts are literal source text,
// whereas the user's note below intentionally remains editable Markdown.
const literal = (text: string) => lines(text).replace(/[!-/:-@\[-`{-~]/g, '\\$&');

export function renderNotesMarkdown(fileName: string, annotations: readonly Annotation[]): string {
  if (!annotations.length) throw appError('这篇论文还没有可导出的批注。');
  const title = literal(fileName.replace(/\.pdf$/i, ''));
  const sections = orderedAnnotations(annotations).map((annotation, index) => {
    const pages = [...new Set(annotation.quote.pages)].sort((a, b) => a - b).join('、');
    const excerpt = literal(annotation.quote.text).split('\n').map(line => `> ${line}`).join('\n');
    const note = annotation.note.trim() ? `\n\n### 我的笔记\n\n${lines(annotation.note)}` : '';
    return `## 批注 ${index + 1} · 第 ${pages} 页\n\n### 原文摘录\n\n${excerpt}${note}`;
  });
  return `# ${title} · 阅读笔记\n\n来源：${literal(fileName)} · 共 ${annotations.length} 条批注\n\n---\n\n${sections.join('\n\n---\n\n')}\n`;
}

export function suggestNotesFileName(fileName: string): string {
  let stem = fileName.replace(/\.pdf$/i, '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '');
  // Keep well within Windows filename limits, including surrogate pairs.
  let bounded = '';
  for (const character of stem) { if (bounded.length + character.length > 170) break; bounded += character; }
  stem = bounded.replace(/[. ]+$/g, '');
  if (!stem || /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(stem)) return 'reading-notes.md';
  return `${stem}-notes.md`;
}
