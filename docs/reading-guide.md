# Reading with Aurelia

[Back to the project](../README.md)

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

Highlights remain aligned as pages are zoomed or resized and support selections across pages. Notes are stored in the reading session. The original PDF is not modified; writing or exporting PDF annotations is not currently supported.

## Translation and conversations

Configure the API address, key, model, and target language in the AI settings dialog. See [Connect your AI](../README.md#connect-your-ai).

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
| API settings | `ai-settings.json`; the key is encrypted by the operating system |
| Reading sessions | `reading-sessions/`; JSON containing conversations, translations, annotations, and quotations |
| Recent files | `recent.json` |
| Reading position and panel width | Application local storage |

Close the app normally before copying the user-data directory for a backup. Session records are not encrypted: keep backups private and do not publish them in a repository. Key encryption depends on the system account environment. Re-enter your key after moving to another machine instead of treating the settings file as a portable key backup.

Session writes use temporary-file replacement and keep a backup of the previous save. Corrupt files are preserved; if no usable backup exists, Aurelia reports an error. History that earlier versions never saved to disk cannot be recovered.

Remote AI requests use HTTPS and do not follow redirects automatically. Changing provider domains or ports requires entering the corresponding key again or clearing the old key. System encryption does not prevent other software with sufficient access under the same account from accessing local information. The [0.4.2 security review](security-review-0.4.2.md) documents the scope of the historical checks in Chinese.

## Zoom and clarity

While zooming, Aurelia temporarily scales the existing image. Once the gesture ends, it renders at the new scale and replaces the preview with a sharp result. At high zoom levels, visible regions use high-resolution tiles to control memory use. Brief softness during zoom is expected; scanned images remain limited by their source resolution.

Manual page rotation, a PDF link annotation layer, and a bookmark outline are not yet available. Full-document retrieval and cloud sync are also not implemented.
