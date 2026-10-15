# Update safety fixes implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development for the independent installer task; the coordinator implements shutdown integration and delivery. Follow test-driven-development and verification-before-completion.

**Goal:** Fix all three 0.10.0 re-audit findings and deliver verified 0.10.1 to the registered local installation.

**Architecture:** Reject reparse points before any old-version removal and before direct uninstall. Apply shortcut preferences only to links owned by this installation. Serialize normal close with a main-process mutation barrier and renderer lock; drain accepted writes without waiting for optional update network traffic.

**Tech stack:** Existing Electron/TypeScript/React, electron-builder NSIS, Vitest and Playwright.

**Spec:** User-approved three fixes; evidence in `release/verification/installer-0.10.0/reaudit-2026-10-15.md`.

## Constraints

- Preserve current working tree, existing profile, registered installation location and release policies in AGENTS.md.
- Version 0.10.1; English changelog. No commit, push or publication in this task.
- Use isolated fixtures for destructive installer checks; never place links into the production installation.
- No forced app termination; local install via scripts/install-local.ps1.

## Review focus

- Existing 0.10.0 uninstaller must never run against an unsafe tree.
- Direct uninstall must reject root/ancestor/descendant links without deleting external sentinels.
- User-repurposed same-name desktop links must survive deselection/uninstall.
- Accepted writes before closing must finish; fresh mutations during close must be rejected; cancel/failure restores interaction.
- A hung network check must not delay ordinary close or start writes after the close drain.

### Task 1: Installer safety and shortcut ownership

Files: `build/installer.nsh`, focused NSIS includes as needed, `scripts/test-installer-safety.mjs` (or PowerShell equivalent).

- [x] Add executable regression probes for descendant junction rejection and shortcut enabled → disabled cleanup; demonstrate failures on old behavior.
- [x] Guard install/upgrade before invoking old uninstaller, and direct uninstall before removals. Reject unsafe/unreadable traversal conservatively.
- [x] Remove disabled owned desktop links, preserve foreign links, keep ownership registration consistent.
- [x] Run real NSIS probes for ordinary trees, nested/dangling links, direct uninstall, shortcut toggles and foreign targets.

### Task 2: Race-free ordinary close

Files: `electron/main.ts`, `electron/update-service.ts`, preload/types, `src/updates/UpdateProvider.tsx`, messages, unit and Electron tests.

- [x] Add failing tests for new mutations after close, save cancellation recovery and slow update checking.
- [x] Establish synchronous main close barrier, notify renderer to lock, allow required capture writes, drain accepted operations and save; restore on failed/cancelled close.
- [x] Stop optional check completion from enqueuing preference writes during close; flush already queued writes. Resume on cancelled close.
- [x] Verify real Electron locking/restoration plus regression tests.

### Task 3: Full verification and local delivery

Files: package.json, package-lock.json, CHANGELOG.md, verification evidence.

- [x] Bump 0.10.1 and document fixes; run all unit tests, typecheck, full Electron suite and npm audit.
- [x] Obtain independent final code review and resolve actionable findings.
- [x] Build NSIS with npm run dist; test actual isolated installer/upgrade behavior.
- [x] Run scripts/install-local.ps1, verify registration, desktop target, version/exe/asar equality and isolated installed smoke/new feature checks.
- [x] Clean owned temporary fixtures after retaining evidence; report actual test results and delivery state.

## Progress

- Root causes and two runtime probes established during 2026-10-15 re-audit.
- Using existing codex/installer-updates checkout so prior uncommitted 0.10.0 work remains included.
- Task 1: initial 16 NSIS failures fixed; review added 5 failing assertions for orphan registration and legacy shortcut repair. Final 75 runtime assertions + 2 actual-template compilation checks pass.
- Task 2: 3 new failing main-process tests became green; 202 unit tests and 110 full Electron tests pass, including 2 new real-window close tests.
- Review: orphaned uninstall records now fail closed, foreign legacy shortcut flags are corrected only after all safety guards; scoped independent review reports no residual source blocker.
- Actual legacy installer probe: default-location orphan registration and registered custom-location junction both rejected before legacy removal; old files, registration and external sentinel preserved.
- Actual marked 0.10.0 → 0.10.1 in-app update and normal restart passed; locale, encrypted test key, groups, page and annotation preserved. Check-only, cancel/retry and ordinary-close behavior passed.
- Actual installer/uninstaller probes passed for linked-tree rejection, disabling an owned desktop shortcut, and legacy missing-executable repair preserving a foreign shortcut. The harness explicitly removes only the uninstaller left by its `_?=` invocation before reusing the fixture directory.
- Production 0.10.1 built, metadata verified and installed through scripts/install-local.ps1. Desktop target, uninstall registration, running version and executable/ASAR equality verified; installed smoke passed, with all five protected personal-profile files unchanged.
- Evidence retained under release/verification/installer-0.10.1; 25 disposable test directories removed. No commit, push or GitHub release performed.
