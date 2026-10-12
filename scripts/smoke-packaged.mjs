import { _electron as electron } from 'playwright';
import { readFile, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const install = JSON.parse((await readFile('.aurelia-install.local.json', 'utf8')).replace(/^\uFEFF/, ''));
const expectedVersion = JSON.parse(await readFile('package.json', 'utf8')).version;
const profile = path.resolve(`tmp/packaged-smoke-${Date.now()}`);
await mkdir(profile, { recursive: true });
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
delete environment.PAPERDESK_DEV_URL;
const app = await electron.launch({
  executablePath: install.executablePath,
  // Match the desktop E2E harness: coordinate-driven mouse drags need a fixed
  // scale on Windows. Native high-DPI rendering is covered by zoom.spec.ts.
  args: [`--user-data-dir=${profile}`, '--force-device-scale-factor=1'],
  env: environment,
  timeout: 30_000,
});
try {
  const page = await app.firstWindow();
  const runtime = await app.evaluate(({ app }) => ({ name: app.getName(), version: app.getVersion(), packaged: app.isPackaged, appPath: app.getAppPath(), userData: app.getPath('userData') }));
  assert.equal(runtime.name, 'Aurelia');
  assert.equal(runtime.version, expectedVersion);
  assert.equal(install.version, expectedVersion);
  assert.equal(runtime.packaged, true);
  assert.ok(runtime.appPath.endsWith('app.asar'));
  assert.equal(path.resolve(runtime.userData).toLowerCase(), profile.toLowerCase());
  assert.ok(page.url().startsWith('file:///'));
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('heading', { name: '打开论文' }).waitFor();
  assert.equal(await page.title(), 'Aurelia');
  assert.equal(await page.locator('.brand > span').first().textContent(), 'Aurelia');
  assert.equal(await page.locator('.brand-icon').evaluate(img => img.complete && img.naturalWidth > 0), true);
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
  }, path.resolve('public/examples/reading-demo.pdf'));
  await page.getByRole('button', { name: '打开 PDF', exact: true }).click();
  await page.locator('[data-page-number="1"][data-text-ready="true"] canvas').waitFor();
  assert.equal(await page.locator('.pdf-page').count(), 3);
  assert.equal(await page.title(), 'reading-demo.pdf — Aurelia');
  assert.ok((await page.locator('[data-page-number="1"] .textLayer').textContent()).includes('AURELIA'));
  const start = await page.locator('[data-page-number="1"] .textLayer span').filter({ hasText: 'LEFT COLUMN:' }).first().boundingBox();
  const end = await page.locator('[data-page-number="1"] .textLayer span').filter({ hasText: 'preserves the sentence' }).first().boundingBox();
  await page.mouse.move(start.x + .5, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width - .5, end.y + end.height / 2, { steps: 12 });
  await page.mouse.up();
  await page.getByTestId('selection-preview').waitFor();
  await page.keyboard.press('Control+c');
  const copied = await app.evaluate(({ clipboard }) => clipboard.readText());
  assert.equal(copied, 'LEFT COLUMN: We propose a novel frame-work for representation learning. The method preserves the sentence across line breaks.');
  await page.keyboard.press('Control+f');
  const search = page.getByRole('textbox', { name: '搜索论文全文' });
  await search.fill('representation learning');
  // Progress also contains “0 处匹配”; wait for a completed, nonempty result
  // before pressing Enter, just as the search E2E tests do.
  await page.getByTestId('search-status').filter({ hasText: /^[1-9]\d* 处匹配$/ }).waitFor();
  await search.press('Enter');
  await page.locator('.search-highlight.active').first().waitFor();
  assert.ok(await page.locator('.search-highlight.active').count() > 0);
  await search.press('Escape');
  await page.evaluate(() => {
    const line = Array.from(document.querySelectorAll('[data-page-number="1"] .textLayer [data-line]')).find(e => e.textContent?.includes('representation learning'));
    const range = document.createRange(); range.selectNodeContents(line);
    window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
  });
  await page.getByRole('toolbar', { name: '选区操作' }).getByRole('button', { name: '批注', exact: true }).click();
  const personalNote = '**My reading note**\n\n- Export keeps this Markdown editable.';
  await page.getByRole('textbox', { name: '批注笔记' }).fill(personalNote);
  const notesFile = path.join(profile, 'reading-notes.md');
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, notesFile);
  await page.getByRole('button', { name: '导出笔记', exact: true }).click();
  await page.getByText('笔记已导出', { exact: true }).waitFor();
  const exported = await readFile(notesFile, 'utf8');
  assert.ok(exported.includes(personalNote));
  assert.ok(exported.includes('第 1 页'));
  assert.ok(exported.includes('representation learning'));
  await mkdir('release/verification', { recursive: true });
  await copyFile(notesFile, 'release/verification/notes-export-example.md');
  await page.screenshot({ path: 'release/verification/packaged-reader.png' });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'passed', name: runtime.name, version: runtime.version, branding: true, packaged: runtime.packaged, localFileLoaded: true, pages: 3, twoColumnCopy: true, fullTextSearch: true, notesExport: true, screenshot: 'release/verification/packaged-reader.png' }, null, 2));
} finally {
  await app.close();
}
