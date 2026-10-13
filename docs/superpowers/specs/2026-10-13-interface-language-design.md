# Interface Language Design

## Intent and approved experience

Deliver Aurelia 0.9.0 with Simplified Chinese and English interfaces. Every new or existing user without a saved language choice must choose once. Persisting a valid choice suppresses the chooser on subsequent launches and upgrades. The user approved the interaction and explicitly requested direct execution.

- First launch shows a bilingual welcome screen with `简体中文` and `English`; select the system-language suggestion (Chinese locales select Simplified Chinese, all others English), but require explicit confirmation before entering the workspace.
- The gear opens Settings with General and AI service sections. General exposes interface language without requiring an API key or model. Saving a different language applies immediately without restarting or remounting the reader.
- UI switching preserves open papers, current position and zoom, history, search state, selection, notes, AI conversation/stream and unsaved AI settings fields.
- The translation target is a separate existing AI preference. Interface language never changes it, API credentials/model, or the existing AI system prompts/default answer rules.

## Scope and boundaries

Translate application-authored visible UI: welcome, library, reader and toolbar, search, navigation/outline controls, annotation and AI panels, settings, loading/empty states, tooltips, accessibility labels, application menu, application-authored native dialog text and actionable errors. Parameterized strings use translations with intact numbers, names and paths; do not concatenate grammatical sentence fragments. English must fit at the existing 960px minimum window width.

Do not translate PDF text, embedded outline titles/link targets, paper/file names, manually named groups, user notes, existing AI output or third-party error details. Windows-owned file-dialog buttons can follow the OS locale. Markdown export contents and file naming retain their current format in this release; only its UI and error messages switch. Backend protocol enums, persisted translation target values and request semantics stay unchanged.

## Architecture

Use the existing React/TypeScript/Electron stack without a new runtime dependency. A typed catalog shared by renderer and main process supplies both locales and interpolation; split catalogs by responsibility if needed. Avoid DOM replacement, machine translation/network requests, or deriving behavior from translated labels. The main process owns a small separate `app-settings.json` in the existing stable userData profile; it is independent of AI and library stores.

Expose `UiLocale = 'zh-CN' | 'en'`, `AppSettings = { locale: UiLocale | null; suggestedLocale: UiLocale }`, `getAppSettings(): Promise<AppSettings>` and `saveAppSettings({locale: UiLocale}): Promise<AppSettings>` through trusted main-frame IPC. Null means no confirmed choice; suggestion is not persistence. Validate input strictly. Serialize atomic writes; publish success and change the application locale only after durable save succeeds. The renderer serializes/disables duplicate saves and preserves the old locale on failure.

Load preferences before showing normal application UI. Use a stable root language provider and a first-run gate. After confirmation, mount the normal workspace; later changes update context without changing reader identity. Set document language appropriately. The native menu/dialogs use the same effective saved locale and update on save. Browser development fallback can use a namespaced localStorage preference with equivalent explicit-confirmation behavior.

## Persistence and failure behavior

- Missing settings are a normal first choice, including upgrades from 0.8.0. Closing the chooser without confirmation exits normally and does not mark it completed.
- Keep chosen language across versioned installation directories by using the existing stable user profile. Existing user files are never moved or rewritten to establish language choice.
- Invalid settings must not crash startup or silently claim a saved choice. Preserve unreadable/corrupt evidence; show a recoverable localized/bilingual error with retry, and require explicit confirmation before creating a replacement for malformed data. Read permission failures must not overwrite the inaccessible file.
- A failed save keeps the chooser/settings available with an actionable error, preserves previous disk preference and UI language, and permits retry.
- Existing transient application-authored error/status messages must render appropriately after a language change. Raw user/server content stays verbatim; use message identifiers/parameters or a deliberate exact application-error translation boundary rather than indiscriminate string replacement.

## Verification and delivery

Unit tests cover catalog parity/interpolation, locale validation/system suggestion, missing/valid/malformed preferences, atomic save failure/retry and independence from AI settings. Real Electron tests cover first launch and upgrading an old profile, both language choices and restart suppression, live switching with reader/history/search/note state retained, unchanged translation target and AI drafts/prompts, localized menu/dialog/error paths, failed preference save/retry, and wide/narrow layouts. Existing regression profiles explicitly select/seed Chinese without any production bypass; fresh first-run tests exercise the real chooser.

Run focused tests while implementing, then full units/typecheck/build/source Electron suite. Package 0.9.0, install using the existing local install root, update the desktop shortcut, and verify installed executable/asar/version equality. Run full installed Electron regression and a packaged smoke that exercises language choice/switch/restart as well as existing reading/navigation/export features. Keep English public docs and release artifacts executable-only. No push or GitHub Release is authorized in this implementation turn.
