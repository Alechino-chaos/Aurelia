// Explicit, isolated NSIS A -> B verification. Never runs on production builds.
// Usage: node scripts/verify-installed-update.mjs <installed-test-exe> <B-artifacts-dir>
import { _electron as electron, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile, copyFile, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import asar from '@electron/asar';

if (process.argv.length !== 4) throw new Error('Provide installed test exe and B artifacts directory');
const [executable, artifacts] = process.argv.slice(2).map(value => path.resolve(value));
const deliveryVersion = JSON.parse(await readFile('package.json', 'utf8')).version;
const evidenceDirectory = path.resolve('release/verification', `installer-${deliveryVersion}`);
await mkdir(evidenceDirectory, { recursive: true });
const installedPackage = () => JSON.parse(asar.extractFile(path.join(path.dirname(executable), 'resources/app.asar'), 'package.json').toString());
assert.equal(installedPackage().aureliaUpdateTest, true, 'Refuse production installation');
const beforeVersion = installedPackage().version;
const metadata = await readFile(path.join(artifacts, 'latest.yml'), 'utf8');
const afterVersion = /^version: (.+)$/m.exec(metadata)?.[1];
assert.ok(afterVersion && afterVersion !== beforeVersion);
// Match the marked app's fallback so NSIS ShellAsUser restart remains isolated
// even when Windows drops the launching process's environment variables.
const installationId = createHash('sha256').update(path.resolve(path.dirname(executable)).toLowerCase()).digest('hex').slice(0, 16);
const profile = path.join(os.tmpdir(), `aurelia-update-test-${installationId}`);
await mkdir(profile, { recursive: true });
const cacheRoot = path.join(profile, 'cache-root');
await mkdir(cacheRoot, { recursive: true });
await writeFile(path.join(profile, 'app-settings.json'), JSON.stringify({ locale: 'en' }));
await writeFile(path.join(profile, 'update-preferences.json'), JSON.stringify({ autoCheck: false, lastCheckedAt: null }));
const paper = path.join(profile, 'upgrade-paper.pdf');
await copyFile('tests/fixtures/navigation.pdf', paper);
const requests = [];
let slowDownload = false;
const server = createServer(async (request, response) => {
  const basename = path.basename(decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
  requests.push(basename);
  if (!/^latest\.yml$|^Aurelia-[\d.]+-setup\.exe(?:\.blockmap)?$/.test(basename)) { response.writeHead(404).end(); return; }
  try {
    const file = path.join(artifacts, basename), info = await stat(file);
    response.writeHead(200, { 'Content-Length': info.size, 'Content-Type': basename.endsWith('.yml') ? 'text/yaml' : 'application/octet-stream' });
    if (slowDownload && basename.endsWith('.exe')) {
      const stream = createReadStream(file, { highWaterMark: 64 * 1024 });
      response.on('close', () => stream.destroy());
      for await (const chunk of stream) {
        if (response.destroyed) break;
        response.write(chunk); await new Promise(resolve => setTimeout(resolve, 10));
      }
      response.end();
    } else createReadStream(file).pipe(response);
  } catch { if (!response.headersSent) response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const env = { ...process.env, AURELIA_UPDATE_TEST_PROFILE: profile,
  LOCALAPPDATA: cacheRoot,
  AURELIA_UPDATE_TEST_URL: `http://127.0.0.1:${server.address().port}` };
delete env.ELECTRON_RUN_AS_NODE;
delete env.PAPERDESK_DEV_URL;
let app;
const launch = async () => {
  app = await electron.launch({ executablePath: executable, args: [`--user-data-dir=${profile}`, '--force-device-scale-factor=1'], env });
  const page = await app.firstWindow();
  await expect(page.locator('[data-workspace-ready="true"]')).toBeVisible();
  await expect.poll(() => page.evaluate(async () => (await window.paperdesk.getUpdateState()).supported)).toBe(true);
  return page;
};
try {
  let page = await launch();
  const runtime = await app.evaluate(({ app }) => ({ version: app.getVersion(), profile: app.getPath('userData') }));
  assert.equal(runtime.version, beforeVersion); assert.equal(path.resolve(runtime.profile), profile);
  await app.evaluate(({ dialog }, paper) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paper] }); }, paper);
  await page.getByRole('button', { name: 'Open PDF', exact: true }).click();
  await expect(page.locator('[data-page-number="1"]')).toHaveAttribute('data-text-ready', 'true');
  const seeded = await page.evaluate(async () => {
    const bridge = window.paperdesk, library = await bridge.getLibrary();
    const entry = library.entries.find(item => item.id === library.activeId);
    await bridge.loadReadingSession(entry.documentId, entry.name);
    await bridge.updateReadingSession(entry.documentId, { type: 'annotation-add', entry: {
      id: 'upgrade-proof', createdAt: 1, updatedAt: 1, color: 'yellow',
      quote: { text: 'Preserved excerpt 原文', fileName: entry.name, pages: [1] }, note: 'Preserved note 批注',
      regions: [{ page: 1, x: .1, y: .2, width: .3, height: .03 }],
    } });
    const grouped = await bridge.updateLibrary({ type: 'group-create', name: 'Upgrade verification 研究' });
    await bridge.updateLibrary({ type: 'entry-move', id: entry.id, groupId: grouped.groups.at(-1).id });
    await bridge.saveAiSettings({ baseUrl: 'https://example.com/v1', model: 'upgrade-verification', targetLanguage: '日本語', apiKey: 'test-only-upgrade-key' });
    return { documentId: entry.documentId, fileName: entry.name };
  });
  await page.locator('.page-input').fill('2'); await page.locator('.page-input').press('Enter');
  await expect(page.locator('.page-input')).toHaveValue('2');
  // Check metadata only, then prove the explicit download boundary.
  let state = await page.evaluate(() => window.paperdesk.checkForUpdates());
  assert.equal(state.phase, 'available'); assert.equal(state.availableVersion, afterVersion);
  assert.equal(requests.filter(name => name.endsWith('.exe')).length, 0);
  slowDownload = true;
  await page.evaluate(() => { void window.paperdesk.downloadUpdate(); });
  await expect.poll(() => requests.filter(name => name.endsWith('.exe')).length).toBeGreaterThan(0);
  assert.equal((await page.evaluate(() => window.paperdesk.cancelUpdateDownload())).phase, 'cancelled');
  await expect.poll(() => page.evaluate(async () => (await window.paperdesk.getUpdateState()).phase)).toBe('cancelled');
  slowDownload = false;
  // Wait for the cancellation to settle before retrying the single driver.
  await expect.poll(async () => (await page.evaluate(() => window.paperdesk.downloadUpdate())).phase, { timeout: 120000 }).toBe('downloaded');
  await app.close(); app = undefined;
  const settingsBefore = await readFile(path.join(profile, 'ai-settings.json'), 'utf8');
  assert.equal(installedPackage().version, beforeVersion, 'Normal close must not install');
  page = await launch();
  assert.equal((await app.evaluate(({ app }) => app.getVersion())), beforeVersion, 'Restart must not install');
  state = await page.evaluate(() => window.paperdesk.checkForUpdates()); assert.equal(state.phase, 'available');
  state = await page.evaluate(() => window.paperdesk.downloadUpdate()); assert.equal(state.phase, 'downloaded');
  const exit = app.waitForEvent('close', { timeout: 60000 });
  await page.evaluate(() => { void window.paperdesk.installUpdate(); });
  await exit; app = undefined;
  await expect.poll(() => { try { return installedPackage().version; } catch { return 'installing'; } }, { timeout: 120000 }).toBe(afterVersion);
  assert.equal(JSON.parse(await readFile(path.join(profile, 'app-settings.json'), 'utf8')).locale, 'en');
  assert.equal(await readFile(path.join(profile, 'ai-settings.json'), 'utf8'), settingsBefore);
  const libraryAfter = JSON.parse(await readFile(path.join(profile, 'library.json'), 'utf8'));
  assert.ok(libraryAfter.groups.some(group => group.name === 'Upgrade verification 研究'));
  assert.equal(libraryAfter.entries.find(entry => entry.id === libraryAfter.activeId).view.page, 2);
  const sessionAfter = JSON.parse(await readFile(path.join(profile, 'reading-sessions', `${seeded.documentId}.json`), 'utf8'));
  assert.ok(sessionAfter.annotations.some(note => note.id === 'upgrade-proof' && note.note === 'Preserved note 批注'));
  assert.deepEqual(await readFile(paper), await readFile('tests/fixtures/navigation.pdf'));
  const evidence = { beforeVersion, afterVersion, executable, profile, seeded, requests, verified: [
    'registered custom test install', 'check does not download', 'cancel download', 'explicit retry',
    'ordinary close does not install', 'restart does not install', 'explicit actual NSIS upgrade', 'locale preserved',
    'AI configuration and encrypted test key preserved', 'library group preserved', 'reading page preserved', 'annotation preserved', 'original PDF unchanged',
  ] };
  await writeFile(path.join(evidenceDirectory, 'upgrade-evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  if (app) await app.close();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
