import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile, rm, mkdir, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SessionStore } from '../electron/session-store';
import { applySessionAction, emptySession, validateSession } from '../electron/session-model';
import type { Annotation, SessionAction } from '../electron/session-types';

const a = 'a'.repeat(64), b = 'b'.repeat(64);
const directories: string[] = [];
const stores: SessionStore[] = [];
async function setup() {
  const directory = await mkdtemp(path.join(tmpdir(), 'aurelia-sessions-'));
  directories.push(directory);
  const store = new SessionStore(directory); stores.push(store);
  return { directory, store };
}
afterEach(async () => {
  await Promise.all(stores.splice(0).map(s => s.close().catch(() => {})));
  await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});
function question(chatId: string, suffix = 'first'): SessionAction {
  return { type: 'chat', chatId, user: { id: `question-${suffix}`, role: 'user', content: '解释这段话', status: 'done', quote: { text: '原文片段', fileName: 'paper.pdf', pages: [2] } },
    answer: { id: `answer-${suffix}`, role: 'assistant', content: '', status: 'streaming' } };
}

it('persists separate papers, streamed responses, source quotes, drafts and all translation records', async () => {
  const { store, directory } = await setup();
  const first = await store.load(a, 'paper.pdf'), second = await store.load(b, 'paper.pdf');
  await store.update(a, question(first.activeChatId));
  store.record(a, { id: 'answer-first', type: 'delta', text: '**结论**：有效。' });
  await store.update(a, { type: 'draft', chatId: first.activeChatId, draft: '再问一下' });
  store.record(a, { id: 'answer-first', type: 'done' });
  for (const id of ['translation-first', 'translation-second']) {
    await store.update(a, { type: 'translation', entry: { id, quote: { text: id, fileName: 'paper.pdf', pages: [2] }, language: '简体中文', content: '', status: 'streaming' } });
    store.record(a, { id, type: 'delta', text: '译文' }); store.record(a, { id, type: 'done' });
  }
  await store.update(b, { type: 'draft', chatId: second.activeChatId, draft: '另一篇论文' });
  await store.close();
  const restored = new SessionStore(directory);
  const result = await restored.load(a, 'renamed.pdf');
  expect(result.chats[0].messages[1]).toMatchObject({ content: '**结论**：有效。', status: 'done' });
  expect(result.chats[0].messages[0].quote?.pages).toEqual([2]);
  expect(result.chats[0].draft).toBe('再问一下');
  expect(result.translations).toHaveLength(2);
  expect((await restored.load(b, 'paper.pdf')).chats[0].messages).toHaveLength(0);
});

it('retains partial output after suspension and ignores late completion events', async () => {
  const { store, directory } = await setup();
  const session = await store.load(a, 'paper.pdf');
  await store.update(a, question(session.activeChatId));
  store.record(a, { id: 'answer-first', type: 'delta', text: '部分回答' });
  await store.suspend(a);
  store.record(a, { id: 'answer-first', type: 'delta', text: '迟到的内容' });
  store.record(a, { id: 'answer-first', type: 'done' });
  await store.close();
  const result = await new SessionStore(directory).load(a, 'paper.pdf');
  expect(result.chats[0].messages[1]).toMatchObject({ content: '部分回答', status: 'interrupted' });
  const retry = question(session.activeChatId, 'retry') as Extract<SessionAction, { type: 'chat' }>;
  expect(applySessionAction(result, { ...retry, replaceId: 'answer-first' }).chats[0].messages).toHaveLength(2);
});

it('serializes rapid saves without an older draft overwriting a newer one', async () => {
  const { store, directory } = await setup();
  const session = await store.load(a, 'paper.pdf');
  await Promise.all(Array.from({ length: 20 }, (_, i) => store.update(a, { type: 'draft', chatId: session.activeChatId, draft: String(i) })));
  expect(JSON.parse(await readFile(path.join(directory, `${a}.json`), 'utf8')).chats[0].draft).toBe('19');
});

it('keeps old conversations accessible after creating a new one', async () => {
  const { store } = await setup();
  const session = await store.load(a, 'paper.pdf');
  await store.update(a, question(session.activeChatId));
  store.record(a, { id: 'answer-first', type: 'done' });
  await store.update(a, { type: 'translation', entry: { id: 'translation-running', quote: { text: 'source', fileName: 'paper.pdf', pages: [1] }, language: '简体中文', content: '', status: 'streaming' } });
  await store.update(a, { type: 'new-chat', id: 'new-chat-id' });
  expect(store.pendingIds(a, 'chat')).toEqual([]);
  expect(store.pendingIds(a)).toEqual(['translation-running']);
  await store.update(a, { type: 'select-chat', id: session.activeChatId });
  const loaded = await store.load(a, 'paper.pdf');
  expect(loaded.chats).toHaveLength(2);
  expect(loaded.translations[0].status).toBe('streaming');
  expect(loaded.chats.find(c => c.id === loaded.activeChatId)?.messages).toHaveLength(2);
});

it('restores a good backup without silently deleting corrupt history', async () => {
  const { store, directory } = await setup();
  const session = await store.load(a, 'paper.pdf');
  await store.update(a, { type: 'draft', chatId: session.activeChatId, draft: '第一次保存' });
  await store.update(a, { type: 'draft', chatId: session.activeChatId, draft: '第二次保存' });
  await writeFile(path.join(directory, `${a}.json`), '{broken');
  const result = await new SessionStore(directory).load(a, 'paper.pdf');
  expect(result.chats[0].draft).toBe('第一次保存');
  expect((await readdir(directory)).some(file => file.includes('.corrupt-'))).toBe(true);
  await writeFile(path.join(directory, `${b}.json`), 'broken');
  await expect(new SessionStore(directory).load(b, 'paper.pdf')).rejects.toThrow('原文件已保留');
  expect(await readFile(path.join(directory, `${b}.json`), 'utf8')).toBe('broken');
});

it('surfaces write errors, preserves the in-memory draft and supports retry', async () => {
  const { directory } = await setup();
  const blocked = path.join(directory, 'not-a-directory');
  await writeFile(blocked, 'block');
  const events: string[] = [];
  const store = new SessionStore(blocked, event => events.push(event.status)); stores.push(store);
  // First read cannot succeed through a file, so create the empty session first.
  await rm(blocked); await mkdir(blocked);
  const session = await store.load(a, 'paper.pdf');
  await rm(blocked, { recursive: true }); await writeFile(blocked, 'block');
  await expect(store.update(a, { type: 'draft', chatId: session.activeChatId, draft: '不能丢的草稿' })).rejects.toThrow('未能保存');
  expect(events).toContain('error');
  await rm(blocked); await mkdir(blocked); await store.flush(a);
  expect((await store.load(a, 'paper.pdf')).chats[0].draft).toBe('不能丢的草稿');
});

it('rejects unsafe identities and strips unrecognized fields such as API configuration', async () => {
  const { store } = await setup();
  await expect(store.load('../outside', 'paper.pdf')).rejects.toThrow('标识');
  const session = emptySession(a, 'paper.pdf', 'initial-chat');
  expect(validateSession({ ...session, apiKey: 'never-store-settings' }, a)).not.toHaveProperty('apiKey');
  expect(() => validateSession(session, b)).toThrow('不匹配');
});

const mark: Annotation = { id: 'annotation-first', createdAt: 1, updatedAt: 1, color: 'yellow', note: '我的理解',
  quote: { text: 'selected passage', fileName: 'paper.pdf', pages: [1, 2] },
  regions: [{ page: 1, x: .1, y: .2, width: .3, height: .02 }, { page: 2, x: .6, y: .1, width: .2, height: .02 }] };

it('loads older sessions without annotations and preserves history when adding notes', async () => {
  const { store, directory } = await setup();
  const legacy = emptySession(a, 'paper.pdf', 'legacy-chat');
  legacy.chats[0].draft = '旧草稿';
  const { annotations: _annotations, ...old } = legacy;
  await writeFile(path.join(directory, `${a}.json`), JSON.stringify(old));
  expect((await store.load(a, 'paper.pdf')).annotations).toEqual([]);
  await store.update(a, { type: 'annotation-add', entry: mark });
  await store.update(a, { type: 'annotation-edit', id: mark.id, note: '修改后的理解', color: 'green' });
  await store.close();
  const result = await new SessionStore(directory).load(a, 'renamed.pdf');
  expect(result.annotations[0]).toMatchObject({ note: '修改后的理解', color: 'green', regions: mark.regions });
  expect(result.chats[0].draft).toBe('旧草稿');
  expect((await store.load(b, 'paper.pdf')).annotations).toEqual([]);
});

it('keeps annotations through streaming, supports deletion and undo, and rejects invalid geometry', async () => {
  const { store } = await setup();
  const session = await store.load(a, 'paper.pdf');
  await store.update(a, { type: 'annotation-add', entry: mark });
  await store.update(a, question(session.activeChatId));
  store.record(a, { id: 'answer-first', type: 'delta', text: 'answer' });
  await store.update(a, { type: 'annotation-edit', id: mark.id, note: '写入中' });
  store.record(a, { id: 'answer-first', type: 'done' });
  expect((await store.load(a, 'paper.pdf')).annotations[0].note).toBe('写入中');
  await store.update(a, { type: 'annotation-delete', id: mark.id });
  expect((await store.load(a, 'paper.pdf')).annotations).toEqual([]);
  await store.update(a, { type: 'annotation-add', entry: mark });
  const loaded = await store.load(a, 'paper.pdf');
  for (const x of [-.1, .9, NaN, Infinity]) {
    expect(() => applySessionAction(loaded, { type: 'annotation-add', entry: { ...mark, id: 'invalid-mark', regions: [{ ...mark.regions[0], x }] } })).toThrow();
  }
  expect(loaded.chats[0].messages[1].content).toBe('answer');
});
