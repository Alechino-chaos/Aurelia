# Markdown Reading Notes Export Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Export the current paper's highlights and personal notes to editable Markdown matching the approved mockup.
**Architecture:** A shared serializer orders annotations. A main-process export service takes a saved session snapshot, uses the native save dialog, and replaces output atomically. The annotation panel invokes a narrow bridge after pending updates settle.
**Tech Stack:** Existing React, TypeScript, Electron, Node.js, Vitest and Playwright; no new dependencies.
**Spec:** ../specs/2026-10-13-markdown-notes-export-design.md

## Global Constraints

- Preserve notes as Markdown; escape only filenames and excerpts; Chinese structural labels.
- Export only annotations, including notes to which AI text was explicitly appended.
- No AI requests, PDF changes, session schema changes, or automatic external-file merge.
- Local delivery includes 0.6.0 packaging, installation, shortcut verification and installed-app tests.
- No remote push or Release in this execution. Future authorized releases use English and only the executable attachment.

## Review Focus

- Latest edits must settle before snapshot: desktop immediate-edit export test.
- A renamed PDF must use its current name: desktop renamed-file export test.
- Cross-page and hostile Markdown excerpts must remain attributable/literal: serializer tests.
- Cancel/failure must preserve existing output: service tests with real filesystem.
- Document switch must not redirect an in-progress export or show stale status: desktop delayed-dialog test.

## Task 1: Serialization and file saving

Files: create `electron/notes-markdown.ts`, `electron/notes-export.ts`, `tests/notes-export.test.ts`; modify `electron/session-store.ts`.
Interfaces: `orderedAnnotations(annotations)`, `renderNotesMarkdown(fileName, annotations)`, `suggestNotesFileName(fileName)`; `SessionStore.annotationSnapshot(key): Annotation[]`; `exportNotes(store, key, fileName, choosePath): Promise<{status:'saved'|'cancelled'}>`.

- [x] Write and run failing serializer/service tests for sorting, raw notes, literal excerpts, safe names, empty sessions, snapshots, cancellation and write failure.
- [x] Implement pure serializer, snapshot clone, strict basename validation and atomic file replacement.
- [x] Run `npm test -- tests/notes-export.test.ts`; expected all cases pass; then full unit suite.

## Task 2: Desktop interaction

Files: modify `electron/main.ts`, `electron/preload.cts`, `src/types.ts`, `src/ai/useAi.ts`, `src/components/AnnotationsPanel.tsx`, `src/styles.css`; create `tests/e2e/notes-export.spec.ts`.
Interfaces: bridge `exportReadingNotes(documentId, fileName)`; controller `exportNotes()` waits outstanding updates and checks identity. Panel owns pending/result states.

- [x] Write a desktop test using actual session updates/UI edits and actual output reads; stub only the native dialog. Verify initial failure because export entry is absent.
- [x] Wire trusted IPC, native Markdown save dialog, pending-update coordination, duplicate-click guard, success/cancel/error UI and cross-document isolation.
- [x] Run typecheck/build and focused desktop tests, including renamed PDF, cancellation, invalid extensions and switching during dialog.

## Task 3: Verification and local delivery

Files: package.json/package-lock.json, CHANGELOG.md, README.md, docs/reading-guide.md, docs/github-publishing.md, 如何启动.txt, scripts/smoke-packaged.mjs, AGENTS.md.

- [x] Bump 0.6.0, document export and English/executable-only release preference; extend packaged smoke with actual exported file assertions.
- [x] Run full unit suite, typecheck, desktop regressions; perform independent whole-change review and fix substantive findings.
- [x] Build portable, install locally, verify shortcut/version/app.asar, run installed desktop tests and smoke.
- [x] Clean obsolete temporary test artifacts with validated literal paths; preserve personal data and current portable; summarize results.

## Execution ledger

- Ruling: user reviewed mockup and said “按这个来吧，开工”; proceed continuously in the existing checkout as in prior delivery, without another design/plan gate or new worktree. No app code existed for this feature at start.
- Pre-flight: Task 2 consumes Task 1 export result and shared ordering; annotations come from main-process snapshots, never renderer-provided replacement sessions.
- Task 1: complete — first test failed on absent module; corrected fixture IDs to satisfy existing minimum length; all 64 unit tests passed.
- Task 2: complete — initial desktop test failed on absent export button; implemented then verified 7/7 desktop cases including real save failure/recovery and switching to both a different PDF and a renamed copy. Typecheck/build passed.
- Ruling: annotation panel key now includes the PDF load instance so reopening the same document under another filename cannot inherit stale export status.
- Final review: independent read-only reviewer found an important extensionless-target overwrite case. Added real-filesystem regression (observed failure) and changed appended destinations to atomic create-only links; explicit .md destinations retain native-confirmed replacement.
- Final review minor (deferred): leading indentation in unusual imported/external excerpt data can render as Markdown code; normal UI selection cleanup strips indentation. This version has no annotation import flow; leave this robustness improvement for that feature.
- Final review ruling: user Markdown is intentionally preserved verbatim, including malformed syntax; rendering depends on the receiving editor. No automatic Markdown repair, annotation import, backup restore, or PDF export is added.
- Task 3 verification: 65/65 unit tests, typecheck and build passed. Source desktop suite passed 45/45; final installed 0.6.0 suite passed 45/45 (44.5 seconds). Packaged smoke verified application version, copying, full-text search and actual Markdown export. Shortcut target and installed app.asar match the new build. Original large-chunk build warning remains.
- Delivery: completed local build and installation, preserving personal data and historical installed copies. Feature changes remain in the current workspace; no remote push or GitHub Release performed.
- Cleanup: validated literal paths, rejected reparse points, then removed temporary profiles/build scratch, test-results, obsolete 0.5.0 portable/checksum and builder debug output; freed 583.8 MiB. Current portable, installed program, verification logs, screenshot and exported example remain.
