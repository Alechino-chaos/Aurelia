import { establishChinese } from './language-helper';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const profile = path.join(root, 'tmp/zoom-e2e', String(Date.now()));
let app: ElectronApplication;
let page: Page;
const errors: string[] = [];

async function open(file: string) {
  await app.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }); }, file);
  await page.getByRole('button', { name: '打开 PDF', exact: true }).click();
  // The old document can still report raster-ready before the async file dialog
  // has delivered the new file. Wait for the requested document before zooming.
  await expect(page.locator('.document-label')).toHaveText(path.basename(file));
  await expect(page.locator('.loading-overlay')).toHaveCount(0);
  await expect(page.locator('.pdf-page').first()).toHaveAttribute('data-raster-ready', 'true');
}
async function zoom(value: string) {
  await page.getByRole('combobox', { name: '缩放比例' }).selectOption(value);
  await expect(page.locator('.pdf-page').first()).toHaveAttribute('data-render-scale', value);
  await expect(page.locator('.pdf-page').first()).toHaveAttribute('data-raster-ready', 'true');
}

test.describe.serial('sharp and responsive zoom', () => {
  test.beforeAll(async () => {
    await mkdir(profile, { recursive: true });
    const env = { ...process.env, PAPERDESK_TEST_DIR: profile };
    delete env.ELECTRON_RUN_AS_NODE;
    const packaged = process.env.AURELIA_TEST_EXECUTABLE;
    app = await electron.launch({ executablePath: packaged ?? process.env.PAPERDESK_ELECTRON_PATH,
      args: [...(packaged ? [`--user-data-dir=${profile}`] : [path.join(root, 'dist-electron/main.js')]), '--force-device-scale-factor=2'], cwd: root, env });
    page = await app.firstWindow(); await establishChinese(page);
    page.on('pageerror', error => errors.push(error.message));
    await page.getByRole('heading', { name: '打开论文' }).waitFor();
  });
  test.afterAll(async () => { await app?.close(); });

  test('keeps the old bitmap during a zoom burst, reuses text nodes and finishes at native resolution', async () => {
    await open(path.join(root, 'public/examples/reading-demo.pdf'));
    await zoom('1');
    const result = await page.evaluate(async () => {
      const pdf = document.querySelector<HTMLElement>('.pdf-page')!;
      const host = pdf.querySelector('.canvas-host')!;
      const old = host.querySelector('canvas')!;
      const text = pdf.querySelector('.textLayer span');
      const reader = document.querySelector('.reader')!;
      let swaps = 0;
      const observer = new MutationObserver(() => swaps++);
      observer.observe(host, { childList: true });
      const frames: number[] = [];
      const start = performance.now();
      let previous = start;
      let blank = false;
      for (let i = 0; i < 8; i++) {
        reader.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true }));
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        await new Promise(resolve => setTimeout(resolve, 20));
        const now = performance.now(); frames.push(now - previous); previous = now;
        blank ||= !old.isConnected || old.width === 0 || old.height === 0;
      }
      const retained = text === pdf.querySelector('.textLayer span');
      const duringSwaps = swaps;
      await new Promise<void>((resolve, reject) => {
        const deadline = performance.now() + 8000;
        const check = () => {
          if (pdf.dataset.renderScale === '1.8' && pdf.dataset.rasterReady === 'true') resolve();
          else if (performance.now() > deadline) reject(new Error('Final sharp raster did not finish'));
          else setTimeout(check, 20);
        };
        check();
      });
      observer.disconnect();
      const canvas = host.querySelector('canvas')!;
      return { blank, retained, duringSwaps, swaps, width: canvas.width, height: canvas.height,
        density: window.devicePixelRatio, maxStepMs: Math.max(...frames), settleMs: performance.now() - previous,
        scale: pdf.dataset.renderScale, mode: pdf.dataset.rasterMode };
    });
    console.log('Zoom metrics', result);
    expect(result.blank).toBe(false);
    expect(result.retained).toBe(true);
    expect(result.duringSwaps).toBe(0);
    expect(result.swaps).toBe(1);
    expect(result.width).toBe(Math.ceil(612 * 1.8 * result.density));
    expect(result.height).toBe(Math.ceil(792 * 1.8 * result.density));
    expect(result.mode).toBe('full');
    await writeFile(path.join(root, 'tmp/zoom-metrics.json'), JSON.stringify(result, null, 2));
  });

  test('high resolution tiles match full-page rendering across tile seams and remain sharp after scrolling', async () => {
    // Identical top-of-page content; only the page height changes. This lets
    // us compare native browser raster pixels in full-page and tiled modes.
    for (const height of [792, 3000]) {
      const pdf = await PDFDocument.create();
      const font = await pdf.embedFont(StandardFonts.TimesRoman);
      const sheet = pdf.addPage([612, height]);
      for (const top of [0, 800, 1600, 2400]) {
        if (top >= height) break;
        for (let row = 0; row < 30; row++) sheet.drawText(`Sharp PDF: fine text, 0123456789, row ${row}`, { x: 40, y: height - top - 45 - row * 14, size: 9, font });
        sheet.drawLine({ start: { x: 20, y: height - top - 50 }, end: { x: 580, y: height - top - 370 }, thickness: .35, color: rgb(.1, .4, .2) });
      }
      await writeFile(path.join(profile, `quality-${height}.pdf`), await pdf.save());
    }
    await open(path.join(profile, 'quality-792.pdf'));
    await zoom('2');
    await page.locator('.reader').evaluate(el => { el.scrollTop = 0; el.scrollLeft = 0; });
    const comparePixels = (save: boolean) => page.evaluate(save => {
      const pdf = document.querySelector<HTMLElement>('.pdf-page')!;
      const base = pdf.querySelector<HTMLCanvasElement>('canvas[data-preview]')!;
      const canvas = document.createElement('canvas'); canvas.width = 1600; canvas.height = 1024;
      const ctx = canvas.getContext('2d')!;
      const fullWidth = 612 * 2 * window.devicePixelRatio;
      const fullHeight = Number.parseFloat(pdf.style.height) * window.devicePixelRatio;
      ctx.drawImage(base, 0, 0, fullWidth, fullHeight);
      for (const tile of pdf.querySelectorAll<HTMLCanvasElement>('canvas[data-tile]')) {
        const [x, y] = tile.dataset.tile!.split(':').map(Number);
        ctx.drawImage(tile, x * 1024, y * 1024);
      }
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const state = window as typeof window & { zoomBaseline?: Uint8ClampedArray };
      if (save) { state.zoomBaseline = pixels; return { mismatch: 0, ink: 0 }; }
      const reference = state.zoomBaseline!;
      let mismatch = 0, ink = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (reference[i] < 240) ink++;
        if (Math.abs(pixels[i] - reference[i]) > 2 || Math.abs(pixels[i + 1] - reference[i + 1]) > 2 || Math.abs(pixels[i + 2] - reference[i + 2]) > 2) mismatch++;
      }
      return { mismatch, ink };
    }, save);
    await expect(page.locator('.pdf-page')).toHaveAttribute('data-raster-mode', 'full');
    await comparePixels(true);
    await open(path.join(profile, 'quality-3000.pdf'));
    await zoom('2');
    await expect(page.locator('.pdf-page')).toHaveAttribute('data-raster-mode', 'tiles');
    const comparison = await comparePixels(false);
    console.log('Full-page vs tiles', comparison);
    expect(comparison.ink).toBeGreaterThan(10000);
    expect(comparison.mismatch / comparison.ink).toBeLessThan(.01);
    await mkdir(path.join(root, 'test-results/screenshots'), { recursive: true });
    await page.screenshot({ path: 'test-results/screenshots/zoom-sharp-tiles.png' });
    await page.locator('.reader').evaluate(el => { el.scrollTop = 1800; });
    await expect.poll(() => page.locator('canvas[data-tile]').evaluateAll(tiles => tiles.some(tile => Number((tile as HTMLElement).dataset.tile!.split(':')[1]) >= 3))).toBe(true);
    await expect(page.locator('.pdf-page')).toHaveAttribute('data-raster-ready', 'true');
    const coverage = await page.evaluate(() => {
      const pdf = document.querySelector('.pdf-page')!.getBoundingClientRect();
      const root = document.querySelector('.reader')!.getBoundingClientRect();
      const tiles = [...document.querySelectorAll<HTMLCanvasElement>('canvas[data-tile]')];
      const rects = tiles.map(tile => tile.getBoundingClientRect());
      let missing = 0;
      for (let y = Math.max(root.top, pdf.top) + 10; y < Math.min(root.bottom, pdf.bottom) - 10; y += 50) {
        for (let x = Math.max(root.left, pdf.left) + 10; x < Math.min(root.right, pdf.right) - 12; x += 50) {
          if (!rects.some(rect => x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom)) missing++;
        }
      }
      return { missing, count: tiles.length, native: tiles.every(tile => Number(tile.dataset.pixelRatio) === window.devicePixelRatio) };
    });
    expect(coverage.missing).toBe(0);
    expect(coverage.native).toBe(true);
    expect(coverage.count).toBeLessThanOrEqual(20);
    await page.screenshot({ path: 'test-results/screenshots/zoom-sharp-scrolled.png' });
    expect(errors).toEqual([]);
  });
});
