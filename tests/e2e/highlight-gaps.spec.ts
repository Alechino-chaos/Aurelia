import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import path from 'node:path';

const root = process.cwd(), profile = path.join(root, 'tmp/highlight-gaps-e2e', String(Date.now()));
const paper = path.join(profile, 'word-runs.pdf');
let app: ElectronApplication, page: Page, documentId: string;
const errors: string[] = [];
const lines = ['SpecTrA introduces Progressive Anchor Spectrum', '(PAS) to organize scene representation across',
  'multiple detail levels allowing the same learned', 'representation to progressively adapt its capacity.'];
async function launch() {
  const env = { ...process.env, PAPERDESK_TEST_DIR: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const packaged = process.env.AURELIA_TEST_EXECUTABLE;
  app = await electron.launch({ executablePath: packaged ?? process.env.PAPERDESK_ELECTRON_PATH,
    args: packaged ? [`--user-data-dir=${profile}`, '--force-device-scale-factor=1'] : [path.join(root, 'dist-electron/main.js'), '--force-device-scale-factor=1'], env });
  page = await app.firstWindow(); page.on('pageerror', e => errors.push(e.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 960));
  await page.getByRole('heading', { name: '打开论文' }).waitFor();
  await app.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }); }, paper);
  await page.getByRole('button', { name: '打开 PDF', exact: true }).click();
  await expect(page.locator('[data-page-number="1"]')).toHaveAttribute('data-text-ready', 'true');
  await page.getByRole('tab', { name: '批注', exact: true }).click();
  await expect(page.locator('.annotation-save-state')).toHaveText('已保存到本机');
}
async function select(number = 1, partial = false) {
  await page.evaluate(({ number, partial }) => {
    const spans = Array.from(document.querySelectorAll(`[data-page-number="${number}"] .textLayer [data-line]`));
    const a = spans.find(el => el.textContent === 'SpecTrA')!, b = spans.find(el => el.textContent === 'capacity.')!;
    const range = document.createRange(); range.setStart(a.firstChild!, partial ? 3 : 0); range.setEnd(b.firstChild!, b.textContent!.length - (partial ? 3 : 0));
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
  }, { number, partial });
  await expect(page.getByRole('toolbar', { name: '选区操作' })).toBeVisible();
}

test.describe.serial('continuous highlights over separate PDF word runs', () => {
  test.beforeAll(async () => {
    await mkdir(profile, { recursive: true });
    const pdf = await PDFDocument.create(), regular = await pdf.embedFont(StandardFonts.TimesRoman), bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
    for (const rotation of [0, 90]) {
      const p = pdf.addPage([612, 792]); p.setRotation(degrees(rotation));
      p.drawText('Abstract', { x: 255, y: 724, font: bold, size: 18 });
      for (const [row, line] of lines.entries()) {
        let x = 40;
        for (const [i, word] of line.split(' ').entries()) {
          const font = i % 2 ? regular : bold;
          p.drawText(word, { x, y: 680 - row * 17, font, size: 11 });
          x += font.widthOfTextAtSize(word, 11) + 6;
        }
      }
      for (let row = 0; row < lines.length; row++)
        p.drawText(`Right column ${row + 1} must stay unmarked.`, { x: 330, y: 680 - row * 17, font: regular, size: 11 });
    }
    const bytes = await pdf.save(); documentId = createHash('sha256').update(bytes).digest('hex');
    await writeFile(paper, bytes); await launch();
  });
  test.afterAll(async () => { await app?.close(); });

  test('paints one strip per line while preserving selected character bounds, copying, and zoom alignment', async () => {
    await select(1, true);
    await page.keyboard.press('Control+c');
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(lines.join(' ').slice(3, -3));
    await page.getByRole('toolbar', { name: '选区操作' }).getByRole('button', { name: '高亮', exact: true }).click();
    const marks = page.locator('[data-page-number="1"] .annotation-highlight');
    await expect(marks).toHaveCount(4);
    for (const scale of ['1', '1.5', '0.75']) {
      await page.getByRole('combobox', { name: '缩放比例' }).selectOption(scale);
      await expect(page.locator('[data-page-number="1"]')).toHaveAttribute('data-text-scale', scale);
      const geometry = await page.evaluate(() => {
        const spans = Array.from(document.querySelectorAll('[data-page-number="1"] .textLayer [data-line]'));
        const first = spans.find(el => el.textContent === 'SpecTrA')!, last = spans.find(el => el.textContent === 'capacity.')!;
        const range = document.createRange(); range.setStart(first.firstChild!, 3); range.setEnd(first.firstChild!, first.textContent!.length);
        const start = range.getBoundingClientRect().left;
        range.setStart(last.firstChild!, 0); range.setEnd(last.firstChild!, last.textContent!.length - 3);
        const end = range.getBoundingClientRect().right;
        const marks = Array.from(document.querySelectorAll('[data-page-number="1"] .annotation-highlight')).map(el => el.getBoundingClientRect());
        const right = spans.find(el => el.textContent?.startsWith('Right column'))!.getBoundingClientRect().left;
        return { startDelta: Math.abs(marks[0].left - start), endDelta: Math.abs(marks[3].right - end), gutterClear: marks.every(r => r.right < right) };
      });
      expect(geometry.startDelta).toBeLessThan(1); expect(geometry.endDelta).toBeLessThan(1); expect(geometry.gutterClear).toBe(true);
    }
    await page.getByRole('combobox', { name: '缩放比例' }).selectOption('1.5');
    await expect(page.locator('[data-page-number="1"]')).toHaveAttribute('data-text-scale', '1.5');
    await expect(page.locator('[data-page-number="1"] canvas[data-render-scale="1.5"]')).toHaveCount(1);
    await expect(page.locator('[data-page-number="1"]')).toHaveAttribute('data-raster-ready', 'true');
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const box = (await page.locator('[data-page-number="1"]').boundingBox())!;
    const reader = (await page.locator('.reader').boundingBox())!;
    await page.screenshot({ path: 'test-results/screenshots/highlight-continuous.png', clip: { x: box.x, y: box.y, width: Math.min(box.width, reader.x + reader.width - box.x - 8), height: 280 } });
  });

  test('restores original fragmented anchors as continuous strips and handles rotated word runs', async () => {
    const stored = await page.evaluate(async id => window.paperdesk!.loadReadingSession(id, 'word-runs.pdf'), documentId);
    expect(stored.annotations[0].regions.length).toBeGreaterThan(20);
    await app.close(); await launch();
    await expect(page.locator('[data-page-number="1"] .annotation-highlight')).toHaveCount(4);
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    await expect(page.locator('[data-page-number="2"]')).toHaveAttribute('data-text-ready', 'true');
    await select(2);
    await page.getByRole('toolbar', { name: '选区操作' }).getByRole('button', { name: '高亮', exact: true }).click();
    await expect(page.locator('[data-page-number="2"] .annotation-highlight')).toHaveCount(4);
    expect(errors).toEqual([]);
  });
});
