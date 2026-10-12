# Repository layout

## Source files

| Location | Purpose |
| --- | --- |
| `src/` | React interface, PDF rendering, selection, and AI panels |
| `electron/` | Desktop main process, isolated bridge, AI requests, and local sessions |
| `public/branding/` | Application icons and asset notes |
| `public/examples/` | Generated two-column PDF sample |
| `scripts/` | Development, build, packaging, installation, and verification tools |
| `tests/` | Unit and Electron end-to-end tests |
| `docs/` | Reading and development guides, visual assets, and review records |
| `package.json`, `package-lock.json` | Project commands and pinned dependencies |
| Root configuration files | TypeScript, Vite, Vitest, Playwright, and Git settings |

## Local files excluded from Git

These files are excluded by `.gitignore` and are not included in a fresh clone.

| Location | Purpose and recovery |
| --- | --- |
| `node_modules/` | Dependencies; install with `npm ci` |
| `public/pdf-assets/` | PDF.js offline assets; prepared automatically during development or builds |
| `dist/`, `dist-electron/` | Production output; generate with `npm run build` |
| `release/` | Packaged applications; generate with `npm run dist` and distribute through GitHub Releases |
| `tmp/`, `test-results/`, `playwright-report/` | Temporary profiles and test output; generated as needed |
| `designs/` | Local design explorations and historical screenshots, which may contain paper excerpts |
| `tests/fixtures/references/*.pdf` | Optional external paper fixtures |
| `*.local.json` | Machine-specific installation records and Electron runtime paths |

The README uses curated assets in `docs/images/`. Those assets are included in Git, unlike the local design archive.

## Installed application and personal data

The desktop shortcut points to an independently installed application. Its actual path is recorded in `.aurelia-install.local.json`. The first-install default is `%LOCALAPPDATA%\Programs\Aurelia\`; use the install script's `-ApplicationRoot` parameter to select another drive. Later updates reuse the recorded location. Removing workspace build output does not affect the installed application.

Personal API settings, recent files, and reading sessions are stored in `%APPDATA%\paperdesk\`, outside the source repository. Do not copy that directory into the project or upload it. Machine-local JSON records remain available to local scripts.

See [Development](development.md) for commands and [Publishing to GitHub](github-publishing.md) for repository upload instructions (Chinese).
