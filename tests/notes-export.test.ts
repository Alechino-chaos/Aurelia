import { describe, expect, test } from 'vitest';
import { mkdtemp, readFile, readdir, writeFile, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Annotation } from '../electron/session-types';
import { SessionStore } from '../electron/session-store';
import { renderNotesMarkdown, suggestNotesFileName } from '../electron/notes-markdown';
import { exportNotes } from '../electron/notes-export';

const key = 'a'.repeat(64);
function entry(id = 'test-one', page = 3): Annotation {
  return { id, createdAt: 1, updatedAt: 1, color: 'yellow', quote: { text: '原文第一行\n第二行', fileName: 'old.pdf', pages: [page] }, note: '', regions: [{ page, x: .1, y: .2, width: .2, height: .1 }] };
}

describe('Markdown notes', () => {
  test('exports notes verbatim with page order and no mutation', () => {
    const note = '**重点**\n\n- 中文\n\n```ts\nconst x = 1;\n```\n\n$$\nx^2\n$$';
    const later = { ...entry('later', 7), note }, earlier = entry();
    const entries = [later, earlier];
    const output = renderNotesMarkdown('current.pdf', entries);
    expect(output).toContain('# current · 阅读笔记');
    expect(output).toContain('来源：current\\.pdf');
    expect(output).toContain('共 2 条批注');
    expect(output.indexOf('第 3 页')).toBeLessThan(output.indexOf('第 7 页'));
    expect(output).toContain('> 原文第一行\n> 第二行');
    expect(output).toContain(`### 我的笔记\n\n${note}\n`);
    expect(output.match(/### 我的笔记/g)).toHaveLength(1);
    expect(entries[0]).toBe(later);
  });
  test('keeps multi-page excerpts together and escapes literal PDF markup', () => {
    const item = entry(); item.quote.pages = [4, 3, 4];
    item.quote.text = '# title\n![image](https://example.com/x)\n<script>bad</script>\n\n$x$';
    const output = renderNotesMarkdown('a[b].pdf', [item]);
    expect(output).toContain('第 3、4 页');
    expect(output).toContain('> \\# title');
    expect(output).toContain('\\!\\[image\\]');
    expect(output).toContain('\\<script\\>');
    expect(output).toContain('> \\$x\\$');
    expect(output).not.toContain('### 我的笔记');
  });
  test('normalizes line endings but preserves note whitespace', () => {
    const item = { ...entry(), note: '  text  \r\n\r\nnext' };
    expect(renderNotesMarkdown('paper.pdf', [item])).toContain('  text  \n\nnext\n');
    expect(() => renderNotesMarkdown('paper.pdf', [])).toThrow();
  });
  test.each([
    ['paper.PDF', 'paper-notes.md'], ['CON.pdf', 'reading-notes.md'],
    ['a:b?.pdf', 'a_b_-notes.md'], ['...pdf', 'reading-notes.md'],
  ])('creates usable Windows name from %s', (name, expected) => expect(suggestNotesFileName(name)).toBe(expected));
  test('bounds long filenames without splitting Unicode characters', () => {
    const name = suggestNotesFileName('😀'.repeat(200) + '.pdf');
    expect(name.length).toBeLessThanOrEqual(190);
    expect(name).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/u);
  });
});

describe('notes export service', () => {
  async function withStore(run: (store: SessionStore, dir: string) => Promise<void>) {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'aurelia-export-'));
    const store = new SessionStore(path.join(dir, 'sessions'));
    try { await store.load(key, 'old.pdf'); await store.update(key, { type: 'annotation-add', entry: entry() }); await run(store, dir); }
    finally { await store.close(); await rm(dir, { recursive: true, force: true }); }
  }
  test('exports a fixed clone while edits continue and uses current filename', () => withStore(async (store, dir) => {
    await store.update(key, { type: 'annotation-edit', id: 'test-one', note: 'latest note' });
    const snapshot = store.annotationSnapshot(key); snapshot[0].note = 'corruption';
    const output = path.join(dir, 'notes');
    const result = await exportNotes(store, key, 'renamed.pdf', async suggested => {
      expect(suggested).toBe('renamed-notes.md');
      await store.update(key, { type: 'annotation-edit', id: 'test-one', note: 'later change' });
      return output;
    });
    expect(result).toEqual({ status: 'saved' });
    const contents = await readFile(output + '.md', 'utf8');
    expect(contents).toContain('latest note');
    expect(contents).not.toContain('corruption'); expect(contents).not.toContain('later change');
    expect(contents).toContain('renamed'); expect(contents).not.toContain(dir);
  }));
  test('cancel preserves existing destination and produces no export file', () => withStore(async (store, dir) => {
    const file = path.join(dir, 'old.md'); await writeFile(file, 'old');
    expect(await exportNotes(store, key, 'paper.pdf', async () => null)).toEqual({ status: 'cancelled' });
    expect(await readFile(file, 'utf8')).toBe('old');
    expect((await readdir(dir)).sort()).toEqual(['old.md', 'sessions']);
  }));
  test('replaces existing Markdown only on successful write', () => withStore(async (store, dir) => {
    const file = path.join(dir, 'old.md'); await writeFile(file, 'old');
    await exportNotes(store, key, 'paper.pdf', async () => file);
    expect(await readFile(file, 'utf8')).toContain('原文第一行');
    expect((await readdir(dir)).sort()).toEqual(['old.md', 'sessions']);
  }));
  test('appending md cannot overwrite a destination the dialog did not confirm', () => withStore(async (store, dir) => {
    const file = path.join(dir, 'keep.md'); await writeFile(file, 'my edited notes');
    await expect(exportNotes(store, key, 'paper.pdf', async () => path.join(dir, 'keep'))).rejects.toThrow();
    expect(await readFile(file, 'utf8')).toBe('my edited notes');
    expect((await readdir(dir)).sort()).toEqual(['keep.md', 'sessions']);
  }));
  test('rejects another extension without overwriting its content', () => withStore(async (store, dir) => {
    const file = path.join(dir, 'paper.pdf'); await writeFile(file, 'original PDF');
    await expect(exportNotes(store, key, 'paper.pdf', async () => file)).rejects.toThrow();
    expect(await readFile(file, 'utf8')).toBe('original PDF');
  }));
  test('failed replacement preserves destination and removes only its temporary file', () => withStore(async (store, dir) => {
    const destination = path.join(dir, 'existing.md'); await mkdir(destination);
    await writeFile(path.join(destination, 'keep.txt'), 'keep');
    await expect(exportNotes(store, key, 'paper.pdf', async () => destination)).rejects.toThrow();
    expect(await readFile(path.join(destination, 'keep.txt'), 'utf8')).toBe('keep');
    expect((await readdir(dir)).sort()).toEqual(['existing.md', 'sessions']);
  }));
  test('rejects untrusted names, unloaded sessions, and empty annotations before dialog', () => withStore(async (store) => {
    const unexpectedDialog = async () => { throw new Error('dialog should not open'); };
    await expect(exportNotes(store, key, '../secret.pdf', unexpectedDialog)).rejects.not.toThrow('dialog should not open');
    await expect(exportNotes(store, 'b'.repeat(64), 'paper.pdf', unexpectedDialog)).rejects.not.toThrow('dialog should not open');
    await store.update(key, { type: 'annotation-delete', id: 'test-one' });
    await expect(exportNotes(store, key, 'paper.pdf', unexpectedDialog)).rejects.not.toThrow('dialog should not open');
  }));
});
