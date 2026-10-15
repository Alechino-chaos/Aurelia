# Aurelia Installer and Updates Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans; track completion below. The user approved the design and mockups and explicitly requested execution. Continue without repeating permission questions for implementation.

**Goal:** Deliver a real Windows installer with visible custom installation, and explicit-download/explicit-restart application updates.

**Architecture:** NSIS owns installation and registered paths; electron-updater owns acquisition and installation. A main-process coordinator owns state and save-before-install, exposed through narrow IPC to React.

**Tech Stack:** Existing Electron/React/TypeScript, electron-builder 26.x, electron-updater 6.8.9, NSIS, GitHub Releases.

**Spec:** ../specs/2026-10-13-installer-and-updates-design.md

## Global constraints

- Keep appId `com.aurelia.reader`, user data `%APPDATA%\\paperdesk`, original icon, Chinese/English, existing reading features.
- Installer first screen shows Install and Custom installation; default current-user location, editable custom path and optional desktop shortcut.
- No automatic download or install-on-quit. Explicit restart must save successfully before installing.
- Stable releases only, no downgrade, fixed official GitHub provider; no credentials in client.
- Preserve existing 0.9.5/0.9.6 changes; target 0.10.0. No push/release/commit unless authorized separately.
- Validate actual NSIS installs and A→B upgrade with isolated user data; never erase personal files or force-kill the user's app.

## Review focus

- Cancelled download producing late completion must never become installable.
- Missing update metadata on the old GitHub release must be reported as failure, not latest.
- Save/AI cancellation races must not bypass persisted reading data.
- Custom directory must be preserved on update and unrelated directory content protected.
- Existing local unpacked copies must not be treated as updater-managed installs.

## Tasks

### Task 1: Main-process update system and shutdown coordinator

Files: new electron/update-types.ts, update-service.ts, update-runtime.ts, update-preferences.ts, update tests; edit main.ts, preload.cts, ai-service.ts, app-settings.ts, src/types.ts as required.

Interface: UpdateState includes phase, currentVersion, supported, autoCheck, lastCheckedAt, availableVersion?, releaseNotes?, percent?, transferred?, total?, error?; phases idle/checking/latest/available/downloading/cancelled/downloaded/preparing/error/unsupported. Preload exposes getUpdateState(), checkForUpdates(), downloadUpdate(), cancelUpdateDownload(), installUpdate(), setAutoCheckUpdates(boolean), onUpdateState(callback), updaterReady(), openUpdateReleasePage(). All action methods return Promise<UpdateState>, except subscriptions/ready/link.

- [x] Write and observe failing behavioral tests for checks, 24h throttling, manual download, cancellation and stale callbacks, rejected versions, timeout and failed saves.
- [x] Implement pure testable coordinator, atomic separate preference file and electron-updater adapter with automatic download/install disabled.
- [x] Integrate trusted IPC, registered-install detection, after-language-ready/focus checks, and reliable save-before-install including AI drain.
- [x] Run targeted tests/typecheck; review task independently and resolve findings.

### Task 2: NSIS installer and reproducible delivery

Files: build/installer.nsh, scripts/dist.mjs, scripts/install-local.ps1, package.json/lock, installer tests/verification scripts.

- [x] Configure full offline NSIS x64 current-user installer and fixed GitHub publish metadata; keep stable appId.
- [x] Implement original-icon bilingual welcome with Install + Custom installation; implement directory/space/shortcut options, validation and silent-update skipping.
- [x] Prove generated setup and metadata exist; inspect installer UI using Windows automation, including custom D-drive/space/Unicode paths and cancellation.
- [x] Replace local copy installer with actual NSIS install and registry/shortcut/version verification.

### Task 3: Updates interface

Files: src/updates/*, src/components/SettingsDialog.tsx, src/App.tsx, related UI locale files/CSS/tests. Consumes Task 1 UpdateState/preload contract.

- [x] Add application-wide update provider after LanguageGate, persistent nonmodal notification independent of toolbar, and About & updates settings tab.
- [x] Render version, safe English release summary, progress/cancel/retry/download/restart/later actions and auto-check toggle; localized authored text, keyboard access.
- [x] Test deterministic state flows in actual renderer, no auto-download/install, responsive UI and live language switch.
- [x] Review task and resolve findings.

### Task 4: Real installation and upgrade validation

Files: isolated verification harness under release/verification, durable regression tests where appropriate; installation/update smoke script in scripts.

- [x] Run all unit tests, typecheck, existing language/reader desktop regression checks.
- [x] Build isolated test versions A and B with an explicit test-build marker and loopback-only update source (production build never accepts a custom feed).
- [x] Install A through NSIS, seed isolated reading/annotation/settings data, then check/download B and verify ordinary exit does not install.
- [x] Explicitly update A→B; verify actual running version, same install path, preserved data and shortcuts. Exercise cancel/network failure and save failure through targeted regression tests.
- [x] Build official 0.10.0 again and install locally only after testing; verify desktop shortcut target and actual asar/version.

### Task 5: Documentation and final review

Files: CHANGELOG.md, README.md, AGENTS.md, design status and this ledger.

- [x] Document installation, one-time portable migration, manual download/restart controls, setup + latest.yml + blockmap release rules and recovery limits.
- [x] Fresh final code/security review, resolve significant findings, re-run affected checks.
- [x] Remove only validated task scratch; retain evidence, official installer, metadata and previous installations needed for rollback.
- [x] Report verified local delivery and any limitations accurately; no GitHub publication.

## Execution ledger

- Planning: Existing checkout contains approved uncommitted typography fixes; preserve them. Reuse checkout on a feature branch instead of resetting or losing those changes.
- Ruling: User explicitly said execute after approving spec direction/mockups; treat this as implementation authorization rather than re-asking for staged approval. No external publication authorized.
- Ruling: Use one implementation worker at a time for isolated subsystems; coordinator handles installer/build work in disjoint files and integration. Task review and final review remain independent.
- Interface scan: Tasks 1/3 share update-types and preload only through the interface above; Task 1 owns them. Tasks 1/2 share package dependency/build assumptions; coordinator owns package files. Task 2/4 share NSIS output/registered path; Task 4 uses Task 2 actual installer, never copies unpacked executables. Task 5 updates delivery rules to the approved installer format.


- Task 1: complete (uncommitted changes, independent spec/quality review clean after 1 fix round; 51 affected tests and typecheck passed).
- Task 2: prototype installed/uninstalled successfully in a dedicated ordinary-integrity directory; first/custom pages inspected at system scaling. Workspace Low integrity blocks direct setup execution; delivery stages an identical installer in a normal user temp directory.
- Task 3: dispatched /root/update_ui after backend gate passed; root continues installer and real-upgrade validation.

- Task 2 review round 1: accepted test shortcut/default-path isolation, non-silent updated-path validation bypass, registered-path relocation and mapped-network-drive findings. Unified fix wave assigned to backend worker after UI implementation finished.
- Task 3: UI tests 7/7 and unit tests 191/191 passed; independent review underway. Existing language test assertions pass but invalid AI settings poison shutdown persistence; diagnosis and targeted repair included in the active fix wave.
- Ruling: Test packages must always use a temporary isolated profile, including NSIS restart without inherited environment. Real-upgrade harness uses the same deterministic fallback, and production ignores test overrides.

- Task 2: all four accepted findings closed by independent scoped review; updated isolated A compiled and reinstalled at the Chinese custom path with exit 0, no test desktop shortcut. A changed /D target is rejected with exit 2 and the registered path preserved. Stock NSIS creates an empty requested folder before customInit; no application files were written there, and the empty test folder was removed.
- Task 3: complete after one review fix. Shared preparing retry lock passed scoped review; 9 targeted Electron tests passed, including the formerly hanging language teardown; 58 affected unit tests, typecheck and build passed.
- Final broad review: accepted P1 editing during save/preparation and P2 interrupted-install repair. One consolidated final fix wave assigned to /root/update_backend. Plan remains active until the final build, real A/B upgrade and local installation are verified.

- Task 2: complete. Final NSIS packages compiled; default and Unicode custom installations passed. Registered relocation and unrelated nonempty directory guards rejected the test destinations. Test and production shortcuts remained isolated.
- Task 4: complete. Actual installed test 0.10.0 -> 0.10.1 upgrades passed at both paths; metadata checks caused no installer download, cancel/retry worked, ordinary quit/restart did not install, explicit update did. Restarted B restored page 2, annotations, groups, locale and decrypted dummy AI key. Missing registration/uninstaller with the recorded recovery path was repaired; the pending marker was cleared.
- Task 5: complete after final scoped re-review PASS. Full unit suite 199/199, affected update/language Electron tests 12/12, existing AI/language/reader/layout regression 29/29, typecheck and production build passed. Installed production smoke passed; focused production update check confirmed supported=true and version 0.10.0.
- Local delivery: actual NSIS production installation and desktop shortcut verified, executable/archive matched final build, personal-profile preservation snapshot unchanged. Evidence and scoped review reports retained under release/verification/installer-0.10.0; test builds/profiles cleaned after verification.
- Ruling: Keep codex/installer-updates and all source changes locally. The approved work was implementation and local delivery; no commit, merge, push, or public Release was requested for this version. Public GitHub feed distribution is not claimed tested before publication.
