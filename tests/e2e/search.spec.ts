import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd(), profile = path.join(root, 'tmp/search-e2e', String(Date.now()));
const paper = path.join(profile, 'search.pdf'), other = path.join(profile, 'other.pdf');
let app: ElectronApplication, page: Page;
const errors: string[] = [];
async function open(file: string) {
  await app.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }); }, file);
  await page.getByRole('button', { name: '打开 PDF', exact: true }).click();
  // Wait for React to display the requested document, not the previous page's
  // text-ready flag while the async file dialog is still completing.
  await expect(page.locator('.document-label')).toHaveText(path.basename(file));
  await expect(page.locator('.loading-overlay')).toHaveCount(0);
  await expect(page.locator('[data-page-number="1"]')).toHaveAttribute('data-text-ready', 'true');
}
async function query(text: string) {
  await page.keyboard.press('Control+f');
  await page.getByRole('textbox', { name: '搜索论文全文' }).fill(text);
  await expect(page.getByTestId('search-status')).not.toContainText('正在');
}

test.describe.serial('full-document search', () => {
  test.beforeAll(async () => {
    await mkdir(profile, { recursive: true });
    const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.TimesRoman);
    for (let p = 1; p <= 8; p++) {
      const sheet = pdf.addPage([612, 792]);
      sheet.drawText(`Page ${p}`, { x: 40, y: 750, size: 14, font });
      sheet.drawText('A Neural', { x: 40, y: 680, size: 12, font });
      sheet.drawText('network supports reading.', { x: 40, y: 664, size: 12, font });
      sheet.drawText('frame-', { x: 40, y: 610, size: 12, font });
      sheet.drawText('work', { x: 40, y: 594, size: 12, font });
      if (p === 8) sheet.drawText('LastPageNeedle', { x: 40, y: 410, size: 12, font });
    }
    await writeFile(paper, await pdf.save());
    const second = await PDFDocument.create(); second.addPage(); await writeFile(other, await second.save());
    const env = { ...process.env, PAPERDESK_TEST_DIR: profile }; delete env.ELECTRON_RUN_AS_NODE;
    const packaged = process.env.AURELIA_TEST_EXECUTABLE;
    app = await electron.launch({ executablePath: packaged ?? process.env.PAPERDESK_ELECTRON_PATH,
      args: [...(packaged ? [`--user-data-dir=${profile}`] : [path.join(root, 'dist-electron/main.js')]), '--force-device-scale-factor=1'], env });
    page = await app.firstWindow(); page.on('pageerror', e => errors.push(e.message));
    await page.getByRole('heading', { name: '打开论文' }).waitFor();
    await open(paper);
  });
  test.afterAll(async () => { await app?.close(); });

  test('searches an unvisited last page and locates the precise characters without stealing the selection', async () => {
    await expect(page.locator('[data-page-number="8"]')).toHaveAttribute('data-text-ready', 'false');
    const before = await page.locator('.reader').evaluate(el => el.scrollTop);
    await query('LastPageNeedle');
    await expect(page.getByTestId('search-status')).toHaveText('1 处匹配');
    expect(await page.locator('.reader').evaluate(el => el.scrollTop)).toBe(before);
    await page.getByRole('textbox', { name: '搜索论文全文' }).press('Enter');
    await expect(page.locator('[data-page-number="8"] .search-highlight.active').first()).toBeInViewport();
    await expect(page.getByTestId('search-status')).toHaveText('1 / 1');
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
    await expect(page.getByRole('toolbar', { name: '选区操作' })).toHaveCount(0);
    await page.getByRole('textbox', { name: '搜索论文全文' }).press('Enter');
    await expect(page.getByTestId('search-notice')).toContainText('开头');
  });

  test('handles phrases, case options, line-end hyphens, reverse navigation and IME', async () => {
    await query('neural network');
    await expect(page.getByTestId('search-status')).toHaveText('8 处匹配');
    await page.getByRole('checkbox', { name: '区分大小写' }).check();
    await expect(page.getByTestId('search-status')).toHaveText('未找到匹配');
    await page.getByRole('checkbox', { name: '区分大小写' }).uncheck();
    await expect(page.getByTestId('search-status')).toHaveText('8 处匹配');
    await page.getByRole('textbox', { name: '搜索论文全文' }).press('Enter');
    await expect(page.getByTestId('search-status')).toHaveText('8 / 8');
    await page.getByRole('textbox', { name: '搜索论文全文' }).press('Shift+Enter');
    await expect(page.getByTestId('search-status')).toHaveText('7 / 8');
    await query('framework');
    await expect(page.getByTestId('search-status')).toHaveText('未找到匹配');
    await page.getByRole('checkbox', { name: '忽略行末连字符' }).check();
    await expect(page.getByTestId('search-status')).toHaveText('8 处匹配');
    const input = page.getByRole('textbox', { name: '搜索论文全文' });
    await input.evaluate(el => {
      el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true }));
    });
    await expect(page.getByTestId('search-status')).not.toHaveText(/\d+ \/ 8/);
    await input.evaluate(el => el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
  });

  test('keeps highlights aligned through zoom, preserves text nodes, copying and annotations', async () => {
    await query('Neural');
    await expect(page.getByTestId('search-status')).toHaveText('8 处匹配');
    await page.getByRole('textbox', { name: '搜索论文全文' }).press('Enter');
    await expect(page.locator('.search-highlight.active').first()).toBeInViewport();
    const currentPage = Number(await page.getByRole('textbox', { name: '页码', exact: true }).inputValue());
    for (const scale of ['1', '1.5', '0.75']) {
      await page.getByRole('combobox', { name: '缩放比例' }).selectOption(scale);
      await expect(page.locator(`[data-page-number="${currentPage}"]`)).toHaveAttribute('data-text-scale', scale);
      await expect.poll(async () => page.evaluate(number => {
        const sheet = document.querySelector(`[data-page-number="${number}"]`)!;
        const text = Array.from(sheet.querySelectorAll('.textLayer [data-line]')).find(el => el.textContent === 'A Neural')!;
        if (text.childNodes.length !== 1) return 100;
        const range = document.createRange(); range.setStart(text.firstChild!, 2); range.setEnd(text.firstChild!, 8);
        const expected = range.getBoundingClientRect(), actual = sheet.querySelector('.search-highlight.active')?.getBoundingClientRect();
        return actual ? Math.max(Math.abs(expected.left - actual.left), Math.abs(expected.right - actual.right), Math.abs(expected.top - actual.top)) : 100;
      }, currentPage)).toBeLessThan(1);
    }
    await page.evaluate(number => {
      const span = Array.from(document.querySelectorAll(`[data-page-number="${number}"] .textLayer [data-line]`)).find(el => el.textContent === 'A Neural')!;
      const range = document.createRange(); range.setStart(span.firstChild!, 2); range.setEnd(span.firstChild!, 8);
      window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    }, currentPage);
    await expect(page.getByRole('toolbar', { name: '选区操作' })).toBeVisible();
    await page.keyboard.press('Control+c');
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('Neural');
    await page.getByRole('toolbar', { name: '选区操作' }).getByRole('button', { name: '高亮', exact: true }).click();
    await expect(page.locator('.annotation-card')).toHaveCount(1);
    await page.screenshot({ path: 'test-results/search-with-annotation.png' });
  });

  test('closes cleanly, remembers the query only in the same document and resets when switching', async () => {
    await page.keyboard.press('Control+f');
    const input = page.getByRole('textbox', { name: '搜索论文全文' });
    await input.press('Escape');
    await expect(input).toHaveCount(0);
    await expect(page.locator('.search-highlight')).toHaveCount(0);
    await page.keyboard.press('Control+f');
    await expect(input).toHaveValue('Neural');
    await input.fill('LastPageNeedle');
    await open(other);
    await expect(input).toHaveCount(0);
    await page.keyboard.press('Control+f');
    await expect(input).toHaveValue('');
    await input.fill('LastPageNeedle');
    await expect(page.getByTestId('search-status')).toContainText('没有可搜索文本');
    await expect(page.locator('.search-highlight')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('fits the minimum window with both panels and preserves the reading position on close', async () => {
    await open(paper);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(960, 700));
    await page.getByRole('button', { name: '切换页码导航' }).click();
    await query('LastPageNeedle');
    await expect(page.getByTestId('search-status')).toHaveText('1 处匹配');
    await page.getByRole('textbox', { name: '搜索论文全文' }).press('Enter');
    await expect(page.locator('.search-highlight.active').first()).toBeInViewport();
    const fit = await page.getByRole('search', { name: '论文全文搜索' }).evaluate(el => {
      const bounds = el.getBoundingClientRect();
      return Array.from(el.querySelectorAll('input, button')).every(control => {
        const rect = control.getBoundingClientRect(); return rect.left >= bounds.left && rect.right <= bounds.right && rect.width > 0;
      });
    });
    expect(fit).toBe(true);
    const position = await page.locator('.reader').evaluate(el => el.scrollTop);
    await page.getByRole('textbox', { name: '搜索论文全文' }).press('Escape');
    const after = await page.locator('.reader').evaluate(el => ({ top: el.scrollTop, maximum: el.scrollHeight - el.clientHeight }));
    // Closing the bar increases the viewport; at the document bottom the browser
    // must clamp scrollTop to the new maximum instead of preserving an invalid offset.
    expect(after.top).toBe(Math.min(position, after.maximum));
    await page.keyboard.press('Control+f');
    await expect(page.getByRole('textbox', { name: '搜索论文全文' })).toHaveValue('LastPageNeedle');
    await page.getByRole('button', { name: 'AI 服务设置' }).click();
    await page.keyboard.press('Control+f');
    expect(await page.getByRole('textbox', { name: '搜索论文全文' }).evaluate(el => el === document.activeElement)).toBe(false);
    expect(errors).toEqual([]);
  });
});
