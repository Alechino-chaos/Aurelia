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

The Windows portable executable is written to `release/Aurelia-<version>-portable.exe`. Build artifacts are excluded from Git and should be distributed separately as Release attachments. Release signing and automatic updates are not configured.

To install locally and create a desktop shortcut, close the installed application normally, then run:

```powershell
./scripts/install-local.ps1
```

The default location for a first installation is `%LOCALAPPDATA%\Programs\Aurelia\`. To choose another location:

```powershell
./scripts/install-local.ps1 -ApplicationRoot 'E:\Aurelia'
```

The script copies the program into a new version directory, updates the desktop shortcut, and records the location in `.aurelia-install.local.json`. Later updates reuse that location. Old version directories are not automatically removed. Personal reading data does not move with the installation directory.

Editing source code or running development mode does not update an installed copy. Rebuild and reinstall it to apply changes.

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
