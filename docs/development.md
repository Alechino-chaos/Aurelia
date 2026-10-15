# Developing Aurelia

[Back to the project](../README.md)

The primary development and verification platform is Windows x64. Use Node.js 22.13+ and npm. Initial installation and packaging require network access to download dependencies and build tools. Exact dependency versions are pinned by `package-lock.json`.

## Local development

```powershell
npm ci
npm run dev
```

The development command compiles the Electron main process and starts Vite and the desktop window. Restart it after changing main-process code.

Use `npm run dev:web` for a frontend-only preview. Browser mode can open local PDFs, but Electron-specific capabilities require the desktop app.

The PDF.js worker, CMaps, fonts, and WASM assets ship with the application. Development and build commands prepare `public/pdf-assets/` automatically; do not download or commit those generated files manually.

## Building and testing

```powershell
npm run typecheck
npm test
npm run build
npm start
```

Run Electron end-to-end tests with:

```powershell
npm run test:e2e
```

- Unit tests cover reading order, copy rules, highlight geometry, Markdown, AI protocols, and session storage.
- Desktop tests cover mouse selection, the clipboard, zoom, highlights, AI interactions, restart recovery, and security boundaries.
- AI tests use a local mock service and test keys, without calling real paid APIs.
- Desktop tests use isolated profiles under `tmp/`, preserving personal reading history. Results are written to `test-results/`.

The built-in PDF is synthetic and can be regenerated with `node scripts/create-fixtures.mjs`. The optional external paper fixture is described in the [fixture notes](../tests/fixtures/references/README.md) (Chinese). If it is missing, only the corresponding test is skipped.

## Packaging and local installation

```powershell
npm run dist
```

The Windows x64 offline installer is written to `release/Aurelia-<version>-setup.exe`, alongside `latest.yml` and a `.blockmap`. The bilingual welcome page offers Install and Custom installation. Build artifacts are excluded from Git.

Publish all three artifacts from the same build to a draft GitHub Release, verify the attachment set, then publish the stable release with English notes. Do not upload a separate `.sha256` file. Versions must increase strictly. The app uses the fixed public `Alechino-chaos/Aurelia` feed with no client credentials. Downloads and installation require separate user actions; automatic checks never download, and ordinary exit never installs. Code signing is not yet configured.

To install locally and create a desktop shortcut, close the installed application normally, then run:

```powershell
./scripts/install-local.ps1
```

The default location for a first installation is `%LOCALAPPDATA%\Programs\Aurelia\`. To choose another location:

```powershell
./scripts/install-local.ps1 -ApplicationRoot 'E:\Aurelia'
```

The script runs the actual NSIS installer, reads its registered installation directory, verifies the executable and application archive, and records the location in `.aurelia-install.local.json`. Later updates retain that registered location and the shortcut preference. Previously delivered portable directories are not removed. Personal data remains in `%APPDATA%\paperdesk` and does not move with the installation directory.

Portable users install the first setup version manually once. A failed download leaves the current application usable. During restart preparation, an overlay temporarily locks editing while the app saves; a save or launch failure restores interaction. Installation interrupted by a crash or power loss has no promised automatic rollback: rerun the official installer to repair program files, keeping the existing user data. The installer records its validated destination separately before replacing files and clears that recovery record after success. Repair may reuse this recorded directory; unrelated nonempty directories remain rejected.

For isolated upgrade verification, `AURELIA_UPDATE_TEST_BUILD=<version>` creates a separately registered test installer under `release/upgrade-test-<version>`. Test installation directories, shortcuts and updater caches are separate from the production identity. Only those marked test builds accept a loopback `AURELIA_UPDATE_TEST_URL` and an isolated `AURELIA_UPDATE_TEST_PROFILE`. Without an explicit profile, they use a temporary profile derived from the installed executable directory, including after an installer restart. Production builds ignore these overrides. Never publish test packages.

Build versions A and B, install A with its actual test installer, then run `node scripts/verify-installed-update.mjs <installed-test-exe> <B-artifacts-directory>`. The harness seeds synthetic papers, annotations and a dummy encrypted key, checks the manual download boundary, cancels and retries, proves ordinary exit does not install, and explicitly performs the NSIS upgrade. Evidence is saved under `release/verification/installer-<current-package-version>/upgrade-evidence.json`. After closing the restarted test application normally, pass that file to `node scripts/verify-upgrade-restart.mjs` to verify the actual running B, automatic test-profile isolation and restored state. Repeat with a fresh test installation at the default path and a custom Unicode path. Both scripts reject unmarked production packages.

Run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-installer-safety.ps1` for executable NSIS regression probes. They compile the production path and shortcut policy into disposable installers, use isolated directories and registry keys, and verify junction rejection and shortcut ownership without changing the real installation. Ordinary-close regressions are covered by `tests/unit/update-ipc.test.ts` and `tests/e2e/close.spec.ts`.

Editing source code or running development mode does not update an installed copy. Rebuild and reinstall it to apply changes.

For each version update in this project, update the package and lockfile versions and `CHANGELOG.md`, run the relevant checks, build with `npm run dist`, and run `./scripts/install-local.ps1`. Verify the desktop shortcut target and run `node scripts/smoke-packaged.mjs` against the installed copy before reporting the desktop update as complete. Keep test profiles isolated from personal data. See the project conventions in [AGENTS.md](../AGENTS.md).

## Environment troubleshooting

If a Windows workspace carries a Low integrity label, Electron may exit during initialization. Set `PAPERDESK_ELECTRON_PATH` to a matching Electron runtime in an ordinary user directory, or provide `executablePath` and `version` in the Git-ignored `.paperdesk-runtime.local.json`. Ordinary workspaces do not require this override. Do not disable the application sandbox as a workaround.

For Electron binary downloads through a proxy, use `ELECTRON_GET_USE_PROXY=1` and `GLOBAL_AGENT_HTTP_PROXY`. Never commit proxy credentials, API keys, or personal configuration.

## Code map

| Location | Responsibility |
| --- | --- |
| `src/App.tsx` | Reading workspace and interactions |
| `src/pdf/` | Reading order, selection, copying, rendering, and highlight geometry |
| `src/components/` | Pages, AI panels, settings, and annotation UI |
| `electron/main.ts`, `electron/preload.cts` | Desktop main process and isolated bridge |
| `electron/ai-*` | AI configuration, requests, and protocol handling |
| `electron/session-*` | Session models, validation, and disk storage |
| `scripts/`, `tests/` | Development tools and automated verification |

See [Repository layout](README.md) for additional file guidance. Before submitting changes, run the relevant checks. Keep real keys, user profiles, and papers or screenshots without sharing permission out of commits.
