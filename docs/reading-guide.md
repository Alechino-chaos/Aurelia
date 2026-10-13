# Reading with Aurelia

[Back to the project](../README.md)

## Choose the interface language

Choose **English** or **简体中文** on first launch and click **Confirm and continue**. Upgrading to 0.9.0 asks once for any existing profile without a confirmed preference. The system language only suggests a selection. Closing before confirming leaves the choice pending for the next launch.

Use **Settings → General → Interface language** to change the interface immediately. Saving does not require an AI connection and preserves the current document, position, zoom, navigation and search, notes, active AI response and unsaved AI fields. The preference is stored separately in `app-settings.json` in your stable user-data directory and survives restarts and versioned installations. If saving fails, the previous language remains active and you can retry. Unreadable settings require recovery or retry; malformed files are preserved before a confirmed replacement.

The labels below use the English interface. Application labels and messages follow your chosen language; PDF text, filenames, group names, notes and AI responses keep their original content. **Settings → AI service → Translation target language** independently controls translation output. Switching the interface does not change that target or the existing AI prompts and answer rules.

## Navigate a paper

Click a reference, figure link or other native PDF link to follow its embedded destination. Aurelia uses the PDF's actual link metadata; plain reference text without a link stays ordinary text. Linked text remains selectable and copyable. Dragging a selection does not activate the link; a focused link can also be activated from the keyboard.

Open the left navigation panel with **Toggle page navigation**, then choose **Outline** for the PDF's native outline or **Page number** for its physical page list. Expand or collapse nested outline sections and click an item to jump. A PDF without an outline shows an empty state, and failed metadata can be retried. The library remains accessible from **Library**.

- Internal links and outline items support named and direct PDF destinations, including cropped and intrinsically rotated pages. Their embedded zoom is ignored: jumps preserve your current numeric zoom or fit-to-width mode. Manual page rotation is not provided.
- **Back** and **Forward**, or `Alt+Left` and `Alt+Right`, restore the position and zoom saved by explicit jumps. Page controls, page-list and outline items, native links, search matches, annotation locations and AI source references use the same history. Passive scrolling and zoom changes do not add entries. Alt shortcuts are inactive while editing text, composing with an IME or using a modal dialog.
- Each open library entry has independent in-memory history, including copies with identical PDF contents. History survives switching papers and release of inactive PDF resources, holds up to 100 entries per direction, and clears when the paper closes, the app restarts or the content changes. Saved reading positions still restore after restart; Back/Forward history is not saved to disk.
- Explicitly clicked HTTP(S) links open in the system browser after validation. Unsupported actions and invalid destinations show a message without moving the reader or changing its history. Aurelia never executes PDF scripts or opens local or remote files through PDF actions. If PDF.js exposes a safe HTTP(S) URL from an action, it is treated only as an explicit browser link.

Aurelia does not infer reference links, perform OCR, generate AI outlines, or provide link previews or split views.

## Find text in a paper

Click the search icon beside the filename or press `Ctrl+F`. Type a word or phrase to search the entire current PDF, including pages you have not scrolled to. Search is local and does not contact AI.

- Typing updates the match count and page highlights without moving your reading position. Press `Enter` for the next match or `Shift+Enter` for the previous one. The first jump starts from your current page; after searching finishes, navigation wraps at the ends.
- The current match has an orange outline; other matches use pale blue. You can still select, copy, highlight, and annotate text while search is open.
- Search ignores case by default. Enable **Match case** to match case. Enable **Ignore line-end hyphens** to match `framework` when the PDF breaks it as `frame-` / `work`; visible hyphens are preserved by default.
- Phrases can span lines within the same detected paragraph. Common font ligatures and soft hyphens are handled automatically. Search follows the selected text reading order; automatic columns keep separate detected paragraphs and columns apart. Search does not join phrases across pages or apply compatibility normalization to mathematical symbols.
- During indexing, the bar shows the pages searched so far. A failed page is reported and can be retried; textless pages are reported separately. Scanned images require OCR, which is not available yet.
- Press `Esc` or close the search bar to remove search highlights. Your position stays in place. Each open paper remembers its query, options and search-bar visibility while switching papers, including when an inactive PDF resource is released. Search memory clears on paper closure, app restart or changed content. Queries and indexes are not saved to disk.

Search accepts up to 512 characters and displays up to 10,000 matches. If that limit is exceeded, the bar asks you to narrow the query. Complex layouts and unusual encodings can affect extracted text; confirm important results against the original page.

## Selection and copying

The order in which a PDF draws text is not always its reading order. Aurelia uses text coordinates to organize common two-column layouts, reading the left column before the right. Full-width headings divide the page into separate regions. The visual layout of the original page stays intact.

Select a passage to compare its cleaned and original text in the side panel. Copy options include automatic column ordering, original PDF order, original-text copying, source references, and line-end hyphen handling.

- Cleaned copying joins line breaks within paragraphs, preserves inferred paragraph boundaries, and converts common typographic ligatures.
- Visible hyphens are kept by default. For example, `frame-` followed by `work` on the next line becomes `frame-work`.
- The optional line-end hyphen removal setting can join this into `framework`, but may also alter genuine compound words. Check the preview.
- Original-text copying preserves extracted characters and inferred line boundaries; it does not reconstruct the PDF's underlying byte order.
- Cross-page selections keep page boundaries. Headers and footers are not automatically removed.

Column detection is a geometric heuristic, not a guarantee for every PDF. Check previews for complex tables, multi-column magazines, equations, marginal notes, unusual fonts, and rotated text. Switch to original PDF order if needed. OCR is not yet available for scanned documents.

## Highlights and annotations

Select text, choose pale yellow or pale green in the floating toolbar, then highlight it. The annotation action lets you add a note. Neither action requires AI.

The annotations tab lists entries by page and position:

- Select an excerpt or its source-location action to return to the passage.
- Notes save automatically while you edit. Highlight colors can be changed.
- You can undo the most recent deletion. Switching papers clears the undo state.
- Ask AI about an annotation, then append the response to that note.

Highlights remain aligned as pages are zoomed or resized and support selections across pages. Notes are stored in the reading session. The original PDF is not modified; embedding annotations into a PDF is not currently supported.

## Export reading notes

Open the **Annotations** tab and click **Export notes**. Choose a location in the Windows Save As dialog to save an editable `.md` file for Obsidian, Typora, or another Markdown editor. The default filename is `<paper>-notes.md`.

- Each file includes the current paper's filename and all annotations, ordered by page and position. Each entry contains its physical PDF page number(s), original excerpt, and a **我的笔记** section when a note is present. Highlights without notes remain included.
- Notes retain their original Markdown, including emphasis, lists, code blocks, and formulas. Excerpts are escaped as literal source text. Appearance and formula rendering depend on the receiving editor and its theme.
- AI text appears only if you explicitly saved it into an annotation. Other chats, translations, drafts, API settings, and the original PDF are not exported. Export works offline and makes no AI requests.
- Export becomes available after the latest notes are saved. If saving failed, use the existing retry action first. The export captures the paper before the save dialog opens; switching documents cannot change that export's content.
- Cancelling creates no file. Errors leave the reading records unchanged and let you retry. Use the `.md` extension; selecting a different extension is rejected to avoid overwriting a PDF or another file type.
- The exported file is independent. Editing it does not update Aurelia, and exporting again does not merge those external edits. Choose a new filename if you want to keep both versions.

Exported notes keep Chinese structural labels independently of the interface language; excerpts and notes retain their original languages. Export is for editing and sharing, not for restoring Aurelia sessions.

## Translation and conversations

Configure the API address, key, model, and target language in **Settings → AI service**. The translation target is independent of the interface language. See [Connect your AI](../README.md#connect-your-ai).

Translations can be stopped, retried, and copied. Each translation is kept in the history. Conversations support quoted selections, follow-up questions, stopping, retrying, and starting a new conversation. Older conversations remain available in the history selector.

Responses and translations support Markdown and KaTeX equations. Copying a response preserves its original Markdown. Generated HTML is not executed, remote images do not load automatically, and links display their text and address without opening automatically.

Each request has a two-minute timeout. Translation input is limited to 30,000 characters; conversation requests are limited to 100,000 characters and 20 completed historical turns. Shorten the selection or start a new conversation when needed. Providers may impose additional context and usage limits.

## Session recovery

Conversations, translations, references, drafts, highlights, and annotations are saved per paper. Reopening a paper restores its records; switching papers keeps their conversations separate.

Papers are identified by the SHA-256 hash of their file contents:

- Renaming or moving an unchanged PDF preserves access to its session.
- Files with the same name but different contents have separate sessions.
- Changing a PDF's contents makes it a different document for session purposes.

Switching papers or closing normally stops active requests and saves the content received so far. Restoring a session does not call AI automatically; incomplete responses can be retried manually. A power failure or forced shutdown can still lose the most recent unsaved content.

The interface shows save status and offers a retry after failures. Each session file has a 32 MB limit. Reaching it produces a save error rather than silently deleting history.

## Data and backups

The default Windows user-data directory is `%APPDATA%\paperdesk\`. The earlier product name is retained for compatibility. This location is independent of the drive where the program is installed.

| Data | Storage |
| --- | --- |
| Interface language | `app-settings.json`; contains only your confirmed local interface preference |
| API settings | `ai-settings.json`; the key is encrypted by the operating system |
| Reading sessions | `reading-sessions/`; JSON containing conversations, translations, annotations, and quotations |
| Recent files | `recent.json` |
| Library groups, entries, open papers and reading views | `library.json`; includes per-entry position, zoom and panel state, workspace mode and sidebar layout |
| Reader preferences and fallback view settings | Application local storage |
| Search state and Back/Forward history | Memory only; not included in backups |

Close the app normally before copying the user-data directory for a backup. Session records are not encrypted: keep backups private and do not publish them in a repository. Key encryption depends on the system account environment. Re-enter your key after moving to another machine instead of treating the settings file as a portable key backup.

Session writes use temporary-file replacement and keep a backup of the previous save. Corrupt files are preserved; if no usable backup exists, Aurelia reports an error. History that earlier versions never saved to disk cannot be recovered.

Remote AI requests use HTTPS and do not follow redirects automatically. Changing provider domains or ports requires entering the corresponding key again or clearing the old key. System encryption does not prevent other software with sufficient access under the same account from accessing local information. The [0.4.2 security review](security-review-0.4.2.md) documents the scope of the historical checks in Chinese.

## Zoom and clarity

While zooming, Aurelia temporarily scales the existing image. Once the gesture ends, it renders at the new scale and replaces the preview with a sharp result. At high zoom levels, visible regions use high-resolution tiles to control memory use. Brief softness during zoom is expected; scanned images remain limited by their source resolution.

Manual page rotation, full-document AI retrieval and cloud sync are not implemented. Native PDF links and outlines are available as described under [Navigate a paper](#navigate-a-paper).
