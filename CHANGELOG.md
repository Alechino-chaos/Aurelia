# Changelog

## 1.0.0 — 2026-10-15

- Launch the first stable Windows installer release, with Install and Custom installation options, a configurable destination, and an optional desktop shortcut.
- Add in-app stable update checks, manual download, progress, cancellation and retry, and an explicit Restart and update action. Ordinary exit never installs updates.
- Preserve existing portable users' language, library, reading progress, annotations and AI settings when installing under the same Windows account.
- Improve home-screen and right-sidebar typography for more comfortable reading.
- Protect files outside the installation directory by rejecting linked or unreadable installation trees and inconsistent uninstall registration before removal.
- Finish accepted saves before closing, prevent edits during shutdown, and restore interaction when a failed close is cancelled.
- Honor desktop shortcut preferences on reinstall and preserve shortcuts repurposed for other applications.

## 0.10.1 — 2026-10-15

- Reject linked or unreadable installation trees before upgrades and uninstalls, protecting files outside the application directory.
- Lock editing during normal shutdown, finish accepted saves, and restore interaction if closing is cancelled after a save failure.
- Stop waiting for optional update network checks during shutdown while preserving already queued preference writes.
- Apply desktop shortcut preferences during reinstall and preserve same-name shortcuts that point to another application.

## 0.10.0 — 2026-10-13

- Introduce a Windows installer with Install and Custom installation on the welcome screen, a configurable location, and an optional desktop shortcut.
- Add About & updates in Settings, update notifications, download progress, cancellation, and explicit Restart and update.
- Check stable official releases automatically or manually; downloads begin only on request and ordinary exit never installs an update.
- Save reading state and settings before updating, preserve the existing local profile, and keep the app open if saving fails.
- Temporarily lock editing while preparing an update, and support rerunning setup to repair an interrupted installation at its recorded location.
- Provide Chinese and English update controls. Existing portable users install this version manually once to enable future in-app updates.

## 0.9.6 — 2026-10-13

- Improve right-sidebar readability with 14 px guidance, 16 px empty-state headings, clearer secondary text, and larger action labels while preserving the existing tab sizes and layout.

## 0.9.5 — 2026-10-13

- Improve readability on the Open a paper home screen with a larger heading, 16 px instructions and primary action, and clearer secondary text.

## 0.9.4 — 2026-10-13

- Make paper-library group names larger and semibold for clearer hierarchy, while keeping paper counts visually secondary.

## 0.9.3 — 2026-10-13

- Resize the outline and page navigation by dragging its edge or using arrow keys; remember the preferred width and protect the reading area on smaller windows.
- Hide the top reading toolbar to free up vertical space, with an accessible restore button in the title bar. Keep the preference across paper switches and restarts.

## 0.9.2 — 2026-10-13

- Restore the original Aurelia application icon on the welcome screen for consistent branding.

## 0.9.1 — 2026-10-13

- Redesign the first-launch language welcome with a light sage reading illustration, refined bilingual typography and clearly selected language rows.
- Preserve explicit confirmation, keyboard selection, save retries and existing language preferences; returning users keep their saved choice.

## 0.9.0 — 2026-10-13

- Choose English or Simplified Chinese once before entering the workspace, including when upgrading an existing profile. The system language only suggests a selection; explicit confirmation saves your preference.
- Switch the interface immediately in Settings → General, with localized controls, accessible labels, application messages, native menus and file-dialog labels.
- Keep the current paper, reading position, zoom, navigation and search state, notes, ongoing AI responses and unsaved settings while changing language.
- Store the confirmed language separately from AI settings in the stable local profile. Failed saves retain the previous language and allow retry; unreadable or damaged settings are preserved for recovery.
- Keep translation targets independently configured in Settings → AI service. PDF text, personal notes, AI responses and exported Markdown retain their existing content and languages.

## 0.8.0 — 2026-10-13

- Follow native PDF links and named page actions, including offset destinations on cropped or intrinsically rotated pages, while preserving the current numeric zoom or fit-to-width mode.
- Read the PDF's native nested outline in the existing navigation panel, expand or collapse sections, and switch to the physical page list when needed.
- Return through explicit reading jumps with Back/Forward and Alt+Left/Alt+Right; restore the saved position and zoom for links, outline items, page controls, search matches, annotation locations and AI source references.
- Keep up to 100 entries in each history direction per open library entry, independently for same-content copies and across paper switches or resource eviction. History clears on closure, restart or content change and is never written to disk.
- Keep linked text selectable and copyable, support keyboard link activation, and open only explicitly clicked HTTP(S) destinations in the system browser after main-process validation.

Navigation uses metadata embedded in the PDF. Aurelia does not infer reference links, generate outlines, run PDF scripts or open local or remote files through PDF actions. Manual page rotation, previews and split views are not included.

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
