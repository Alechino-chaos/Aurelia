import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile, rm, mkdir, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { applyLibraryAction, emptyLibrary, validateLibrary, normalizeLibraryPath } from '../electron/library-model';
import { LibraryStore } from '../electron/library-store';
import { LibraryFiles } from '../electron/library-files';
import type { LibraryAction, LibraryState } from '../electron/library-types';

const hash = 'a'.repeat(64);
const directories: string[] = [];
const stores: LibraryStore[] = [];
async function setup() {
  const directory = await mkdtemp(path.join(tmpdir(), 'aurelia-library-'));
  directories.push(directory);
  const store = new LibraryStore(directory); stores.push(store);
  await store.load();
  return { directory, store, files: new LibraryFiles(store) };
}
afterEach(async () => {
  await Promise.all(stores.splice(0).map(s => s.flush().catch(() => {})));
  await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});
function state(): LibraryState {
  return { ...emptyLibrary(), entries: ['a','b','c'].map(id => ({ id, path: `C:\\papers\\${id}.pdf`, name: `${id}.pdf`, groupId: null, documentId: hash })), openIds: ['a','b','c'], activeId: 'b' };
}
it('normalizes and bounds unique group names and reparents deleted groups', () => {
  let data = applyLibraryAction(state(), { type: 'group-create', name: '  Methods   papers  ' });
  expect(data.groups[0].name).toBe('Methods papers');
  expect(() => applyLibraryAction(data, { type: 'group-create', name: 'methods papers' })).toThrow();
  for (const name of ['', '未分组', 'x'.repeat(81)]) expect(() => applyLibraryAction(data, {type:'group-create',name})).toThrow();
  data = applyLibraryAction(data, { type:'entry-move', id:'a', groupId:data.groups[0].id });
  data = applyLibraryAction(data, { type:'group-delete', id:data.groups[0].id });
  expect(data.entries[0].groupId).toBeNull();
  expect(data.entries[0].documentId).toBe(hash);
});
it('closes the right adjacent tab then left, without removing papers', () => {
  let data = applyLibraryAction(state(), { type:'tab-close', id:'b' });
  expect(data.activeId).toBe('c'); expect(data.entries).toHaveLength(3);
  data = applyLibraryAction(data, { type:'tab-close', id:'c' });
  expect(data.activeId).toBe('a');
  data = applyLibraryAction(data, { type:'entry-remove', id:'a' });
  expect(data.activeId).toBeNull(); expect(data.entries.map(e => e.id)).toEqual(['b','c']);
});
it('rejects unknown actions, IDs, forged entry fields and malformed schemas', () => {
  for (const action of [{ type:'arbitrary', path:'C:\\secret' }, {type:'tab-open',id:'missing'}, {type:'mode',mode:'bad'}, {type:'entry-move',id:'a',groupId:'missing'}, {type:'group-create',name:'ok',path:'bad'}]) {
    expect(() => applyLibraryAction(state(), action as LibraryAction)).toThrow();
  }
  for (const data of [{...state(), version:99}, {...state(),activeId:'missing'}, {...state(),openIds:['a','a']}, {...state(),entries:[...state().entries,state().entries[0]]}]) expect(() => validateLibrary(data)).toThrow();
});
it('bounds navigation and rejects stale content captures', () => {
  const data = applyLibraryAction(state(), { type:'view',id:'a',view:{page:-2,anchorY:5,anchorX:-1,zoom:10,panelOpen:false,panelTab:'chat'},documentId:hash });
  expect(data.entries[0].view).toEqual({page:1,anchorY:1,anchorX:0,zoom:4,panelOpen:false,panelTab:'chat'});
  expect(() => applyLibraryAction(data,{type:'view',id:'a',view:{page:1},documentId:'b'.repeat(64)})).toThrow();
  expect(() => applyLibraryAction(data,{type:'view',id:'a',view:{page:NaN}})).toThrow();
  expect(normalizeLibraryPath('C:/Papers/../PAPERS/A.pdf')).toBe(normalizeLibraryPath('c:\\papers\\a.pdf'));
});
it('serializes writes and flushes the latest debounced view for real restart', async () => {
  const { store,directory } = await setup();
  const entry = await store.register({path:'C:\\papers\\a.pdf',name:'a.pdf',documentId:hash});
  await store.update({type:'tab-open',id:entry.id});
  await Promise.all(Array.from({length:20},(_,i)=>store.update({type:'view',id:entry.id,view:{page:i+1,anchorY:.75,zoom:1.5}})));
  await store.update({type:'mode',mode:'tabs'}); await store.flush();
  const restored = await new LibraryStore(directory).load();
  expect(restored.entries[0].view?.page).toBe(20); expect(restored.entries[0].view?.anchorY).toBe(.75);
  expect(restored.mode).toBe('tabs'); expect(restored.openIds).toEqual([entry.id]); expect(restored.activeId).toBe(entry.id);
});
it('keeps same-content paths separate, deduplicates canonical paths and never activates from reads', async () => {
  const {store,directory,files}=await setup();
  const a=path.join(directory,'A.pdf'),b=path.join(directory,'B.pdf');
  await writeFile(a,'%PDF-1.7\nidentical'); await writeFile(b,'%PDF-1.7\nidentical');
  const first=await files.openPath(a),second=await files.openPath(b);
  expect(first.libraryId).not.toBe(second.libraryId); expect(first.documentId).toBe(second.documentId);
  await store.update({type:'tab-open',id:first.libraryId});
  await files.open(second.libraryId);
  expect((await store.get()).activeId).toBe(first.libraryId);
  const repeated=await store.register({path:a.toUpperCase(),name:'A.pdf',documentId:first.documentId});
  expect(repeated.id).toBe(first.libraryId); expect((await store.get()).entries).toHaveLength(2);
});
it('recovers a backup and preserves corrupt primary; unrecoverable and future files are protected', async () => {
  const {store,directory}=await setup();
  await store.update({type:'group-create',name:'First'}); await store.update({type:'group-create',name:'Second'});
  const file=path.join(directory,'library.json'); await writeFile(file,'{corrupt');
  const recovered=new LibraryStore(directory); stores.push(recovered);
  expect((await recovered.load()).groups.map(g=>g.name)).toEqual(['First']);
  expect((await readdir(directory)).some(f=>f.includes('.corrupt-'))).toBe(true);
  await recovered.update({type:'mode',mode:'tabs'});
  await writeFile(file,'broken'); await writeFile(`${file}.bak`,'also broken');
  const broken=new LibraryStore(directory);
  await expect(broken.load()).rejects.toThrow('原文件已保留');
  await expect(broken.update({type:'group-create',name:'Lost'})).rejects.toThrow();
  expect(await readFile(file,'utf8')).toBe('broken');
  await writeFile(file,JSON.stringify({...emptyLibrary(),version:99}));
  await writeFile(`${file}.bak`,JSON.stringify(emptyLibrary()));
  await expect(new LibraryStore(directory).load()).rejects.toThrow('较新版本');
  expect(JSON.parse(await readFile(file,'utf8')).version).toBe(99);
});
it('recovers a valid temporary file when first atomic write was interrupted', async () => {
  const {directory}=await setup();
  const data=applyLibraryAction(emptyLibrary(),{type:'group-create',name:'Recovered'});
  await rm(path.join(directory,'library.json'),{force:true});
  await writeFile(path.join(directory,'library.json.tmp'),JSON.stringify(data));
  const store=new LibraryStore(directory); stores.push(store);
  expect((await store.load()).groups[0].name).toBe('Recovered');
  await store.update({type:'mode',mode:'tabs'});
  expect((await new LibraryStore(directory).load()).mode).toBe('tabs');
});
it('migrates known recent paths once including missing papers without opening them', async () => {
  const {directory}=await setup(); await rm(path.join(directory,'library.json'),{force:true});
  const store=new LibraryStore(directory); stores.push(store);
  const data=await store.load([{path:'C:\\missing\\paper.pdf',name:'paper.pdf'},{path:'c:/MISSING/paper.pdf',name:'paper.pdf'}]);
  expect(data.entries).toHaveLength(1); expect(data.entries[0].documentId).toBeNull(); expect(data.openIds).toEqual([]);
  expect((await new LibraryStore(directory).load([{path:'C:\\other.pdf',name:'other.pdf'}])).entries).toHaveLength(1);
});
it('retains pending writes after disk failure and flush retries without losing mutations', async () => {
  const {store,directory}=await setup();
  await mkdir(path.join(directory,'library.json.tmp'));
  await expect(store.update({type:'group-create',name:'Keep me'})).rejects.toThrow();
  await rm(path.join(directory,'library.json.tmp'),{recursive:true}); await store.flush();
  expect((await new LibraryStore(directory).load()).groups[0].name).toBe('Keep me');
});
it('imports valid PDFs independently, resets changed bytes, relocates matching identity and preserves sources', async () => {
  const {store,directory,files}=await setup();
  const a=path.join(directory,'a.pdf'),invalid=path.join(directory,'invalid.pdf'),moved=path.join(directory,'moved.pdf');
  await writeFile(a,'%PDF-1.7\noriginal'); await writeFile(invalid,'not a PDF'); await writeFile(moved,'%PDF-1.7\noriginal');
  const result=await files.importPaths([a,invalid,path.join(directory,'missing.pdf')]);
  expect(result.importedIds).toHaveLength(1); expect(result.errors).toHaveLength(2); expect(result.state.activeId).toBeNull();
  const id=result.importedIds[0];
  await store.update({type:'view',id,view:{page:7,zoom:2}});
  const relocated=await files.relocate(id,moved); expect(relocated.outcome).toBe('relocated');
  expect(relocated.state.entries[0].view?.page).toBe(7);
  const mismatch=await files.relocate(id,a); expect(mismatch.outcome).toBe('relocated');
  await writeFile(moved,'%PDF-1.7\ndifferent');
  const denied=await files.relocate(id,moved); expect(denied.outcome).toBe('mismatch');
  expect(denied.state.entries[0].path).toBe(a); expect(denied.state.entries).toHaveLength(1);
  expect(denied.candidateName).toBe('moved.pdf');
  const imported=await files.acceptRelocationImport(id); expect(imported.importedIds).toHaveLength(1);
  await writeFile(a,'%PDF-1.7\nchanged');
  const opened=await files.open(id); expect(opened.view).toBeUndefined();
  expect(opened.documentId).not.toBe(imported.state.entries[0].documentId);
  await store.update({type:'entry-remove',id});
  expect(await readFile(a,'utf8')).toBe('%PDF-1.7\nchanged');
});
it('does not resurrect removed entries or attach a late read after relocation', async () => {
  const {store}=await setup();
  const e=await store.register({path:'C:\\a.pdf',name:'a.pdf',documentId:hash});
  await store.relocate(e.id,'C:\\b.pdf',hash);
  await expect(store.refresh(e.id,{path:'C:\\a.pdf',documentId:hash})).rejects.toThrow();
  await store.update({type:'entry-remove',id:e.id});
  await expect(store.refresh(e.id,{path:'C:\\b.pdf',documentId:hash})).rejects.toThrow();
  expect((await store.get()).entries).toEqual([]);
});
it('retains existing identity on relocation collision and only reveals registered paths', async () => {
  const {store,files,directory}=await setup();
  const a=path.join(directory,'first.pdf'),b=path.join(directory,'second.pdf');
  await writeFile(a,'%PDF-1.7\nsame');await writeFile(b,'%PDF-1.7\nsame');
  const first=await files.openPath(a),second=await files.openPath(b);
  const result=await files.relocate(first.libraryId,b);
  expect(result.outcome).toBe('existing');expect(result.existingId).toBe(second.libraryId);
  expect(result.state.entries[0].path).toBe(a);
  const revealed:string[]=[];
  await files.reveal(first.libraryId,p=>revealed.push(p));
  await expect(files.reveal('C:\\arbitrary.pdf',p=>revealed.push(p))).rejects.toThrow();
  expect(revealed).toEqual([a]);
});
it('strictly rejects nonabsolute paths, wrong extensions, oversized sources and invalid groups', async () => {
  const {files,directory}=await setup();
  const {open}=await import('node:fs/promises');
  const large=path.join(directory,'large.pdf'),txt=path.join(directory,'text.txt');
  const handle=await open(large,'w');await handle.truncate(250*1024*1024+1);await handle.close();
  await writeFile(txt,'%PDF-1.7\nvalid bytes');
  for(const file of ['relative.pdf',txt,large])await expect(files.openPath(file)).rejects.toThrow();
  await expect(files.importPaths([txt],'unknown')).rejects.toThrow();
});
