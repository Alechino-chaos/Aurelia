# Markdown Reading Notes Export

Status: design and rendered mockup approved; implementation authorized by “可以，那就按这个来吧，开工”.

## 需求与方案速读

已确认的需求：

- 首要用途是自己整理和复习，主要使用 Obsidian、Typora；分享给别人是第二用途。
- 导出原文摘录、页码和自己的批注，包括已经主动存入批注的 AI 回答。其他翻译和聊天记录不自动导出。
- 批注里的 Markdown 原样保留，包括列表、加粗、代码块和公式；不重新生成或改写笔记内容。

推荐的使用方式：一篇论文导出一个 `.md` 文件，按批注面板的页码和位置顺序排列。没有笔记的高亮也保留。点击“导出笔记”，选择位置即可；如果最新笔记还在保存，就先等待保存完成。导出的文件可以独立编辑，再次导出不会自动合并外部修改。

推荐沿用现有技术：React 负责按钮与提示，TypeScript 负责把批注整理为 Markdown，Electron 与 Node.js 负责系统保存窗口和写文件。无需新框架、服务器或 AI 调用。所谓“快照”是固定本次导出的数据，避免保存过程中切换论文导致内容混杂。

默认沿用中文界面：导出结构标题使用“原文摘录”“我的笔记”“第 N 页”；摘录与笔记保持原来的语言。公开发布说明继续使用英文。第一版输出可编辑的 Markdown；另加 PDF 分享格式、自动同步和备份恢复均留待后续需求。

主要验收条件：刚写下的笔记不遗漏，不同论文不混杂，格式可继续编辑，取消不生成文件，写入失败不损坏已有文件。

## Purpose and scope

The user approved prioritizing one-click Markdown export of the current paper's highlights and notes, and requested planning before the update. The primary purpose is personal organization and review in Obsidian and Typora; sharing is secondary. Backup and restore are outside this feature. Success means that a reader can finish annotating a paper and save a complete, editable document with clear page references without manually copying individual annotations.

This is a medium-sized feature spanning the annotation panel, the existing Electron bridge, and local file saving. It reuses existing reading sessions, adds no dependencies, and does not change the session schema. The proposed feature version is 0.6.0.

Export all annotations for the current paper. Include highlights without notes and AI responses already appended to an annotation's note. Do not automatically include chat history, translations, drafts, API settings, or the original PDF. Export does not call AI or modify the PDF. Editing the exported file does not update Aurelia.

## User flow

1. Add an `导出笔记` button to the existing annotations panel header.
2. Enable it only when the current session is ready, has annotations, and has no pending or failed saves. While saving, explain that export becomes available after saving; existing retry controls handle failures. This avoids silently exporting stale data.
3. Clicking it starts one export operation. Disable duplicate clicks while it is running.
4. Open a native Windows Save As dialog with a Markdown filter and default name `<PDF basename>-notes.md`. The user chooses the directory and confirms any replacement using the native dialog.
5. Report success only after the write completes. Cancellation is silent; a write failure displays a retryable error without changing annotations.
6. If the paper changes during the operation, the export retains the original paper's snapshot; do not display its completion or error on the new paper's panel.

Keep the existing Chinese application interface. Generated Markdown structural labels use Chinese to match that interface; quoted text and user notes retain their original languages. The user's English-only publishing preference applies to public release information, not to private exported notes.

## Export format

Use UTF-8 Markdown, LF line endings, and a final newline. The document contains:

- A title derived from the current PDF filename, without its `.pdf` suffix.
- The source filename and total annotation count. Do not expose absolute local paths or internal session IDs.
- Numbered annotation sections ordered exactly as the annotation panel: first region page, y, x, then creation time. Preserve input order for ties.
- A page label such as `第 3 页` or `第 3、4 页` with sorted, unique, 1-based physical PDF page numbers; these are not printed page labels. A cross-page annotation remains one entry and lists every source page.
- An `原文摘录` block containing the complete quoted text, followed by a `我的笔记` block only if the note contains non-whitespace content.

Preserve paragraphs, Unicode, formulas, and user Markdown in notes, including lists, emphasis, links, and fenced code blocks. Do not escape or rewrite the user's note body; preserve its Markdown source apart from normalizing line endings. Escape PDF filenames and excerpts as literal text so Markdown headings, links, images, or HTML found in a PDF do not become document structure or embedded content. Preserve original note text as editable Markdown without evaluating it. Do not invent PDF titles, authors, DOI metadata, or clickable application deep links. Displaying formulas depends on the receiving editor's Markdown/math support; export preserves the source rather than converting formulas to images.

An empty session does not produce an empty file. Filename sanitization handles Windows reserved names, invalid characters, trailing dots/spaces, and excessive length; fall back to `reading-notes.md`. Add `.md` when an extension is omitted, but never replace an existing appended target without native confirmation of that exact target; ask the user to choose the full filename or another name. Reject another extension with a clear error rather than writing Markdown over a PDF or unrelated file.

## Implementation boundaries

### Markdown serialization

Create a focused module for deterministic Markdown serialization and suggested filename generation. It consumes a filename and an annotation snapshot. Keep ordering consistent with `src/components/AnnotationsPanel.tsx`; share a small ordering helper if necessary rather than maintaining different sorting rules.

### Snapshot and file output

Extend the existing `SessionStore` with a read-only snapshot operation for an already-loaded document. Return cloned annotation data; do not reread old session JSON from disk and do not expose mutable store objects.

The renderer waits for updates already initiated before export and refuses export if they failed. The main process also checks that the requested session has been loaded, flushes its pending saves, and captures the snapshot before opening the Save As dialog. The renderer sends a validated document ID and current display filename, never an arbitrary output path or a complete replacement session. The current filename matters because a renamed PDF may retain its original session filename.

Add a narrow export IPC handler through the existing trusted-main-frame `handle` wrapper in `electron/main.ts`, exposed through `electron/preload.cts` and typed in `src/types.ts`. Validate the filename as a basename and validate the document ID using existing session conventions. Return explicit saved/cancelled outcomes; return meaningful errors for invalid input or filesystem failure.

Use a separate export service module for the dialog/write orchestration so `main.ts` remains wiring code. Write a uniquely named temporary file beside the selected destination, close it, and replace the destination only after the full write succeeds. Clean up only the temporary file owned by the operation. Preserve an existing destination on failed writes; do not fall back to deleting the destination first. Keep user data and source PDFs unchanged.

### UI state

Keep export state local to the annotation panel. The AI/session controller provides a way to wait for the current document's outstanding session updates and detect failed updates. Recheck document identity and save state before invoking export. Loading, saving, empty, exporting, failed, and saved states must not be conflated. A session save error and an export write error remain separate.

## Validation

- Serialization: highlights without notes, notes containing Markdown/formulas, multiline excerpts, Chinese, special Markdown/HTML characters, duplicate/cross-page page numbers, deterministic ordering, and no accidental conversation or settings content.
- Filenames and writes: reserved names, renamed PDFs, missing/wrong extensions, cancellation, replacement, permission failures, and preservation of existing output on write failure.
- Session timing: an edit immediately followed by export includes the latest accepted text; pending/failed edits cannot produce a stale successful export; switching papers cannot mix annotations or filename.
- Electron integration: create and edit annotations through the UI, save using a stubbed native dialog, inspect the actual `.md` file, exercise cancellation/failure, and verify unauthorized IPC senders remain rejected.
- Regression: typecheck, unit tests, build, and relevant/full Electron tests once changes are stable. Extend packaged smoke verification to export notes from the installed application.

## Delivery

After implementation and verification, update package and lock versions, the English changelog and reading guide, then build the Windows portable application. Install it locally, update the desktop shortcut, verify the installed version and packaged contents, and test export using an isolated profile. Preserve personal reading data and clear obsolete test output according to `AGENTS.md`.

For any authorized GitHub Release, use English release information and attach only the portable `.exe`; do not upload a checksum file or add checksum instructions. Creating a new remote release is separate from local installation and follows the user's publishing instructions.

## Suggested implementation phases

1. Markdown formatting, filenames, and focused unit tests.
2. Stable session snapshot, native saving, bridge integration, and failure tests.
3. Annotation panel integration and desktop tests for latest edits and document switching.
4. Regression checks, documentation, packaging, installation, and installed-app verification.

Implementation and verification are tracked in `../plans/2026-10-13-markdown-notes-export.md`. User-approved review points are export scope, output format, preservation of note Markdown, and the rendered example.
