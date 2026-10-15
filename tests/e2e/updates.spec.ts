import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { UpdateState } from '../../electron/update-types';

// The real renderer and preload run in Electron. Only the update IPC boundary is
// replaced: no network, installer, or production test switch is required.
const initial: UpdateState = { phase: 'idle', currentVersion: '0.10.0', supported: true, autoCheck: true, lastCheckedAt: null };
let app: ElectronApplication, page: Page;
const errors: string[] = [];
async function launch(locale: 'en' | null = 'en') {
  const profile = path.join(process.cwd(), 'tmp/updates-e2e', `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(profile, { recursive: true });
  if (locale) await writeFile(path.join(profile, 'app-settings.json'), JSON.stringify({ locale }));
  const env = { ...process.env, PAPERDESK_TEST_DIR: profile }; delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath: process.env.PAPERDESK_ELECTRON_PATH, args: [path.join(process.cwd(), 'dist-electron/main.js')], cwd: process.cwd(), env });
  page = await app.firstWindow();
  await app.evaluate(({ ipcMain, BrowserWindow }, value) => {
    const fixture = { state: value, calls: [] as string[], reject: '', installError: true, finishDownload: null as null | (() => void) };
    (globalThis as any).updateFixture = fixture;
    const publish = () => { for (const window of BrowserWindow.getAllWindows()) window.webContents.send('update:state', fixture.state); return fixture.state; };
    for (const action of ['get-state', 'ready', 'check', 'download', 'cancel', 'install', 'set-auto-check', 'release-page']) {
      ipcMain.removeHandler(`update:${action}`);
      ipcMain.handle(`update:${action}`, (_event, enabled) => {
        fixture.calls.push(action);
        if (fixture.reject === action) throw new Error('private transport details must not appear');
        if (action === 'check') fixture.state = { ...fixture.state, phase: 'available', availableVersion: '0.11.0', lastCheckedAt: 1791892800000, releaseNotes: 'Improved reading.\n<img src="https://invalid.test/pixel" onerror="alert(1)">\n[unsafe](javascript:alert(1))' };
        if (action === 'download') {
          fixture.state = { ...fixture.state, phase: 'downloading', error: undefined, percent: 25, transferred: 1048576, total: 4194304 };
          publish(); return new Promise<UpdateState>(resolve => { fixture.finishDownload = () => { fixture.finishDownload = null; resolve(fixture.state); }; });
        }
        if (action === 'cancel') { fixture.state = { ...fixture.state, phase: 'cancelled' }; fixture.finishDownload?.(); }
        if (action === 'set-auto-check') fixture.state = { ...fixture.state, autoCheck: enabled };
        if (action === 'install') fixture.state = { ...fixture.state, phase: fixture.installError ? 'error' : 'preparing', error: fixture.installError ? 'save' : undefined };
        return action === 'ready' || action === 'release-page' ? undefined : publish();
      });
    }
  }, initial);
  errors.length = 0; page.on('pageerror', error => errors.push(error.message));
  await page.reload();
}
async function emit(state: Partial<UpdateState>) {
  await app.evaluate(({ BrowserWindow }, patch) => {
    const fixture = (globalThis as any).updateFixture;
    fixture.state = { ...fixture.state, ...patch };
    BrowserWindow.getAllWindows()[0].webContents.send('update:state', fixture.state);
    if (patch.phase && patch.phase !== 'downloading') fixture.finishDownload?.();
  }, state);
}
const calls = () => app.evaluate(() => (globalThis as any).updateFixture.calls as string[]);
async function screenshot(name: string, width = 1440) {
  await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size, 940), width);
  const directory = path.join(process.cwd(), 'release/verification/installer-0.10.0');
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, name) });
}
async function openUpdates() {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'About & updates', exact: true }).click();
}
test.afterEach(async () => { expect(errors).toEqual([]); await app?.close(); });

for (const [panel, error] of [['Chat', 'save'], ['Annotations', 'install']] as const) {
  test(`freezes ${panel} and Settings during delayed preparation and restores after ${error} failure`, async () => {
    await launch();
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, path.join(process.cwd(), 'tests/fixtures/navigation.pdf'));
    await page.getByRole('button', { name: 'Open PDF', exact: true }).click();
    await expect(page.locator('[data-page-number="1"]')).toHaveAttribute('data-text-ready', 'true');
    let editor;
    if (panel === 'Chat') {
      await page.getByRole('tab', { name: 'Chat', exact: true }).click(); editor = page.getByRole('textbox', { name: 'AI message', exact: true });
    } else {
      await page.evaluate(() => {
        const line = document.querySelector('[data-page-number="1"] .textLayer [data-line]')!;
        const range = document.createRange(); range.selectNodeContents(line);
        window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
      });
      await page.getByRole('toolbar', { name: 'Selection actions' }).getByRole('button', { name: 'Annotations', exact: true }).click();
      editor = page.getByRole('textbox', { name: 'Annotation note', exact: true });
    }
    await editor.fill(`Protected ${panel}`);
    await emit({ phase: 'downloaded', availableVersion: '0.11.0' }); await openUpdates();
    await app.evaluate(({ ipcMain, BrowserWindow }) => {
      const fixture = (globalThis as any).updateFixture;
      ipcMain.removeHandler('update:install');
      ipcMain.handle('update:install', () => {
        fixture.calls.push('install'); fixture.state = { ...fixture.state, phase: 'preparing', error: undefined };
        BrowserWindow.getAllWindows()[0].webContents.send('update:state', fixture.state);
        return new Promise(resolve => { fixture.finishInstall = (error: string) => {
          fixture.state = { ...fixture.state, phase: 'error', error }; BrowserWindow.getAllWindows()[0].webContents.send('update:state', fixture.state); resolve(fixture.state);
        }; });
      });
    });
    await page.getByRole('button', { name: 'Restart and update', exact: true }).click();
    const overlay = page.getByTestId('update-saving-overlay'); await expect(overlay).toBeVisible(); await expect(overlay).toBeFocused();
    await expect(page.locator('.update-app-surface')).toHaveAttribute('inert', '');
    await page.keyboard.press('Escape'); await page.keyboard.press('Control+Tab'); await page.keyboard.type('must not be edited'); await page.keyboard.press('Tab');
    await expect(overlay).toBeFocused(); await expect(page.locator('.settings-dialog')).toHaveCount(1);
    if (panel === 'Chat') {
      const hiddenEditor = page.locator('.chat-compose textarea');
      await hiddenEditor.evaluate((element: HTMLElement) => element.focus()); await page.keyboard.type('blocked text');
      await expect(hiddenEditor).toHaveValue(`Protected ${panel}`);
    } else {
      // Opening Settings normally finishes the textarea's blur edit. Inert
      // must also prevent reopening that editor by pointer or keyboard.
      const edit = page.locator('.annotation-actions button').last();
      await edit.evaluate((element: HTMLElement) => element.focus()); await page.keyboard.press('Enter');
      const bounds = await edit.boundingBox(); await page.mouse.click(bounds!.x + 4, bounds!.y + 4);
      await expect(page.locator('.annotation-note textarea')).toHaveCount(0);
      await expect(page.locator('.annotation-note p')).toHaveText(`Protected ${panel}`);
    }
    await expect(overlay).toBeFocused();
    const language = page.locator('#settings-general select'); await language.evaluate((element: HTMLElement) => element.focus()); await page.keyboard.press('ArrowDown');
    await expect(language).toHaveValue('en'); await expect(overlay).toBeFocused();
    await app.evaluate((_electron, code) => (globalThis as any).updateFixture.finishInstall(code), error);
    await expect(overlay).toHaveCount(0); await expect(page.locator('.update-app-surface')).not.toHaveAttribute('inert', '');
    await page.getByRole('button', { name: 'Close settings', exact: true }).click();
    if (panel === 'Annotations') await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await editor.fill(`Restored ${panel}`); await expect(editor).toHaveValue(`Restored ${panel}`);
  });
}

test('locks while native AI confirmation is pending and restores after it is declined', async () => {
  await launch(); await emit({ phase: 'downloaded', availableVersion: '0.11.0' }); await openUpdates();
  await app.evaluate(({ ipcMain }) => {
    const fixture = (globalThis as any).updateFixture;
    ipcMain.removeHandler('update:install'); ipcMain.handle('update:install', () => new Promise(resolve => { fixture.declineInstall = () => resolve(fixture.state); }));
  });
  await page.getByRole('button', { name: 'Restart and update', exact: true }).click();
  await expect(page.getByTestId('update-saving-overlay')).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.locator('.settings-dialog')).toHaveCount(1);
  await app.evaluate(() => (globalThis as any).updateFixture.declineInstall());
  await expect(page.getByTestId('update-saving-overlay')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Restart and update', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Close settings', exact: true }).click(); await expect(page.locator('.settings-dialog')).toHaveCount(0);
});

test('disables shared preference and transport retries during update preparation', async () => {
  await launch(); await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await app.evaluate(({ ipcMain }) => {
    const fixture = (globalThis as any).updateFixture;
    ipcMain.removeHandler('update:set-auto-check');
    ipcMain.handle('update:set-auto-check', () => {
      fixture.calls.push('set-auto-check');
      return new Promise((_resolve, reject) => { fixture.rejectPreference = () => reject(new Error('deferred preference transport failure')); });
    });
  });
  await page.getByRole('checkbox', { name: 'Automatically check for updates' }).uncheck();
  await emit({ phase: 'preparing', error: 'preferences' });
  await app.evaluate(() => (globalThis as any).updateFixture.rejectPreference());
  const retries = page.locator('#settings-general').getByRole('button', { name: 'Retry saving preference', exact: true, includeHidden: true });
  await expect(retries).toHaveCount(2);
  for (let index = 0; index < await retries.count(); index++) await expect(retries.nth(index)).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: 'Automatically check for updates', includeHidden: true })).toBeDisabled();
  const before = (await calls()).filter(action => action === 'set-auto-check').length;
  await retries.evaluateAll(buttons => { for (const button of buttons) (button as HTMLButtonElement).click(); });
  expect((await calls()).filter(action => action === 'set-auto-check')).toHaveLength(before);
  const aboutRetries = page.locator('#settings-updates').getByRole('button', { name: 'Retry saving preference', exact: true, includeHidden: true });
  for (let index = 0; index < await aboutRetries.count(); index++) await expect(aboutRetries.nth(index)).toBeDisabled();
});

test('waits for language confirmation before updaterReady and changes update language live', async () => {
  await launch(null);
  await page.getByRole('radio', { name: 'English', exact: true }).waitFor();
  expect(await calls()).not.toContain('ready');
  await page.getByRole('radio', { name: 'English', exact: true }).check();
  await page.getByRole('button', { name: '确认并继续 / Confirm and continue' }).click();
  await openUpdates();
  await expect(page.getByText('No check yet.', { exact: true })).toBeVisible();
  expect(await calls()).toContain('ready');
  await page.getByRole('tab', { name: 'General', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Automatically check for updates' })).toBeChecked();
  await page.getByRole('checkbox', { name: 'Automatically check for updates' }).uncheck();
  expect(await app.evaluate(() => (globalThis as any).updateFixture.state.autoCheck)).toBe(false);
  await page.getByRole('combobox', { name: 'Interface language' }).selectOption('zh-CN');
  await page.getByRole('button', { name: 'Save language' }).click();
  await page.getByRole('tab', { name: '关于与更新' }).click();
  await expect(page.getByRole('button', { name: '检查更新', exact: true })).toBeVisible();
  await screenshot('updates-chinese-960.png', 960);
});

test('checks without downloading, treats release notes as text and cancels/retries download', async () => {
  await launch(); await openUpdates();
  await page.getByRole('button', { name: 'Check for updates', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Download update', exact: true })).toBeVisible();
  expect(await calls()).not.toContain('download'); expect(await calls()).not.toContain('install');
  const notes = page.getByTestId('update-release-notes');
  await expect(notes).toContainText('<img src='); await expect(notes.locator('img, a, script')).toHaveCount(0);
  await screenshot('updates-english-1440.png');
  await page.getByRole('button', { name: 'Download update', exact: true }).click();
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
  await screenshot('updates-downloading-960.png', 960);
  await page.getByRole('button', { name: 'Close settings' }).click();
  await page.getByRole('button', { name: 'Try the two-column sample' }).click();
  await page.locator('[data-page-number="1"][data-text-ready="true"]').waitFor();
  expect(await app.evaluate(() => (globalThis as any).updateFixture.state.phase)).toBe('downloading');
  await openUpdates();
  await page.getByRole('button', { name: 'Cancel download' }).click();
  await expect(page.getByText('Download cancelled.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Download update', exact: true }).click();
  await emit({ phase: 'error', error: 'download' });
  await page.getByRole('button', { name: 'Retry download', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cancel download' })).toBeVisible();
  expect((await calls()).filter(action => action === 'download')).toHaveLength(3);
});

test('keeps toast and about entry reachable with hidden toolbar; Later never installs', async () => {
  await launch();
  await page.getByRole('button', { name: 'Hide top toolbar' }).click();
  await page.getByRole('button', { name: 'Show top toolbar' }).focus();
  await emit({ phase: 'available', availableVersion: '0.11.0' });
  await expect(page.getByTestId('update-toast')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show top toolbar' })).toBeFocused();
  await page.getByTestId('update-toast').getByRole('button', { name: 'Later', exact: true }).click();
  await emit({ phase: 'available' });
  await expect(page.getByTestId('update-toast')).toHaveCount(0);
  await page.getByRole('button', { name: 'About & updates', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Download update', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close settings' }).click();
  await emit({ phase: 'downloaded' });
  await expect(page.getByTestId('update-toast')).toContainText('ready to install');
  await page.getByTestId('update-toast').getByRole('button', { name: 'View update' }).click();
  await expect(page.getByTestId('update-toast')).toHaveCount(0);
  await page.getByRole('dialog').getByRole('button', { name: 'Later', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await calls()).not.toContain('install');
  await emit({ phase: 'downloaded' }); await expect(page.getByTestId('update-toast')).toHaveCount(0);
});

test('localizes all check failures, distinguishes latest and preserves installer retry', async () => {
  await launch(); await openUpdates();
  for (const [code, text] of [['network', 'connection'], ['timeout', 'timed out'], ['invalid-version', 'release information is invalid']] as const) {
    await emit({ phase: 'error', error: code });
    await expect(page.getByRole('alert')).toContainText(text);
    await expect(page.getByRole('button', { name: 'Retry check', exact: true })).toBeEnabled();
    await expect(page.getByText('You are up to date.', { exact: true })).toHaveCount(0);
  }
  await emit({ phase: 'latest', error: undefined });
  await expect(page.getByText('You are up to date.', { exact: true })).toBeVisible();
  await emit({ phase: 'checking' });
  await expect(page.getByRole('button', { name: 'Check for updates', exact: true, includeHidden: true })).toBeDisabled();
  await emit({ phase: 'error', error: 'install', availableVersion: '0.11.0' });
  await expect(page.getByRole('alert')).toContainText('installer could not start');
  await expect(page.getByRole('button', { name: 'Retry restart and update' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Download update', exact: true })).toHaveCount(0);
  await emit({ phase: 'error', error: 'preferences' });
  await expect(page.getByRole('alert')).toContainText('preference could not be saved');
  await page.getByRole('button', { name: 'Retry saving preference' }).click();
  expect(await calls()).toContain('set-auto-check');
});

test('retries saving through explicit install and prevents duplicate actions while preparing', async () => {
  await launch(); await emit({ phase: 'downloaded', availableVersion: '0.11.0' }); await openUpdates();
  expect(await calls()).not.toContain('install');
  await page.getByRole('button', { name: 'Restart and update', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('could not be saved');
  await screenshot('updates-save-failure-1440.png');
  expect((await calls()).filter(action => action === 'install')).toHaveLength(1);
  await app.evaluate(() => { (globalThis as any).updateFixture.installError = false; });
  await page.getByRole('button', { name: 'Retry restart and update', exact: true }).click();
  await expect(page.getByText('Saving your reading before updating…', { exact: true })).toBeVisible();
  await screenshot('updates-preparing-960.png', 960);
  await expect(page.getByRole('button', { name: 'Check for updates', exact: true })).toBeDisabled();
  expect((await calls()).filter(action => action === 'install')).toHaveLength(2);
});

test('shows transport failure without claiming latest, recovers check and opens fixed release page', async () => {
  await launch(); await openUpdates();
  await emit({ phase: 'latest' });
  await expect(page.getByText('You are up to date.', { exact: true })).toBeVisible();
  await app.evaluate(() => { (globalThis as any).updateFixture.reject = 'check'; });
  await page.getByRole('button', { name: 'Check for updates', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Unable to communicate with the update service');
  await expect(page.getByText('You are up to date.', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('alert')).not.toContainText('private transport');
  await app.evaluate(() => { (globalThis as any).updateFixture.reject = ''; });
  await page.getByRole('button', { name: 'Retry check', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Download update', exact: true })).toBeVisible();
  await emit({ phase: 'unsupported', supported: false });
  await expect(page.getByText(/portable or development/)).toBeVisible();
  await page.getByRole('button', { name: 'Official releases' }).click();
  expect(await calls()).toContain('release-page');
});

test('supports tab keyboard navigation and traps focus, with readable narrow layout', async () => {
  await launch(); await openUpdates();
  await page.getByRole('tab', { name: 'About & updates' }).focus();
  await page.keyboard.press('Home'); await expect(page.getByRole('tab', { name: 'General' })).toBeFocused();
  await page.keyboard.press('ArrowRight'); await expect(page.getByRole('tab', { name: 'AI service' })).toBeFocused();
  await page.keyboard.press('End'); await expect(page.getByRole('tab', { name: 'About & updates' })).toBeFocused();
  const buttons = page.getByRole('dialog').locator('button:visible:not(:disabled)');
  await buttons.last().focus(); await page.keyboard.press('Tab'); await expect(buttons.first()).toBeFocused();
  await page.keyboard.press('Shift+Tab'); await expect(buttons.last()).toBeFocused();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(760, 650));
  await expect(page.getByRole('button', { name: 'Check for updates' })).toBeInViewport();
  expect(await page.getByRole('dialog').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await mkdir('test-results/screenshots', { recursive: true });
  await page.screenshot({ path: 'test-results/screenshots/updates-narrow.png' });
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
});
