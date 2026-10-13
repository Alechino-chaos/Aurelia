import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { copyFile, mkdir, readFile, readdir, rmdir, unlink, writeFile } from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import path from 'node:path';

const root = process.cwd();
let app: ElectronApplication, page: Page, profile: string;
const errors: string[] = [];
async function launch() {
  const env = { ...process.env, PAPERDESK_TEST_DIR: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const packaged = process.env.AURELIA_TEST_EXECUTABLE;
  app = await electron.launch({ executablePath: packaged ?? process.env.PAPERDESK_ELECTRON_PATH, args: [...(packaged ? [`--user-data-dir=${profile}`] : [path.join(root, 'dist-electron/main.js')]), '--lang=en-US', '--force-device-scale-factor=1'], cwd: root, env });
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
}
async function confirm(locale: 'zh-CN' | 'en') {
  await page.getByRole('radio', { name: locale === 'en' ? 'English' : '简体中文', exact: true }).check();
  await page.getByRole('button', { name: '确认并继续 / Confirm and continue' }).click();
  await expect(page.locator('[data-workspace-ready="true"]')).toBeVisible();
}
async function settings(locale: 'zh-CN' | 'en') { await page.getByRole('button', { name: locale === 'en' ? 'Settings' : '设置', exact: true }).click(); }
async function switchLanguage(locale: 'zh-CN' | 'en', current: 'zh-CN' | 'en') {
  await page.getByRole('combobox', { name: current === 'en' ? 'Interface language' : '界面语言', exact: true }).selectOption(locale);
  await page.getByRole('button', { name: current === 'en' ? 'Save language' : '保存语言', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
}
test.beforeEach(async ({}, info) => {
  profile = path.join(root, 'tmp/interface-language/e2e', `${Date.now()}-${info.testId.replace(/\W/g, '')}`);
  errors.length = 0;
  await mkdir(profile, { recursive: true }); await launch();
});
test.afterEach(async () => { await app?.close(); expect(errors).toEqual([]); });
test('requires explicit first choice, persists English and skips choice after restart', async () => {
  await expect(page.getByRole('heading', { name: '欢迎使用 Aurelia / Welcome to Aurelia' })).toBeVisible();
  await page.screenshot({ path: path.join(root, 'tmp/interface-language/first-choice.png') });
  await expect(page.locator('[data-workspace-ready="true"]')).toHaveCount(0);
  await expect(page.getByRole('radio', { name: 'English', exact: true })).toBeChecked();
  await page.getByRole('button', { name: '确认并继续 / Confirm and continue' }).click();
  await expect(page.locator('[data-workspace-ready="true"]')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Open a paper', exact: true })).toBeVisible();
  expect(JSON.parse(await readFile(path.join(profile, 'app-settings.json'), 'utf8'))).toEqual({ locale: 'en' });
  await app.close(); await launch();
  await expect(page.getByRole('heading', { name: 'Open a paper', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Welcome to Aurelia/ })).toHaveCount(0);
});

test('normal close before confirmation leaves choice pending and saves Chinese only after confirmation', async () => {
  await page.getByRole('radio', { name: '简体中文', exact: true }).check();
  await app.close();
  await expect(readFile(path.join(profile, 'app-settings.json'))).rejects.toThrow();
  await launch(); await confirm('zh-CN');
  await expect(page.getByRole('heading', { name: '打开论文', exact: true })).toBeVisible();
  await app.close(); await launch();
  await expect(page.getByRole('heading', { name: '打开论文', exact: true })).toBeVisible();
  expect(JSON.parse(await readFile(path.join(profile, 'app-settings.json'), 'utf8'))).toEqual({ locale: 'zh-CN' });
});

test('localizes existing annotation marker names while keeping raw quotes, titles and reader identity', async () => {
  await confirm('en');
  const paper = path.join(profile, 'raw-论文.pdf'); await copyFile(path.join(root, 'tests/fixtures/navigation.pdf'), paper);
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, paper);
  await page.getByRole('button', { name: 'Open PDF', exact: true }).click();
  await expect(page.locator('[data-page-number="1"]')).toHaveAttribute('data-text-ready', 'true');
  const quote = '原文 raw {quote} 未翻译', otherQuote = 'second 原文 {title}', note = '我的笔记 raw {name}';
  await page.evaluate(async ({ quote, otherQuote, note }) => {
    const library = await window.paperdesk!.getLibrary(), paper = library.entries.find(entry => entry.id === library.activeId)!;
    await window.paperdesk!.loadReadingSession(paper.documentId!, paper.name);
    for (const [index, text] of [quote, otherQuote].entries()) {
      await window.paperdesk!.updateReadingSession(paper.documentId!, { type: 'annotation-add', entry: {
        id: `existing-marker-${index}`, createdAt: 1, updatedAt: 1, color: 'yellow',
        quote: { text, fileName: paper.name, pages: [1] }, note: index === 0 ? note : '',
        regions: [{ page: 1, x: .15, y: .2 + index * .1, width: .3, height: .03 }],
      } });
    }
  }, { quote, otherQuote, note });
  // Restart restores real persisted annotations rather than only a transient component fixture.
  await app.close(); await launch();
  const markers = page.locator('[data-page-number="1"] .annotation-marker');
  await expect(markers).toHaveCount(2);
  const reader = await page.locator('.workspace-reader-host').getAttribute('data-reader-generation');
  const document = await page.locator('[data-document-id]').getAttribute('data-document-id');
  for (const locale of ['en', 'zh-CN', 'en'] as const) {
    if (locale === 'zh-CN') { await settings('en'); await switchLanguage('zh-CN', 'en'); await page.getByRole('button', { name: '关闭设置' }).click(); }
    else if (await page.locator('html').getAttribute('lang') === 'zh-CN') { await settings('zh-CN'); await switchLanguage('en', 'zh-CN'); await page.getByRole('button', { name: 'Close settings' }).click(); }
    await expect(markers.nth(0)).toHaveAttribute('aria-label', locale === 'en' ? `View annotation: ${quote}` : `查看批注：${quote}`);
    await expect(markers.nth(1)).toHaveAttribute('aria-label', locale === 'en' ? `View annotation: ${otherQuote}` : `查看批注：${otherQuote}`);
    await expect(markers.nth(0)).toHaveAttribute('title', note); await expect(markers.nth(1)).toHaveAttribute('title', otherQuote);
    expect(await page.locator('.workspace-reader-host').getAttribute('data-reader-generation')).toBe(reader);
    expect(await page.locator('[data-document-id]').getAttribute('data-document-id')).toBe(document);
  }
});

test('asks an existing populated profile once and preserves its independent AI settings and groups', async () => {
  await confirm('zh-CN');
  await page.evaluate(async () => {
    await window.paperdesk!.updateLibrary({ type: 'group-create', name: '我的论文 {name}' });
    await window.paperdesk!.saveAiSettings({ baseUrl: 'http://127.0.0.1:9999/v1', model: 'old-model', targetLanguage: '日本語', clearKey: true });
    await window.paperdesk!.loadReadingSession('a'.repeat(64), 'personal-中文.pdf');
  });
  const aiBefore = await readFile(path.join(profile, 'ai-settings.json'), 'utf8');
  await app.close(); await unlink(path.join(profile, 'app-settings.json')); await launch();
  await expect(page.getByRole('heading', { name: /Welcome to Aurelia/ })).toBeVisible();
  await confirm('en');
  await expect(page.getByRole('button', { name: 'Collapse group 我的论文 {name}', exact: true })).toBeVisible();
  expect(await readFile(path.join(profile, 'ai-settings.json'), 'utf8')).toBe(aiBefore);
  const ai = await page.evaluate(() => window.paperdesk!.getAiSettings());
  expect(ai.model).toBe('old-model'); expect(ai.targetLanguage).toBe('日本語');
});

test('preserves malformed preference evidence and supports unreadable-load retry', async () => {
  await app.close(); const settingsFile = path.join(profile, 'app-settings.json');
  await writeFile(settingsFile, '{invalid original'); await launch();
  await expect(page.getByRole('alert')).toContainText('Language settings are invalid');
  expect(await readFile(settingsFile, 'utf8')).toBe('{invalid original');
  await confirm('en');
  const backup = (await readdir(profile)).find(name => name.startsWith('app-settings.json.corrupt-'))!;
  expect(await readFile(path.join(profile, backup), 'utf8')).toBe('{invalid original');
  await app.close(); await unlink(settingsFile); await mkdir(settingsFile); await launch();
  await expect(page.getByRole('heading', { name: /Could not load language settings/ })).toBeVisible();
  await expect(page.locator('[data-workspace-ready="true"]')).toHaveCount(0);
  await rmdir(settingsFile); await page.getByRole('button', { name: '重试 / Retry', exact: true }).click();
  await confirm('zh-CN');
});

test('failed first save and live settings save keep their prior state and retry after filesystem repair', async () => {
  await expect(page.getByRole('heading', { name: /Welcome to Aurelia/ })).toBeVisible();
  const settingsFile = path.join(profile, 'app-settings.json'); await mkdir(settingsFile);
  await page.getByRole('button', { name: '确认并继续 / Confirm and continue' }).click();
  await expect(page.getByRole('alert')).toContainText('Could not save your language');
  await expect(page.locator('[data-workspace-ready="true"]')).toHaveCount(0);
  await rmdir(settingsFile); await confirm('en'); await settings('en');
  await expect(page.getByRole('tab', { name: 'General', exact: true })).toHaveAttribute('aria-selected', 'true');
  const saved = await readFile(settingsFile, 'utf8'); await unlink(settingsFile); await mkdir(settingsFile);
  await page.getByRole('combobox', { name: 'Interface language' }).selectOption('zh-CN');
  await page.getByRole('button', { name: 'Save language', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Could not save language settings');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await rmdir(settingsFile); await writeFile(settingsFile, saved);
  await page.getByRole('button', { name: 'Save language', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.getByRole('tab', { name: '常规', exact: true })).toHaveAttribute('aria-selected', 'true');
});

for (const initial of ['en', 'zh-CN'] as const) {
  test(`relocalizes cached authored sample fetch failures from ${initial} without translating raw details`, async () => {
    await confirm(initial);
    // Chromium routing does not intercept local file: fetches; provide the failing response at the fetch boundary.
    await page.evaluate(() => {
      const fetch = window.fetch.bind(window);
      window.fetch = (input, init) => String(input).endsWith('/examples/reading-demo.pdf')
        ? Promise.resolve(new Response('unavailable', { status: 503 })) : fetch(input, init);
    });
    const notice = page.locator('.workspace-notice[role="alert"] span');
    await page.getByRole('button', { name: initial === 'en' ? 'Try the two-column sample' : '体验双栏示例', exact: true }).click();
    await expect(notice).toHaveText(initial === 'en' ? 'Could not open file: Sample file not found' : '无法打开文件：示例文件不存在');
    const next = initial === 'en' ? 'zh-CN' : 'en';
    await settings(initial); await switchLanguage(next, initial);
    await page.getByRole('button', { name: next === 'en' ? 'Close settings' : '关闭设置', exact: true }).click();
    await expect(notice).toHaveText(next === 'en' ? 'Could not open file: Sample file not found' : '无法打开文件：示例文件不存在');

    // An unmarked upstream error can coincide with a catalog value; its original bytes must remain intact.
    await page.evaluate(() => {
      const fetch = window.fetch.bind(window);
      window.fetch = (input, init) => String(input).endsWith('/examples/reading-demo.pdf')
        ? Promise.reject(new Error('Sample file not found')) : fetch(input, init);
    });
    await page.getByRole('button', { name: next === 'en' ? 'Try the two-column sample' : '体验双栏示例', exact: true }).click();
    await expect(notice).toHaveText(next === 'en' ? 'Could not open file: Sample file not found' : '无法打开文件：Sample file not found');
    await settings(next); await switchLanguage(initial, next);
    await page.getByRole('button', { name: initial === 'en' ? 'Close settings' : '关闭设置', exact: true }).click();
    await expect(notice).toHaveText(initial === 'en' ? 'Could not open file: Sample file not found' : '无法打开文件：Sample file not found');
  });
}

test('switches live reading, selection, history, search, notes and streaming AI without losing drafts or changing requests', async () => {
  await confirm('zh-CN');
  const paper = path.join(profile, 'user-论文.pdf'); await copyFile(path.join(root, 'tests/fixtures/navigation.pdf'), paper);
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, paper);
  await page.getByRole('button', { name: '打开 PDF', exact: true }).click();
  await expect(page.locator('[data-page-number="1"]')).toHaveAttribute('data-text-ready', 'true');
  const originalDocument = await page.locator('[data-document-id]').getAttribute('data-document-id');
  const originalReader = await page.locator('.workspace-reader-host').getAttribute('data-reader-generation');
  await page.getByRole('combobox', { name: '缩放比例', exact: true }).selectOption('0.75');
  await page.evaluate(() => {
    const span = document.querySelector('[data-page-number="1"] .textLayer [data-line]')!;
    const range = document.createRange(); range.selectNodeContents(span);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
  });
  await page.getByRole('toolbar', { name: '选区操作' }).getByRole('button', { name: '批注', exact: true }).click();
  await page.getByRole('textbox', { name: '批注笔记', exact: true }).fill('我的笔记 raw {pages}');
  await page.getByRole('button', { name: '全文搜索', exact: true }).click();
  const query = await page.locator('[data-page-number="1"] .textLayer [data-line]').first().textContent();
  await page.getByRole('textbox', { name: '搜索论文全文' }).fill(query!.split(' ')[0]);
  await page.getByRole('checkbox', { name: '区分大小写' }).check();
  await expect(page.getByTestId('search-status')).not.toContainText('正在搜索');
  await page.getByRole('textbox', { name: '页码', exact: true }).fill('2'); await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: '后退', exact: true })).toBeEnabled();
  const requests: any[] = []; let response: ServerResponse | undefined;
  const server = createServer((req, res) => {
    let body = ''; req.on('data', part => body += part); req.on('end', () => {
      requests.push(JSON.parse(body)); response = res; res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '原始 AI answer {name}' } }] })}\n\n`);
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const endpoint = `http://127.0.0.1:${(server.address() as any).port}/v1`;
    await page.evaluate(async endpoint => { await window.paperdesk!.saveAiSettings({ baseUrl: endpoint, model: 'state-model', targetLanguage: '日本語', clearKey: true }); }, endpoint);
    // Load the settings through the existing form so the active controller has its current configuration.
    await settings('zh-CN'); await page.getByRole('tab', { name: 'AI 服务', exact: true }).click();
    await page.getByRole('textbox', { name: 'API 地址', exact: true }).fill(endpoint);
    await page.getByRole('textbox', { name: '模型名称', exact: true }).fill('state-model');
    await page.getByRole('combobox', { name: '翻译目标语言', exact: true }).selectOption('日本語');
    await page.getByRole('button', { name: '保存设置', exact: true }).click(); await expect(page.getByRole('dialog').getByRole('status')).toContainText('设置已保存');
    await page.getByRole('button', { name: '关闭设置' }).click();
    await page.getByRole('tab', { name: '对话', exact: true }).click();
    await page.getByRole('textbox', { name: 'AI 消息', exact: true }).fill('raw user 中文 question');
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
    await expect(page.getByTestId('ai-answer')).toContainText('原始 AI answer {name}');
    await page.getByRole('textbox', { name: 'AI 消息', exact: true }).fill('未发送 chat draft');
    const requestBefore = JSON.stringify(requests[0]);
    const scrollBefore = await page.locator('.reader').evaluate(el => ({ top: el.scrollTop, left: el.scrollLeft }));
    await settings('zh-CN'); await page.getByRole('tab', { name: 'AI 服务', exact: true }).click();
    await page.getByRole('textbox', { name: '模型名称', exact: true }).fill('unsaved-model');
    await page.getByLabel('API Key', { exact: true }).fill('unsaved-test-key');
    await page.getByRole('tab', { name: '常规', exact: true }).click(); await switchLanguage('en', 'zh-CN');
    await page.getByRole('tab', { name: 'AI service', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Model name', exact: true })).toHaveValue('unsaved-model');
    await expect(page.getByLabel('API Key', { exact: true })).toHaveValue('unsaved-test-key');
    await expect(page.getByRole('combobox', { name: 'Translation target language', exact: true })).toHaveValue('日本語');
    await expect(page.getByRole('combobox', { name: 'Translation target language' })).toContainText('Japanese');
    await page.getByRole('tab', { name: 'General', exact: true }).click(); await switchLanguage('zh-CN', 'en');
    await page.getByRole('tab', { name: 'AI 服务', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '模型名称', exact: true })).toHaveValue('unsaved-model');
    await page.getByRole('tab', { name: '常规', exact: true }).click(); await switchLanguage('en', 'zh-CN');
    await page.getByRole('button', { name: 'Close settings', exact: true }).click();
    expect(await page.locator('[data-document-id]').getAttribute('data-document-id')).toBe(originalDocument);
    expect(await page.locator('.workspace-reader-host').getAttribute('data-reader-generation')).toBe(originalReader);
    expect(await page.locator('.reader').evaluate(el => ({ top: el.scrollTop, left: el.scrollLeft }))).toEqual(scrollBefore);
    await expect(page.getByRole('combobox', { name: 'Zoom', exact: true })).toHaveValue('0.75');
    await expect(page.getByRole('textbox', { name: 'Page number', exact: true })).toHaveValue('2');
    await expect(page.getByRole('textbox', { name: 'Search paper full text' })).toHaveValue(query!.split(' ')[0]);
    await expect(page.getByRole('checkbox', { name: 'Match case' })).toBeChecked();
    await expect(page.getByRole('textbox', { name: 'AI message', exact: true })).toHaveValue('未发送 chat draft');
    await expect(page.getByRole('button', { name: 'Quote current selection', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Stop answer', exact: true })).toBeVisible();
    await expect(page.getByTestId('ai-answer')).toContainText('原始 AI answer {name}');
    expect(JSON.stringify(requests[0])).toBe(requestBefore); expect(requests).toHaveLength(1);
    const savedAi = await page.evaluate(() => window.paperdesk!.getAiSettings());
    expect(savedAi.targetLanguage).toBe('日本語'); expect(savedAi.model).toBe('state-model');
    expect(JSON.stringify(savedAi)).not.toContain('unsaved-test-key');
    const session = await page.evaluate(async () => { const library = await window.paperdesk!.getLibrary(); return window.paperdesk!.loadReadingSession(library.entries[0].documentId!, library.entries[0].name); });
    expect(session.annotations[0].note).toBe('我的笔记 raw {pages}');
    await expect(page.locator('.native-pdf-link').first()).toHaveAttribute('aria-label', /^Go to /);
    for (const width of [960, 1440]) {
      await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 900), width);
      await page.screenshot({ path: path.join(root, `tmp/interface-language/en-${width}-reading-ai.png`) });
    }
    response!.end('data: [DONE]\n\n'); await expect(page.getByRole('button', { name: 'Stop answer', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Back', exact: true }).click(); await expect(page.getByRole('textbox', { name: 'Page number', exact: true })).toHaveValue('1');
    await page.getByRole('button', { name: 'Forward', exact: true }).click(); await expect(page.getByRole('textbox', { name: 'Page number', exact: true })).toHaveValue('2');
    await page.getByRole('tab', { name: 'Selection', exact: true }).click();
    await expect(page.getByTestId('selection-preview')).toHaveText(query!);
    await settings('en'); await switchLanguage('zh-CN', 'en'); await page.getByRole('button', { name: '关闭设置' }).click();
    await expect(page.locator('.native-pdf-link').first()).toHaveAttribute('aria-label', /^跳转到 /);
    for (const width of [960, 1440]) {
      await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 900), width);
      await page.screenshot({ path: path.join(root, `tmp/interface-language/zh-CN-${width}-reading-selection.png`) });
    }
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('localizes native actions, authored errors and link labels and fits 960 and 1440 pixels in both languages', async () => {
  await confirm('en');
  for (const locale of ['en', 'zh-CN'] as const) {
    if (locale === 'zh-CN') { await settings('en'); await switchLanguage('zh-CN', 'en'); await page.getByRole('button', { name: '关闭设置' }).click(); }
    const labels = await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items.map(item => ({ label: item.label, children: item.submenu?.items.map(child => child.label) })));
    expect(labels[0].label).toBe(locale === 'en' ? 'File' : '文件');
    expect(labels[0].children).toContain(locale === 'en' ? 'Open PDF…' : '打开 PDF…');
    await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async (_window: any, options: any) => { (globalThis as any).languageDialog = options; return { canceled: true, filePaths: [] }; }; });
    await page.getByRole('button', { name: locale === 'en' ? 'Open PDF' : '打开 PDF', exact: true }).click();
    const options = await app.evaluate(() => (globalThis as any).languageDialog);
    expect(options.title).toBe(locale === 'en' ? 'Open academic paper' : '打开学术论文');
    expect(options.filters[0].name).toBe(locale === 'en' ? 'PDF documents' : 'PDF 文档');
    await settings(locale); await page.getByRole('tab', { name: locale === 'en' ? 'AI service' : 'AI 服务', exact: true }).click();
    await page.getByRole('textbox', { name: locale === 'en' ? 'API endpoint' : 'API 地址', exact: true }).fill('https://example.com/v1');
    await page.getByRole('button', { name: locale === 'en' ? 'Save and test' : '保存并测试', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(locale === 'en' ? 'Enter a valid model name.' : '请填写有效的模型名称。');
    await page.getByRole('button', { name: locale === 'en' ? 'Close settings' : '关闭设置', exact: true }).click();
    for (const width of [960, 1440]) {
      await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 900), width);
      await page.screenshot({ path: path.join(root, `tmp/interface-language/${locale}-${width}-workspace.png`) });
      for (const name of [locale === 'en' ? 'Open PDF' : '打开 PDF', locale === 'en' ? 'Settings' : '设置', locale === 'en' ? 'Toggle side panel' : '切换右侧面板']) {
        const bounds = await page.getByRole('button', { name, exact: true }).boundingBox(); expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      }
      await settings(locale);
      await page.screenshot({ path: path.join(root, `tmp/interface-language/${locale}-${width}-settings.png`) });
      await page.getByRole('button', { name: locale === 'en' ? 'Close settings' : '关闭设置', exact: true }).focus();
      await page.keyboard.press('Shift+Tab'); await expect(page.getByRole('button', { name: locale === 'en' ? 'Save language' : '保存语言', exact: true })).toBeFocused();
      await page.keyboard.press('Tab'); await expect(page.getByRole('button', { name: locale === 'en' ? 'Close settings' : '关闭设置', exact: true })).toBeFocused();
      await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
    }
  }
});
