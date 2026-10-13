# Interface Language Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Deliver Aurelia 0.9.0 with one-time language choice and persistent, immediate Chinese/English interface switching.

**Architecture:** A typed bilingual catalog and independent main-owned preference store feed a stable React provider, first-run gate and general settings. Main menus/errors and renderer controls share language resources while reading and AI state retain identity.

**Tech Stack:** Existing Electron, React, TypeScript, Vitest and Playwright; no new runtime dependency.

**Spec:** docs/superpowers/specs/2026-10-13-interface-language-design.md

## Global Constraints

- Support exactly `zh-CN` and `en`; every profile without a confirmed preference chooses once, including existing users. Explicit confirmation is required; system locale only preselects.
- Live interface switching must not remount the reader, reset reading/search/navigation/notes or AI state, or discard unsaved AI fields.
- Translation target remains independently configured. Existing AI prompts/default answer rules, API/model/key and persisted protocol values are unchanged.
- Translate application-authored UI and errors, including native menus/dialog labels; preserve source/user/server content and current exported Markdown contents.
- Persist language separately in stable userData; validate, serialize and atomically save. Save failure preserves prior state and permits retry; do not destroy unreadable/corrupt settings.
- English and Chinese work at 960px and 1440px; keyboard/focus and accessible labels work in both languages.
- Version 0.9.0, English public docs, no new runtime dependency. Follow AGENTS for full package/install/shortcut verification; no push or Release.

## Review Focus

- Rapid save/language changes and failed writes must not desynchronize renderer, menu and persisted preference (Tasks 1/2).
- Upgraded profiles must choose once without modifying library/AI files or losing restored papers (Tasks 1/2).
- Language context changes must not abort pending navigation, restart streams or discard drafts (Task 2).
- Dynamic error text and labels must not translate user content or retain stale application text (Tasks 1/2).
- English layout and native dialogs must remain usable and match the locale after restart (Tasks 2/3).

## Task 1: Shared localization and persistent desktop preferences

**Files:** Create electron/i18n.ts (and focused catalog files if warranted), electron/app-settings.ts, tests/i18n.test.ts, tests/app-settings.test.ts. Modify electron/main.ts, electron/preload.cts, src/types.ts, application-authored errors in electron/ai-service.ts, ai-protocol.ts, library/session stores/models/files, external-url.ts, notes-export.ts and notes-markdown.ts as needed for error UI only. Preserve exported Markdown content and AI prompt text.

**Interfaces:** Export `UiLocale = 'zh-CN' | 'en'`; `AppSettings = {locale: UiLocale | null; suggestedLocale: UiLocale}`; pure `suggestUiLocale(value: string): UiLocale`; catalog translation API with typed keys/interpolation and explicit/current locale suitable for both runtimes. `AppSettingsStore` accepts profile directory and suggested system locale, supplies load/get/save with serial atomic persistence. Bridge `getAppSettings(): Promise<AppSettings>` and `saveAppSettings(input: {locale: UiLocale}): Promise<AppSettings>`. Document exact catalog/store/error contracts before Task 2. Main menu refresh follows successful save. Default translator Chinese keeps existing pure tests deterministic; runtime explicitly establishes effective locale.

- [x] Write behavioral tests for missing/valid/corrupt preferences, explicit selection persistence/reload, unsupported locale rejection, save failure/retry and ordered concurrent saves; assert unrelated AI/library files unchanged. Write catalog key parity, parameter interpolation and locale suggestion tests. Observe meaningful RED.
- [x] Implement pure catalog and separate preference store, preserving malformed evidence and protecting inaccessible data. Store only confirmed locale; no dependency on AI configuration. Use same-directory atomic writes with controlled failure behavior.
- [x] Wire trusted main-frame IPC/preload/types, boot initialization and menu refresh; localize app-owned main/native dialog/error paths with intact dynamic data. Cover foreign-frame/malformed IPC and read/save failures through targeted tests where feasible.
- [x] Run focused tests, typecheck and full unit suite; inspect unchanged AI prompt/export rendering semantics, self-review and commit. Report APIs, RED/GREEN and any renderer-facing error representation.

## Task 2: First-run gate, settings and complete bilingual interface

**Files:** Create src/i18n/LanguageProvider.tsx, src/components/LanguageWelcome.tsx, src/components/SettingsDialog.tsx, tests/e2e/language.spec.ts and an E2E language/profile helper as needed. Modify src/App.tsx, Reader.tsx, existing components/workspace/search/navigation/AI modules and styles, shared catalogs, index.html language, existing E2E setup only as needed. Preserve existing regression assertions.

**Interfaces:** Consume Task 1 exact reported API; expose `useLanguage()` with current locale, ready/settings state and save operation plus translator. Provider must remain stable across saves; workspace gating only before initial confirmation. Gear opens General by default; AI setup prompts open AI service section. Existing AiSettingsDialog can be refactored to reusable form content retaining unsaved state across tab/language changes; no nested modal or nested form. Error copy is localized at display boundaries, without translating user content.

- [x] Write real Electron first-choice RED against old UI. Cover missing preferences in both clean and populated old profiles, system preselection requiring confirmation, Chinese and English saved choices, normal close without save and no chooser after restart.
- [x] Implement stable provider/gate and Settings General/AI sections. Save first, then switch atomically; keep current language on failure, retry without API configuration. Browser fallback follows same user contract.
- [x] Migrate all application-owned renderer text, placeholders/titles/aria and parameterized notices to shared resources, preserving exact Chinese labels where semantically unchanged. Translate visible error/status presentation and native actions, not source/user/AI output. Catalogs may split by feature, with typed parity checks.
- [x] Add live-switch E2E covering open document/position/zoom/history/search/note retention, an ongoing AI response and unsaved AI form fields, unchanged translation target and system prompts, menu/native-dialog labels, application errors, unavailable preference save/retry and no secrets exposed. Inspect 960/1440 in both languages.
- [x] Update old E2E profile setup to establish confirmed Chinese preference via a shared fixture helper or actual chooser; no production test bypass and no weakened baseline assertions. Run typecheck, focused E2E, full unit suite, build and full source Electron once green. Self-review/commit and report catalog coverage audit and remaining boundary cases.

## Task 3: Version, English documentation and verified desktop delivery

**Files:** package.json, package-lock.json, CHANGELOG.md, README.md, docs/reading-guide.md, scripts/smoke-packaged.mjs, completed plan checkboxes and ignored verification evidence.

- [x] Extend packaged smoke with actual first-choice English, immediate Chinese/English settings switch, independent translation target and restart suppression, retaining existing copy/search/export/library/navigation assertions. Prefer old-installed missing-feature RED before bumping version; selector changes may require a dedicated short RED probe.
- [x] Set version 0.9.0, update English docs explaining one-time upgrade prompt, setting scope and translation-target independence. No checksum asset or publication.
- [x] After app review passes, build portable, inspect running personal app (normal close only), install to existing recorded root and update shortcut. Preserve old installations/profiles. Verify installed runtime/version/EXE/asar and shortcut match build.
- [x] Run full installed Electron suite and enhanced smoke in isolated profiles, inspect wide/narrow screenshots, record exact evidence. Archive current evidence; clean only validated obsolete generated workspace files and preserve other plan workspaces.
- [x] Commit scoped files/completed plan, report version/artifact/install paths and test results; no remote publication.
