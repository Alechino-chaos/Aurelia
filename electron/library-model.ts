import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { LibraryAction, LibraryEntry, LibraryState, ReadingView } from './library-types.js';
const fail = (): never => { throw new Error('无效的论文库数据或操作。'); };
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return fail();
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(k => !allowed.includes(k)))
    fail();
}
export function libraryId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value))
    return fail();
  return value;
}
export function normalizeLibraryPath(value: unknown): string {
  if (typeof value !== 'string' || value.length > 32767 || value.includes('\0') || !path.win32.isAbsolute(value))
    return fail();
  return path.win32.normalize(value).toLowerCase();
}
function groupName(value: unknown): string {
  if (typeof value !== 'string')
    return fail();
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name || name.length > 80 || name.toLowerCase() === '未分组' || /[\x00-\x1f]/.test(name))
    return fail();
  return name;
}
function number(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined)
    return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value))
    return fail();
  return Math.min(max, Math.max(min, value));
}
export function normalizeReadingView(value: unknown, previous?: ReadingView): ReadingView {
  const raw = object(value);
  keys(raw, ['page', 'anchorY', 'anchorX', 'zoom', 'panelOpen', 'panelTab']);
  const base: ReadingView = previous ?? { page: 1, anchorY: 0, anchorX: 0, zoom: 'fit', panelOpen: true, panelTab: 'selection' };
  const panelTab = raw.panelTab ?? base.panelTab;
  if (!['selection', 'translation', 'chat', 'annotations'].includes(panelTab as string))
    return fail();
  if (raw.panelOpen !== undefined && typeof raw.panelOpen !== 'boolean')
    return fail();
  return { page: Math.floor(number(raw.page, base.page, 1, 100000)), anchorY: number(raw.anchorY, base.anchorY, 0, 1), anchorX: number(raw.anchorX, base.anchorX, 0, 1),
    zoom: raw.zoom === 'fit' ? 'fit' : raw.zoom === undefined ? base.zoom : number(raw.zoom, 1, .25, 4), panelOpen: (raw.panelOpen ?? base.panelOpen) as boolean, panelTab: panelTab as ReadingView['panelTab'] };
}
export function emptyLibrary(): LibraryState {
  return { version: 1, groups: [], entries: [], openIds: [], activeId: null, mode: 'sidebar', sidebarWidth: 260, collapsedGroupIds: [] };
}
export function validateLibrary(value: unknown): LibraryState {
  const raw = object(value);
  if (typeof raw.version === 'number' && raw.version > 1)
    throw new Error('论文库由较新版本创建，原文件已保留。请升级 Aurelia。');
  keys(raw, ['version', 'groups', 'entries', 'openIds', 'activeId', 'mode', 'sidebarWidth', 'collapsedGroupIds', 'recovery']);
  if (raw.version !== 1 || !Array.isArray(raw.groups) || raw.groups.length > 1000 || !Array.isArray(raw.entries) || raw.entries.length > 10000)
    return fail();
  const groups = raw.groups.map(value => { const g = object(value); keys(g, ['id', 'name']); return { id: libraryId(g.id), name: groupName(g.name) }; });
  const groupIds = new Set(groups.map(g => g.id));
  if (groupIds.size !== groups.length || new Set(groups.map(g => g.name.toLowerCase())).size !== groups.length)
    return fail();
  const entries: LibraryEntry[] = raw.entries.map(value => {
    const e = object(value);
    keys(e, ['id', 'path', 'name', 'groupId', 'documentId', 'view']);
    normalizeLibraryPath(e.path);
    if (typeof e.name !== 'string' || !e.name || e.name.length > 1024 || e.groupId !== null && !groupIds.has(e.groupId as string) || e.documentId !== null && (typeof e.documentId !== 'string' || !/^[a-f0-9]{64}$/.test(e.documentId)))
      return fail();
    return { id: libraryId(e.id), path: e.path as string, name: e.name, groupId: e.groupId as string | null, documentId: e.documentId as string | null, ...(e.view === undefined ? {} : { view: normalizeReadingView(e.view) }) };
  });
  const ids = new Set(entries.map(e => e.id));
  if (ids.size !== entries.length || new Set(entries.map(e => normalizeLibraryPath(e.path))).size !== entries.length)
    return fail();
  function list(value: unknown, allowed: Set<string>) {
    if (!Array.isArray(value) || value.some(id => typeof id !== 'string' || !allowed.has(id)) || new Set(value).size !== value.length)
      return fail();
    return value as string[];
  }
  const openIds = list(raw.openIds, ids), collapsedGroupIds = list(raw.collapsedGroupIds, new Set([...groupIds, 'ungrouped']));
  if (raw.activeId !== null && !openIds.includes(raw.activeId as string) || openIds.length > 0 && raw.activeId === null || !['sidebar', 'tabs'].includes(raw.mode as string))
    return fail();
  return { version: 1, groups, entries, openIds, activeId: raw.activeId as string | null, mode: raw.mode as LibraryState['mode'], sidebarWidth: number(raw.sidebarWidth, 260, 180, 520), collapsedGroupIds };
}
export function applyLibraryAction(current: LibraryState, input: unknown): LibraryState {
  const action = object(input), state = structuredClone(current);
  const shapes: Record<string, string[]> = { 'group-create': ['name'], 'group-rename': ['id', 'name'], 'group-delete': ['id'], 'entry-move': ['id', 'groupId'], 'entry-remove': ['id'], 'tab-open': ['id'], 'tab-activate': ['id'], 'tab-close': ['id'], mode: ['mode'], sidebar: ['width', 'collapsedGroupIds'], view: ['id', 'view', 'documentId'] };
  if (typeof action.type !== 'string' || !Object.hasOwn(shapes, action.type))
    return fail();
  keys(action, ['type', ...shapes[action.type]]);
  const group = () => { const found = state.groups.find(g => g.id === libraryId(action.id)); if (!found)
    return fail(); return found; };
  const entry = () => { const found = state.entries.find(e => e.id === libraryId(action.id)); if (!found)
    return fail(); return found; };
  const close = (id: string) => { const index = state.openIds.indexOf(id); if (index < 0)
    return; state.openIds.splice(index, 1); if (state.activeId === id)
    state.activeId = state.openIds[index] ?? state.openIds[index - 1] ?? null; };
  switch (action.type) {
    case 'group-create':
    case 'group-rename': {
      const name = groupName(action.name), existing = action.type === 'group-rename' ? group() : undefined;
      if (state.groups.some(g => g.id !== existing?.id && g.name.toLowerCase() === name.toLowerCase()))
        return fail();
      if (existing)
        existing.name = name;
      else
        state.groups.push({ id: randomUUID(), name });
      break;
    }
    case 'group-delete': {
      const id = group().id;
      state.groups = state.groups.filter(g => g.id !== id);
      state.entries.forEach(e => { if (e.groupId === id)
        e.groupId = null; });
      state.collapsedGroupIds = state.collapsedGroupIds.filter(g => g !== id);
      break;
    }
    case 'entry-move': {
      const e = entry();
      if (action.groupId !== null && !state.groups.some(g => g.id === libraryId(action.groupId)))
        return fail();
      e.groupId = action.groupId as string | null;
      break;
    }
    case 'entry-remove': {
      const id = entry().id;
      close(id);
      state.entries = state.entries.filter(e => e.id !== id);
      break;
    }
    case 'tab-open': {
      const id = entry().id;
      if (!state.openIds.includes(id))
        state.openIds.push(id);
      state.activeId = id;
      break;
    }
    case 'tab-activate': {
      const id = entry().id;
      if (!state.openIds.includes(id))
        return fail();
      state.activeId = id;
      break;
    }
    case 'tab-close':
      close(entry().id);
      break;
    case 'mode':
      state.mode = action.mode as LibraryState['mode'];
      break;
    case 'sidebar': {
      if (action.width !== undefined)
        state.sidebarWidth = number(action.width, 260, 180, 520);
      if (action.collapsedGroupIds !== undefined)
        state.collapsedGroupIds = action.collapsedGroupIds as string[];
      break;
    }
    case 'view': {
      const e = entry();
      if (action.documentId !== undefined && action.documentId !== e.documentId)
        throw new Error('论文内容已改变，请重新读取阅读位置。');
      e.view = normalizeReadingView(action.view, e.view);
      break;
    }
  }
  return { ...validateLibrary(state), ...(current.recovery ? { recovery: current.recovery } : {}) };
}
