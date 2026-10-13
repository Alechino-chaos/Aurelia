import { establishChinese } from './language-helper';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { mkdir, writeFile, readFile, copyFile, readdir } from 'node:fs/promises';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import path from 'node:path';

const root = process.cwd();
const profile = path.join(root, 'tmp/session-e2e', String(Date.now()));
const paperA = path.join(profile, 'a/paper.pdf');
const paperB = path.join(profile, 'b/paper.pdf');
const renamed = path.join(profile, 'renamed.pdf');
let app: ElectronApplication, page: Page, server: Server, baseUrl: string;
let slow = false, translationNumber = 0;
const requests: any[] = [];
const errors: string[] = [];
async function launch() {
  const env = { ...process.env, PAPERDESK_TEST_DIR: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  const packaged = process.env.AURELIA_TEST_EXECUTABLE;
  app = await electron.launch({ executablePath: packaged ?? process.env.PAPERDESK_ELECTRON_PATH,
    args: packaged ? [`--user-data-dir=${profile}`] : [path.join(root, 'dist-electron/main.js')], cwd: root, env });
  page = await app.firstWindow(); await establishChinese(page);
  page.on('pageerror', error => errors.push(error.message));
  await page.locator('[data-workspace-ready="true"]').waitFor();
}
async function open(file: string) {
  await app.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }); }, file);
  await page.getByRole('button', { name: '打开 PDF', exact: true }).click();
  await expect(page.locator('.loading-overlay')).toHaveCount(0);
  await expect(page.locator('[data-page-number="1"]')).toHaveAttribute('data-text-ready', 'true');
  // Both fixtures have the same filename; wait for the requested PDF rather
  // than accidentally interacting with the previous paper while IPC reads it.
  await expect(page.locator('[data-page-number="1"] .textLayer')).toContainText(file === paperB ? 'Paper B:' : 'Paper A:');
  await page.getByRole('tab', { name: '对话', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'AI 消息', exact: true })).toBeEnabled();
}
async function send(text: string) {
  await page.getByRole('tab', { name: '对话', exact: true }).click();
  await page.getByRole('textbox', { name: 'AI 消息', exact: true }).fill(text);
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByTestId('ai-answer').last()).toContainText(slow ? '部分回答' : `回答：${text}`);
  if (!slow) await expect(page.getByRole('button', { name: '停止回答' })).toHaveCount(0);
}
async function translate() {
  await page.evaluate(() => {
    const span = document.querySelector('[data-page-number="1"] .textLayer span')!;
    const range = document.createRange(); range.selectNodeContents(span);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
  });
  await page.getByRole('toolbar', { name: '选区操作' }).getByRole('button', { name: '翻译', exact: true }).click();
  await expect(page.getByTestId('translation-result')).toContainText(slow ? '部分译文' : '译文');
  if (!slow) await expect(page.getByRole('button', { name: '停止翻译' })).toHaveCount(0);
}

test.describe.serial('per-paper reading sessions', () => {
  test.beforeAll(async () => {
    for (const [file, name] of [[paperA, 'A'], [paperB, 'B']]) {
      await mkdir(path.dirname(file), { recursive: true });
      const pdf = await PDFDocument.create();
      const font = await pdf.embedFont(StandardFonts.TimesRoman);
      pdf.addPage([612, 792]).drawText(`Paper ${name}: source sentence for persistent translation.`, { x: 48, y: 700, size: 14, font });
      await writeFile(file, await pdf.save());
    }
    await copyFile(paperA, renamed);
    server = createServer((req, res) => {
      let raw = ''; req.on('data', part => { raw += part; });
      req.on('end', () => {
        const body = JSON.parse(raw); requests.push(body);
        const translation = body.messages[0].content.includes('学术翻译');
        const text = slow ? translation ? '部分译文，尚未完成' : '部分回答，尚未完成'
          : translation ? `译文 ${++translationNumber}：论文原文。` : `回答：${body.messages.at(-1).content.split('\n')[0]}`;
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
        const timer = setTimeout(() => res.end('data: [DONE]\n\n'), slow ? 15000 : 80);
        res.on('close', () => clearTimeout(timer));
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
    await launch();
    await page.evaluate(baseUrl => window.paperdesk!.saveAiSettings({ baseUrl, model: 'session-test-model', targetLanguage: '简体中文', apiKey: 'session-dummy-key' }), baseUrl);
    // Re-read settings through the regular startup path.
    await app.close(); await launch();
  });
  test.afterAll(async () => { await app?.close(); server?.closeAllConnections(); await new Promise<void>(resolve => server?.close(() => resolve())); });

  test('isolates same-named papers and restores chat, translation history and drafts when switching', async () => {
    await open(paperA);
    await send('A 的问题');
    await translate();
    await page.getByRole('button', { name: '重新翻译', exact: true }).click();
    await expect(page.getByTestId('translation-result')).toContainText('译文 2');
    await page.getByRole('tab', { name: '对话', exact: true }).click();
    await page.getByRole('textbox', { name: 'AI 消息', exact: true }).fill('A 未发送的问题');
    await open(paperB);
    await expect(page.getByTestId('ai-answer')).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'AI 消息', exact: true })).toHaveValue('');
    await page.getByRole('tab', { name: '翻译', exact: true }).click();
    await expect(page.getByTestId('translation-result')).toHaveCount(0);
    await send('B 的问题');
    await page.getByRole('textbox', { name: 'AI 消息', exact: true }).fill('B 的草稿');
    await open(paperA);
    await expect(page.getByTestId('ai-answer')).toHaveText('回答：A 的问题');
    await expect(page.getByRole('textbox', { name: 'AI 消息', exact: true })).toHaveValue('A 未发送的问题');
    await page.getByRole('tab', { name: '翻译', exact: true }).click();
    await expect(page.getByTestId('translation-result')).toContainText('译文 2');
    await page.getByRole('combobox', { name: '翻译记录' }).selectOption({ index: 0 });
    await expect(page.getByTestId('translation-result')).toContainText('译文 1');
    await expect(page.locator('.ai-source').first()).toContainText('第 1 页');
    await page.getByRole('button', { name: '复制译文', exact: true }).click();
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('译文 1：论文原文。');
  });

  test('archives conversations and restores them after closing, including a renamed copy of the PDF', async () => {
    await page.getByRole('tab', { name: '对话', exact: true }).click();
    await page.getByRole('button', { name: '新建对话' }).click();
    await expect(page.getByTestId('ai-answer')).toHaveCount(0);
    await send('A 的第二个对话');
    await page.getByRole('textbox', { name: 'AI 消息', exact: true }).fill('重启后继续');
    const count = requests.length;
    await app.close(); await launch();
    await open(renamed);
    await expect(page.getByTestId('ai-answer')).toHaveText('回答：A 的第二个对话');
    await expect(page.getByRole('textbox', { name: 'AI 消息', exact: true })).toHaveValue('重启后继续');
    await page.getByRole('combobox', { name: '对话记录' }).selectOption({ index: 0 });
    await expect(page.getByTestId('ai-answer')).toHaveText('回答：A 的问题');
    await expect(page.getByRole('textbox', { name: 'AI 消息', exact: true })).toHaveValue('A 未发送的问题');
    await page.getByRole('tab', { name: '翻译', exact: true }).click();
    await expect(page.getByTestId('translation-result')).toContainText('译文 1');
    await open(paperB);
    await expect(page.getByTestId('ai-answer')).toHaveText('回答：B 的问题');
    await expect(page.getByRole('textbox', { name: 'AI 消息', exact: true })).toHaveValue('B 的草稿');
    expect(requests).toHaveLength(count);
    const files = (await readdir(path.join(profile, 'reading-sessions'))).filter(file => file.endsWith('.json'));
    expect(files).toHaveLength(2);
    for (const file of files) expect(await readFile(path.join(profile, 'reading-sessions', file), 'utf8')).not.toContain('session-dummy-key');
  });

  test('keeps partial answers in their original paper when switching during generation', async () => {
    await open(paperA); slow = true;
    await send('切换时的长回答');
    await open(paperB);
    await expect(page.getByTestId('ai-answer')).toHaveText('回答：B 的问题');
    await expect(page.getByRole('button', { name: '停止回答' })).toHaveCount(0);
    await open(paperA);
    await expect(page.getByTestId('ai-answer').last()).toContainText('部分回答');
    await expect(page.getByRole('button', { name: '重试', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '停止回答' })).toHaveCount(0);
  });

  test('flushes both chat and translation on close, restores incomplete status and can retry', async () => {
    await page.getByRole('button', { name: '新建对话' }).click();
    await send('关闭时的长回答');
    await translate();
    const count = requests.length;
    await app.close(); await launch();
    await open(paperA);
    await expect(page.getByTestId('ai-answer').last()).toContainText('部分回答');
    await expect(page.getByRole('button', { name: '停止回答' })).toHaveCount(0);
    await page.getByRole('tab', { name: '翻译', exact: true }).click();
    await expect(page.getByTestId('translation-result')).toContainText('部分译文');
    await expect(page.getByRole('button', { name: '停止翻译' })).toHaveCount(0);
    expect(requests).toHaveLength(count);
    slow = false;
    await page.getByRole('tab', { name: '对话', exact: true }).click();
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await expect(page.getByTestId('ai-answer').last()).toHaveText('回答：关闭时的长回答');
    await expect(page.getByTestId('session-status')).toHaveText('已保存到本机');
    await mkdir(path.join(root, 'test-results/screenshots'), { recursive: true });
    await page.screenshot({ path: 'test-results/screenshots/sessions-restored.png' });
    expect(errors).toEqual([]);
  });
});
