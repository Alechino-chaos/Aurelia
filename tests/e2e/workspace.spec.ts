import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { copyFile, mkdir, readFile, rename, writeFile, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const root = process.cwd();
let app: ElectronApplication, page: Page, profile: string, directory: string;
let a: string, b: string, c: string;
const errors: string[] = [];
async function launch() {
  const env = { ...process.env, PAPERDESK_TEST_DIR: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const packaged = process.env.AURELIA_TEST_EXECUTABLE;
  app = await electron.launch({ executablePath: packaged ?? process.env.PAPERDESK_ELECTRON_PATH,
    args: [...(packaged ? [`--user-data-dir=${profile}`] : [path.join(root, 'dist-electron/main.js')]), '--force-device-scale-factor=1'], cwd: root, env });
  page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await page.waitForLoadState('domcontentloaded');
}
async function pick(files: string[]) {
  await app.evaluate(({ dialog }, files) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files }); }, files);
}
async function importFiles(files: string[]) {
  await pick(files); await page.getByRole('button', { name: '导入论文', exact: true }).click();
}
async function loaded(name: string) {
  await expect(page.locator('.document-label')).toHaveText(name);
  await expect(page.locator('[data-page-number="1"]')).toHaveAttribute('data-text-ready', 'true');
}
function entry(file: string) { return page.locator('.library-entry').filter({ has: page.locator(`button[data-paper-path=${JSON.stringify(file)}]`) }); }
async function openEntry(file: string) { const id = await entry(file).getAttribute('data-library-id'); await entry(file).locator('.paper-open').click(); await expect(page.locator('.workspace-reader-host')).toHaveAttribute('data-reader-id', id!); await loaded(path.basename(file)); }
async function setPage(number: number) { await page.getByRole('textbox', { name: '页码', exact: true }).fill(String(number)); await page.keyboard.press('Enter'); }

test.describe('paper library workspace', () => {
  test.beforeEach(async ({}, info) => {
    errors.length = 0; directory = path.join(root, 'tmp/workspace-e2e', `${Date.now()}-${info.testId.replace(/\W/g, '')}`);
    profile = path.join(directory, 'profile'); a = path.join(directory, 'first/paper.pdf'); b = path.join(directory, 'second/paper.pdf'); c = path.join(directory, 'third/third.pdf');
    for (const [file, text] of [[a, 'Alpha'], [b, 'Beta'], [c, 'Gamma']]) {
      await mkdir(path.dirname(file), { recursive: true }); const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.TimesRoman);
      for (let i = 1; i <= 4; i++) pdf.addPage([612, 792]).drawText(`${text} workspace page ${i}. Search unique ${text}.`, { x: 48, y: 700, size: 16, font });
      await writeFile(file, await pdf.save());
    }
    await mkdir(profile, { recursive: true }); await launch();
  });
  test.afterEach(async () => {
    // Failed race assertions can leave an invalid old reader whose native close prompts about saving.
    // This isolated synthetic profile may close explicitly during cleanup; behavior checks run before this override.
    await app?.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 2, checkboxChecked: false }); }).catch(() => {});
    await app?.close(); expect(errors).toEqual([]);
  });

  test('groups imported papers with real locations and keeps close distinct from remove', async () => {
    const original = await readFile(a);
    await page.getByRole('button', { name: '新建分组', exact: true }).click();
    await page.getByRole('textbox', { name: '分组名称' }).fill('Compression'); await page.getByRole('button', { name: '保存分组' }).click();
    await importFiles([a, b]); await loaded('paper.pdf');
    await expect(entry(a)).toContainText(path.dirname(a)); await expect(entry(b)).toContainText(path.dirname(b));
    await expect(entry(a).getByText('first', { exact: true })).toBeVisible(); await expect(entry(b).getByText('second', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '收起分组 Compression' })).toBeVisible();
    await entry(b).locator('summary').click(); await entry(b).getByRole('combobox', { name: '移动到分组' }).selectOption('');
    await page.getByRole('button', { name: '重命名分组 Compression' }).click(); await page.getByRole('textbox', { name: '分组名称' }).fill('Reading');
    await page.getByRole('button', { name: '保存分组' }).click();
    await page.getByRole('button', { name: '标签模式' }).click(); await page.getByRole('button', { name: '论文库', exact: true }).click(); await openEntry(b);
    await expect(page.getByRole('navigation', { name: '论文库列表' })).toHaveCount(0); await expect(page.getByRole('tablist', { name: '打开的论文' }).getByRole('tab')).toHaveCount(2);
    await page.getByRole('button', { name: `关闭论文 ${b}`, exact: true }).click(); await loaded('paper.pdf');
    await page.getByRole('button', { name: '论文库', exact: true }).click(); await expect(entry(b)).toBeVisible();
    await entry(b).locator('summary').click(); await entry(b).getByRole('button', { name: '移出论文库' }).click(); await expect(entry(b)).toHaveCount(0);
    await page.getByRole('button', { name: '删除分组 Reading' }).click(); await expect(entry(a)).toBeVisible();
    expect(await readFile(a)).toEqual(original); expect(await readFile(b)).toBeTruthy();
  });

  test('restores independent page zoom panel and search memory and captures latest scroll on native close', async () => {
    await importFiles([a, b]); await loaded('paper.pdf');
    await page.getByRole('combobox', { name: '缩放比例' }).selectOption('1.25'); await setPage(3);
    await page.getByRole('tab', { name: '批注', exact: true }).click();
    await page.getByRole('button', { name: '全文搜索', exact: true }).click(); await page.getByRole('textbox', { name: '搜索论文全文' }).fill('Alpha');
    await page.getByRole('checkbox', { name: '区分大小写' }).check();
    await openEntry(b); await expect(page.getByRole('textbox', { name: '页码', exact: true })).toHaveValue('1');
    await page.getByRole('combobox', { name: '缩放比例' }).selectOption('.75'.replace(/^\./, '0.')); await setPage(2); await page.getByRole('button', { name: '切换右侧面板' }).click();
    await openEntry(a); await expect(page.getByRole('textbox', { name: '页码', exact: true })).toHaveValue('3');
    await expect(page.getByRole('combobox', { name: '缩放比例' })).toHaveValue('1.25'); await expect(page.getByRole('tab', { name: '批注', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('textbox', { name: '搜索论文全文' })).toHaveValue('Alpha'); await expect(page.getByRole('checkbox', { name: '区分大小写' })).toBeChecked();
    await page.getByRole('button', { name: '标签模式' }).click();
    // DOM scroll followed immediately by the native close must not rely on the next animation frame/state render.
    const anchor = await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>('.reader')!, paper = root.querySelector<HTMLElement>('[data-page-number="3"]')!;
      root.scrollTop += paper.getBoundingClientRect().top - root.getBoundingClientRect().top + paper.getBoundingClientRect().height * .37;
      return root.scrollTop;
    });
    await app.close(); await rename(b, `${b}.missing`); await launch(); await loaded('paper.pdf');
    await expect(page.getByRole('tablist', { name: '打开的论文' }).getByRole('tab')).toHaveCount(2);
    await expect(page.getByRole('textbox', { name: '页码', exact: true })).toHaveValue('3'); await expect(page.getByRole('combobox', { name: '缩放比例' })).toHaveValue('1.25');
    await expect.poll(() => page.locator('.reader').evaluate(el => el.scrollTop)).toBeCloseTo(anchor, -1);
    await expect(page.getByRole('textbox', { name: '搜索论文全文' })).toHaveCount(0); await expect(page.getByRole('alert')).toHaveCount(0);
    await page.getByRole('tab', { name: `打开论文 ${b}`, exact: true }).click(); await expect(page.getByRole('alert')).toContainText('无法');
    await page.getByRole('tab', { name: `打开论文 ${a}`, exact: true }).click(); await loaded('paper.pdf');
  });

  test('keeps same-content copy notes fresh while navigation belongs to each path', async () => {
    await copyFile(a, b); await importFiles([a, b]); await loaded('paper.pdf');
    await page.getByRole('tab', { name: '对话', exact: true }).click(); await page.getByRole('textbox', { name: 'AI 消息' }).fill('shared draft'); await setPage(3);
    await openEntry(b); await page.getByRole('tab', { name: '对话', exact: true }).click(); await expect(page.getByRole('textbox', { name: 'AI 消息' })).toHaveValue('shared draft');
    await expect(page.getByRole('textbox', { name: '页码', exact: true })).toHaveValue('1'); await page.getByRole('textbox', { name: 'AI 消息' }).fill('updated by copy');
    await openEntry(a); await expect(page.getByRole('textbox', { name: 'AI 消息' })).toHaveValue('updated by copy'); await expect(page.getByRole('textbox', { name: '页码', exact: true })).toHaveValue('3');
    await copyFile(c, a); await openEntry(b); await openEntry(a); await expect(page.locator('.textLayer').first()).toContainText('Gamma');
    await expect(page.getByRole('textbox', { name: '页码', exact: true })).toHaveValue('1'); await page.getByRole('tab', { name: '对话', exact: true }).click(); await expect(page.getByRole('textbox', { name: 'AI 消息' })).toHaveValue('');
  });

  test('cycles closes and respects IME while controls remain reachable at 960px', async () => {
    await importFiles([a, b, c]); await loaded('paper.pdf'); await openEntry(b); await openEntry(c);
    await page.keyboard.press('Control+Tab'); await loaded('paper.pdf'); await expect(entry(a)).toContainText('当前阅读');
    await page.keyboard.press('Control+Shift+Tab'); await loaded('third.pdf');
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', ctrlKey: true, isComposing: true })));
    expect((await page.evaluate(() => window.paperdesk!.getLibrary())).openIds).toHaveLength(3);
    await page.keyboard.press('Control+w'); await loaded('paper.pdf');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 760));
    await expect.poll(() => page.locator('.app').evaluate(el => el.getBoundingClientRect().width)).toBe(960);
    expect((await page.locator('.reader').boundingBox())!.width).toBeGreaterThan(320);
    await expect(page.locator('.pdf-page canvas').first()).toBeVisible();
    for (const name of ['打开 PDF', 'AI 服务设置', '切换右侧面板']) { const box = (await page.getByRole('button', { name, exact: true }).boundingBox())!; expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(960); }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(960);
    await mkdir(path.join(root, 'test-results/screenshots'), { recursive: true }); await page.screenshot({ path: 'test-results/screenshots/workspace-sidebar.png' });
    await page.getByRole('button', { name: '标签模式' }).click(); await page.screenshot({ path: 'test-results/screenshots/workspace-tabs.png' });
  });

  test('saves sidebar width and collapsed groups and keeps page navigation separate', async () => {
    await page.getByRole('button', { name: '新建分组' }).click(); await page.getByRole('textbox', { name: '分组名称' }).fill('Saved group'); await page.getByRole('button', { name: '保存分组' }).click();
    await importFiles([a, b]); await loaded('paper.pdf'); await page.getByRole('button', { name: '收起分组 Saved group' }).click();
    const separator = page.getByRole('separator', { name: '调整论文库宽度' }); await separator.focus(); await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await page.evaluate(() => window.paperdesk!.getLibrary())).sidebarWidth).toBe(280);
    await page.getByRole('button', { name: '切换页码导航' }).click(); await expect(page.getByRole('navigation', { name: '页码导航' })).toBeVisible();
    await page.getByRole('button', { name: '论文库', exact: true }).click(); await expect(page.getByRole('button', { name: '展开分组 Saved group' })).toBeVisible();
    await page.getByRole('button', { name: '展开分组 Saved group' }).click(); await openEntry(b);
    await expect(page.getByRole('navigation', { name: '页码导航' })).toHaveCount(0); await expect(page.getByRole('navigation', { name: '论文库列表' })).toBeVisible();
    await expect(page.getByRole('button', { name: '论文库', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '收起分组 Saved group' }).click(); await app.close(); await launch(); await loaded('paper.pdf');
    await expect(page.getByRole('button', { name: '展开分组 Saved group' })).toBeVisible(); await expect(page.getByRole('separator', { name: '调整论文库宽度' })).toHaveAttribute('aria-valuenow', '280');
    await expect(entry(a)).toHaveCount(0); await page.getByRole('button', { name: '展开分组 Saved group' }).click(); await expect(entry(a)).toBeVisible();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 920));
    await expect.poll(() => page.locator('.reader').evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThan(700);
    await page.screenshot({ path: 'test-results/screenshots/workspace-sidebar-1440.png' });
  });

  test('relocates matching content with state retained and offers mismatches as separate papers', async () => {
    await importFiles([a]); await loaded('paper.pdf'); await setPage(3); await page.getByRole('combobox', { name: '缩放比例' }).selectOption('1.25');
    const moved = path.join(directory, 'moved.pdf'); await rename(a, moved); await entry(a).locator('.paper-open').click(); await expect(page.getByRole('alert')).toContainText('无法打开');
    await pick([moved]); await page.locator('.workspace-load-state').getByRole('button', { name: '重新定位' }).click(); await loaded('moved.pdf');
    await expect(page.getByRole('textbox', { name: '页码', exact: true })).toHaveValue('3'); await expect(page.getByRole('combobox', { name: '缩放比例' })).toHaveValue('1.25');
    await app.evaluate(({ shell }) => { shell.showItemInFolder = file => { (globalThis as any).workspaceRevealed = file; }; });
    await entry(moved).locator('summary').click(); await entry(moved).getByRole('button', { name: '在文件夹中显示' }).click(); expect(await app.evaluate(() => (globalThis as any).workspaceRevealed)).toBe(moved);
    await pick([c]); await entry(moved).getByRole('button', { name: '重新定位' }).click(); await expect(page.getByRole('dialog', { name: '文件内容不同' })).toContainText('third.pdf');
    expect((await page.evaluate(() => window.paperdesk!.getLibrary())).entries).toHaveLength(1); await page.getByRole('button', { name: '作为新论文导入' }).click(); await loaded('third.pdf');
    const state = await page.evaluate(() => window.paperdesk!.getLibrary()); expect(state.entries.map(entry => entry.path).sort()).toEqual([moved, c].sort()); expect(state.entries.find(entry => entry.path === moved)?.view?.page).toBe(3);
  });

  test('password cancellation and switching leave other papers usable', async () => {
    const encrypted = path.join(directory, 'encrypted.pdf');
    await writeFile(encrypted, Buffer.from('JVBERi0xLjMKJeLjz9MKMSAwIG9iago8PAovUHJvZHVjZXIgPDU3ZGQ2YWY2MmM+Cj4+CmVuZG9iagoyIDAgb2JqCjw8Ci9UeXBlIC9QYWdlcwovQ291bnQgMQovS2lkcyBbIDQgMCBSIF0KPj4KZW5kb2JqCjMgMCBvYmoKPDwKL1R5cGUgL0NhdGFsb2cKL1BhZ2VzIDIgMCBSCj4+CmVuZG9iago0IDAgb2JqCjw8Ci9UeXBlIC9QYWdlCi9SZXNvdXJjZXMgPDwKPj4KL01lZGlhQm94IFsgMC4wIDAuMCA2MTIgNzkyIF0KL1BhcmVudCAyIDAgUgo+PgplbmRvYmoKNSAwIG9iago8PAovViAyCi9SIDMKL0xlbmd0aCAxMjgKL1AgNDI5NDk2NzI5MgovRmlsdGVyIC9TdGFuZGFyZAovTyA8OWVkNDU0ZGM0MDQ2NDI5N2RiNzc0ZGViZjRjMjUzMDI3Mzk5NDllNWY4N2YzNjZlZGMzYzMwMzhhZjcyZjUzZj4KL1UgPDM5Njc0ZDQ4ZTBhYjU5ZDJjZTI3NWU3YWUwYTFiZmIxMjhiZjRlNWU0ZTc1OGE0MTY0MDA0ZTU2ZmZmYTAxMDg+Cj4+CmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMTUgMDAwMDAgbiAKMDAwMDAwMDA1OSAwMDAwMCBuIAowMDAwMDAwMTE4IDAwMDAwIG4gCjAwMDAwMDAxNjcgMDAwMDAgbiAKMDAwMDAwMDI2MSAwMDAwMCBuIAp0cmFpbGVyCjw8Ci9TaXplIDYKL1Jvb3QgMyAwIFIKL0luZm8gMSAwIFIKL0lEIFsgPDM1NjEzMTMyNjIzNzY0MzczODM1NjEzNjY0MzUzNTM3MzUzNjM5NjI2MjM3MzA2NDMyMzQzMjMyNjEzNzMwMzk+IDwzNTYxMzEzMjYyMzc2NDM3MzgzNTYxMzY2NDM1MzUzNzM1MzYzOTYyNjIzNzMwNjQzMjM0MzIzMjYxMzczMDM5PiBdCi9FbmNyeXB0IDUgMCBSCj4+CnN0YXJ0eHJlZgo0NzYKJSVFT0YK', 'base64'));
    await importFiles([a, encrypted]); await loaded('paper.pdf'); await entry(encrypted).locator('.paper-open').click(); await expect(page.getByRole('textbox', { name: 'PDF 密码' })).toBeVisible();
    await openEntry(a); await expect(page.getByRole('textbox', { name: 'PDF 密码' })).toHaveCount(0); await expect(entry(encrypted)).toContainText('已打开');
    await entry(encrypted).locator('.paper-open').click(); await page.getByRole('button', { name: '取消密码' }).click(); await expect(page.getByRole('alert')).toContainText('已取消');
    await openEntry(a); await entry(encrypted).locator('.paper-open').click(); await page.getByRole('textbox', { name: 'PDF 密码' }).fill('aurelia-test-password'); await page.getByRole('button', { name: '解锁 PDF' }).click();
    await expect(page.locator('.document-label')).toHaveText('encrypted.pdf'); await expect(page.locator('.pdf-page')).toHaveCount(1); await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('a delayed older read cannot replace the newest A after rapid A B A activation', async () => {
    await importFiles([a, b, c]); await loaded('paper.pdf'); await openEntry(c);
    const aid = await entry(a).getAttribute('data-library-id'), bid = await entry(b).getAttribute('data-library-id');
    await app.evaluate(({ ipcMain }, aid) => {
      const handlers = (ipcMain as any)._invokeHandlers, original = handlers.get('library:open'); let delayed = false;
      (globalThis as any).workspaceReadLog = [];
      handlers.set('library:open', async (...args: any[]) => {
        const result = await original(...args); (globalThis as any).workspaceReadLog.push(args[1]);
        if (args[1] === aid && !delayed) { delayed = true; await new Promise(resolve => { (globalThis as any).releaseWorkspaceRead = resolve; }); }
        return result;
      });
    }, aid);
    await entry(a).locator('.paper-open').click(); await expect.poll(async () => await app.evaluate(() => (globalThis as any).workspaceReadLog.length)).toBe(1);
    await entry(b).locator('.paper-open').click(); await expect.poll(async () => await app.evaluate(() => (globalThis as any).workspaceReadLog.length)).toBe(2);
    await entry(a).locator('.paper-open').click(); await expect(page.locator('.workspace-reader-host')).toHaveAttribute('data-reader-id', aid!); await expect(page.locator('.textLayer').first()).toContainText('Alpha');
    await app.evaluate(() => (globalThis as any).releaseWorkspaceRead()); await expect.poll(async () => (await page.evaluate(() => window.paperdesk!.getLibrary())).activeId).toBe(aid);
    await expect(page.locator('.workspace-reader-host')).toHaveAttribute('data-reader-id', aid!); expect((await page.evaluate(() => window.paperdesk!.getLibrary())).openIds).toEqual([aid, await entry(c).getAttribute('data-library-id'), bid]);
  });

  test('refuses switch and native close after failed session save, then preserves latest draft on retry', async () => {
    await importFiles([a, b]); await loaded('paper.pdf'); await page.getByRole('tab', { name: '对话', exact: true }).click(); await page.getByRole('textbox', { name: 'AI 消息' }).fill('initial');
    await expect(page.getByTestId('session-status')).toHaveText('已保存到本机');
    const library = await page.evaluate(() => window.paperdesk!.getLibrary()), original = library.activeId!, documentId = library.entries.find(entry => entry.id === original)!.documentId!;
    await page.evaluate(documentId => window.paperdesk!.flushReadingSession(documentId), documentId);
    const temp = path.join(profile, 'reading-sessions', `${documentId}.json.tmp`); await mkdir(temp);
    await page.getByRole('textbox', { name: 'AI 消息' }).fill('latest draft'); await entry(b).locator('.paper-open').click();
    await expect(page.getByRole('alert').filter({ hasText: '无法切换论文' })).toBeVisible(); expect((await page.evaluate(() => window.paperdesk!.getLibrary())).activeId).toBe(original);
    await app.evaluate(({ dialog, BrowserWindow }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); BrowserWindow.getAllWindows()[0].close(); });
    await expect(page.getByRole('textbox', { name: 'AI 消息' })).toHaveValue('latest draft'); await rmdir(temp);
    await page.getByRole('button', { name: '重试保存或恢复' }).click(); await expect(page.getByTestId('session-status')).toHaveText('已保存到本机'); await openEntry(b);
    await app.close(); await launch(); await loaded('paper.pdf'); await openEntry(a); await expect(page.getByRole('textbox', { name: 'AI 消息' })).toHaveValue('latest draft');
  });

  test('releases real PDF workers on third-resource and oversized-inactive eviction and restores evicted search', async () => {
    const workers = new Set<unknown>(); page.on('worker', worker => { workers.add(worker); worker.on('close', () => workers.delete(worker)); });
    await importFiles([a, b, c]); await loaded('paper.pdf');
    await page.getByRole('button', { name: '全文搜索' }).click(); await page.getByRole('textbox', { name: '搜索论文全文' }).fill('Alpha');
    await openEntry(b); await expect.poll(() => workers.size).toBe(2); await openEntry(c); await expect.poll(() => workers.size).toBe(2);
    await openEntry(a); await expect.poll(() => workers.size).toBe(2); await expect(page.getByRole('textbox', { name: '搜索论文全文' })).toHaveValue('Alpha');
    const large = path.join(directory, 'large.pdf'); await writeFile(large, Buffer.concat([await readFile(c), Buffer.alloc(32 * 1024 * 1024 + 1, 32)]));
    await importFiles([large]); await loaded('large.pdf'); await expect.poll(() => workers.size).toBe(2); await openEntry(a); await expect.poll(() => workers.size).toBe(1);
    await expect(page.getByRole('textbox', { name: '搜索论文全文' })).toHaveValue('Alpha');
  });

  test('shows an actionable library save failure without an unhandled renderer rejection', async () => {
    await importFiles([a]); await loaded('paper.pdf');
    const blocked = path.join(profile, 'library.json.tmp'); await mkdir(blocked);
    try {
      await page.getByRole('button', { name: '标签模式' }).click(); await expect(page.locator('.workspace-notice[role="alert"]')).toContainText('保存');
      await expect(page.locator('.document-label')).toHaveText('paper.pdf');
    } finally { await rmdir(blocked); }
  });

  for (const remove of [false, true]) {
    test(`failed active ${remove ? 'removal' : 'tab-close'} reconciles dirty metadata and recovers normal close`, async () => {
      await importFiles([a, b]); await loaded('paper.pdf'); await openEntry(b); await openEntry(a);
      const original = await readFile(a), aid = await entry(a).getAttribute('data-library-id'), bid = await entry(b).getAttribute('data-library-id');
      const documentId = (await page.evaluate(() => window.paperdesk!.getLibrary())).entries.find(entry => entry.id === aid)!.documentId!;
      await page.getByRole('tab', { name: '对话', exact: true }).click(); await page.getByRole('textbox', { name: 'AI 消息' }).fill('draft retained after metadata failure');
      await expect(page.getByTestId('session-status')).toHaveText('已保存到本机'); await page.evaluate(id => window.paperdesk!.flushReadingSession(id), documentId);
      const session = path.join(profile, 'reading-sessions', `${documentId}.json`), blocked = path.join(profile, 'library.json.tmp');
      const savedSession = JSON.parse(await readFile(session, 'utf8')); await mkdir(blocked);
      try {
        if (remove) { await entry(a).locator('summary').click(); await entry(a).getByRole('button', { name: '移出论文库' }).click(); }
        else await entry(a).getByRole('button', { name: `关闭论文 ${a}`, exact: true }).click();
        await expect(page.locator('.workspace-notice[role="alert"]')).toContainText('保存');
        const dirty = await page.evaluate(() => window.paperdesk!.getLibrary()); expect(dirty.activeId).toBe(bid); expect(dirty.openIds).not.toContain(aid); expect(dirty.entries.some(entry => entry.id === aid)).toBe(!remove);
        await expect(page.locator('.workspace-reader-host')).toHaveAttribute('data-reader-id', bid!); await expect(page.locator('.textLayer').first()).toContainText('Beta');
      } finally { await rmdir(blocked); }
      expect(await readFile(a)).toEqual(original); expect(JSON.parse(await readFile(session, 'utf8'))).toEqual(savedSession);
      // Retry writes through ordinary navigation; a removed paper can be imported again without losing its content-keyed session.
      if (remove) { await importFiles([a]); await expect(entry(a)).toBeVisible(); }
      await openEntry(a); await page.getByRole('tab', { name: '对话', exact: true }).click();
      await expect(page.getByRole('textbox', { name: 'AI 消息' })).toHaveValue('draft retained after metadata failure'); await openEntry(b);
      // Cancel any unexpected save-error dialog. Successful close therefore cannot use explicit discard.
      await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); });
      await app.close(); await launch(); await loaded('paper.pdf');
      await expect(page.locator('.workspace-reader-host')).toHaveAttribute('data-reader-id', bid!); await expect(page.locator('.textLayer').first()).toContainText('Beta');
      await openEntry(a); await expect(page.getByRole('textbox', { name: 'AI 消息' })).toHaveValue('draft retained after metadata failure'); expect(await readFile(a)).toEqual(original);
    });
  }

  test('a delayed failed removal preserves a newer queued selection and its capture', async () => {
    await importFiles([a, b, c]); await loaded('paper.pdf'); await openEntry(b); await openEntry(a);
    const aid = await entry(a).getAttribute('data-library-id'), cid = await entry(c).getAttribute('data-library-id');
    await app.evaluate(({ ipcMain }, aid) => {
      const handlers = (ipcMain as any)._invokeHandlers, update = handlers.get('library:update');
      handlers.set('library:update', async (...args: any[]) => {
        try { return await update(...args); }
        catch (reason) {
          if (args[1].type === 'entry-remove' && args[1].id === aid) { (globalThis as any).failedRemovalHeld = true; await new Promise(resolve => { (globalThis as any).releaseFailedRemoval = resolve; }); }
          throw reason;
        }
      });
    }, aid);
    const blocked = path.join(profile, 'library.json.tmp'); await mkdir(blocked);
    try {
      await entry(a).locator('summary').click(); await entry(a).getByRole('button', { name: '移出论文库' }).click();
      await expect.poll(() => app.evaluate(() => !!(globalThis as any).failedRemovalHeld)).toBe(true);
      await entry(c).locator('.paper-open').click();
      await rmdir(blocked); await app.evaluate(() => (globalThis as any).releaseFailedRemoval());
      await expect(page.locator('.workspace-reader-host')).toHaveAttribute('data-reader-id', cid!); await expect(page.locator('.textLayer').first()).toContainText('Gamma');
      expect((await page.evaluate(() => window.paperdesk!.getLibrary())).activeId).toBe(cid);
    } finally { await rmdir(blocked).catch(() => {}); await app.evaluate(() => (globalThis as any).releaseFailedRemoval?.()); }
  });

  test('a slow native Open result cannot override a later library selection', async () => {
    await importFiles([a, b, c]); await loaded('paper.pdf'); await openEntry(c); await pick([a]);
    await app.evaluate(({ ipcMain }) => {
      const handlers = (ipcMain as any)._invokeHandlers, original = handlers.get('pdf:open');
      handlers.set('pdf:open', async (...args: any[]) => { const result = await original(...args); (globalThis as any).nativeOpenStarted = true; await new Promise(resolve => { (globalThis as any).releaseNativeOpen = resolve; }); (globalThis as any).nativeOpenReleased = true; return result; });
    });
    await page.getByRole('button', { name: '打开 PDF', exact: true }).click(); await expect.poll(() => app.evaluate(() => !!(globalThis as any).nativeOpenStarted)).toBe(true);
    await openEntry(b); const bid = await entry(b).getAttribute('data-library-id'); await app.evaluate(() => (globalThis as any).releaseNativeOpen());
    await expect.poll(() => app.evaluate(() => !!(globalThis as any).nativeOpenReleased)).toBe(true);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect((await page.evaluate(() => window.paperdesk!.getLibrary())).activeId).toBe(bid); await expect(page.locator('.textLayer').first()).toContainText('Beta');
  });

  test('switching away before restored layout settles preserves the incoming stored anchor', async () => {
    await importFiles([a, b]); await loaded('paper.pdf'); await setPage(3); await openEntry(b);
    const aid = await entry(a).getAttribute('data-library-id'), bid = await entry(b).getAttribute('data-library-id');
    await page.evaluate(({ aid, bid }) => {
      const host = document.querySelector('.workspace-reader-host')!;
      const observer = new MutationObserver(() => {
        if (host.getAttribute('data-reader-id') !== aid) return;
        observer.disconnect(); (window as any).switchedBeforeLayout = true;
        document.querySelector<HTMLButtonElement>(`.library-entry[data-library-id="${bid}"] .paper-open`)!.click();
      }); observer.observe(host, { attributes: true, attributeFilter: ['data-reader-id'] });
    }, { aid, bid });
    await entry(a).locator('.paper-open').click(); await expect.poll(() => page.evaluate(() => !!(window as any).switchedBeforeLayout)).toBe(true);
    await expect(page.locator('.workspace-reader-host')).toHaveAttribute('data-reader-id', bid!);
    expect((await page.evaluate(() => window.paperdesk!.getLibrary())).entries.find(entry => entry.id === aid)!.view!.page).toBe(3);
    await openEntry(a); await expect(page.getByRole('textbox', { name: '页码', exact: true })).toHaveValue('3');
  });

  test('scrolls overflowing tabs into view clear of the native window buttons', async () => {
    const files = [];
    for (let i = 1; i <= 8; i++) { const file = path.join(directory, `Long paper filename number ${i}.pdf`); await copyFile(a, file); files.push(file); }
    await importFiles(files); await loaded(path.basename(files[0])); for (const file of files.slice(1)) await openEntry(file);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(960, 760)); await page.getByRole('button', { name: '标签模式' }).click();
    await expect(page.getByRole('tab', { name: `打开论文 ${files[7]}`, exact: true })).toHaveAttribute('aria-selected', 'true');
    const activeTab = page.getByRole('tablist', { name: '打开的论文' }).getByRole('tab', { name: `打开论文 ${files[7]}`, exact: true });
    await expect.poll(async () => { const bounds = await activeTab.boundingBox(); return bounds ? bounds.x + bounds.width : Infinity; }).toBeLessThanOrEqual(820);
    await page.getByRole('button', { name: `关闭论文 ${files[7]}`, exact: true }).click(); await loaded(path.basename(files[6]));
  });

  for (const remove of [false, true]) {
    for (const queued of [false, true]) {
      test(`newer same-ID activation supersedes ${remove ? 'removal' : 'close'} ${queued ? 'inside the action queue' : 'during capture'}`, async () => {
        await importFiles([a, b]); await loaded('paper.pdf'); await openEntry(b); await openEntry(a);
        const aid = await entry(a).getAttribute('data-library-id');
        const documentId = (await page.evaluate(() => window.paperdesk!.getLibrary())).entries.find(entry => entry.id === aid)!.documentId!;
        await app.evaluate(({ ipcMain }, documentId) => {
          const handlers = (ipcMain as any)._invokeHandlers, suspend = handlers.get('session:suspend'), update = handlers.get('library:update'); let held = false;
          handlers.set('session:suspend', async (...args: any[]) => {
            const next = await suspend(...args);
            if (args[1] === documentId && !held) { held = true; (globalThis as any).sameCaptureHeld = true; await new Promise(resolve => { (globalThis as any).releaseSameCapture = resolve; }); }
            return next;
          });
          handlers.set('library:update', async (...args: any[]) => {
            const next = await update(...args);
            if (args[1].type === 'mode' && args[1].mode === 'tabs') { (globalThis as any).sameQueueHeld = true; await new Promise(resolve => { (globalThis as any).releaseSameQueue = resolve; }); }
            return next;
          });
        }, documentId);
        if (remove) { await entry(a).locator('summary').click(); await entry(a).getByRole('button', { name: '移出论文库' }).click(); await entry(a).locator('summary').click(); }
        else await entry(a).getByRole('button', { name: `关闭论文 ${a}`, exact: true }).click();
        await expect.poll(() => app.evaluate(() => !!(globalThis as any).sameCaptureHeld)).toBe(true);
        if (queued) {
          await page.getByRole('button', { name: '标签模式' }).click(); await expect.poll(() => app.evaluate(() => !!(globalThis as any).sameQueueHeld)).toBe(true);
          await app.evaluate(() => (globalThis as any).releaseSameCapture());
          await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
          await entry(a).locator('.paper-open').click(); await app.evaluate(() => (globalThis as any).releaseSameQueue());
        } else { await openEntry(a); await app.evaluate(() => (globalThis as any).releaseSameCapture()); }
        // A later ordered mode action is a queue barrier after the obsolete close continuation.
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        await page.getByRole('button', { name: '文件树模式' }).click(); await expect.poll(async () => (await page.evaluate(() => window.paperdesk!.getLibrary())).mode).toBe('sidebar');
        await expect(page.locator('.workspace-reader-host')).toHaveAttribute('data-reader-id', aid!); await expect(page.locator('.textLayer').first()).toContainText('Alpha');
        const next = await page.evaluate(() => window.paperdesk!.getLibrary()); expect(next.activeId).toBe(aid); expect(next.openIds).toContain(aid); expect(next.entries.some(entry => entry.id === aid)).toBe(true);
      });
    }

    test(`same-ID selection after committed ${remove ? 'removal' : 'close'} reconciles authoritative ownership`, async () => {
      await importFiles([a, b]); await loaded('paper.pdf'); await openEntry(b); await openEntry(a);
      const aid = await entry(a).getAttribute('data-library-id'), bid = await entry(b).getAttribute('data-library-id');
      await app.evaluate(({ ipcMain }, { aid, remove }) => {
        const handlers = (ipcMain as any)._invokeHandlers, update = handlers.get('library:update');
        handlers.set('library:update', async (...args: any[]) => {
          const next = await update(...args);
          if (args[1].id === aid && args[1].type === (remove ? 'entry-remove' : 'tab-close')) { (globalThis as any).sameOperationCommitted = true; await new Promise(resolve => { (globalThis as any).releaseSameOperation = resolve; }); }
          return next;
        });
      }, { aid, remove });
      if (remove) { await entry(a).locator('summary').click(); await entry(a).getByRole('button', { name: '移出论文库' }).click(); await entry(a).locator('summary').click(); }
      else await entry(a).getByRole('button', { name: `关闭论文 ${a}`, exact: true }).click();
      await expect.poll(() => app.evaluate(() => !!(globalThis as any).sameOperationCommitted)).toBe(true);
      await entry(a).locator('.paper-open').click(); await app.evaluate(() => (globalThis as any).releaseSameOperation());
      const expected = remove ? bid : aid;
      await expect(page.locator('.workspace-reader-host')).toHaveAttribute('data-reader-id', expected!);
      await expect(page.locator('.textLayer').first()).toContainText(remove ? 'Beta' : 'Alpha');
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      const next = await page.evaluate(() => window.paperdesk!.getLibrary()); expect(next.activeId).toBe(expected); expect(next.openIds).toContain(expected); expect(next.entries.some(entry => entry.id === expected)).toBe(true); expect(next.entries.some(entry => entry.id === aid)).toBe(!remove);
    });

    test(`${remove ? 'removing' : 'closing'} a pending activation cannot render its closed paper`, async () => {
      await importFiles([a, b]); await loaded('paper.pdf'); await openEntry(b); await openEntry(a);
      const aid = await entry(a).getAttribute('data-library-id'), bid = await entry(b).getAttribute('data-library-id');
      await app.evaluate(({ ipcMain }, bid) => {
        const handlers = (ipcMain as any)._invokeHandlers, original = handlers.get('library:update');
        handlers.set('library:update', async (...args: any[]) => {
          const next = await original(...args);
          if (args[1].type === 'tab-activate' && args[1].id === bid) { (globalThis as any).activationAccepted = true; await new Promise(resolve => { (globalThis as any).releaseActivation = resolve; }); }
          return next;
        });
      }, bid);
      await entry(b).locator('.paper-open').click(); await expect.poll(() => app.evaluate(() => !!(globalThis as any).activationAccepted)).toBe(true);
      if (remove) { await entry(b).locator('summary').click(); await entry(b).getByRole('button', { name: '移出论文库' }).click(); }
      else await entry(b).getByRole('button', { name: `关闭论文 ${b}`, exact: true }).click();
      await app.evaluate(() => (globalThis as any).releaseActivation());
      await expect.poll(async () => (await page.evaluate(() => window.paperdesk!.getLibrary())).openIds.includes(bid!)).toBe(false);
      await expect(page.locator('.workspace-reader-host')).toHaveAttribute('data-reader-id', aid!); await expect(page.locator('.textLayer').first()).toContainText('Alpha');
      const next = await page.evaluate(() => window.paperdesk!.getLibrary()); expect(next.activeId).toBe(aid); expect(next.entries.some(entry => entry.id === bid)).toBe(!remove);
    });

    test(`stale active ${remove ? 'removal' : 'close'} completion preserves a newer reader`, async () => {
      await importFiles([a, b, c]); await loaded('paper.pdf'); await openEntry(b); await openEntry(c); await openEntry(a);
      const aid = await entry(a).getAttribute('data-library-id'), cid = await entry(c).getAttribute('data-library-id');
      const documentId = (await page.evaluate(() => window.paperdesk!.getLibrary())).entries.find(entry => entry.id === aid)!.documentId!;
      await app.evaluate(({ ipcMain }, documentId) => {
        const handlers = (ipcMain as any)._invokeHandlers, original = handlers.get('session:suspend'); let held = false;
        handlers.set('session:suspend', async (...args: any[]) => {
          const next = await original(...args);
          if (args[1] === documentId && !held) { held = true; (globalThis as any).closeCaptureAccepted = true; await new Promise(resolve => { (globalThis as any).releaseCloseCapture = resolve; }); }
          return next;
        });
      }, documentId);
      if (remove) { await entry(a).locator('summary').click(); await entry(a).getByRole('button', { name: '移出论文库' }).click(); }
      else await entry(a).getByRole('button', { name: `关闭论文 ${a}`, exact: true }).click();
      await expect.poll(() => app.evaluate(() => !!(globalThis as any).closeCaptureAccepted)).toBe(true);
      await openEntry(c);
      await page.evaluate(() => { const range = document.createRange(); range.selectNodeContents(document.querySelector('.textLayer span')!); window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range); });
      await app.evaluate(() => (globalThis as any).releaseCloseCapture());
      await expect.poll(async () => (await page.evaluate(() => window.paperdesk!.getLibrary())).openIds.includes(aid!)).toBe(false);
      await expect(page.locator('.workspace-reader-host')).toHaveAttribute('data-reader-id', cid!); await expect(page.locator('.textLayer').first()).toContainText('Gamma');
      expect((await page.evaluate(() => window.paperdesk!.getLibrary())).activeId).toBe(cid);
      expect(await page.evaluate(() => window.getSelection()!.toString())).toContain('Gamma');
    });
  }
});
