import electron from 'electron';
import { readFileSync, existsSync } from 'node:fs';

// Optional, machine-local runtime location. No permission changes or automatic downloads.
export function electronExecutable() {
  if (process.env.PAPERDESK_ELECTRON_PATH) return process.env.PAPERDESK_ELECTRON_PATH;
  try {
    const config = JSON.parse(readFileSync(new URL('../.paperdesk-runtime.local.json', import.meta.url), 'utf8'));
    const installed = JSON.parse(readFileSync(new URL('../node_modules/electron/package.json', import.meta.url), 'utf8'));
    if (config.version === installed.version && typeof config.executablePath === 'string' && existsSync(config.executablePath)) return config.executablePath;
  } catch { /* Use the regular npm-managed runtime. */ }
  return electron;
}
