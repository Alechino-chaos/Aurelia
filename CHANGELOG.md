# Changelog

## 0.6.0 — 2026-10-13

- Export the current paper's highlights and personal notes as one editable Markdown file from the annotations panel.
- Keep page references, source excerpts, and original note Markdown, including lists, emphasis, code blocks, and formulas.
- Include AI answers only when explicitly saved into an annotation; exclude other conversations and translations.
- Wait for pending saves and capture an independent snapshot before the native Save As dialog, preserving the original paper when switching documents.
- Handle cancellation and write errors without changing reading records or the source PDF; replace existing Markdown files only after a complete write.

## 0.5.0 — 2026-10-13

- Added local full-document search, including pages that have not been viewed.
- Added Ctrl+F, next/previous match navigation, wrap notices, and Esc to close.
- Added case-sensitive and optional line-end dehyphenation matching, with support for wrapped phrases, Chinese text, and font ligatures.
- Added separate search highlights that preserve text selection, copying, annotations, and zoom alignment.
- Added indexing progress, failed-page retry, textless-page notices, and an explicit 10,000-match limit.
- Shared extracted text between the reader and search; searches remain in memory and make no AI requests.

Search operates on the PDF text layer. OCR, cross-document search, regular expressions, and phrases spanning pages are not included.

## 0.4.2

Previous desktop release with PDF reading, two-column selection, AI translation and conversations, per-paper history, and local highlights and notes. See the historical security review in `docs/security-review-0.4.2.md`.
