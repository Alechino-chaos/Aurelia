import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppInfo } from 'app-builder-lib/out/appInfo';
const build = vi.hoisted(() => ({ options: undefined as any }));
vi.mock('electron-builder', () => ({ build: async (options: any) => { build.options = options; return []; },
  Platform: { WINDOWS: { createTarget: () => 'nsis-x64' } }, Arch: { x64: 'x64' } }));
vi.mock('../../scripts/electron-runtime.mjs', () => ({ electronExecutable: () => 'C:\\Electron\\electron.exe' }));
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe('explicit test installer build isolation', () => {
  it('uses a separate package/cache identity and shortcut while retaining the Aurelia executable', async () => {
    vi.resetModules(); vi.stubEnv('AURELIA_UPDATE_TEST_BUILD', '0.10.2'); vi.spyOn(console, 'log').mockImplementation(() => {});
    await import('../../scripts/dist.mjs'); const config = build.options.config;
    expect(config.extraMetadata).toMatchObject({ name: 'aurelia-upgrade-test', version: '0.10.2', aureliaUpdateTest: true });
    expect(config.nsis).toMatchObject({ guid: '19e4ad96-9090-4c86-ad10-49b0da8b3ed3', shortcutName: 'Aurelia Upgrade Test', createStartMenuShortcut: false });
    const app = new AppInfo({ metadata: config.extraMetadata, config: { productName: 'Aurelia' } } as never);
    expect(app.updaterCacheDirName).toBe('aurelia-upgrade-test-updater'); expect(app.productFilename).toBe('Aurelia');
    expect(build.options.publish).toBe('never');
  });
  it('leaves production identity and feed configuration in package.json untouched', async () => {
    vi.resetModules(); vi.stubEnv('AURELIA_UPDATE_TEST_BUILD', ''); vi.spyOn(console, 'log').mockImplementation(() => {});
    await import('../../scripts/dist.mjs'); const config = build.options.config;
    expect(config).not.toHaveProperty('extraMetadata'); expect(config).not.toHaveProperty('nsis'); expect(config).not.toHaveProperty('appId');
    expect(build.options.publish).toBe('never');
  });
});
