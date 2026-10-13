import { _electron as electron, expect } from '@playwright/test';
import { readFile, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const install = JSON.parse((await readFile('.aurelia-install.local.json', 'utf8')).replace(/^\uFEFF/, ''));
const expectedVersion = JSON.parse(await readFile('package.json', 'utf8')).version;
const evidence = name => `release/verification/${name}-${expectedVersion}`;
const profile = path.resolve(`tmp/packaged-smoke-${Date.now()}`);
await mkdir(profile, { recursive: true });
const firstPaper = path.join(profile, 'papers', 'first', 'reading-demo.pdf');
const secondPaper = path.join(profile, 'papers', 'second', 'reading-demo.pdf');
const navigationPaper = path.join(profile, 'papers', 'navigation.pdf');
for (const file of [firstPaper, secondPaper]) {
  await mkdir(path.dirname(file), { recursive: true });
  await copyFile(path.resolve('public/examples/reading-demo.pdf'), file);
}
await copyFile(path.resolve('tests/fixtures/navigation.pdf'), navigationPaper);
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
delete environment.PAPERDESK_DEV_URL;
const launch = () => electron.launch({
  executablePath: install.executablePath,
  // Match the desktop E2E harness: coordinate-driven mouse drags need a fixed
  // scale on Windows. Native high-DPI rendering is covered by zoom.spec.ts.
  args: [`--user-data-dir=${profile}`, '--force-device-scale-factor=1'],
  env: environment,
  timeout: 30_000,
});
let app = await launch();
const errors = [];
try {
  let page = await app.firstWindow();
  const runtime = await app.evaluate(({ app }) => ({ name: app.getName(), version: app.getVersion(), packaged: app.isPackaged, appPath: app.getAppPath(), userData: app.getPath('userData') }));
  assert.equal(runtime.name, 'Aurelia');
  assert.equal(runtime.version, expectedVersion);
  assert.equal(install.version, expectedVersion);
  assert.equal(runtime.packaged, true);
  assert.ok(runtime.appPath.endsWith('app.asar'));
  assert.equal(path.resolve(runtime.userData).toLowerCase(), profile.toLowerCase());
  assert.ok(page.url().startsWith('file:///'));
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('heading', { name: '打开论文' }).waitFor();
  assert.equal(await page.title(), 'Aurelia');
  assert.equal(await page.locator('.brand > span').first().textContent(), 'Aurelia');
  assert.equal(await page.locator('.brand-icon').evaluate(img => img.complete && img.naturalWidth > 0), true);
  // Use the actual library controls and native-picker import path. Two copies
  // share notes by content but must keep separate paths and reading positions.
  await page.getByRole('button', { name: '新建分组', exact: true }).click({ timeout: 10_000 });
  await page.getByRole('textbox', { name: '分组名称' }).fill('Packaged reading');
  await page.getByRole('button', { name: '保存分组' }).click();
  await app.evaluate(({ dialog }, files) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files });
  }, [firstPaper, secondPaper]);
  await page.getByRole('button', { name: '导入论文', exact: true }).click();
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
  await copyFile(notesFile, evidence('notes-export-example') + '.md');
  await page.screenshot({ path: evidence('packaged-reader') + '.png' });
  const entries = await page.evaluate(() => window.paperdesk.getLibrary());
  assert.equal(entries.entries.length, 2);
  assert.equal(entries.groups[0].name, 'Packaged reading');
  assert.ok(entries.entries.every(entry => entry.groupId === entries.groups[0].id));
  const firstId = entries.entries.find(entry => entry.path === firstPaper).id;
  const secondId = entries.entries.find(entry => entry.path === secondPaper).id;
  const setPage = async number => {
    const input = page.getByRole('textbox', { name: '页码', exact: true });
    await input.fill(String(number)); await input.press('Enter');
    await expect(input).toHaveValue(String(number));
  };
  await setPage(3);
  await page.getByRole('combobox', { name: '缩放比例' }).selectOption('1.25');
  await page.getByRole('button', { name: '打开论文 ' + secondPaper, exact: true }).click();
  await expect(page.locator('.workspace-reader-host')).toHaveAttribute('data-reader-id', secondId);
  await page.locator('[data-page-number="1"][data-text-ready="true"] canvas').waitFor();
  await expect(page.getByRole('textbox', { name: '页码', exact: true })).toHaveValue('1');
  await setPage(2);
  await page.getByRole('combobox', { name: '缩放比例' }).selectOption('1');
  await page.getByRole('button', { name: '标签模式', exact: true }).click();
  const tabs = page.getByRole('tablist', { name: '打开的论文' });
  await expect(tabs.getByRole('tab')).toHaveCount(2);
  await tabs.getByRole('tab', { name: '打开论文 ' + firstPaper, exact: true }).click();
  await expect(page.locator('.workspace-reader-host')).toHaveAttribute('data-reader-id', firstId);
  await expect(page.getByRole('textbox', { name: '页码', exact: true })).toHaveValue('3');
  await expect(page.getByRole('combobox', { name: '缩放比例' })).toHaveValue('1.25');
  await page.screenshot({ path: evidence('packaged-workspace') + '.png' });
  // Native close flushes the latest workspace and session. Relaunch the exact
  // installed binary against the same disposable profile to prove persistence.
  await app.close(); app = await launch(); page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.workspace-reader-host')).toHaveAttribute('data-reader-id', firstId);
  await expect(page.getByRole('textbox', { name: '页码', exact: true })).toHaveValue('3');
  await expect(page.getByRole('combobox', { name: '缩放比例' })).toHaveValue('1.25');
  await expect(page.getByRole('tablist', { name: '打开的论文' }).getByRole('tab')).toHaveCount(2);
  const restored = await page.evaluate(() => window.paperdesk.getLibrary());
  assert.equal(restored.mode, 'tabs');
  assert.equal(restored.activeId, firstId);
  assert.deepEqual(restored.openIds, [firstId, secondId]);
  assert.equal(restored.groups[0].name, 'Packaged reading');
  await page.getByRole('tab', { name: '打开论文 ' + secondPaper, exact: true }).click();
  await expect(page.locator('.workspace-reader-host')).toHaveAttribute('data-reader-id', secondId);
  await expect(page.getByRole('textbox', { name: '页码', exact: true })).toHaveValue('2');
  await expect(page.getByRole('combobox', { name: '缩放比例' })).toHaveValue('1');
  await page.screenshot({ path: evidence('packaged-restored-workspace') + '.png' });
  for (const file of [firstPaper, secondPaper]) assert.deepEqual(await readFile(file), await readFile('public/examples/reading-demo.pdf'));

  // Exercise native PDF metadata through the installed reader after retaining
  // the original copy/search/export/library/restart checks above.
  await page.getByRole('button', { name: '论文库', exact: true }).click();
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, navigationPaper);
  await page.getByRole('button', { name: '导入论文', exact: true }).click();
  await expect(page.locator('.document-label')).toHaveText('navigation.pdf');
  await page.locator('[data-page-number="1"][data-text-ready="true"] canvas').waitFor();
  await expect(page.locator('[data-page-number="1"] .native-pdf-link')).toHaveCount(9);
  await page.getByRole('button', { name: '切换右侧面板', exact: true }).click();
  const zoom = page.getByRole('combobox', { name: '缩放比例' });
  const currentPage = page.getByRole('textbox', { name: '页码', exact: true });
  const position = () => page.locator('.reader').evaluate(root => ({ top: root.scrollTop, left: root.scrollLeft }));
  const expectPosition = async point => {
    await expect.poll(async () => {
      const actual = await position();
      return Math.max(Math.abs(actual.top - point.top), Math.abs(actual.left - point.left));
    }).toBeLessThan(1);
  };
  await zoom.selectOption('1.25');
  await page.locator('.reader').evaluate(root => { root.scrollTop = 40; root.scrollLeft = 0; });
  const source = await position();
  const link = await page.locator('[data-page-number="1"] .native-pdf-link').first().boundingBox();
  assert.ok(link);
  await page.mouse.click(link.x + link.width / 2, link.y + link.height / 2);
  await expect(currentPage).toHaveValue('2');
  await expect(zoom).toHaveValue('1.25');
  // Horizontal centering can clamp to the reader edge at this zoom; the native
  // vertical offset must still be exact and Back restores both actual axes.
  await expect.poll(() => page.locator('[data-page-number="2"]').evaluate(element => {
    const paper = element.getBoundingClientRect(), reader = element.closest('.reader').getBoundingClientRect();
    return Math.abs(paper.top + paper.height * .25 - reader.top);
  })).toBeLessThan(1);
  await zoom.selectOption('1');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const destination = await position();
  await page.getByRole('button', { name: '后退', exact: true }).click();
  await expect(zoom).toHaveValue('1.25');
  await expectPosition(source);
  await page.getByRole('button', { name: '前进', exact: true }).click();
  await expect(zoom).toHaveValue('1');
  await expectPosition(destination);
  await page.getByRole('button', { name: '切换页码导航', exact: true }).click();
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Rotated detail', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '折叠 Introduction', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Rotated detail', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '展开 Introduction', exact: true }).click();
  await zoom.selectOption('fit');
  await page.getByRole('button', { name: 'Rotated detail', exact: true }).click();
  await expect(currentPage).toHaveValue('3');
  await expect(zoom).toHaveValue('fit');
  await expect.poll(() => page.locator('[data-page-number="3"]').evaluate(element => {
    const root = element.closest('.reader'), paper = element.getBoundingClientRect(), reader = root.getBoundingClientRect();
    const target = root.scrollTop + paper.top + paper.height * .25 - reader.top;
    // Last-page destinations clamp when fit width leaves too little document
    // below the requested anchor to place it at the viewport's top.
    return Math.abs(root.scrollTop - Math.max(0, Math.min(target, root.scrollHeight - root.clientHeight)));
  })).toBeLessThan(1);
  await page.screenshot({ path: evidence('packaged-outline-1440') + '.png' });
  await page.setViewportSize({ width: 960, height: 720 });
  await expect(page.getByRole('button', { name: '后退', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '前进', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '论文库', exact: true })).toBeVisible();
  await page.screenshot({ path: evidence('packaged-navigation-960') + '.png' });
  assert.deepEqual(await readFile(navigationPaper), await readFile('tests/fixtures/navigation.pdf'));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'passed', name: runtime.name, version: runtime.version, branding: true, packaged: runtime.packaged, appPath: runtime.appPath, localFileLoaded: true, pages: 3, twoColumnCopy: true, fullTextSearch: true, notesExport: true, groupedMultiImport: true, independentViews: true, tabsSwitch: true, restartRestore: true, nativeLinkClick: true, nestedOutlineClick: true, numericZoomPreserved: true, fitPreserved: true, backForwardPositionAndZoom: true, narrowControls: true, sourceBytesPreserved: true, profile, executable: install.executablePath, screenshots: ['packaged-reader', 'packaged-workspace', 'packaged-restored-workspace', 'packaged-outline-1440', 'packaged-navigation-960'].map(name => evidence(name) + '.png') }, null, 2));
} finally {
  await app.close();
}
