import { describe, expect, it, vi } from 'vitest';
const host = vi.hoisted(() => ({ instances: [] as any[], quit: 0, failSpawn: false, spawn: [] as string[] }));
vi.mock('electron', () => ({ app: { isPackaged: true, getPath: () => 'C:\\isolated-profile', getVersion: () => '0.10.0', getAppPath: () => 'C:\\app', commandLine: { hasSwitch: () => true, getSwitchValue: () => 'C:\\isolated-profile' }, quit() { host.quit++; } } }));
vi.mock('electron-updater', async () => {
  const { EventEmitter } = await import('node:events');
  return { default: { CancellationToken: class { cancel() {} }, NsisUpdater: class extends EventEmitter {
    autoDownload = true; autoInstallOnAppQuit = true; allowDowngrade = true; allowPrerelease = true;
    constructor(public configuration: unknown) { super(); host.instances.push(this); }
    installerPath = 'C:\\cache\\setup.exe';
    install() { return (this as any).doInstall({}); }
    async spawnLog(_file: string, args: string[]) { host.spawn = args; if (host.failSpawn) throw new Error('spawn failed'); return true; }
    async checkForUpdates() { return { updateInfo: { version: '0.11.0', files: [{ url: 'Aurelia-0.11.0-setup.exe', sha512: 'abc' }], releaseNotes: 'Notes' } }; }
  } } };
});
import { createUpdateDriver } from '../../electron/update-runtime';
import { testFeed } from '../../electron/update-policy';
describe('official updater boundary', () => {
  it('configures fixed public stable feed with no automatic download, install, prerelease or downgrade', async () => {
    host.instances.length = 0;
    const driver = createUpdateDriver({ installDirectory: 'C:\\Aurelia', testBuild: false, onInstallStarted() {} });
    expect(await driver.check()).toMatchObject({ version: '0.11.0' });
    const updater = host.instances[0];
    expect(updater.configuration).toEqual({ provider: 'github', owner: 'Alechino-chaos', repo: 'Aurelia', private: false, releaseType: 'release' });
    expect(updater).toMatchObject({ autoDownload: false, autoInstallOnAppQuit: false, allowDowngrade: false, allowPrerelease: false, installDirectory: 'C:\\Aurelia' });
  });
  it('ignores arbitrary test URLs in production and restricts marked builds to loopback HTTP', () => {
    expect(testFeed(false, 'http://127.0.0.1:3000')).toBeUndefined();
    for (const url of ['https://example.com/feed', 'http://evil.test/', 'http://user:pass@localhost/', 'http://127.0.0.1/#bad']) expect(testFeed(true, url)).toBeUndefined();
    expect(testFeed(true, 'http://127.0.0.1:3000/feed/')).toBe('http://127.0.0.1:3000/feed/');
  });
  it('keeps the app open if installer spawn fails and preserves custom directory on retry', async () => {
    host.quit = 0; host.failSpawn = true; let started = false;
    const driver = createUpdateDriver({ installDirectory: 'D:\\中文 Aurelia', testBuild: false, onInstallStarted() { started = true; } });
    await driver.check(); await expect(driver.install()).rejects.toThrow('spawn failed');
    expect(host.quit).toBe(0); expect(started).toBe(false);
    host.failSpawn = false; await driver.install();
    expect(host.quit).toBe(1); expect(started).toBe(true);
    expect(host.spawn).toEqual(['--updated', '/S', '--force-run', '/D=D:\\中文 Aurelia']);
  });
});
