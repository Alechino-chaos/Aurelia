import { afterEach, describe, expect, it, vi } from 'vitest';
const host = vi.hoisted(() => ({ location: 'D:\\研究 软件\\Aurelia', exe: 'D:\\研究 软件\\Aurelia\\Aurelia.exe',
  command: [] as string[], options: {} as Record<string, unknown>, virtualArchive: false, archiveExists: true }));
vi.mock('electron', () => ({ app: { isPackaged: true, getPath: () => host.exe } }));
vi.mock('electron-updater', () => ({ default: { NsisUpdater: class {}, CancellationToken: class {} } }));
vi.mock('node:child_process', () => ({ execFile: (...args: any[]) => {
  host.command = args[1]; host.options = args[2];
  // PowerShell/.NET reads Unicode values; the process output is explicitly UTF-8 JSON.
  const bytes = Buffer.from(JSON.stringify({ InstallLocation: host.location, UninstallString: `"${host.location}\\Uninstall Aurelia.exe"` }), 'utf8');
  args.at(-1)(null, { stdout: bytes.toString('utf8') });
} }));
vi.mock('node:fs/promises', () => ({ realpath: async (value: string) => value, stat: async (value: string) => ({ isFile: () => !host.virtualArchive || !value.endsWith('app.asar'), isDirectory: () => host.virtualArchive && value.endsWith('app.asar') }) }));
vi.mock('original-fs', () => ({ promises: { stat: async () => ({ isFile: () => host.archiveExists }) } }));
import { registeredInstallDirectory } from '../../electron/update-runtime';
afterEach(() => vi.unstubAllEnvs());
describe('Unicode-safe NSIS registration eligibility', () => {
  it('reads a registered Chinese directory via UTF-8 JSON and checks matching executable/uninstaller paths', async () => {
    vi.stubEnv('PORTABLE_EXECUTABLE_FILE', '');
    expect(await registeredInstallDirectory(false)).toBe('D:\\研究 软件\\Aurelia');
    expect(host.command.slice(0, 3)).toEqual(['-NoProfile', '-NonInteractive', '-EncodedCommand']);
    expect(host.options).toMatchObject({ encoding: 'utf8', windowsHide: true });
    const script = Buffer.from(host.command[3], 'base64').toString('utf16le');
    expect(script).toContain('Registry64'); expect(script).toContain('UTF8Encoding');
    expect(script).toContain('8e3b71f6-b014-4f5d-83d9-ea8146edc067');
  });
  it('rejects an unpacked copy outside the registered Chinese directory', async () => {
    vi.stubEnv('PORTABLE_EXECUTABLE_FILE', '');
    const original = host.exe; host.exe = 'E:\\unpacked\\Aurelia.exe';
    try { expect(await registeredInstallDirectory(false)).toBeUndefined(); } finally { host.exe = original; }
  });
  it('checks the physical ASAR file even when Electron presents it as a virtual directory', async () => {
    vi.stubEnv('PORTABLE_EXECUTABLE_FILE', ''); host.virtualArchive = true; host.archiveExists = true;
    try {
      expect(await registeredInstallDirectory(false)).toBe(host.location);
      host.archiveExists = false; expect(await registeredInstallDirectory(false)).toBeUndefined();
    } finally { host.virtualArchive = false; host.archiveExists = true; }
  });
});
