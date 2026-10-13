import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd(), profile = path.join(root, 'tmp/pdf-navigation/e2e', String(Date.now()));
const paper = path.join(profile, 'navigation.pdf'), blank = path.join(profile, 'blank.pdf');
const copy = path.join(profile, 'navigation-copy.pdf'), third = path.join(profile, 'navigation-third.pdf');
let app: ElectronApplication, page: Page;
const errors: string[] = [];
async function open(file: string) {
  await app.evaluate(({ dialog }, value) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [value] }); }, file);
  await page.getByRole('button', { name: '打开 PDF', exact: true }).click();
  await expect(page.locator('.document-label')).toHaveText(path.basename(file));
  await expect(page.locator('[data-page-number="1"]')).toHaveAttribute('data-text-ready', 'true');
}
async function position() {
  return page.locator('.reader').evaluate(el => ({ top: el.scrollTop, left: el.scrollLeft }));
}
async function clickNative(index: number) {
  const box = await page.locator(`[data-page-number="1"] .native-pdf-link`).nth(index).boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
}
async function top() {
  await page.locator('.reader').evaluate(el => { el.scrollTop = 40; el.scrollLeft = 0; });
  await expect(page.getByRole('textbox', { name: '页码', exact: true })).toHaveValue('1');
}
async function turn(number: number) {
  await page.getByRole('textbox', { name: '页码', exact: true }).fill(String(number)); await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: '页码', exact: true })).toHaveValue(String(number));
  await expect.poll(() => page.locator('.reader').evaluate(root => {
    const top = root.getBoundingClientRect().top + 24;
    return Number(Array.from(root.querySelectorAll<HTMLElement>('.pdf-page')).find(el => el.getBoundingClientRect().bottom > top)?.dataset.pageNumber);
  })).toBe(number);
}
async function delayWorker(action: string, milliseconds: number) {
  await page.evaluate(({ action, milliseconds }) => {
    const original = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function(message: any, ...args: any[]) {
      if (message?.action === action) {
        Worker.prototype.postMessage = original;
        setTimeout(() => original.call(this, message, ...args as [any]), milliseconds);
      } else original.call(this, message, ...args as [any]);
    };
  }, { action, milliseconds });
}
test.describe.serial('native document navigation', () => {
  test.beforeAll(async () => {
    await mkdir(profile, { recursive: true });
    await copyFile(path.join(root, 'tests/fixtures/navigation.pdf'), paper);
    await copyFile(paper, copy); await copyFile(paper, third);
    const pdf = await PDFDocument.create(); pdf.addPage(); await writeFile(blank, await pdf.save());
    const env = { ...process.env, PAPERDESK_TEST_DIR: profile }; delete env.ELECTRON_RUN_AS_NODE;
    const packaged = process.env.AURELIA_TEST_EXECUTABLE;
    app = await electron.launch({ executablePath: packaged ?? process.env.PAPERDESK_ELECTRON_PATH,
      args: [...(packaged ? [`--user-data-dir=${profile}`] : [path.join(root, 'dist-electron/main.js')]), '--force-device-scale-factor=1'], env });
    page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await page.getByRole('heading', { name: '打开论文' }).waitFor(); await open(paper);
    await page.getByRole('button', { name: '切换右侧面板' }).click();
  });
  test.afterAll(async () => { await app?.close(); });

  test('clicks an offset native destination at current zoom and restores the actual source with Back/Forward', async () => {
    await page.getByRole('combobox', { name: '缩放比例' }).selectOption('1.25');
    await expect(page.locator('[data-page-number="1"] .native-pdf-link')).toHaveCount(9);
    await page.locator('.reader').evaluate(el => { el.scrollTop = 40; });
    const before = await position();
    await clickNative(0);
    await expect(page.getByRole('textbox', { name: '页码', exact: true })).toHaveValue('2');
    await expect(page.getByRole('combobox', { name: '缩放比例' })).toHaveValue('1.25');
    await expect.poll(() => page.locator('[data-page-number="2"]').evaluate(el => {
      const root = el.closest('.reader')!, p = el.getBoundingClientRect(), r = root.getBoundingClientRect();
      return Math.abs(p.top + p.height * .25 - r.top);
    })).toBeLessThan(1);
    const destination = await position();
    await page.getByRole('button', { name: '后退', exact: true }).click();
    await expect.poll(async () => Math.abs((await position()).top - before.top)).toBeLessThan(1);
    await page.getByRole('button', { name: '前进', exact: true }).click();
    await expect.poll(async () => Math.abs((await position()).top - destination.top)).toBeLessThan(1);
    await page.keyboard.press('Alt+ArrowLeft');
    await expect.poll(async () => Math.abs((await position()).top - before.top)).toBeLessThan(1);
  });

  test('shows the nested outline, collapses children and navigates the rotated crop without changing zoom', async () => {
    await page.getByRole('button', { name: '切换页码导航' }).click();
    await page.getByRole('button', { name: '目录', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Rotated detail', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '折叠 Introduction' }).click();
    await expect(page.getByRole('button', { name: 'Rotated detail', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '切换页码导航' }).click();
    await page.getByRole('button', { name: '切换页码导航' }).click();
    await expect(page.getByRole('button', { name: 'Rotated detail', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '展开 Introduction' })).toBeVisible();
    await page.getByRole('button', { name: '展开 Introduction' }).click();
    await page.getByRole('button', { name: 'Rotated detail', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '页码', exact: true })).toHaveValue('3');
    await expect(page.getByRole('combobox', { name: '缩放比例' })).toHaveValue('1.25');
    await expect(page.getByRole('button', { name: '论文库', exact: true })).toBeVisible();
    await page.screenshot({ path: 'tmp/pdf-navigation/task-2-outline-1440.png' });
    await page.getByRole('button', { name: '后退', exact: true }).click();
    await page.getByRole('button', { name: '切换页码导航' }).click();
  });

  test('selects and copies linked text with a real mouse drag without activating the link', async () => {
    const text = page.locator('[data-page-number="1"] .textLayer span').filter({ hasText: /^Reference \[1\]$/ });
    const box = await text.boundingBox(); expect(box).not.toBeNull();
    const before = await position();
    await page.mouse.move(box!.x + 1, box!.y + box!.height / 2); await page.mouse.down();
    await page.mouse.move(box!.x + box!.width - 1, box!.y + box!.height / 2, { steps: 15 }); await page.mouse.up();
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('Reference [1]');
    await page.keyboard.press('Control+c');
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('Reference [1]');
    expect(await position()).toEqual(before);
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
  });

  test('shows a usable empty outline with the page tab available', async () => {
    await open(blank);
    await page.getByRole('button', { name: '切换页码导航' }).click();
    await page.getByRole('button', { name: '目录', exact: true }).click();
    await expect(page.getByText('这篇 PDF 没有目录')).toBeVisible();
    await page.getByRole('button', { name: '页码', exact: true }).click();
    await expect(page.getByRole('button', { name: '第 1 页', exact: true })).toBeVisible();
    expect(errors).toEqual([]);
    await page.getByRole('button', { name: '切换页码导航' }).click();
  });

  test('preserves fit mode, aligns cropped rotated link regions and supports keyboard activation', async () => {
    await open(paper); await top();
    await page.getByRole('combobox', { name: '缩放比例' }).selectOption('fit');
    await page.locator('[data-page-number="1"] .native-pdf-link').nth(1).focus(); await page.keyboard.press('Enter');
    await expect(page.getByRole('textbox', { name: '页码', exact: true })).toHaveValue('3');
    await expect(page.getByRole('combobox', { name: '缩放比例' })).toHaveValue('fit');
    const rect = await page.locator('[data-page-number="3"] .native-pdf-link').evaluate(el => ({
      x: parseFloat((el as HTMLElement).style.left), y: parseFloat((el as HTMLElement).style.top),
      w: parseFloat((el as HTMLElement).style.width), h: parseFloat((el as HTMLElement).style.height) }));
    expect(rect).toEqual({ x: 50, y: 25, w: 10, h: 25 });
    await page.getByRole('button', { name: '后退', exact: true }).click(); await top();
  });

  test('keeps history intact for invalid targets, unsupported actions and passive scrolling/zoom', async () => {
    await clickNative(0); await expect(page.getByRole('textbox', { name: '页码', exact: true })).toHaveValue('2');
    await page.getByRole('button', { name: '后退', exact: true }).click(); await top();
    const before = await position();
    await clickNative(4); await expect(page.locator('.toast')).toContainText('无法跳转');
    expect(await position()).toEqual(before); await expect(page.getByRole('button', { name: '前进', exact: true })).toBeEnabled();
    await clickNative(5); await expect(page.locator('.toast')).toContainText('暂不支持');
    expect(await position()).toEqual(before); await expect(page.getByRole('button', { name: '前进', exact: true })).toBeEnabled();
    await page.getByRole('combobox', { name: '缩放比例' }).selectOption('1');
    await top(); await page.getByRole('button', { name: '前进', exact: true }).click();
    await expect(page.getByRole('combobox', { name: '缩放比例' })).toHaveValue('fit');
    await page.getByRole('button', { name: '后退', exact: true }).click();
    await expect(page.getByRole('combobox', { name: '缩放比例' })).toHaveValue('1'); await top();
    const scrolled = await position();
    // Entering the visible page number is an explicit request to its beginning.
    await page.getByRole('textbox', { name: '页码', exact: true }).fill('1'); await page.keyboard.press('Enter');
    await expect.poll(() => page.locator('[data-page-number="1"]').evaluate(el => Math.abs(el.getBoundingClientRect().top - el.closest('.reader')!.getBoundingClientRect().top - 24))).toBeLessThan(1);
    await page.getByRole('button', { name: '后退', exact: true }).click();
    await expect.poll(async () => Math.abs((await position()).top - scrolled.top)).toBeLessThan(1);
  });

  test('cancels a slow native destination through Back and ignores editable/IME Alt shortcuts', async () => {
    const before = await position(); await delayWorker('GetDestination', 650); await clickNative(0);
    await page.getByRole('button', { name: '后退', exact: true }).click();
    const canceled = await position(); await page.waitForTimeout(750); expect(await position()).toEqual(canceled);
    await turn(2); const jumped = await position();
    const input = page.getByRole('textbox', { name: '页码', exact: true }); await input.focus(); await input.press('Alt+ArrowLeft');
    expect(await position()).toEqual(jumped);
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, isComposing: true })));
    expect(await position()).toEqual(jumped); await input.blur();
    await page.getByRole('button', { name: 'AI 服务设置' }).click(); await page.keyboard.press('Alt+ArrowLeft');
    expect(await position()).toEqual(jumped); await page.getByRole('button', { name: '关闭 AI 设置' }).click();
    await page.getByRole('button', { name: '后退', exact: true }).click();
    await expect.poll(async () => Math.abs((await position()).top - canceled.top)).toBeLessThan(1);
    void before; await top();
  });

  test('records precise search and annotation jumps and prevents a delayed search from overriding Back', async () => {
    const before = await position(); await page.keyboard.press('Control+f');
    await page.getByRole('textbox', { name: '搜索论文全文' }).fill('Native navigation returns');
    await expect(page.getByTestId('search-status')).toHaveText('1 处匹配');
    await page.evaluate(() => {
      const original = window.requestAnimationFrame;
      window.requestAnimationFrame = callback => original(time => { setTimeout(() => callback(time), 350); });
      setTimeout(() => { window.requestAnimationFrame = original; }, 400);
    });
    await page.getByRole('textbox', { name: '搜索论文全文' }).press('Enter');
    await page.getByRole('button', { name: '后退', exact: true }).click();
    const canceled = await position(); await page.waitForTimeout(1200); expect(await position()).toEqual(canceled);
    await page.getByRole('textbox', { name: '搜索论文全文' }).press('Enter');
    await expect(page.locator('.search-highlight.active').first()).toBeInViewport();
    await page.getByRole('button', { name: '后退', exact: true }).click();
    await expect.poll(async () => Math.abs((await position()).top - canceled.top)).toBeLessThan(1);
    await page.getByRole('button', { name: '前进', exact: true }).click();
    await expect(page.locator('.search-highlight.active').first()).toBeInViewport();
    await page.getByRole('textbox', { name: '搜索论文全文' }).press('Escape');
    await page.evaluate(() => {
      const span = Array.from(document.querySelectorAll('[data-page-number="2"] .textLayer [data-line]')).find(el => el.textContent?.includes('Native navigation returns'))!;
      const range = document.createRange(); range.selectNodeContents(span); window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    });
    await page.getByRole('toolbar', { name: '选区操作' }).getByRole('button', { name: '高亮', exact: true }).click();
    await expect(page.locator('.annotation-card')).toHaveCount(1); await turn(1);
    const source = await position(); await page.getByRole('button', { name: '定位原文', exact: true }).click();
    await expect(page.locator('[data-page-number="2"] .annotation-highlight').first()).toBeInViewport();
    await page.getByRole('button', { name: '后退', exact: true }).click();
    await expect.poll(async () => Math.abs((await position()).top - source.top)).toBeLessThan(1);
    await page.getByRole('button', { name: '切换右侧面板' }).click(); await top(); void before;
  });

  test('keeps the current zoom when a newer page jump cancels a history restore waiting for layout', async () => {
    await page.getByRole('combobox', { name: '缩放比例' }).selectOption('2'); await top();
    await page.evaluate(() => {
      const original = window.requestAnimationFrame;
      window.requestAnimationFrame = callback => original(time => { setTimeout(() => callback(time), 350); });
      setTimeout(() => { window.requestAnimationFrame = original; }, 450);
    });
    await page.getByRole('button', { name: '后退', exact: true }).click();
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '页码', exact: true })).toHaveValue('2');
    await expect(page.getByRole('combobox', { name: '缩放比例' })).toHaveValue('2');
    await page.waitForTimeout(1000);
    await expect(page.getByRole('combobox', { name: '缩放比例' })).toHaveValue('2'); await top();
  });

  test('validates real trusted IPC, opens only explicitly clicked HTTP(S) targets and rejects a foreign frame', async () => {
    await app.evaluate(({ shell }) => { (globalThis as any).openedUrls = []; shell.openExternal = async url => { (globalThis as any).openedUrls.push(url); }; });
    await top(); await clickNative(2);
    await expect.poll(() => app.evaluate(() => (globalThis as any).openedUrls)).toEqual(['https://doi.org/10.1234/navigation']);
    const denied = await page.evaluate(async () => {
      const bad = ['file:///C:/x.pdf', 'javascript:alert(1)', 'mailto:test@example.com', 'https://u:p@example.com', 'https://example.com/\n', 'https://example.com/' + 'x'.repeat(8192)];
      return Promise.all(bad.map(async url => { try { await window.paperdesk!.openExternalUrl(url); return false; } catch { return true; } }));
    });
    expect(denied).toEqual([true, true, true, true, true, true]);
    const packaged = process.env.AURELIA_TEST_EXECUTABLE;
    const preload = packaged ? path.join(path.dirname(packaged), 'resources/app.asar/dist-electron/preload.cjs') : path.join(root, 'dist-electron/preload.cjs');
    const foreignDenied = await app.evaluate(async ({ BrowserWindow }, preload) => {
      const main = BrowserWindow.getAllWindows()[0], foreign = new BrowserWindow({ show: false, webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false } });
      try { await foreign.loadURL(main.webContents.getURL()); return await foreign.webContents.executeJavaScript('(async () => { try { await window.paperdesk.openExternalUrl("https://example.com/"); return false; } catch { return true; } })()'); }
      finally { foreign.destroy(); }
    }, preload);
    expect(foreignDenied).toBe(true);
    expect(await app.evaluate(() => (globalThis as any).openedUrls)).toEqual(['https://doi.org/10.1234/navigation']);
  });

  test('retains independent same-content histories across switching and cache eviction, resets close/restart/content change', async () => {
    await top(); await turn(2); await open(copy);
    await expect(page.getByRole('button', { name: '后退', exact: true })).toBeDisabled();
    await page.getByRole('combobox', { name: '缩放比例' }).selectOption('1.25'); await turn(3);
    await open(third); await expect(page.getByRole('button', { name: '后退', exact: true })).toBeDisabled();
    await open(paper); await expect(page.getByRole('button', { name: '后退', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: '后退', exact: true }).click(); await expect(page.getByRole('textbox', { name: '页码', exact: true })).toHaveValue('1');
    await open(copy); await expect(page.getByRole('textbox', { name: '页码', exact: true })).toHaveValue('3');
    await page.getByRole('button', { name: '后退', exact: true }).click(); await expect(page.getByRole('textbox', { name: '页码', exact: true })).toHaveValue('1');
    await page.getByRole('button', { name: '标签模式' }).click();
    await page.getByRole('button', { name: `关闭论文 ${copy}`, exact: true }).click(); await open(copy);
    await expect(page.getByRole('button', { name: '后退', exact: true })).toBeDisabled();
    await turn(2); await app.close();
    const env = { ...process.env, PAPERDESK_TEST_DIR: profile }; delete env.ELECTRON_RUN_AS_NODE;
    const packaged = process.env.AURELIA_TEST_EXECUTABLE;
    app = await electron.launch({ executablePath: packaged ?? process.env.PAPERDESK_ELECTRON_PATH,
      args: [...(packaged ? [`--user-data-dir=${profile}`] : [path.join(root, 'dist-electron/main.js')]), '--force-device-scale-factor=1'], env });
    page = await app.firstWindow(); await expect(page.locator('.document-label')).toHaveText(path.basename(copy));
    await expect(page.getByRole('textbox', { name: '页码', exact: true })).toHaveValue('2');
    await expect(page.getByRole('button', { name: '后退', exact: true })).toBeDisabled();
    await turn(1); await open(third); await copyFile(blank, copy); await open(copy);
    await expect(page.getByRole('button', { name: '后退', exact: true })).toBeDisabled();
    await expect(page.getByRole('textbox', { name: '页码', exact: true })).toHaveValue('1');
  });

  test('keeps controls reachable and both navigation tabs usable at 960px', async () => {
    await open(paper); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(960, 700));
    await page.getByRole('combobox', { name: '缩放比例' }).selectOption('fit');
    await page.getByRole('button', { name: '切换页码导航' }).click();
    for (const name of ['后退', '前进', '打开 PDF', 'AI 服务设置', '切换右侧面板']) {
      const box = await page.getByRole('button', { name, exact: true }).boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(960);
    }
    await expect(page.getByRole('button', { name: '论文库', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '页码', exact: true }).click(); await page.getByRole('button', { name: '第 2 页', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '页码', exact: true })).toHaveValue('2');
    await page.screenshot({ path: 'tmp/pdf-navigation/task-2-navigation-960.png' });
    expect(errors).toEqual([]);
  });
});
