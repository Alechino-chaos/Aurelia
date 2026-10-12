import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

const profile = path.join(process.cwd(), 'tmp/security-e2e', String(Date.now()));
const env = { ...process.env, PAPERDESK_TEST_DIR: profile }; delete env.ELECTRON_RUN_AS_NODE;
const packaged = process.env.AURELIA_TEST_EXECUTABLE;
const executablePath = packaged ?? process.env.PAPERDESK_ELECTRON_PATH!;
const args = packaged ? [`--user-data-dir=${profile}`] : [path.join(process.cwd(), 'dist-electron/main.js')];
let app: ElectronApplication, page: Page;

test.describe.serial('desktop security boundaries', () => {
  test.beforeAll(async () => {
    await mkdir(profile, { recursive: true });
    app = await electron.launch({ executablePath, args, env }); page = await app.firstWindow();
    await page.getByRole('heading', { name: '打开论文' }).waitFor();
  });
  test.afterAll(async () => { await app?.close(); });

  test('denies renderer Node access, untrusted IPC and popup windows', async () => {
    const expectedRuntime = JSON.parse(await readFile('node_modules/electron/package.json', 'utf8')).version;
    expect(await app.evaluate(() => process.versions.electron)).toBe(expectedRuntime);
    const prefs = await app.evaluate(({ BrowserWindow }) => {
      const p = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
      return { sandbox: p.sandbox, contextIsolation: p.contextIsolation, nodeIntegration: p.nodeIntegration };
    });
    expect(prefs).toEqual({ sandbox: true, contextIsolation: true, nodeIntegration: false });
    expect(await page.evaluate(() => typeof (window as any).require)).toBe('undefined');
    const preload = packaged ? path.join(path.dirname(packaged), 'resources/app.asar/dist-electron/preload.cjs')
      : path.join(process.cwd(), 'dist-electron/preload.cjs');
    const rejected = await app.evaluate(async ({ BrowserWindow }, preload) => {
      const main = BrowserWindow.getAllWindows()[0];
      const foreign = new BrowserWindow({ show: false, webPreferences: {
        preload, sandbox: true, contextIsolation: true, nodeIntegration: false,
      } });
      try {
        await foreign.loadURL(main.webContents.getURL());
        const result = await foreign.webContents.executeJavaScript('(async () => { if (!window.paperdesk) return { bridge: false }; try { await window.paperdesk.getAiSettings(); return { bridge: true, rejected: false }; } catch { return { bridge: true, rejected: true }; } })()');
        return result;
      } finally { foreign.destroy(); }
    }, preload);
    expect(rejected).toMatchObject({ bridge: true, rejected: true });
    await page.evaluate(() => { window.open('https://example.invalid/blocked'); });
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
    const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
    expect(policy).toContain("frame-src 'none'"); expect(policy).toContain("form-action 'none'");
    expect(policy).not.toContain('ws://');
  });

  test('a second launch focuses the existing window without overwriting its session', async () => {
    const key = 'a'.repeat(64);
    await page.evaluate(async key => {
      const s = await window.paperdesk!.loadReadingSession(key, 'security-fixture.pdf');
      await window.paperdesk!.updateReadingSession(key, { type: 'draft', chatId: s.activeChatId, draft: '保留这份草稿' });
    }, key);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
    const status = await new Promise<number | null>((resolve, reject) => {
      const child = spawn(executablePath, args, { env, windowsHide: true, stdio: 'ignore' });
      const timer = setTimeout(() => { child.kill(); reject(new Error('Second launch did not exit')); }, 15000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); resolve(code); });
    });
    expect(status).toBe(0);
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized())).toBe(false);
    const session = await page.evaluate(key => window.paperdesk!.loadReadingSession(key, 'security-fixture.pdf'), key);
    expect(session.chats[0].draft).toBe('保留这份草稿');
  });

  test('never forwards an API key to a redirect target', async () => {
    let targetHits = 0;
    const server = createServer((req, res) => {
      if (req.url === '/target') { targetHits++; res.end('unexpected'); }
      else { res.writeHead(302, { Location: '/target' }); res.end(); }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
      const events = await page.evaluate(async baseUrl => {
        await window.paperdesk!.saveAiSettings({ baseUrl, apiKey: 'redirect-test-secret', model: 'test', targetLanguage: '简体中文' });
        const events: { type: string }[] = [];
        const off = window.paperdesk!.onAiEvent(event => events.push(event));
        try { await window.paperdesk!.startAi({ id: 'redirect-check', kind: 'chat', messages: [{ role: 'user', content: 'hello' }] }); }
        finally { off(); }
        return events;
      }, baseUrl);
      expect(events.some(e => e.type === 'error')).toBe(true);
      expect(JSON.stringify(events)).not.toContain('redirect-test-secret');
      expect(targetHits).toBe(0);
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});
