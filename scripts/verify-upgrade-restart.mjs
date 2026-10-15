// Run after the automatically restarted test application has been closed normally.
// Usage: node scripts/verify-upgrade-restart.mjs <upgrade-evidence.json>
import { _electron as electron, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import asar from '@electron/asar';

const evidenceFile = process.argv[2];
if (!evidenceFile) throw new Error('Provide upgrade evidence file');
const evidence = JSON.parse(await readFile(evidenceFile, 'utf8'));
const metadata = JSON.parse(asar.extractFile(path.join(path.dirname(evidence.executable), 'resources/app.asar'), 'package.json').toString());
assert.equal(metadata.aureliaUpdateTest, true, 'Refuse production installation');
const env = { ...process.env };
for (const key of ['ELECTRON_RUN_AS_NODE', 'PAPERDESK_DEV_URL', 'AURELIA_UPDATE_TEST_PROFILE', 'AURELIA_UPDATE_TEST_URL']) delete env[key];
// No profile argument or override: exercise the safe installed-test fallback.
const app = await electron.launch({ executablePath: evidence.executable, args: ['--force-device-scale-factor=1'], env });
try {
  const runtime = await app.evaluate(({ app }) => ({ version: app.getVersion(), profile: app.getPath('userData') }));
  assert.equal(runtime.version, evidence.afterVersion);
  assert.equal(path.resolve(runtime.profile).toLowerCase(), path.resolve(evidence.profile).toLowerCase());
  const page = await app.firstWindow();
  await expect(page.locator('[data-workspace-ready="true"]')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('.page-input')).toHaveValue('2');
  const persisted = await page.evaluate(async () => {
    const bridge = window.paperdesk, library = await bridge.getLibrary();
    const active = library.entries.find(item => item.id === library.activeId);
    return { ai: await bridge.getAiSettings(), library, session: await bridge.loadReadingSession(active.documentId, active.name), updates: await bridge.getUpdateState() };
  });
  assert.equal(persisted.ai.model, 'upgrade-verification');
  assert.equal(persisted.ai.targetLanguage, '日本語');
  assert.equal(persisted.ai.hasApiKey, true);
  assert.ok(!persisted.ai.keyError);
  assert.equal(persisted.updates.supported, true);
  assert.equal(persisted.updates.autoCheck, false);
  assert.ok(persisted.library.groups.some(group => group.name === 'Upgrade verification 研究'));
  assert.ok(persisted.session.annotations.some(note => note.id === 'upgrade-proof' && note.note === 'Preserved note 批注'));
  evidence.restart = { ...runtime, encryptedKeyDecrypts: true, restoredPage: 2, annotationsRestored: true, updaterSupported: true };
  await page.screenshot({ path: evidenceFile.replace(/\.json$/, '-restart.png') });
  await writeFile(evidenceFile, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence.restart, null, 2));
} finally { await app.close(); }
