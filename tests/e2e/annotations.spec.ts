import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import { createServer, type Server } from 'node:http';
import path from 'node:path';

const root = process.cwd(), profile = path.join(root, 'tmp/annotations-e2e', String(Date.now()));
const paper = path.join(profile, 'paper.pdf'), other = path.join(profile, 'other.pdf'), renamed = path.join(profile, 'renamed.pdf');
const rotatedPaper = path.join(profile, 'rotated.pdf');
let app: ElectronApplication, page: Page, server: Server;
const errors: string[] = [];
async function launch() {
  const env = { ...process.env, PAPERDESK_TEST_DIR: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const packaged = process.env.AURELIA_TEST_EXECUTABLE;
  app = await electron.launch({ executablePath: packaged ?? process.env.PAPERDESK_ELECTRON_PATH,
    args: packaged ? [`--user-data-dir=${profile}`, '--force-device-scale-factor=1'] : [path.join(root, 'dist-electron/main.js'), '--force-device-scale-factor=1'], env });
  page = await app.firstWindow(); page.on('pageerror', e => errors.push(e.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1586, 992));
  await page.locator('[data-workspace-ready="true"]').waitFor();
}
async function open(file = paper) {
  await app.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }); }, file);
  await page.getByRole('button', { name: '打开 PDF', exact: true }).click();
  await expect(page.locator('.loading-overlay')).toHaveCount(0);
  await expect(page.locator('[data-page-number="1"]')).toHaveAttribute('data-text-ready', 'true');
  await page.getByRole('tab', { name: '批注', exact: true }).click();
  await expect(page.locator('.annotation-save-state')).toHaveText('已保存到本机');
}
async function select(start: string, end = start, startPage = 1, endPage = startPage) {
  await page.evaluate(({ start, end, startPage, endPage }) => {
    const find = (number: number, text: string) => Array.from(document.querySelectorAll(`[data-page-number="${number}"] .textLayer [data-line]`)).find(e => e.textContent?.includes(text))!;
    const a = find(startPage, start), b = find(endPage, end);
    const range = document.createRange(); range.setStart(a.firstChild!, 0); range.setEnd(b.firstChild!, b.textContent!.length);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
  }, { start, end, startPage, endPage });
  await expect(page.getByRole('toolbar', { name: '选区操作' })).toBeVisible();
}
const toolbar = () => page.getByRole('toolbar', { name: '选区操作' });
const cards = () => page.locator('.annotation-card');

test.describe.serial('paper highlights and notes', () => {
  test.beforeAll(async () => {
    await mkdir(profile, { recursive: true });
    const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.TimesRoman), bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
    for (let number = 1; number <= 3; number++) {
      const p = pdf.addPage([612, 792]);
      p.drawText('3   Method', { x: 38, y: 690, size: 17, font: bold });
      const left = ['The model adapts its capacity to different', 'resource budgets. Rather than relying on a single,', 'monolithic configuration, we design a unified', 'representation that can be specialized for tasks.',
        'This allows the compiler to generate efficient code', 'while maintaining a consistent model. Our approach', 'combines static analysis with profile-guided', 'optimization, enabling the compiler to identify hot', 'traces and apply aggressive optimizations selectively.'];
      const right = ['Type stability is crucial for effective specialization.', 'We use a combination of abstract interpretation', 'and dynamic feedback to infer precise types for each', 'trace. When multiple types appear at a particular', 'program point, the system decides whether to create', 'a specialized version or fall back to a general one.',
        'This balances compilation time and generated code.', 'The same model supports multiple operating points.', 'At runtime a lightweight dispatcher selects the', 'most appropriate version for the resource budget.'];
      for (let repeat = 0; repeat < 3; repeat++) {
        left.forEach((text, i) => p.drawText(text, { x: 38, y: 650 - (i + repeat * 11) * 14, size: 11, font }));
        right.forEach((text, i) => p.drawText(text, { x: 320, y: 734 - (i + repeat * 12) * 14, size: 11, font }));
      }
      p.drawText(`Page ${number}`, { x: 290, y: 25, size: 10, font });
    }
    await writeFile(paper, await pdf.save()); await copyFile(paper, renamed);
    pdf.getPage(2).setRotation(degrees(90)); await writeFile(rotatedPaper, await pdf.save());
    const second = await PDFDocument.create(); second.addPage().drawText('A different paper'); await writeFile(other, await second.save());
    await launch();
  });
  test.afterAll(async () => { await app?.close(); server?.close(); });

  test('creates a left-column note using mouse selection without API configuration', async () => {
    await open();
    await expect(page.locator('.page-caption').first()).toContainText('双栏阅读顺序');
    const a = await page.locator('.textLayer [data-line]').filter({ hasText: 'The model adapts its capacity' }).first().boundingBox();
    const b = await page.locator('.textLayer [data-line]').filter({ hasText: 'monolithic configuration' }).first().boundingBox();
    await page.mouse.move(a!.x + .5, a!.y + a!.height / 2); await page.mouse.down();
    await page.mouse.move(b!.x + b!.width - .5, b!.y + b!.height / 2, { steps: 12 }); await page.mouse.up();
    await toolbar().getByRole('button', { name: '批注', exact: true }).click();
    await expect(cards()).toHaveCount(1);
    await page.getByRole('textbox', { name: '批注笔记' }).fill('核心思路：通过调整模型容量，适配不同的资源预算。');
    await page.locator('.annotations-heading').click();
    await expect(cards().first()).toContainText('核心思路');
    await expect(cards().first()).not.toContainText('Type stability');
    expect(await page.locator('.annotation-highlight').evaluateAll(els => els.every(el => parseFloat((el as HTMLElement).style.left) < 50))).toBe(true);
    expect(await page.getByRole('tab', { name: '批注', exact: true }).evaluate(el => getComputedStyle(el).fontSize)).toBe('16px');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('keeps character geometry aligned through zoom and panel resizing without blocking copying', async () => {
    for (const scale of ['1', '1.5', '0.75']) {
      await page.getByRole('combobox', { name: '缩放比例' }).selectOption(scale);
      await expect(page.locator('[data-page-number="1"]')).toHaveAttribute('data-text-scale', scale);
      const delta = await page.evaluate(() => {
        const span = Array.from(document.querySelectorAll('[data-page-number="1"] .textLayer [data-line]')).find(e => e.textContent?.includes('The model adapts'))!;
        const range = document.createRange(); range.selectNodeContents(span);
        const expected = range.getBoundingClientRect(), mark = document.querySelector('.annotation-highlight')!.getBoundingClientRect();
        return Math.max(Math.abs(expected.x - mark.x), Math.abs(expected.y - mark.y), Math.abs(expected.width - mark.width), Math.abs(expected.height - mark.height));
      });
      expect(delta).toBeLessThan(2);
    }
    await select('The model adapts');
    await page.keyboard.press('Control+c');
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('The model adapts its capacity to different');
    await page.keyboard.press('Escape');
    await page.getByRole('combobox', { name: '缩放比例' }).selectOption('fit');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(960, 640));
    const handle = page.getByRole('separator', { name: '调整右侧面板宽度' });
    await handle.focus(); for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowRight');
    await expect(handle).toHaveAttribute('aria-valuenow', '280');
    expect(await page.locator('.inspector-tabs').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await expect(page.getByRole('tab', { name: '批注', exact: true })).toBeVisible();
    await page.screenshot({ path: 'test-results/screenshots/annotations-compact.png' });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1586, 992));
    await handle.dblclick();
  });

  test('supports green highlights, editing, delete undo, and locating the exact source', async () => {
    await select('The same model supports');
    await toolbar().getByRole('button', { name: '使用浅绿' }).click();
    await toolbar().getByRole('button', { name: '高亮', exact: true }).click();
    await expect(cards()).toHaveCount(2);
    await expect(page.locator('.annotation-highlight.green')).toHaveCount(1);
    await cards().filter({ hasText: 'The same model' }).getByRole('button', { name: '删除批注' }).click();
    await expect(cards()).toHaveCount(1);
    await page.getByRole('button', { name: '撤销删除' }).click(); await expect(cards()).toHaveCount(2);
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    await cards().filter({ hasText: 'The model adapts' }).getByRole('button', { name: '定位原文', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '页码', exact: true })).toHaveValue('1');
    await expect(page.locator('.annotation-highlight').first()).toBeInViewport();
    await cards().filter({ hasText: 'The model adapts' }).getByRole('button', { name: '编辑', exact: true }).click();
    await page.getByRole('textbox', { name: '批注笔记' }).fill('核心思路：通过调整模型容量，适配不同的资源预算。这里需要和固定容量的方法对比。');
    await page.locator('.annotations-heading').click();
    const handle = page.getByRole('separator', { name: '调整右侧面板宽度' });
    await handle.focus(); for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft');
    await page.getByRole('combobox', { name: '缩放比例' }).selectOption('1.5');
    await page.getByRole('button', { name: '放大', exact: true }).click();
    await page.getByRole('button', { name: '放大', exact: true }).click();
    await page.evaluate(() => { document.querySelector('.reader')!.scrollTop = 0; });
    await expect(page.locator('.toast')).toHaveCount(0);
    await select('The model adapts', 'monolithic configuration');
    await page.screenshot({ path: 'test-results/screenshots/annotations-desktop.png' });
    await page.locator('.inspector').screenshot({ path: 'test-results/screenshots/annotations-inspector.png' });
    await page.keyboard.press('Escape');
  });

  test('restores notes after restart and rename, isolates papers, and retains cross-page and rotated highlights', async () => {
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    await expect(page.locator('[data-page-number="2"]')).toHaveAttribute('data-text-ready', 'true');
    await select('Page 1', 'The model adapts', 1, 2);
    await toolbar().getByRole('button', { name: '高亮', exact: true }).click();
    await expect(cards()).toHaveCount(3);
    await expect(cards().filter({ hasText: '第 1、2 页' })).toHaveCount(1);
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    await expect(page.locator('[data-page-number="3"]')).toHaveAttribute('data-text-ready', 'true');
    await select('Type stability', 'Type stability', 3);
    await toolbar().getByRole('button', { name: '高亮', exact: true }).click();
    await expect(cards()).toHaveCount(4);
    await open(rotatedPaper);
    await page.getByRole('textbox', { name: '页码', exact: true }).fill('3'); await page.keyboard.press('Enter');
    await expect(page.locator('[data-page-number="3"]')).toHaveAttribute('data-text-ready', 'true');
    await select('Type stability', 'Type stability', 3);
    await toolbar().getByRole('button', { name: '高亮', exact: true }).click(); await expect(cards()).toHaveCount(1);
    await open(other); await expect(cards()).toHaveCount(0);
    await open(); await expect(cards()).toHaveCount(4);
    await app.close(); await launch(); await open(renamed); await expect(cards()).toHaveCount(4);
    await expect(cards().filter({ hasText: '这里需要和固定容量的方法对比' })).toHaveCount(1);
    await open(rotatedPaper); await expect(cards()).toHaveCount(1);
    const rotated = page.locator('[data-page-number="3"] .annotation-highlight');
    await cards().filter({ hasText: '第 3 页' }).getByRole('button', { name: '定位原文', exact: true }).click();
    await expect(rotated.first()).toBeInViewport();
    expect(errors).toEqual([]);
  });

  test('saves an AI answer to the selected note without replacing the user note', async () => {
    server = createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content: '容量调整可以适配不同计算预算。' } }] })); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    await page.evaluate(async baseUrl => { await window.paperdesk!.saveAiSettings({ baseUrl, apiKey: 'annotation-test-key', model: 'test', targetLanguage: '简体中文' }); }, `http://127.0.0.1:${port}/v1`);
    await app.close(); await launch(); await open();
    const card = cards().filter({ hasText: '这里需要和固定容量的方法对比' });
    await card.getByRole('button', { name: '定位原文', exact: true }).click();
    await card.getByRole('button', { name: '问 AI', exact: true }).click();
    await page.getByRole('textbox', { name: 'AI 消息', exact: true }).fill('解释这段话');
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
    await page.getByRole('button', { name: '保存到当前批注' }).click();
    await expect(cards().filter({ hasText: '这里需要和固定容量的方法对比' })).toContainText('AI 回答：');
    await expect(cards().filter({ hasText: '这里需要和固定容量的方法对比' })).toContainText('容量调整可以适配不同计算预算');
    expect(errors).toEqual([]);
  });
});
