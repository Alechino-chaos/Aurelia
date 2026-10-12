# Changelog

## 0.7.0 — 2026-10-13

- Organize explicitly imported PDFs in persistent, manually named groups, with actual folder locations visible beside each paper.
- Switch between a library sidebar and scrollable reading tabs; use the library drawer in tabs mode and keep page navigation independently available.
- Restore open papers, active paper, reading positions, zoom, panel state, sidebar width and collapsed groups after restart; load inactive papers only when selected.
- Keep each paper's search in memory while switching, save the outgoing paper's notes and stop its active AI request, and preserve independent navigation for same-content copies.
- Close reading tabs without removing library entries; move or remove entries and delete groups without moving or deleting source PDFs or saved notes.
- Reveal files in Explorer and relocate missing PDFs with matching content; offer changed files as separate imports and retain unavailable entries.
- Add Ctrl+Tab, Ctrl+Shift+Tab and Ctrl+W, reliable rapid activation and close handling, bounded PDF resource retention, and protected recovery for damaged library metadata.

Groups have one level. Search queries reset on restart or tab closure. The library does not scan folders or sync to a cloud service.

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
