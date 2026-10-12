import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile, copyFile, readdir, rename, unlink } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import path from 'node:path';

const root = process.cwd();
let app: ElectronApplication, page: Page, profile: string;
const demo = path.join(root, 'public/examples/reading-demo.pdf');
const note = '**自己的理解**\n\n- 保留中文和列表\n\n```ts\nconst x = 1;\n```\n\n$$\nx^2\n$$';
const exportButton = () => page.getByRole('button', { name: '导出笔记', exact: true });

async function open(file = demo) {
  await app.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }); }, file);
  await page.getByRole('button', { name: '打开 PDF', exact: true }).click();
  await expect(page.locator('.document-label')).toHaveText(path.basename(file));
  await expect(page.locator('[data-page-number="1"]')).toHaveAttribute('data-text-ready', 'true');
  await page.getByRole('tab', { name: '批注', exact: true }).click();
  await expect(page.locator('.annotation-save-state')).toHaveText('已保存到本机');
}
async function annotate() {
  await page.evaluate(() => {
    const line = Array.from(document.querySelectorAll('[data-page-number="1"] .textLayer [data-line]')).find(e => e.textContent?.includes('representation learning'))!;
    const range = document.createRange(); range.selectNodeContents(line);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
  });
  await page.getByRole('toolbar', { name: '选区操作' }).getByRole('button', { name: '批注', exact: true }).click();
  await page.getByRole('textbox', { name: '批注笔记' }).fill(note);
}
async function saveTo(file: string | null) {
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async (...args: any[]) => {
      (globalThis as any).notesSaveOptions = args.at(-1);
      return { canceled: filePath === null, filePath: filePath ?? undefined };
    };
  }, file);
}

test.beforeEach(async () => {
  profile = path.join(root, 'tmp/notes-export-e2e', `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(profile, { recursive: true });
  const env = { ...process.env, PAPERDESK_TEST_DIR: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const packaged = process.env.AURELIA_TEST_EXECUTABLE;
  app = await electron.launch({ executablePath: packaged ?? process.env.PAPERDESK_ELECTRON_PATH,
    args: packaged ? [`--user-data-dir=${profile}`, '--force-device-scale-factor=1'] : [path.join(root, 'dist-electron/main.js'), '--force-device-scale-factor=1'], env });
  page = await app.firstWindow(); await page.getByRole('heading', { name: '打开论文' }).waitFor();
  await open();
});
test.afterEach(async () => { await app?.close(); });

test('exports the latest personal Markdown note and literal excerpt to a real file', async () => {
  await expect(exportButton()).toBeDisabled({ timeout: 1500 });
  await annotate();
  const file = path.join(profile, 'notes.md'); await saveTo(file);
  await page.getByRole('textbox', { name: '批注笔记' }).fill(note + '\n最后修改');
  // Deliberately click immediately after editing; the button waits for saving.
  await exportButton().click();
  await expect(page.getByRole('status').filter({ hasText: '笔记已导出' })).toBeVisible();
  const content = await readFile(file, 'utf8');
  expect(content).toContain('### 我的笔记\n\n' + note + '\n最后修改');
  expect(content).toContain('> work for representation learning\\. The method');
  expect(content).toContain('第 1 页'); expect(content).not.toContain(profile);
  const options = await app.evaluate(() => (globalThis as any).notesSaveOptions);
  expect(options.defaultPath).toBe('reading-demo-notes.md');
  await page.screenshot({ path: path.join(profile, 'notes-export.png') });
});

test('cancelling creates no output and permits another export', async () => {
  await annotate(); await saveTo(null); await exportButton().click();
  await expect(exportButton()).toBeEnabled();
  expect((await readdir(profile)).filter(name => name.endsWith('.md'))).toEqual([]);
  await expect(page.getByText('笔记已导出', { exact: true })).toHaveCount(0);
  const file = path.join(profile, 'retry.md'); await saveTo(file); await exportButton().click();
  await expect(page.getByText('笔记已导出', { exact: true })).toBeVisible();
  expect(await readFile(file, 'utf8')).toContain(note);
});

test('wrong extension and failed writes preserve data and allow retry', async () => {
  await annotate();
  const original = path.join(profile, 'keep.pdf'); await writeFile(original, 'existing PDF');
  await saveTo(original); await exportButton().click();
  await expect(page.getByRole('alert').filter({ hasText: '请选择 .md 文件' })).toBeVisible();
  expect(await readFile(original, 'utf8')).toBe('existing PDF');
  await saveTo(path.join(profile, 'missing-directory/notes.md')); await exportButton().click();
  await expect(page.getByRole('alert').filter({ hasText: '笔记未能导出' })).toBeVisible();
  const output = path.join(profile, 'good.md'); await saveTo(output); await exportButton().click();
  await expect(page.getByText('笔记已导出', { exact: true })).toBeVisible();
  expect(await readFile(output, 'utf8')).toContain(note);
});

test('renaming a paper exports existing notes under its current filename', async () => {
  await annotate(); await expect(exportButton()).toBeEnabled();
  const renamed = path.join(profile, 'renamed-paper.pdf'); await copyFile(demo, renamed); await open(renamed);
  const output = path.join(profile, 'renamed.md'); await saveTo(output); await exportButton().click();
  await expect(page.getByText('笔记已导出', { exact: true })).toBeVisible();
  const content = await readFile(output, 'utf8');
  expect(content).toContain('# renamed\\-paper · 阅读笔记');
  expect(content).toContain(note); expect(content).not.toContain('reading\\-demo');
});

for (const different of [false, true]) test(`switching to ${different ? 'another paper' : 'a renamed copy'} while the dialog is pending keeps the original snapshot`, async () => {
  await annotate();
  const output = path.join(profile, 'original.md');
  await app.evaluate(({ dialog }) => {
    dialog.showSaveDialog = () => new Promise(resolve => { (globalThis as any).finishNotesDialog = resolve; });
  });
  await exportButton().click();
  await expect(page.getByRole('button', { name: '正在导出…', exact: true })).toBeDisabled();
  const other = path.join(profile, 'other-name.pdf');
  if (different) {
    const pdf = await PDFDocument.create(); pdf.addPage().drawText('A completely different paper'); await writeFile(other, await pdf.save());
  } else await copyFile(demo, other);
  await open(other);
  await app.evaluate((_electron, filePath) => { (globalThis as any).finishNotesDialog({ canceled: false, filePath }); }, output);
  await expect.poll(async () => readFile(output, 'utf8').catch(() => '')).toContain('reading\\-demo');
  await expect(page.getByText('笔记已导出', { exact: true })).toHaveCount(0);
  if (different) await expect(exportButton()).toBeDisabled();
});

test('failed session save blocks stale export until the latest note is saved', async () => {
  await annotate(); await expect(exportButton()).toBeEnabled();
  const directory = path.join(profile, 'reading-sessions'), backup = path.join(profile, 'sessions-backup');
  await rename(directory, backup); await writeFile(directory, 'blocked directory');
  try {
    await page.getByRole('textbox', { name: '批注笔记' }).fill('必须导出最新笔记');
    await expect(page.locator('.annotation-save-state')).toHaveText('保存或恢复失败');
    await expect(exportButton()).toBeDisabled();
  } finally { await unlink(directory); await rename(backup, directory); }
  await page.getByRole('button', { name: '重试', exact: true }).click();
  const output = path.join(profile, 'recovered.md'); await saveTo(output); await exportButton().click();
  await expect(page.getByText('笔记已导出', { exact: true })).toBeVisible();
  expect(await readFile(output, 'utf8')).toContain('必须导出最新笔记');
});
