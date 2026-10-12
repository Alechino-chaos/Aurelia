import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const profile = path.join(root, 'tmp/ai-e2e', String(Date.now()));
const requests: { url: string; authorization: string; body: any }[] = [];
let app: ElectronApplication;
let page: Page;
let server: Server;
let baseUrl: string;
let mode: 'normal' | 'unauthorized' | 'slow' | 'markdown' = 'normal';
const formattedAnswer = [
  '**核心贡献**：一个统一模型支持多个码率工作点。',
  '### 1. 整体定位',
  '通过**按需激活**控制模型规模，避免为每个工作点训练独立模型。',
  '1. 逐级扩展锚点\n2. 按需分配细节\n   - 保留时序一致性',
  '| 模块 | 作用 |\n| --- | --- |\n| PAS | 组织细节层级 |\n| SCAA | 分配容量 |',
  '内联公式 $N \\times 3$，以及损失函数：',
  '$$\nL = \\sum_{i=1}^{N} \\lVert x_i - y_i \\rVert^2\n$$',
  '```python\nresult = progressive_model.decode(anchor_features, capacity_budget, temporal_context)\n```',
  '<img src="https://example.invalid/track" onerror="alert(1)">',
  '![不可自动加载的图片](https://example.invalid/track)',
].join('\n\n');
const errors: string[] = [];
async function launch() {
  const env = { ...process.env, PAPERDESK_TEST_DIR: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  const packagedExecutable = process.env.AURELIA_TEST_EXECUTABLE;
  app = await electron.launch({ executablePath: packagedExecutable || process.env.PAPERDESK_ELECTRON_PATH, args: packagedExecutable ? [`--user-data-dir=${profile}`] : [path.join(root, 'dist-electron/main.js')], cwd: root, env });
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('heading', { name: '打开论文' }).waitFor();
}
test.describe.serial('AI translation and conversation', () => {
  test.beforeAll(async () => {
    await mkdir(profile, { recursive: true });
    server = createServer((req, res) => {
      let raw = '';
      req.on('data', part => { raw += part; });
      req.on('end', () => {
        const body = JSON.parse(raw);
        requests.push({ url: req.url!, authorization: req.headers.authorization ?? '', body });
        if (mode === 'unauthorized') { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'do not display dummy-test-key' } })); return; }
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        if (mode === 'markdown') {
          const pieces = ['**核心', '贡献**：一个统一模型支持多个码率工作点。\n\n', formattedAnswer.slice(formattedAnswer.indexOf('###'))];
          const timers = pieces.map((content, index) => setTimeout(() => {
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
            if (index === pieces.length - 1) res.end('data: [DONE]\n\n');
          }, index * 350));
          res.on('close', () => timers.forEach(clearTimeout));
          return;
        }
        const system = body.messages[0].content;
        const text = mode === 'slow' ? '正在生成的部分回答' : system.includes('学术翻译') ? '我们提出了一种用于表征学习的新框架。' : body.messages.at(-1).content.includes('only OK') ? 'OK' : '这段文字介绍了一种表征学习方法。\n关键是保持句子与上下文完整。';
        const bytes = Buffer.from(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\r\n\r\n`);
        // Split bytes even inside a UTF-8 codepoint.
        res.write(bytes.subarray(0, 49));
        const first = setTimeout(() => res.write(bytes.subarray(49)), 30);
        const finish = setTimeout(() => { res.end('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'); }, mode === 'slow' ? 15000 : 160);
        res.on('close', () => { clearTimeout(first); clearTimeout(finish); });
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
    await launch();
  });
  test.afterAll(async () => { await app?.close(); server?.closeAllConnections(); await new Promise<void>(resolve => server?.close(() => resolve())); });

  test('configures and tests an endpoint while keeping its key encrypted and out of renderer reads', async () => {
    await page.getByRole('button', { name: 'AI 服务设置', exact: true }).click();
    await page.getByRole('textbox', { name: 'API 地址', exact: true }).fill(baseUrl);
    await page.getByLabel('API Key', { exact: true }).fill('dummy-test-key');
    await page.getByRole('textbox', { name: '模型名称', exact: true }).fill('test-model');
    await page.getByRole('button', { name: '保存并测试', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('连接成功');
    expect(requests[0].url).toBe('/v1/chat/completions');
    expect(requests[0].authorization).toBe('Bearer dummy-test-key');
    expect(requests[0].body.model).toBe('test-model');
    const config = await readFile(path.join(profile, 'ai-settings.json'), 'utf8');
    expect(config).not.toContain('dummy-test-key');
    expect(JSON.parse(config).encryptedKey).toBeTruthy();
    const publicConfig = await page.evaluate(() => window.paperdesk!.getAiSettings());
    expect(JSON.stringify(publicConfig)).not.toContain('dummy-test-key');
    expect(publicConfig.hasApiKey).toBe(true);
    await page.getByRole('button', { name: '关闭 AI 设置' }).click();
    await app.close();
    await launch();
    await page.getByRole('button', { name: 'AI 服务设置', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '模型名称', exact: true })).toHaveValue('test-model');
    await expect(page.getByLabel('API Key', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('API Key', { exact: true })).toHaveAttribute('placeholder', '已保存，留空保持不变');
    await page.getByRole('button', { name: '关闭 AI 设置' }).click();
  });

  test('translates an exact PDF selection and copies the streamed translation', async () => {
    await page.getByRole('button', { name: '体验双栏示例' }).click();
    await page.locator('[data-page-number="1"][data-text-ready="true"]').waitFor();
    await page.evaluate(() => {
      const span = Array.from(document.querySelectorAll('[data-page-number="1"] .textLayer span')).find(el => el.textContent?.startsWith('LEFT COLUMN:'))!;
      const range = document.createRange();
      range.selectNodeContents(span);
      window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    });
    await page.getByRole('toolbar', { name: '选区操作' }).getByRole('button', { name: '翻译', exact: true }).click();
    await expect(page.getByTestId('translation-result')).toHaveText('我们提出了一种用于表征学习的新框架。');
    await expect(page.getByRole('button', { name: '重新翻译' })).toBeVisible();
    const sent = requests.at(-1)!.body;
    expect(sent.messages[1].content).toContain('LEFT COLUMN:');
    expect(sent.messages[1].content).not.toContain('RIGHT COLUMN');
    await page.getByRole('button', { name: '复制译文', exact: true }).click();
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('我们提出了一种用于表征学习的新框架。');
  });

  test('quotes source text in a multi-turn chat and keeps it when collapsing the panel', async () => {
    await page.getByRole('tab', { name: '对话', exact: true }).click();
    await page.getByRole('button', { name: '引用当前选区', exact: true }).click();
    await page.getByRole('textbox', { name: 'AI 消息', exact: true }).fill('解释这段话');
    await page.getByRole('button', { name: '发送消息' }).click();
    await expect(page.getByTestId('ai-answer').last()).toContainText('关键是保持句子');
    await expect(page.getByRole('button', { name: '发送消息' })).toBeVisible();
    expect(requests.at(-1)!.body.messages.at(-1).content).toContain('Aurelia · 双栏阅读示例.pdf，第 1 页');
    expect(requests.at(-1)!.body.messages.at(-1).content).toContain('LEFT COLUMN:');
    await page.getByRole('button', { name: '切换右侧面板' }).click();
    await page.getByRole('button', { name: '切换右侧面板' }).click();
    await expect(page.getByTestId('ai-answer')).toContainText('表征学习');
    await page.getByRole('textbox', { name: 'AI 消息', exact: true }).fill('再解释一下');
    await page.getByRole('textbox', { name: 'AI 消息', exact: true }).press('Enter');
    await expect(page.getByTestId('ai-answer')).toHaveCount(2);
    await expect(page.getByRole('button', { name: '发送消息' })).toBeVisible();
    expect(requests.at(-1)!.body.messages.map((item: any) => item.role)).toEqual(['system', 'user', 'assistant', 'user']);
    await mkdir('test-results/screenshots', { recursive: true });
    await page.screenshot({ path: 'test-results/screenshots/ai-chat.png' });
  });

  test('renders streamed Markdown and local math without loading model-provided images', async () => {
    mode = 'markdown';
    const remoteRequests: string[] = [];
    const onRequest = (request: { url: () => string }) => { if (request.url().includes('example.invalid')) remoteRequests.push(request.url()); };
    page.on('request', onRequest);
    await page.getByRole('button', { name: '新建对话' }).click();
    await page.getByRole('textbox', { name: 'AI 消息' }).fill('请按结构解释这段方法，列出公式和示例');
    await page.getByRole('button', { name: '发送消息' }).click();
    const answer = page.getByTestId('ai-answer').last();
    await expect(answer.locator('strong').first()).toHaveText('核心贡献');
    await expect(page.getByRole('button', { name: '发送消息' })).toBeVisible();
    await expect(answer.locator('h3')).toHaveText('1. 整体定位');
    await expect(answer.locator('ol > li')).toHaveCount(2);
    await expect(answer.locator('table')).toHaveCount(1);
    await expect(answer.locator('.katex')).toHaveCount(2);
    await expect(answer.locator('.katex-error')).toHaveCount(0);
    await expect(answer.locator('pre code')).toContainText('progressive_model.decode');
    await expect(answer.locator('img, script, iframe')).toHaveCount(0);
    expect(remoteRequests).toEqual([]);
    await page.locator('.chat-message.assistant').last().getByRole('button', { name: '复制', exact: true }).click();
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(formattedAnswer);
    await page.locator('.chat-scroll').evaluate(el => { el.scrollTop = 0; });
    await page.screenshot({ path: 'test-results/screenshots/ai-markdown.png' });
    await answer.locator('.katex-display').scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'test-results/screenshots/ai-markdown-math.png' });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 720));
    const separator = page.getByRole('separator', { name: '调整右侧面板宽度' });
    await separator.focus();
    for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');
    expect(await page.locator('.chat-scroll').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await expect(page.getByRole('button', { name: '发送消息' })).toBeInViewport();
    await page.screenshot({ path: 'test-results/screenshots/ai-markdown-compact.png' });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 940));
    await separator.dblclick();
    page.off('request', onRequest);
    mode = 'normal';
    expect(errors).toEqual([]);
  });

  test('handles authentication failures, retries and cancellation without stale answers', async () => {
    mode = 'unauthorized';
    await page.getByRole('textbox', { name: 'AI 消息', exact: true }).fill('测试错误');
    await page.getByRole('button', { name: '发送消息' }).click();
    await expect(page.getByRole('alert')).toContainText('认证失败');
    await expect(page.getByRole('alert')).not.toContainText('dummy-test-key');
    mode = 'normal';
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '发送消息' })).toBeVisible();
    mode = 'slow';
    await page.getByRole('textbox', { name: 'AI 消息', exact: true }).fill('长回答');
    await page.getByRole('button', { name: '发送消息' }).click();
    await expect(page.getByTestId('ai-answer').last()).toContainText('正在生成');
    await page.getByRole('button', { name: '停止回答' }).click();
    await expect(page.getByText('已停止，回答可能不完整。')).toBeVisible();
    await page.getByRole('button', { name: '新建对话' }).click();
    await expect(page.getByTestId('ai-answer')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('guards provider changes, clears stored keys and cancels document-scoped conversations', async () => {
    await page.getByRole('button', { name: 'AI 服务设置', exact: true }).click();
    await page.getByRole('textbox', { name: 'API 地址', exact: true }).fill(baseUrl.replace('127.0.0.1', 'localhost'));
    await page.getByRole('button', { name: '保存设置', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('更换服务商');
    expect((await page.evaluate(() => window.paperdesk!.getAiSettings())).baseUrl).toBe(baseUrl);
    await page.getByRole('textbox', { name: 'API 地址', exact: true }).fill(baseUrl);
    await page.getByRole('checkbox', { name: '清除已保存的 Key' }).check();
    await page.getByRole('button', { name: '保存设置', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('设置已保存');
    expect(JSON.parse(await readFile(path.join(profile, 'ai-settings.json'), 'utf8')).encryptedKey).toBeUndefined();
    await mkdir('test-results/screenshots', { recursive: true });
    await page.screenshot({ path: 'test-results/screenshots/ai-settings.png' });
    await page.getByRole('button', { name: '关闭 AI 设置' }).click();
    mode = 'slow';
    await page.getByRole('textbox', { name: 'AI 消息', exact: true }).fill('测试切换文档');
    await page.getByRole('button', { name: '发送消息' }).click();
    await expect(page.getByTestId('ai-answer').last()).toContainText('正在生成');
    expect(requests.at(-1)!.authorization).toBe('');
    const otherPaper = path.join(profile, 'different-paper.pdf');
    await writeFile(otherPaper, Buffer.concat([await readFile(path.join(root, 'public/examples/reading-demo.pdf')), Buffer.from('\n% distinct paper fixture\n')]));
    await app.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }); }, otherPaper);
    await page.getByRole('button', { name: '打开 PDF', exact: true }).click();
    await expect(page.getByTestId('ai-answer')).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'AI 消息', exact: true })).toHaveValue('');
    await expect(page.getByRole('button', { name: '停止回答' })).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
