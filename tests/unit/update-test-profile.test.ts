import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
const host = vi.hoisted(() => ({ marker: true, cli: '', profile: 'C:\\personal\\paperdesk', exe: 'D:\\Aurelia 升级验证\\Reader\\Aurelia.exe' }));
vi.mock('electron', () => ({ app: { isPackaged: true, getAppPath: () => 'C:\\app', commandLine: { getSwitchValue: () => host.cli },
  getPath: (name: string) => name === 'exe' ? host.exe : host.profile, setPath: (_name: string, value: string) => { host.profile = value; } } }));
vi.mock('electron-updater', () => ({ default: { NsisUpdater: class {}, CancellationToken: class {} } }));
vi.mock('node:fs', async original => ({ ...await original<typeof import('node:fs')>(), readFileSync: () => JSON.stringify({ aureliaUpdateTest: host.marker }) }));
import { preserveUpdateTestProfile } from '../../electron/update-runtime';
describe('marked update-test profile isolation', () => {
  it('uses the stable isolated fallback when restarted without CLI or inherited environment', () => {
    vi.stubEnv('AURELIA_UPDATE_TEST_PROFILE', ''); host.marker = true; host.cli = ''; host.profile = 'C:\\personal\\paperdesk';
    const expected = path.join(os.tmpdir(), `aurelia-update-test-${createHash('sha256').update(path.resolve(path.dirname(host.exe)).toLowerCase()).digest('hex').slice(0, 16)}`);
    preserveUpdateTestProfile(); expect(host.profile).toBe(expected); expect(process.env.AURELIA_UPDATE_TEST_PROFILE).toBe(expected);
    vi.stubEnv('AURELIA_UPDATE_TEST_PROFILE', 'relative-profile'); host.profile = 'C:\\personal\\paperdesk';
    preserveUpdateTestProfile(); expect(host.profile).toBe(expected);
    vi.unstubAllEnvs();
  });
  it('prefers absolute CLI, then absolute environment, ignoring a relative CLI', () => {
    host.marker = true; host.cli = 'C:\\isolated-cli'; vi.stubEnv('AURELIA_UPDATE_TEST_PROFILE', 'C:\\isolated-env');
    preserveUpdateTestProfile(); expect(host.profile).toBe('C:\\isolated-cli');
    host.cli = 'relative-cli'; vi.stubEnv('AURELIA_UPDATE_TEST_PROFILE', 'C:\\isolated-env');
    preserveUpdateTestProfile(); expect(host.profile).toBe('C:\\isolated-env');
    vi.unstubAllEnvs();
  });
  it('ignores all test environment overrides in a production package', () => {
    host.marker = false; host.profile = 'C:\\personal\\paperdesk'; host.cli = '';
    vi.stubEnv('AURELIA_UPDATE_TEST_PROFILE', 'C:\\test-override'); preserveUpdateTestProfile(); expect(host.profile).toBe('C:\\personal\\paperdesk');
    vi.unstubAllEnvs();
  });
});
