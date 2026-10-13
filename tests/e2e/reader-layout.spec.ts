import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { establishChinese } from './language-helper';

const root = process.cwd();
let app: ElectronApplication, page: Page, profile: string;
const errors: string[] = [];
async function launch() {
  const env = { ...process.env, PAPERDESK_TEST_DIR: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const packaged = process.env.AURELIA_TEST_EXECUTABLE;
  app = await electron.launch({ executablePath: packaged ?? process.env.PAPERDESK_ELECTRON_PATH,
    args: [...(packaged ? [`--user-data-dir=${profile}`] : [path.join(root, 'dist-electron/main.js')]), '--force-device-scale-factor=1'], env });
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await establishChinese(page);
  await expect(page.locator('[data-workspace-ready="true"]')).toBeVisible();
}
test.beforeEach(async ({}, info) => {
  errors.length = 0;
  profile = path.join(root, 'tmp/reader-layout', `${Date.now()}-${info.testId.replace(/\W/g, '')}`);
  await mkdir(profile, { recursive: true }); await launch();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
  await page.getByRole('button', { name: '体验双栏示例' }).click();
  await expect(page.locator('[data-page-number="1"]')).toHaveAttribute('data-text-ready', 'true');
});
test.afterEach(async () => { await app?.close(); expect(errors).toEqual([]); });

test('resizes document navigation with mouse and keyboard, remembers width and protects reading space', async () => {
  await page.getByRole('button', { name: '切换页码导航' }).click();
  const nav = page.getByRole('navigation', { name: '页码导航', exact: true });
  const separator = page.getByRole('separator', { name: '调整文档导航宽度' });
  await expect(separator).toBeVisible();
  const initial = (await nav.boundingBox())!.width, grip = (await separator.boundingBox())!;
  await page.mouse.move(grip.x + 2, grip.y + 100); await page.mouse.down();
  await page.mouse.move(grip.x + 102, grip.y + 100, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => (await nav.boundingBox())!.width).toBeCloseTo(initial + 100, 0);
  await separator.focus(); await page.keyboard.press('ArrowRight');
  const savedWidth = initial + 120;
  await expect(separator).toHaveAttribute('aria-valuenow', String(savedWidth));
  await page.getByRole('button', { name: '页码', exact: true }).click();
  await expect(nav).toHaveCSS('width', `${savedWidth}px`);
  await page.getByRole('button', { name: '切换页码导航' }).click();
  await page.getByRole('button', { name: '切换页码导航' }).click();
  await expect(nav).toHaveCSS('width', `${savedWidth}px`);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(960, 640));
  await expect.poll(async () => (await page.locator('.reading-workspace').boundingBox())!.width).toBeGreaterThanOrEqual(359);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
  await expect(separator).toHaveAttribute('aria-valuenow', String(savedWidth));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(960, 640));
  await separator.focus(); await page.keyboard.press('End');
  await expect.poll(async () => (await page.locator('.reading-workspace').boundingBox())!.width).toBeGreaterThanOrEqual(359);
  await page.keyboard.press('Home'); await expect(separator).toHaveAttribute('aria-valuenow', '160');
  await separator.dblclick(); await expect(separator).toHaveAttribute('aria-valuenow', '240');
  await separator.focus(); await page.keyboard.press('ArrowRight');
  await expect(separator).toHaveAttribute('aria-valuenow', '260');
  await app.close(); await launch();
  await page.getByRole('button', { name: '切换页码导航' }).click();
  await expect(page.getByRole('separator', { name: '调整文档导航宽度' })).toHaveAttribute('aria-valuenow', '260');
});

test('hides and restores the toolbar without losing page, zoom or access after restart', async () => {
  await page.getByRole('combobox', { name: '缩放比例' }).selectOption('1');
  await page.getByRole('textbox', { name: '页码', exact: true }).fill('2');
  await page.getByRole('textbox', { name: '页码', exact: true }).press('Enter');
  await expect(page.getByRole('textbox', { name: '页码', exact: true })).toHaveValue('2');
  const before = (await page.locator('.reader').boundingBox())!.height;
  await page.getByRole('button', { name: '隐藏顶部工具栏', exact: true }).click();
  await expect(page.locator('.workspace-toolbar')).toBeHidden();
  const restore = page.getByRole('button', { name: '显示顶部工具栏', exact: true });
  await expect(restore).toBeFocused();
  await expect.poll(async () => (await page.locator('.reader').boundingBox())!.height).toBeGreaterThan(before + 40);
  await page.keyboard.press('Control+f'); await expect(page.getByRole('textbox', { name: '搜索论文全文' })).toBeVisible();
  await page.keyboard.press('Escape');
  await restore.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: '隐藏顶部工具栏', exact: true })).toBeFocused();
  await expect(page.getByRole('textbox', { name: '页码', exact: true })).toHaveValue('2');
  await expect(page.getByRole('combobox', { name: '缩放比例' })).toHaveValue('1');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
  await page.getByRole('button', { name: '保存语言', exact: true }).click();
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await page.getByRole('button', { name: 'Hide top toolbar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Show top toolbar', exact: true })).toBeVisible();
  await app.close(); await launch();
  await expect(page.locator('.workspace-toolbar')).toBeHidden();
  await page.getByRole('button', { name: 'Show top toolbar', exact: true }).click();
  await expect(page.locator('.workspace-toolbar')).toBeVisible();
});
