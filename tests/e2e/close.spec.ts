import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

let app: ElectronApplication, page: Page, profile: string, exited = false;
test.beforeEach(async () => {
  profile = path.resolve('tmp/close-e2e', `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(profile, { recursive: true });
  await writeFile(path.join(profile, 'app-settings.json'), JSON.stringify({ locale: 'en' }));
  const env = { ...process.env, PAPERDESK_TEST_DIR: profile }; delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath: process.env.PAPERDESK_ELECTRON_PATH,
    args: [path.resolve('tests/e2e/fixtures/close-entry.mjs')], env });
  exited = false; page = await app.firstWindow();
  await page.getByRole('heading', { name: 'Open a paper', exact: true }).waitFor();
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, path.resolve('tests/fixtures/navigation.pdf'));
  await page.getByRole('button', { name: 'Open PDF', exact: true }).click();
  await expect(page.locator('[data-page-number="1"]')).toHaveAttribute('data-text-ready', 'true');
  await page.getByRole('tab', { name: 'Chat', exact: true }).click();
});
test.afterEach(async () => { if (!exited) await app.close(); });

async function delayClose(fail: boolean) {
  await app.evaluate(({ dialog }, fail) => {
    const fixture = (globalThis as any).closeTest;
    const original = fixture.SessionStore.prototype.close;
    fixture.SessionStore.prototype.close = async function () {
      fixture.SessionStore.prototype.close = original;
      await new Promise<void>(resolve => { fixture.release = resolve; });
      if (fail) throw new Error('Isolated disk failure');
      return original.call(this);
    };
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  }, fail);
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].close(); });
  await expect(page.getByRole('dialog', { name: 'Saving before closing' })).toBeVisible();
  await expect.poll(() => app.evaluate(() => typeof (globalThis as any).closeTest.release)).toBe('function');
}

test('locks normal close, rejects late IPC edits, and saves the accepted draft and reading state', async () => {
  const editor = page.getByRole('textbox', { name: 'AI message', exact: true });
  await editor.fill('Keep this draft during normal close');
  const library = await page.evaluate(() => window.paperdesk!.getLibrary());
  const documentId = library.entries[0].documentId!;
  await delayClose(false);
  const overlay = page.getByRole('dialog', { name: 'Saving before closing' });
  await expect(overlay).toBeFocused();
  await expect(page.locator('.update-app-surface')).toHaveAttribute('inert', '');
  await page.keyboard.press('Escape'); await page.keyboard.press('Control+Tab'); await page.keyboard.type('must not change');
  await expect(overlay).toBeFocused(); await expect(editor).toHaveValue('Keep this draft during normal close');
  const blocked = await page.evaluate(async () => {
    try { await window.paperdesk!.saveAppSettings({ locale: 'zh-CN' }); return false; } catch { return true; }
  });
  expect(blocked).toBe(true);
  const closed = app.waitForEvent('close');
  await app.evaluate(() => (globalThis as any).closeTest.release());
  await closed; exited = true;
  const session = JSON.parse(await readFile(path.join(profile, 'reading-sessions', `${documentId}.json`), 'utf8'));
  expect(session.chats.some((chat: { draft: string }) => chat.draft === 'Keep this draft during normal close')).toBe(true);
  expect(JSON.parse(await readFile(path.join(profile, 'app-settings.json'), 'utf8')).locale).toBe('en');
  expect(JSON.parse(await readFile(path.join(profile, 'library.json'), 'utf8')).activeId).toBe(library.activeId);
});

test('cancelled close after a save failure unlocks the editor and allows a successful retry', async () => {
  const editor = page.getByRole('textbox', { name: 'AI message', exact: true });
  await editor.fill('Before the failure');
  await delayClose(true);
  await app.evaluate(() => (globalThis as any).closeTest.release());
  await expect(page.getByRole('dialog', { name: 'Saving before closing' })).toHaveCount(0);
  await expect(page.locator('.update-app-surface')).not.toHaveAttribute('inert', '');
  await editor.fill('After cancelling close');
  await expect(editor).toHaveValue('After cancelling close');
  await page.evaluate(() => window.paperdesk!.saveAppSettings({ locale: 'en' }));
  const closed = app.waitForEvent('close');
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].close(); });
  await closed; exited = true;
});
