import { _electron as electron, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { electronExecutable } from './electron-runtime.mjs';

const output = path.resolve('designs/aurelia-redesign/verification');
const iteration = process.argv[2] || 'final';
await mkdir(output, { recursive: true });
const profile = path.resolve(`tmp/design-profile-${Date.now()}`);
const env = { ...process.env, PAPERDESK_TEST_DIR: profile };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: electronExecutable(), args: [path.resolve('dist-electron/main.js'), '--force-device-scale-factor=1'], env });
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1559, 1009));
  await page.getByRole('heading', { name: '打开论文' }).waitFor();
  await page.evaluate(() => localStorage.setItem('paperdesk:panelWidth', '450'));
  await page.reload();
  await page.getByRole('heading', { name: '打开论文' }).waitFor();
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, path.resolve('tests/fixtures/references/tracemonkey.pdf'));
  await page.getByRole('button', { name: '打开 PDF', exact: true }).click();
  await expect(page.locator('[data-page-number="1"]')).toHaveAttribute('data-text-ready', 'true');
  await expect(page.locator('[data-page-number="1"] canvas')).toBeVisible();
  const start = page.locator('[data-page-number="1"] .textLayer span').filter({ hasText: 'Dynamic languages such as JavaScript' }).first();
  const end = page.locator('[data-page-number="1"] .textLayer span').filter({ hasText: 'is available, traditional compilers' }).first();
  await start.scrollIntoViewIfNeeded();
  // Deterministic visual state; mouse dragging and copying are covered by E2E.
  await page.evaluate(() => {
    const spans = Array.from(document.querySelectorAll('[data-page-number="1"] .textLayer span'));
    const first = spans.find(el => el.textContent.includes('Dynamic languages such as JavaScript'));
    const last = spans.find(el => el.textContent.includes('is available, traditional compilers'));
    const range = document.createRange();
    range.setStart(first.firstChild, 0);
    range.setEnd(last.firstChild, last.firstChild.textContent.length);
    const selection = window.getSelection();
    selection.removeAllRanges(); selection.addRange(range);
  });
  await expect(page.getByTestId('selection-preview')).toContainText('Dynamic languages');
  // Dismiss the floating tools by scrolling, keeping the native PDF highlight.
  await page.locator('.reader').evaluate(el => { el.scrollTop += 2; });
  await expect(page.getByRole('toolbar', { name: '选区操作' })).toHaveCount(0);
  await page.screenshot({ path: path.join(output, `${iteration}-selection.png`), scale: 'css', animations: 'disabled' });
  await page.locator('.inspector').screenshot({ path: path.join(output, `${iteration}-inspector.png`), scale: 'css' });
  await page.locator('.workspace-toolbar').screenshot({ path: path.join(output, `${iteration}-toolbar.png`), scale: 'css' });
  const metrics = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio, panelWidth: document.querySelector('.inspector').getBoundingClientRect().width }));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(960, 640));
  await page.getByRole('separator', { name: '调整右侧面板宽度' }).focus();
  for (let i = 0; i < 9; i++) await page.keyboard.press('ArrowRight');
  await page.getByRole('button', { name: '切换页码导航' }).click();
  await page.locator('.copy-options summary').click();
  await page.screenshot({ path: path.join(output, `${iteration}-compact.png`), scale: 'css', animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('button', { name: '引用到对话', exact: true })).toBeInViewport();
  await page.getByRole('tab', { name: '对话', exact: true }).click();
  await page.screenshot({ path: path.join(output, `${iteration}-chat-compact.png`), scale: 'css', animations: 'disabled' });
  expect(errors).toEqual([]);
  await writeFile(path.join(output, `${iteration}-metrics.json`), JSON.stringify({ ...metrics, errors }, null, 2));
  console.log(JSON.stringify({ output, iteration, ...metrics, errors }));
} finally { await app.close(); }
