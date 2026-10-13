import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { emptyHistory, recordJump, stepHistory, type NavigationPoint } from '../src/navigation/history';
import { resolveDestination } from '../src/navigation/destinations';
import { classifyNativeLink, nativeLinkRect } from '../src/navigation/links';
import { validateExternalUrl } from '../electron/external-url';

const point = (page: number, x = .2, y = .3, zoom: NavigationPoint['zoom'] = 1.25): NavigationPoint => ({ page, x, y, zoom });
describe('navigation history', () => {
  it('restores exact signed coordinates and zoom, and uses the scrolled departure on forward', () => {
    const start = point(1, -.012, .345678, 'fit');
    const history = recordJump(emptyHistory(), start, point(3));
    const back = stepHistory(history, 'back', point(3, .4, .6, 2));
    expect(back.target).toEqual(start);
    expect(stepHistory(back.history, 'forward', point(1, .1, .5)).target).toEqual(point(3, .4, .6, 2));
    expect(history).toEqual({ past: [start], future: [] });
  });
  it('clears forward on a successful branch but keeps it on subpixel no-op', () => {
    const back = stepHistory(recordJump(emptyHistory(), point(1), point(2)), 'back', point(2));
    expect(recordJump(back.history, point(1), point(1, .20001, .30001))).toBe(back.history);
    expect(recordJump(back.history, point(1), point(4))).toEqual({ past: [point(1)], future: [] });
    expect(recordJump(emptyHistory(), point(1), point(1, .2, .3, 'fit')).past).toEqual([point(1)]);
  });
  it('caps both stacks, keeps entry memories independent, and copies input points', () => {
    let history = emptyHistory();
    const other = emptyHistory();
    const start = point(1);
    history = recordJump(history, start, point(2)); start.y = .99;
    expect(history.past[0].y).toBe(.3);
    for (let page = 2; page <= 120; page++) history = recordJump(history, point(page), point(page + 1));
    expect(history.past).toHaveLength(100);
    expect(history.past[0].page).toBe(21);
    for (let page = 121; page > 21; page--) history = stepHistory(history, 'back', point(page)).history;
    expect(history.future).toHaveLength(100);
    expect(other).toEqual({ past: [], future: [] });
    expect(stepHistory(other, 'back', point(1))).toEqual({ history: other, target: null });
  });
  it('leaves history intact on malformed capture or target', () => {
    const history = recordJump(emptyHistory(), point(1), point(2));
    expect(recordJump(history, point(2), point(0))).toBe(history);
    expect(recordJump(history, point(2), point(3, NaN))).toBe(history);
    expect(stepHistory(history, 'back', point(2, 0, 0, -1))).toEqual({ history, target: null });
  });
});

describe('external URL boundary', () => {
  it('accepts canonical HTTP(S) URLs without credentials', () => {
    expect(validateExternalUrl('https://doi.org/10.1234/paper?x=1#ref')).toBe('https://doi.org/10.1234/paper?x=1#ref');
    expect(validateExternalUrl('HTTP://EXAMPLE.COM')).toBe('http://example.com/');
  });
  it.each([undefined, 2, '', ' https://example.com', 'https://example.com\n', 'https://example.com/\u007f', 'https://a:b@example.com', 'https://a@example.com', 'javascript:alert(1)', 'file:///C:/a.pdf', 'mailto:a@example.com', '//example.com', 'https://' + 'a'.repeat(8192)])('rejects unsafe input %s', value => {
    expect(() => validateExternalUrl(value)).toThrow();
  });
});

describe('real PDF native navigation', () => {
  let pdf: PDFDocumentProxy;
  beforeAll(async () => {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdf = await getDocument({ data: new Uint8Array(readFileSync('tests/fixtures/navigation.pdf')), isEvalSupported: false, standardFontDataUrl: resolve('node_modules/pdfjs-dist/standard_fonts').replaceAll('\\', '/') + '/' }).promise;
  });
  afterAll(async () => { await pdf?.loadingTask.destroy(); });

  it('resolves named and referenced direct offset destinations without PDF zoom', async () => {
    expect(await resolveDestination(pdf, 'reference')).toEqual({ page: 2, x: .25, y: .25 });
    expect(await resolveDestination(pdf, (await pdf.getDestination('reference'))!)).toEqual({ page: 2, x: .25, y: .25 });
    expect(await resolveDestination(pdf, [1, { name: 'XYZ' }, 150, 600, 9])).toEqual({ page: 2, x: .25, y: .25 });
  });
  it('maps cropped rotated UserUnit destinations and keeps displayed null axes', async () => {
    expect(await resolveDestination(pdf, 'rotated')).toEqual({ page: 3, x: .5, y: .25 });
    expect(await resolveDestination(pdf, [2, { name: 'XYZ' }, null, 400, 8])).toEqual({ page: 3, x: .5, y: null });
    expect(await resolveDestination(pdf, [2, { name: 'XYZ' }, 200, null, 8])).toEqual({ page: 3, x: null, y: .25 });
    expect(await resolveDestination(pdf, [1, { name: 'XYZ' }, null, 600, null])).toEqual({ page: 2, x: null, y: .25 });
    expect(await resolveDestination(pdf, [1, { name: 'XYZ' }, null, null, null])).toEqual({ page: 2, x: null, y: null });
  });
  it.each([
    ['Fit', [], { page: 2, x: 0, y: 0 }], ['FitB', [], { page: 2, x: 0, y: 0 }],
    ['FitH', [600], { page: 2, x: 0, y: .25 }], ['FitBH', [600], { page: 2, x: 0, y: .25 }],
    ['FitV', [150], { page: 2, x: .25, y: 0 }], ['FitBV', [150], { page: 2, x: .25, y: 0 }],
    ['FitR', [150, 400, 300, 600], { page: 2, x: .25, y: .25 }],
  ])('supports %s without a zoom override', async (name, values, expected) => {
    expect(await resolveDestination(pdf, [1, { name }, ...values])).toEqual(expected);
  });
  it('aligns rotated target rectangles and clamps out-of-crop coordinates', async () => {
    expect(await resolveDestination(pdf, [2, { name: 'FitR' }, 200, 250, 300, 400])).toEqual({ page: 3, x: .25, y: .25 });
    expect(await resolveDestination(pdf, [1, { name: 'XYZ' }, -100, 999, null])).toEqual({ page: 2, x: 0, y: 0 });
  });
  it.each(['missing', 'invalid', null, [], [-1, { name: 'Fit' }], [3, { name: 'Fit' }], [.5, { name: 'Fit' }], [1, { name: 'Unknown' }], [1, { name: 'XYZ' }, NaN, 600, 1], [1, { name: 'FitR' }, 300, 400, 150, 600], [1, { name: 'Fit' }, 123]])('rejects invalid destination %j', async destination => {
    await expect(resolveDestination(pdf, destination)).rejects.toThrow();
  });
  it('reads nested native outlines and safe link targets from the actual fixture', async () => {
    const outline = await pdf.getOutline();
    expect(outline?.[0].title).toBe('Introduction');
    expect(outline?.[0].items[0].title).toBe('Rotated detail');
    const annotations = await (await pdf.getPage(1)).getAnnotations();
    const targets = annotations.map(classifyNativeLink);
    expect(targets).toContainEqual({ kind: 'destination', destination: 'reference' });
    expect(targets).toContainEqual({ kind: 'external', url: 'https://doi.org/10.1234/navigation' });
    expect(targets).toContainEqual({ kind: 'action', action: 'NextPage' });
    expect(targets.filter(target => target?.kind === 'unsupported')).toHaveLength(2);
    // PDF.js discards the original action discriminator. Aurelia only exposes the safe URL,
    // never evaluates PDF code or follows the remote document target inside the reader.
    expect(targets).toContainEqual({ kind: 'external', url: 'https://untrusted.example/script' });
    expect(targets).toContainEqual({ kind: 'external', url: 'https://untrusted.example/remote.pdf#[0,{%22name%22:%22Fit%22}]' });
  });
  it('transforms rotated cropped UserUnit rectangles into clipped normalized hit areas', async () => {
    const page = await pdf.getPage(3);
    const viewport = page.getViewport({ scale: 1 });
    expect([viewport.width, viewport.height]).toEqual([1200, 800]);
    const link = (await page.getAnnotations()).find(item => item.subtype === 'Link');
    expect(nativeLinkRect(link!.rect, viewport)).toEqual({ x: .5, y: .25, width: .1, height: .25 });
    expect(nativeLinkRect([0, 50, 300, 460], viewport)).toEqual({ x: 0, y: 0, width: .6, height: .5 });
    expect(nativeLinkRect([0, 0, 1, 1], viewport)).toBeNull();
    expect(nativeLinkRect([NaN, 1, 2, 3], viewport)).toBeNull();
  });
});

describe('malformed native annotations', () => {
  it('accepts outline-style targets with nullable absent fields', () => {
    expect(classifyNativeLink({ subtype: 'Link', dest: 'reference', action: null, url: null, unsafeUrl: undefined })).toEqual({ kind: 'destination', destination: 'reference' });
    expect(classifyNativeLink({ subtype: 'Link', dest: null, action: null, url: 'https://example.com/', unsafeUrl: null })).toEqual({ kind: 'external', url: 'https://example.com/' });
  });
  it('blocks unknown, remote, script, attachment and malformed targets', () => {
    expect(classifyNativeLink({ subtype: 'Text' })).toBeNull();
    for (const fields of [{ action: 'Print' }, { action: 'GoToR' }, { action: 'Launch' }, { action: 'JavaScript' }, { url: 'file:///a.pdf' }, { url: 'https://safe.test', unsafeUrl: 'javascript:alert(1)' }, { attachment: {} }, { dest: {} }, { dest: '' }, { dest: [0, { name: 'Fit' }], url: 'https://safe.test' }, {}]) {
      expect(classifyNativeLink({ subtype: 'Link', ...fields })?.kind).toBe('unsupported');
    }
  });
});
