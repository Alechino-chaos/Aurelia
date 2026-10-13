# PDF Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Native PDF link/outline navigation with reliable per-paper Back/Forward, delivered as Aurelia 0.8.0 on the existing desktop shortcut.

**Architecture:** Pure history and PDF-native resolution feed a focused reader controller, native link layer and outline panel. Workspace retains transient per-entry navigation memory; Electron validates explicit external HTTP(S) opens.

**Tech Stack:** Existing Electron, React, TypeScript, PDF.js, Vitest, Playwright and pdf-lib; no new dependencies.

**Spec:** docs/superpowers/specs/2026-10-13-pdf-navigation-design.md

## Global Constraints

- Windows desktop; Chinese UI, English public docs; version 0.8.0; no new dependencies.
- Native PDF links/outlines only; no inferred references, OCR, AI outlines or split/preview UI.
- Explicit jumps preserve numeric zoom or fit-width mode; history restores the saved position and zoom.
- Back/Forward history is per open library entry, survives switching/eviction, clears on close/restart/content change, never persists to disk; at most 100 entries per direction.
- Preserve source PDFs, notes, search, AI/session ownership, 0.7 library recovery/race behavior and existing desktop selectors.
- External links require explicit click and main-process HTTP(S) validation; no arbitrary schemes/PDF scripts/remote files.
- Follow AGENTS for package/install/shortcut/installed validation. No push or Release in this task.

## Review Focus

- Delayed link/search destination resolution after a newer jump or tab switch must not steal position (Task 2).
- Rotated/cropped/UserUnit pages require both link and target coordinates to follow the PDF viewport (Tasks 1/2).
- Linked text remains selectable/copyable; drag must not navigate (Task 2).
- Same-content paper copies and evicted resources must retain independent transient histories (Task 2).
- Restoring history across a zoom/layout change must use settled geometry and preserve exact source position (Task 2).

## Task 1: Native navigation primitives and real PDF fixture

**Files:** Create src/navigation/history.ts, src/navigation/destinations.ts, src/navigation/links.ts, electron/external-url.ts, tests/navigation.test.ts, scripts/create-navigation-fixture.mjs, tests/fixtures/navigation.pdf.

**Interfaces:** Export NavigationPoint {page:number; x:number; y:number; zoom:number|'fit'} where x/y are normalized displayed-page coordinates (capture may include small signed offsets near page margins); NavigationHistory {past:NavigationPoint[];future:NavigationPoint[]}; emptyHistory(), recordJump(history,from,to), stepHistory(history,direction:'back'|'forward',current):{history,target:NavigationPoint|null}. History is immutable, capped100, deduplicates same-location jumps with subpixel tolerance. Export resolveDestination(pdf,destination):Promise<{page:number;x:number|null;y:number|null}> using normalized displayed-page coordinates, no zoom. Export native link types/classification and rect transform helper suitable for React hit areas. Export validateExternalUrl(value:unknown):string from electron/external-url.ts, with8192bound/HTTP(S)/no credentials/control chars. Later tasks consume these exact exports; any justified interface refinement must be documented in report before Task2 dispatch.

- [x] Add pure behavioral history tests (branching, exact coordinates/zoom, current scrolled capture, cap, noop, independence) and destination/URL tests; run npm test -- tests/navigation.test.ts and observe missing-module RED.
- [x] Build a reproducible small synthetic PDF with direct/named destinations, nested outline, offset target specifying a zoom, links on rotated/cropped page, invalid destination and external HTTP(S) link; fixture generation is idempotent and uses existing pdf-lib. Ordinary text includes link-bearing phrases for UI drag/copy tests.
- [x] Implement history and URL validation, native classification/rect geometry and destination resolution, rejecting invalid/out-of-range data. Use actual fixture through installed PDF.js for named/direct/rotated/cropped tests; targeted test doubles only for deferred/failure conditions.
- [x] Run focused tests, typecheck and full unit suite; self-review, commit task files and report exact APIs plus RED/GREEN evidence.

## Task 2: Reader navigation, outline and per-paper integration

**Files:** Create src/navigation/useDocumentNavigation.ts, src/components/PdfLinkLayer.tsx, src/components/DocumentOutline.tsx, tests/e2e/navigation.spec.ts. Modify src/Reader.tsx, src/components/PdfPage.tsx, src/components/SearchHighlights.tsx and src/search/usePdfSearch.ts only as required for ordered search landings; src/workspace/Workspace.tsx, src/styles.css, electron/main.ts, electron/preload.cts, src/types.ts. Focused helpers/tests allowed within navigation responsibility.

**Interfaces:** Consume Task1 exports. ReaderSnapshot gains navigation:NavigationHistory and Reader receives initialNavigation?:NavigationHistory. Workspace owns entry-keyed transient navigation memory distinct from ReadingView; snapshot history synchronously before suspend/remount, retain through eviction, clear on closed/removed/changed identity. Bridge openExternalUrl(url:string):Promise<void> is trusted-frame guarded and invokes shell.openExternal only after validateExternalUrl. No library schema mutation.

- [x] Write real Electron tests using native navigation.pdf: link to offset destination at125%, back/forward to exact original position/zoom, nested outline/no-outline and link text drag. Run on old UI to establish meaningful RED.
- [x] Implement navigation controller with explicit transaction/generation guards and synchronous source capture. Support native destination/actions, page controls, search and annotation/source jumps. Commit history only for successful navigation; stale/failure leaves history/viewport intact. Prevent delayed search-highlight auto-scroll after newer history action. Ignore Alt shortcuts during editing/composition/modal interactions and distinguish from page controls.
- [x] Add lazy native link regions transformed with actual PDF viewport; preserve pointer drag text selection, keyboard focus/click, copy/highlight; provide labels and hover destination. Add trusted HTTP(S) IPC; unsupported actions report nonblocking message, never launch scripts/files.
- [x] Add outline/pages tabs in existing left slot with nested expand/collapse, loading/empty/retry; keep library drawer reachable and existing page-navigation toggle functional in sidebar/tabs modes. Add toolbar Back/Forward and Alt shortcuts; inspect960/1440layouts.
- [x] Carry navigation history through managed Reader/Workspace snapshots and browser fallback, resetting by lifecycle/content identity. Cover same-content independent histories, cache eviction, close/reopen/restart, native zoom-ignore/fit, crop/rotation, stale slow destinations, text-selection and search/note return behavior with tests. Preserve original regression assertions.
- [x] Run typecheck, focused E2E, full units, npm run build and full Electron suite. Self-review and commit; report APIs, tests and screenshots.

## Task 3: Version, documentation and complete installed delivery

**Files:** package.json, package-lock.json, CHANGELOG.md, README.md, docs/reading-guide.md, scripts/smoke-packaged.mjs; completed-plan checkboxes and evidence.

**Interfaces:** Existing npm run dist, scripts/install-local.ps1 and .aurelia-install.local.json. Installed E2E uses AURELIA_TEST_EXECUTABLE; smoke imports Task1's synthetic fixture by native picker with isolated profile.

- [x] Extend packaged smoke to prove actual native link/outline click, preserved zoom and Back/Forward; retain copy/search/export/library/restoration assertions. Establish missing-feature RED against old installed0.7 before packaging when feasible.
- [x] Bump version to0.8.0 and write English changelog/readme/reading guide. Correct stale guide statements about per-paper search memory and workspace storage while documenting new navigation boundaries.
- [x] Build portable after source/review green. Install to existing recorded root and update desktop shortcut, preserving old installs/personal data; verify actual runtime/version/exe/asar match.
- [x] Run full installed Electron suite and enhanced packaged smoke in disposable profiles; inspect narrow/wide screenshots and save verification evidence. No rebuild for docs-only finalization.
- [x] Finish review, clean validated obsolete generated outputs only, commit scoped files/completed plan, report local delivery without remote publication.

## Execution decisions

The user approved the interaction and explicitly requested immediate execution. Record the spec and plan, then proceed without another approval loop. Reuse this configured checkout on codex/pdf-navigation with sequential implementers and independent review; existing dependencies and installation record remain usable. Task reports/ledger live in ignored tmp/pdf-navigation/. Source baseline7229aaf; no remote operations.
