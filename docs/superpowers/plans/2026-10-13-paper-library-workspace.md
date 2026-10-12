# Paper Library and Reading Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Ship Aurelia 0.7.0 with a persistent manually grouped paper library, interchangeable sidebar/tabs and reliable reading workspace restoration.

**Architecture:** Main process owns validated library actions and atomic local JSON persistence. Renderer workspace coordinates open entries and supplies an active reader with independent navigation/search state. Existing content-keyed annotation storage and export stay intact.

**Tech Stack:** Existing Electron, React, TypeScript, PDF.js, Vitest and Playwright; no added runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-10-13-paper-library-workspace-design.md`

## Global Constraints

- Windows desktop; Chinese application UI, English public release information.
- PDFs stay in place; deleting groups/library entries never deletes PDFs or reading sessions.
- One-level groups; imported collection only; no filesystem scanning or cloud backend.
- Restore open order, active paper, page anchor, zoom, panel and presentation preferences; load only active PDF at startup.
- Preserve existing AI interruption semantics and session/export ownership.
- Retain at most two PDF instances; inactive files larger than 32 MiB are evicted.
- Follow AGENTS.md for version, packaging, independent installation and desktop verification. No remote publishing in this task.

## Review Focus

- Concurrent rapid opens must not let slow file reads select an obsolete tab (Task 2 race test).
- Corrupt or future-version library files must never be overwritten as an empty library (Task 1 recovery tests).
- Same-content copies share annotations but have separate display paths and navigation (Tasks 1 identity, 2 switching tests).
- Closing immediately after scrolling must save the latest position before shutdown (Tasks 1 flush, 2 restart tests).
- Missing files and password dialogs must allow switching to other tabs (Task 2 failure isolation tests).

## Task 1: Validated persistent library and desktop API

**Files:** Create `electron/library-types.ts`, `electron/library-model.ts`, `electron/library-store.ts`, `electron/library-files.ts`, `tests/library.test.ts`. Modify `electron/main.ts`, `electron/preload.cts`, `src/types.ts`.

**Interfaces:** Shared `LibraryState` has version, groups, entries, openIds, activeId, mode, sidebarWidth, collapsedGroupIds. `LibraryEntry` has id, path, name, groupId, documentId and optional view. `ReadingView` has page, anchorY, anchorX, zoom, panelOpen, panelTab. All interfaces are exported from library-types. `LibraryAction` is a discriminated union of group-create/rename/delete, entry-move/remove, tab-open/activate/close, mode, sidebar, view. Renderer bridge: `getLibrary(): Promise<LibraryState>`; `updateLibrary(action: LibraryAction): Promise<LibraryState>`; `importPapers(groupId?: string): Promise<LibraryImportResult>`; `importDroppedPapers(files: File[], groupId?: string): Promise<LibraryImportResult>`; `openLibraryPaper(id: string): Promise<OpenedFile>`; `relocateLibraryPaper(id: string): Promise<LibraryRelocateResult>`; `revealLibraryPaper(id: string): Promise<void>`. Import returns state, importedIds, errors. Relocate returns state plus mismatch/new-import outcome if applicable. `OpenedFile` gains libraryId and view. Main file read never activates a tab as an async side effect; tab activation remains an explicit ordered action.

- [x] Write tests for group normalization/80-character bound/uniqueness; deleting group reparents; case-insensitive normalized Windows path dedup; same-content different-path entries; adjacent tab close; bounded views; unknown actions/IDs rejected.
- [x] Run `npm test -- tests/library.test.ts`; observe expected missing module/export failure.
- [x] Implement pure model, serialized store with primary/temp/backup and protected recovery/future schema handling; recent migration once including missing entries; flush retry. Tests reopen a real temporary directory, corrupt primary/backup and verify original preservation.
- [x] Implement file service for validated <=250 MB PDFs, content hashing/change reset, multi-import partial success, matching relocation, mismatch normal-import offer, reveal by registered ID. Test temp fixture files and source-byte preservation.
- [x] Wire trusted IPC/preload/types; existing Open/Recent/Drop register entries without breaking old tests; include library flush in application close. Preserve session-save failures on remove.
- [x] Run focused tests, `npm run typecheck`, full `npm test`; review diff and commit task files.

## Task 2: Workspace navigation and independent active reader

**Files:** Create `src/workspace/LibraryPanel.tsx`, `src/workspace/Workspace.tsx`, `src/workspace/workspace.css`, focused workspace helpers/tests as necessary; extract `src/Reader.tsx` from `src/App.tsx`; update search hook and `tests/e2e/workspace.spec.ts`.

**Interfaces:** Consume Task 1 library bridge/types. `App` becomes workspace entry with browser/demo fallback; workspace owns tab metadata/resource cache and ordered activation. Reader accepts opened file/resources, initial view/search state, callbacks for view/search updates and open/import; keep its existing tested DOM labels and behavior. Expose a flush/capture mechanism used before switch/close and app shutdown so latest scroll state is acknowledged by main before close.

- [x] Write failing Electron tests for import/grouping, actual folder paths, sidebar/tabs mode, drawer and close-vs-remove; restart restores two tabs and active page/zoom while inactive missing files do not load.
- [x] Run new focused E2E cases on old build to establish RED.
- [x] Implement workspace + library panel, accessible inline group form (no window.prompt), move menu/drag, collapse/width preferences, reveal/relocate, selected/open indicators, keyboard cycle/close respecting IME, scrollable tabs and narrow-window layout.
- [x] Extract active reader only as needed; save outgoing normalized anchor/search options, cancel AI/save original session, clear selection. Lazy load/cache at most two PDF instances with generation guards; evict inactive >32 MiB. Same-content copies reload current shared sessions. Built-in sample is ephemeral. A canceled password/read affects only that tab.
- [x] Add race/state tests: rapid A/B/A load; same-content copies; changed source resets views; query/zoom/page/panel preserved independently; password/missing failure isolation; close/restart after scroll; existing note drafts and exports stay with original document.
- [x] Run `npm run typecheck`, focused E2E, full unit and Electron E2E suite. Fix regressions without loosening assertions. Self-review and commit task files.

## Task 3: Version and complete desktop delivery

**Files:** Update `package.json`, `package-lock.json`, `CHANGELOG.md`, `README.md` where needed and `scripts/smoke-packaged.mjs`.

**Interfaces:** Existing `npm run dist`, `scripts/install-local.ps1`, `.aurelia-install.local.json` and installed executable E2E setting; existing tests remain reusable against installed artifact.

- [x] Extend packaged smoke to cover library import, switch and persisted restore with isolated profile; run it before build against old installation to observe missing library failure if needed.
- [x] Bump package and lock to 0.7.0, English changelog/docs; update plan completion evidence.
- [x] Run typecheck/unit/Electron regression, `npm run dist`, install using recorded application root, preserving profiles and old installs.
- [x] Verify shortcut target, version, matching app.asar and portable; run installed E2E and smoke with isolated profiles, inspect screenshot for layout usability.
- [x] Run final fresh review; fix material findings and covering tests, rebuild/reinstall if product changes. Clean only validated obsolete generated outputs, keep current artifact and verification evidence. Report local outcome; do not push/release without new publishing instruction.

## Execution decisions

User explicitly approved the written design and requested execution. Proceed through this plan without an additional approval handoff. Reuse the current checkout on a feature branch to keep its installed toolchain and delivery configuration; implementation tasks run sequentially with independent review. Scratch reports live in ignored `tmp/paper-library-workspace/`.
