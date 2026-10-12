import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

let app: ElectronApplication;
let page: Page;
const errors: string[] = [];
const root = process.cwd();
const fixture = path.join(root, 'public/examples/reading-demo.pdf');
const profile = path.join(root, 'tmp/e2e-profile', String(Date.now()));

async function waitText(number = 1) {
  await expect(page.locator(`[data-page-number="${number}"]`)).toHaveAttribute('data-text-ready', 'true');
  await expect(page.locator(`[data-page-number="${number}"]`)).toHaveAttribute('data-raster-ready', 'true');
  await expect(page.locator(`[data-page-number="${number}"] canvas`).first()).toBeVisible();
}
async function pickText(startText: string, endText: string, reverse = false) {
  const start = page.locator('[data-page-number="1"] .textLayer span').filter({ hasText: startText }).first();
  const end = page.locator('[data-page-number="1"] .textLayer span').filter({ hasText: endText }).first();
  const a = (await start.boundingBox())!;
  const b = (await end.boundingBox())!;
  const from = { x: a.x + .5, y: a.y + a.height * .5 };
  const to = { x: b.x + b.width - .5, y: b.y + b.height * .5 };
  await page.mouse.move(reverse ? to.x : from.x, reverse ? to.y : from.y);
  await page.mouse.down();
  await page.mouse.move(reverse ? from.x : to.x, reverse ? from.y : to.y, { steps: 14 });
  await page.mouse.up();
  await expect(page.getByTestId('selection-preview')).toBeVisible();
  await expect(page.getByTestId('selection-preview')).toContainText(startText);
}

test.describe.serial('desktop PDF reading', () => {
  test.beforeAll(async () => {
    const env = { ...process.env, PAPERDESK_TEST_DIR: profile };
    delete env.ELECTRON_RUN_AS_NODE;
    await mkdir(profile, { recursive: true });
    const packaged = process.env.AURELIA_TEST_EXECUTABLE;
    // Coordinate-driven drags use a fixed display scale across Windows monitors.
    // Native high-DPI rendering is covered separately by zoom.spec.ts at 2x.
    app = await electron.launch({ executablePath: packaged ?? process.env.PAPERDESK_ELECTRON_PATH,
      args: [...(packaged ? [`--user-data-dir=${profile}`] : [path.join(root, 'dist-electron/main.js')]), '--force-device-scale-factor=1'], cwd: root, env });
    page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') console.log('Renderer:', message.text()); });
    await page.waitForLoadState('domcontentloaded');
    await mkdir(path.join(root, 'test-results/screenshots'), { recursive: true });
  });
  test.afterAll(async () => { await app?.close(); });
  test.afterEach(async ({}, info) => {
    if (info.status !== info.expectedStatus) {
      console.log('Reader geometry:', await page.evaluate(() => ({
        scrollTop: document.querySelector('.reader')?.scrollTop,
        pages: Array.from(document.querySelectorAll('.pdf-page')).map(el => ({ page: el.getAttribute('data-page-number'), top: el.getBoundingClientRect().top, height: el.getBoundingClientRect().height, canvas: !!el.querySelector('canvas'), status: el.querySelector('.page-loading')?.textContent })),
      })));
      await page.screenshot({ path: 'test-results/screenshots/reader-failure.png' });
    }
  });

  test('opens a local PDF using the desktop bridge', async () => {
    await expect(page.getByRole('heading', { name: '打开论文' })).toBeVisible();
    await page.screenshot({ path: 'test-results/screenshots/welcome.png' });
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
    }, fixture);
    await page.getByRole('button', { name: '打开 PDF', exact: true }).click();
    await waitText();
    await expect(page.locator('.pdf-page')).toHaveCount(3);
    await expect(page.locator('.page-caption').first()).toContainText('双栏阅读顺序');
    await page.screenshot({ path: 'test-results/screenshots/reader.png' });
  });

  test('selection endpoint stays on the same line when moving just beyond its last character', async () => {
    const first = page.locator('[data-page-number="1"] .textLayer span').filter({ hasText: 'LEFT COLUMN:' }).first();
    const last = page.locator('[data-page-number="1"] .textLayer span').filter({ hasText: 'preserves the sentence' }).first();
    const a = (await first.boundingBox())!;
    const b = (await last.boundingBox())!;
    await page.mouse.move(a.x + .5, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width - .5, b.y + b.height / 2, { steps: 14 });
    await expect.poll(() => page.evaluate(() => window.getSelection()!.toString())).toContain('preserves the sentence across line breaks.');
    const selected = await page.evaluate(() => window.getSelection()!.toString());
    for (const [dx, dy] of [[2, 0], [5, 1], [8, 2], [12, 0], [4, -1], [4, b.height / 2 + .5]]) {
      await page.mouse.move(b.x + b.width + dx, b.y + b.height / 2 + dy);
      await expect.poll(() => page.evaluate(() => window.getSelection()!.toString())).toBe(selected);
    }
    const next = (await page.locator('[data-page-number="1"] .textLayer span').filter({ hasText: 'Selecting these lines' }).first().boundingBox())!;
    await page.mouse.move(next.x + next.width - .5, next.y + next.height / 2);
    await expect.poll(() => page.evaluate(() => window.getSelection()!.toString())).toContain('Selecting these lines should never include');
    await page.mouse.move(b.x + b.width - .5, b.y + b.height / 2);
    await expect.poll(() => page.evaluate(() => window.getSelection()!.toString())).toBe(selected);
    await page.mouse.move(b.x + b.width + 4, b.y + b.height + .5);
    await expect.poll(() => page.evaluate(() => window.getSelection()!.toString())).toBe(selected);
    await page.mouse.up();
    await expect(page.getByTestId('selection-preview')).toHaveText('LEFT COLUMN: We propose a novel frame-work for representation learning. The method preserves the sentence across line breaks.');
    await page.keyboard.press('Control+c');
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('LEFT COLUMN: We propose a novel frame-work for representation learning. The method preserves the sentence across line breaks.');
  });

  test('reverse selection remains stable above a line at different zoom levels', async () => {
    for (const zoom of ['0.75', '1.5']) {
      await page.keyboard.press('Escape');
      await page.getByRole('combobox', { name: '缩放比例' }).selectOption(zoom);
      await expect(page.locator('[data-page-number="1"]')).toHaveAttribute('data-text-scale', zoom);
      await waitText();
      await page.locator('.reader').evaluate(element => { element.scrollTop = 0; });
      const top = (await page.locator('[data-page-number="1"] .textLayer span').filter({ hasText: 'RIGHT COLUMN:' }).first().boundingBox())!;
      const bottom = (await page.locator('[data-page-number="1"] .textLayer span').filter({ hasText: 'It must not interrupt' }).first().boundingBox())!;
      await page.mouse.move(bottom.x + bottom.width - .5, bottom.y + bottom.height / 2);
      await page.mouse.down();
      await page.mouse.move(top.x + .5, top.y + top.height / 2, { steps: 14 });
      await expect.poll(() => page.evaluate(() => window.getSelection()!.toString())).toContain('RIGHT COLUMN:');
      const selected = await page.evaluate(() => window.getSelection()!.toString());
      await page.mouse.move(top.x - 4, top.y - .5);
      await expect.poll(() => page.evaluate(() => window.getSelection()!.toString())).toBe(selected);
      await page.mouse.up();
      await expect(page.getByTestId('selection-preview')).toHaveText('RIGHT COLUMN: This independent paragraph belongs to the second column of the page. It must not interrupt the left-column text.');
      await page.keyboard.press('Control+c');
      expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('RIGHT COLUMN: This independent paragraph belongs to the second column of the page. It must not interrupt the left-column text.');
      await expect(page.locator('.textLayer.selecting')).toHaveCount(0);
    }
    await page.getByRole('button', { name: '适合宽度', exact: true }).click();
    await waitText();
  });

  test('mouse selection and Ctrl+C stay inside the left column', async () => {
    await pickText('LEFT COLUMN:', 'preserves the sentence');
    const preview = page.getByTestId('selection-preview');
    await expect(preview).toContainText('LEFT COLUMN: We propose a novel frame-work for representation learning. The method preserves the sentence across line breaks.');
    await expect(preview).not.toContainText('RIGHT COLUMN');
    await page.keyboard.press('Control+c');
    const clipboard = await app.evaluate(({ clipboard }) => clipboard.readText());
    expect(clipboard).toBe('LEFT COLUMN: We propose a novel frame-work for representation learning. The method preserves the sentence across line breaks.');
    await page.screenshot({ path: 'test-results/screenshots/selection.png' });
    await page.keyboard.press('Control+Shift+c');
    const raw = await app.evaluate(({ clipboard }) => clipboard.readText());
    expect(raw).toContain('frame-\nwork');
    expect(raw).not.toContain('RIGHT COLUMN');
  });

  test('reverse drag stays in the right column and optional dehyphenation is explicit', async () => {
    await page.keyboard.press('Escape');
    await pickText('RIGHT COLUMN:', 'It must not interrupt', true);
    await expect(page.getByTestId('selection-preview')).toContainText('RIGHT COLUMN:');
    await expect(page.getByTestId('selection-preview')).not.toContainText('LEFT COLUMN:');
    await page.keyboard.press('Escape');
    await pickText('LEFT COLUMN:', 'preserves the sentence');
    await page.locator('.copy-options summary').click();
    await page.getByRole('checkbox', { name: '删除行末断词连字符' }).check();
    await expect(page.getByTestId('selection-preview')).toContainText('framework');
    await page.getByRole('checkbox', { name: '删除行末断词连字符' }).uncheck();
    await expect(page.getByTestId('selection-preview')).toContainText('frame-work');
  });

  test('copies only selected characters and can attach the source', async () => {
    await page.evaluate(() => {
      const span = Array.from(document.querySelectorAll('[data-page-number="1"] .textLayer span')).find(element => element.textContent?.startsWith('LEFT COLUMN:'))!;
      const text = span.firstChild!;
      const range = document.createRange();
      const start = text.textContent!.indexOf('We propose');
      range.setStart(text, start); range.setEnd(text, start + 'We propose a novel'.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges(); selection.addRange(range);
    });
    await expect(page.getByTestId('selection-preview')).toHaveText('We propose a novel');
    await page.getByRole('button', { name: '带出处复制' }).click();
    const clipboard = await app.evaluate(({ clipboard }) => clipboard.readText());
    expect(clipboard).toBe('We propose a novel\n\n— reading-demo.pdf，第 1 页');
  });

  test('resizes, collapses and restores the panel, and selects accurately after zooming', async () => {
    const panel = page.getByRole('complementary');
    const initial = (await panel.boundingBox())!.width;
    const separator = page.getByRole('separator', { name: '调整右侧面板宽度' });
    const box = (await separator.boundingBox())!;
    await page.mouse.move(box.x + 2, box.y + 200);
    await page.mouse.down(); await page.mouse.move(box.x - 80, box.y + 200, { steps: 8 }); await page.mouse.up();
    await expect.poll(async () => (await panel.boundingBox())!.width).toBeGreaterThan(initial + 60);
    await separator.focus(); await page.keyboard.press('ArrowRight');
    await page.getByRole('button', { name: '切换右侧面板' }).click();
    await expect(panel).toHaveCount(0);
    await page.getByRole('button', { name: '切换右侧面板' }).click();
    await expect(panel).toBeVisible();
    await page.getByRole('combobox', { name: '缩放比例' }).selectOption('0.75');
    await expect(page.locator('[data-page-number="1"]')).toHaveAttribute('data-text-scale', '0.75');
    await waitText();
    await page.locator('.reader').evaluate(element => { element.scrollTop = 0; });
    await pickText('LEFT COLUMN:', 'preserves the sentence');
    await expect(page.getByTestId('selection-preview')).not.toContainText('RIGHT COLUMN');
    await expect(page.getByTestId('selection-preview')).toContainText('preserves the sentence');
    await page.getByRole('button', { name: '适合宽度', exact: true }).click();
    await waitText();
  });

  test('scrolls continuously, jumps pages, and retains text on offscreen pages', async () => {
    await page.getByRole('textbox', { name: '页码', exact: true }).fill('3');
    await page.getByRole('textbox', { name: '页码', exact: true }).press('Enter');
    await waitText(3);
    await expect(page.getByRole('textbox', { name: '页码', exact: true })).toHaveValue('3');
    await page.getByRole('button', { name: '上一页', exact: true }).click();
    await waitText(2);
    await expect(page.getByRole('textbox', { name: '页码', exact: true })).toHaveValue('2');
    await page.screenshot({ path: 'test-results/screenshots/page-two.png' });
    expect(await page.locator('[data-page-number="1"] .textLayer span').count()).toBeGreaterThan(40);
  });

  test('reports invalid files without losing the current document', async () => {
    const invalid = path.join(root, 'tmp/invalid.pdf');
    await writeFile(invalid, 'not a pdf');
    await app.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }); }, invalid);
    await page.getByRole('button', { name: '打开 PDF', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('不是有效的 PDF');
    await expect(page.locator('.pdf-page')).toHaveCount(3);
    expect(errors).toEqual([]);
  });

  test('fits both panels at the minimum desktop size and restores the reading page', async () => {
    await page.getByRole('button', { name: '关闭错误提示' }).click();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 720));
    await page.getByRole('button', { name: '切换页码导航' }).click();
    await expect(page.getByRole('navigation', { name: '页码导航' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const oldDocument = await page.locator('.pages').getAttribute('data-document-id');
    await app.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }); }, fixture);
    await page.getByRole('button', { name: '打开 PDF', exact: true }).click();
    await expect(page.locator('.pages')).not.toHaveAttribute('data-document-id', oldDocument!);
    await expect(page.locator('.loading-overlay')).toHaveCount(0);
    await waitText(2);
    await expect(page.getByRole('textbox', { name: '页码', exact: true })).toHaveValue('2');
    await page.screenshot({ path: 'test-results/screenshots/compact.png' });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 940));
    await page.getByRole('button', { name: '切换页码导航' }).click();
  });

  test('selects and copies an actual two-column academic paper', async () => {
    const realPaper = path.join(root, 'tests/fixtures/references/tracemonkey.pdf');
    test.skip(!existsSync(realPaper), 'Optional Mozilla PDF.js paper fixture has not been downloaded.');
    await app.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }); }, realPaper);
    await page.getByRole('button', { name: '打开 PDF', exact: true }).click();
    await expect(page.locator('.pdf-page')).toHaveCount(14);
    await page.getByRole('combobox', { name: '缩放比例' }).selectOption('1');
    await waitText();
    await expect(page.locator('.page-caption').first()).toContainText('双栏阅读顺序');
    await pickText('Dynamic languages such as JavaScript', 'is available, traditional compilers');
    await expect(page.getByTestId('selection-preview')).toHaveText('Dynamic languages such as JavaScript are more difficult to com-pile than statically typed ones. Since no concrete type information is available, traditional compilers need to emit generic code that can');
    await page.keyboard.press('Control+c');
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).not.toContain('Google');
    await page.screenshot({ path: 'test-results/screenshots/real-paper.png' });
    expect(errors).toEqual([]);
  });
});
