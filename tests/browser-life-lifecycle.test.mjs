import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {EmbodiedLife} from '../src/embodied-life.mjs';
import {createCompanion,adoptCompanion} from '../public/companion-identity.mjs';
import {
  companionCheckpoint,validateCompanionCheckpoint,parseCompanionCheckpoint,restoreCompanion,
  writeCompanionStorage,readCompanionStorage,readGoodCompanionSnapshots,companionSnapshotKey,
  COMPANION_STORAGE_KEY,BACKUP_STORAGE_KEY,GOOD_SNAPSHOTS_STORAGE_KEY,MAX_CHECKPOINT_BYTES,
} from '../public/companion-checkpoint.mjs';
import {VERSION} from '../public/world-spec.mjs';

const body=new EmbodiedLife().state;
body.companion=createCompanion({seed:'0123456789abcdef0123456789abcdef',now:1000});
adoptCompanion(body.companion,'小豆',2000);
const sample=companionCheckpoint(body,{revision:1,modelFingerprint:'a'.repeat(64)});
const checkpoint=(revision=1,savedAt=1000)=>{const value=structuredClone(sample);value.metadata.revision=revision;value.savedAt=savedAt;return value;};
function memoryStorage(){
  const values=new Map(),writes=[];let failKey=null,readFailure=false;
  return {values,writes,get failKey(){return failKey;},set failKey(value){failKey=value;},set readFailure(value){readFailure=value;},
    getItem(key){if(readFailure&&key===COMPANION_STORAGE_KEY)throw Error('injected storage read failure');return values.get(key)??null;},
    setItem(key,value){if(failKey===key)throw new DOMException('injected storage full','QuotaExceededError');writes.push(key);values.set(key,String(value));}};
}

test('save metadata is validated while unannotated v2 keeps identity, body and habits',()=>{
  const legacy=checkpoint();delete legacy.metadata;validateCompanionCheckpoint(legacy);
  const restored=new EmbodiedLife().state;restoreCompanion(restored,legacy);
  assert.deepEqual(restored.companion,legacy.companion);assert.equal(restored.needs.energy,legacy.body.values.energy);
  assert.equal(sample.metadata.productVersion,VERSION);assert.equal(sample.metadata.modelFingerprint,'a'.repeat(64));
  for(const mutate of [v=>v.metadata.revision=-1,v=>v.metadata.modelFingerprint='bad',v=>v.metadata.productVersion='999.0.0',v=>v.savedAt=1e20]){
    const invalid=checkpoint();mutate(invalid);const storage=memoryStorage();
    assert.throws(()=>writeCompanionStorage(storage,invalid));assert.equal(storage.writes.length,0);
  }
});

test('checkpoint limit measures UTF-8 bytes rather than JavaScript characters',()=>{
  const value=checkpoint();value.extra='汉'.repeat(90000);const text=JSON.stringify(value);
  assert.ok(text.length<MAX_CHECKPOINT_BYTES);assert.ok(Buffer.byteLength(text)>MAX_CHECKPOINT_BYTES);
  assert.throws(()=>parseCompanionCheckpoint(text),/备份文件/);assert.throws(()=>validateCompanionCheckpoint(value),/过大/);
});

test('primary saves every time but three good snapshots rotate at one-minute intervals',()=>{
  const storage=memoryStorage();
  writeCompanionStorage(storage,checkpoint(1,1000));writeCompanionStorage(storage,checkpoint(2,3000));
  assert.equal(storage.writes.filter(key=>key===GOOD_SNAPSHOTS_STORAGE_KEY).length,1);
  assert.equal(readCompanionStorage(storage).metadata.revision,2);
  for(const [revision,time]of [[3,61000],[4,121000],[5,181000]])writeCompanionStorage(storage,checkpoint(revision,time));
  assert.deepEqual(readGoodCompanionSnapshots(storage).map(value=>value.metadata.revision),[5,4,3]);
  assert.equal(storage.getItem(BACKUP_STORAGE_KEY),null);
});

test('same-identity future import yields to the current clock without losing either recovery copy',()=>{
  const storage=memoryStorage(),original=checkpoint(1,1000),incoming=checkpoint(2,86401000);
  writeCompanionStorage(storage,original);
  const prior=storage.getItem(COMPANION_STORAGE_KEY);
  writeCompanionStorage(storage,incoming,{backup:true});
  assert.equal(incoming.companion.identity.id,original.companion.identity.id);
  const current=checkpoint(3,3000);writeCompanionStorage(storage,current);
  assert.deepEqual(readGoodCompanionSnapshots(storage).map(value=>value.metadata.revision),[3,2,1]);
  assert.deepEqual(readCompanionStorage(storage),current);
  assert.equal(storage.getItem(BACKUP_STORAGE_KEY),prior);
  const rotations=storage.writes.filter(key=>key===GOOD_SNAPSHOTS_STORAGE_KEY).length;
  writeCompanionStorage(storage,checkpoint(4,5000));
  assert.equal(storage.writes.filter(key=>key===GOOD_SNAPSHOTS_STORAGE_KEY).length,rotations);
  writeCompanionStorage(storage,checkpoint(5,63000));
  assert.deepEqual(readGoodCompanionSnapshots(storage).map(value=>value.metadata.revision),[5,3,2]);
  assert.equal(storage.getItem(BACKUP_STORAGE_KEY),prior);
});

test('clock rollback retains the latest preceding primary and restarts the normal snapshot interval',()=>{
  const storage=memoryStorage(),preceding=checkpoint(2,151000);
  writeCompanionStorage(storage,checkpoint(1,121000));writeCompanionStorage(storage,preceding);
  const current=checkpoint(3,61000);writeCompanionStorage(storage,current);
  const snapshots=readGoodCompanionSnapshots(storage);
  assert.deepEqual(snapshots.map(value=>value.metadata.revision),[3,2,1]);
  assert.deepEqual(snapshots[1],preceding);
  assert.deepEqual(readCompanionStorage(storage),current);
  const rotations=storage.writes.filter(key=>key===GOOD_SNAPSHOTS_STORAGE_KEY).length;
  for(const [revision,time]of [[4,63000],[5,120999]])writeCompanionStorage(storage,checkpoint(revision,time));
  assert.equal(storage.writes.filter(key=>key===GOOD_SNAPSHOTS_STORAGE_KEY).length,rotations);
  writeCompanionStorage(storage,checkpoint(6,121000));
  assert.deepEqual(readGoodCompanionSnapshots(storage).map(value=>value.metadata.revision),[6,3,2]);
  assert.equal(storage.getItem(BACKUP_STORAGE_KEY),null);
});

test('important adoption and import create snapshots without changing the imported identity',()=>{
  const storage=memoryStorage(),first=checkpoint();first.companion.identity.name='';first.companion.identity.adoptedAt=null;
  writeCompanionStorage(storage,first);writeCompanionStorage(storage,checkpoint(2,3000));
  assert.equal(readGoodCompanionSnapshots(storage).length,2);
  const incoming=checkpoint(2,3000);incoming.companion.identity.id='11111111-1111-4111-8111-111111111111';
  const prior=storage.getItem(COMPANION_STORAGE_KEY);writeCompanionStorage(storage,incoming,{backup:true});
  assert.equal(storage.getItem(BACKUP_STORAGE_KEY),prior);
  const snapshots=readGoodCompanionSnapshots(storage);
  assert.notEqual(companionSnapshotKey(snapshots[0]),companionSnapshotKey(snapshots[1]));
  assert.equal(readCompanionStorage(storage).companion.identity.id,incoming.companion.identity.id);
});

test('damaged primary never falls back automatically and invalid recovery entries are excluded',()=>{
  const storage=memoryStorage();writeCompanionStorage(storage,checkpoint());storage.values.set(COMPANION_STORAGE_KEY,'broken primary');
  const rawGood=storage.getItem(GOOD_SNAPSHOTS_STORAGE_KEY);assert.throws(()=>readCompanionStorage(storage));
  assert.equal(storage.getItem(COMPANION_STORAGE_KEY),'broken primary');assert.equal(storage.getItem(GOOD_SNAPSHOTS_STORAGE_KEY),rawGood);
  const corrupt=checkpoint(9);corrupt.companion.identity.name='<bad>';
  storage.values.set(GOOD_SNAPSHOTS_STORAGE_KEY,JSON.stringify({format:1,snapshots:[corrupt,checkpoint()]}));
  assert.equal(readGoodCompanionSnapshots(storage).length,1);
});

test('failed primary writes are explicit and retain the preceding primary',()=>{
  const storage=memoryStorage();writeCompanionStorage(storage,checkpoint());const old=storage.getItem(COMPANION_STORAGE_KEY);
  storage.failKey=COMPANION_STORAGE_KEY;assert.throws(()=>writeCompanionStorage(storage,checkpoint(2,61000)),/storage full/);
  assert.equal(storage.getItem(COMPANION_STORAGE_KEY),old);assert.equal(storage.getItem(BACKUP_STORAGE_KEY),null);
});

test('an auxiliary snapshot write failure still saves the latest primary and keeps actual recovery copies',()=>{
  const storage=memoryStorage();writeCompanionStorage(storage,checkpoint());
  const previousCopies=storage.getItem(GOOD_SNAPSHOTS_STORAGE_KEY);
  storage.failKey=GOOD_SNAPSHOTS_STORAGE_KEY;
  const result=writeCompanionStorage(storage,checkpoint(2,61000));
  assert.equal(readCompanionStorage(storage).metadata.revision,2);
  assert.ok(result.snapshotError);
  assert.equal(storage.getItem(GOOD_SNAPSHOTS_STORAGE_KEY),previousCopies);
  assert.deepEqual(result.snapshots.map(value=>value.metadata.revision),[1]);
  storage.failKey=null;
  const recovered=writeCompanionStorage(storage,checkpoint(3,63000));
  assert.equal(recovered.snapshotError,null);
  assert.deepEqual(readGoodCompanionSnapshots(storage).map(value=>value.metadata.revision),[3,1]);
});

test('when both automatic writes fail the preceding primary and snapshots remain untouched',()=>{
  const storage=memoryStorage();writeCompanionStorage(storage,checkpoint());
  const oldPrimary=storage.getItem(COMPANION_STORAGE_KEY),oldCopies=storage.getItem(GOOD_SNAPSHOTS_STORAGE_KEY);
  const originalWrite=storage.setItem;
  storage.setItem=(key,value)=>{if([COMPANION_STORAGE_KEY,GOOD_SNAPSHOTS_STORAGE_KEY].includes(key))throw new DOMException('injected full storage','QuotaExceededError');originalWrite(key,value);};
  assert.throws(()=>writeCompanionStorage(storage,checkpoint(2,61000)),/full storage/);
  assert.equal(storage.getItem(COMPANION_STORAGE_KEY),oldPrimary);
  assert.equal(storage.getItem(GOOD_SNAPSHOTS_STORAGE_KEY),oldCopies);
});

test('an import cannot replace the primary if its pre-import backup cannot be written',()=>{
  const storage=memoryStorage();writeCompanionStorage(storage,checkpoint());
  const oldPrimary=storage.getItem(COMPANION_STORAGE_KEY),oldCopies=storage.getItem(GOOD_SNAPSHOTS_STORAGE_KEY);
  storage.failKey=BACKUP_STORAGE_KEY;
  assert.throws(()=>writeCompanionStorage(storage,checkpoint(2,61000),{backup:true}),/storage full/);
  assert.equal(storage.getItem(COMPANION_STORAGE_KEY),oldPrimary);
  assert.equal(storage.getItem(GOOD_SNAPSHOTS_STORAGE_KEY),oldCopies);
});

test('snapshot quota failure during import retains the pre-import backup and reports only existing snapshots',()=>{
  const storage=memoryStorage();writeCompanionStorage(storage,checkpoint());
  const prior=storage.getItem(COMPANION_STORAGE_KEY),previousCopies=storage.getItem(GOOD_SNAPSHOTS_STORAGE_KEY);
  storage.failKey=GOOD_SNAPSHOTS_STORAGE_KEY;
  const result=writeCompanionStorage(storage,checkpoint(2,61000),{backup:true});
  assert.equal(storage.getItem(BACKUP_STORAGE_KEY),prior);
  assert.equal(readCompanionStorage(storage).metadata.revision,2);
  assert.equal(storage.getItem(GOOD_SNAPSHOTS_STORAGE_KEY),previousCopies);
  assert.ok(result.snapshotError);
  assert.deepEqual(result.snapshots.map(value=>value.metadata.revision),[1]);
});

test('damaged auxiliary snapshots preserve their raw bytes while primary saves and imports continue',()=>{
  for(const raw of ['broken recovery JSON',JSON.stringify({format:1,snapshots:[{format:99},checkpoint()]})]){
    const storage=memoryStorage();writeCompanionStorage(storage,checkpoint());storage.values.set(GOOD_SNAPSHOTS_STORAGE_KEY,raw);
    const result=writeCompanionStorage(storage,checkpoint(2,61000));assert.ok(result.snapshotError);
    assert.equal(readCompanionStorage(storage).metadata.revision,2);assert.equal(storage.getItem(GOOD_SNAPSHOTS_STORAGE_KEY),raw);
    const prior=storage.getItem(COMPANION_STORAGE_KEY);const imported=writeCompanionStorage(storage,checkpoint(3,62000),{backup:true});
    assert.ok(imported.snapshotError);assert.equal(storage.getItem(BACKUP_STORAGE_KEY),prior);
    assert.equal(readCompanionStorage(storage).metadata.revision,3);assert.equal(storage.getItem(GOOD_SNAPSHOTS_STORAGE_KEY),raw);
  }
});

let moduleSerial=0;
const turn=()=>new Promise(resolve=>setImmediate(resolve));
async function browserFixture(options={}){
  const globals=['MIRROR_BROWSER_LIFE','navigator','localStorage','document','addEventListener','location','Worker','setTimeout','clearTimeout'];
  const originals=new Map(globals.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  const storage=memoryStorage(),events=new Map(),timers=new Map(),workers=[];
  let held=false,lockRequests=0,reloads=0,timerId=0;
  const fixture={storage,workers,options,get held(){return held;},get lockRequests(){return lockRequests;},get reloads(){return reloads;},timers,
    async dispatch(name,event={}){for(const callback of events.get(name)??[])callback(event);await turn();},
    fireTimer(milliseconds){const selected=[...timers].find(([,timer])=>timer.milliseconds===milliseconds);assert.ok(selected,'timer exists');timers.delete(selected[0]);selected[1].callback();},
    async module(){return import(`../public/browser-life.mjs?lifecycle-test=${++moduleSerial}`);},
    async close(){try{await fixture.dispatch('pagehide');}finally{for(const [name,descriptor]of originals){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}}}};
  const addListener=(name,callback)=>{const callbacks=events.get(name)??[];callbacks.push(callback);events.set(name,callbacks);};
  const define=(name,value)=>Object.defineProperty(globalThis,name,{configurable:true,writable:true,value});
  define('MIRROR_BROWSER_LIFE',true);define('localStorage',storage);
  define('document',{hidden:false,addEventListener:addListener});define('addEventListener',addListener);define('location',{reload(){reloads++;}});
  define('navigator',{locks:{request(name,settings,callback){lockRequests++;if(held)return Promise.resolve(callback(null));held=true;return Promise.resolve(callback({name})).finally(()=>{held=false;});}}});
  define('setTimeout',(callback,milliseconds)=>{const id=++timerId;timers.set(id,{callback,milliseconds});return id;});define('clearTimeout',id=>timers.delete(id));
  define('Worker',class {
    constructor(){if(options.constructorFailure)throw Error('injected Worker constructor failure');this.messages=[];this.terminated=false;workers.push(this);if(options.autoBoot!==false)queueMicrotask(()=>this.emit({type:'booted'}));}
    emit(data){this.onmessage?.({data});}
    postMessage(data){
      if(options.postFailure)throw Error('injected postMessage failure');this.messages.push(data);
      if(data.type==='init'&&options.autoState!==false)queueMicrotask(()=>this.emit({type:'state',state:{server:{}},checkpoint:checkpoint(workers.length,1000*workers.length)}));
      if(data.path&&options.apiReply!==false)queueMicrotask(()=>this.emit({id:data.id,result:data.path==='/api/companion/export'?checkpoint(workers.length):{ok:true}}));
    }
    terminate(){this.terminated=true;}
  });
  fixture.api=await fixture.module();return fixture;
}

async function withBrowser(options,run){const fixture=await browserFixture(options);try{await run(fixture);}finally{await fixture.close();}}

test('a failed initial storage read releases the writer and explicit retry starts normally',async()=>withBrowser({},async f=>{
  const errors=[],states=[];f.storage.readFailure=true;f.api.subscribeLife(state=>states.push(state),error=>errors.push(error.message));await turn();
  assert.equal(f.api.getPersistence().runtimeStatus,'failed');assert.equal(f.held,false);assert.equal(errors.length,1);
  f.storage.readFailure=false;await f.api.retryLife();assert.equal(states.length,1);assert.equal(f.lockRequests,2);
  assert.equal(f.api.getPersistence().runtimeStatus,'ready');assert.equal(f.api.getPersistence().status,'saved');
}));

test('concurrent retries share one startup and visibility is synchronized while initialization is pending',async()=>withBrowser({autoState:false},async f=>{
  document.hidden=true;const first=f.api.retryLife(),second=f.api.retryLife();assert.equal(first,second);await turn();
  assert.equal(f.lockRequests,1);assert.equal(f.workers[0].messages.find(message=>message.type==='init').hidden,true);
  document.hidden=false;await f.dispatch('visibilitychange');
  assert.ok(f.workers[0].messages.some(message=>message.type==='visibility'&&message.hidden===false));
  f.workers[0].emit({type:'state',state:{server:{}},checkpoint:checkpoint()});await first;
  assert.equal(f.api.getPersistence().runtimeStatus,'ready');
}));

test('constructor errors and boot timeouts clean up and remain retryable',async()=>{
  for(const cause of ['constructor','timeout'])await withBrowser({constructorFailure:cause==='constructor',autoBoot:cause!=='timeout'},async f=>{
    const errors=[];f.api.subscribeLife(()=>{},error=>errors.push(error.message));await turn();
    if(cause==='timeout'){f.fireTimer(90000);await turn();assert.equal(f.workers[0].terminated,true);}
    assert.equal(errors.length,1);assert.equal(f.held,false);assert.equal(f.timers.size,0);
    f.options.constructorFailure=false;f.options.autoBoot=true;await f.api.retryLife();assert.equal(f.api.getPersistence().runtimeStatus,'ready');
  });
});

test('duplicate boot messages cannot reinitialize; runtime error reaches all subscribers and clears pending work',async()=>withBrowser({apiReply:false},async f=>{
  const errorsA=[],errorsB=[];f.api.subscribeLife(()=>{},e=>errorsA.push(e.message));f.api.subscribeLife(()=>{},e=>errorsB.push(e.message));await f.api.retryLife();
  const original=f.workers[0],oldCallback=original.onmessage;original.emit({type:'booted'});original.emit({type:'booted'});
  assert.equal(original.messages.filter(message=>message.type==='init').length,1);
  const request=f.api.localApi('/api/state');await turn();const rejected=assert.rejects(request,/runtime crash/);
  original.onerror({message:'injected runtime crash'});await rejected;await turn();
  assert.equal(errorsA.length,1);assert.equal(errorsB.length,1);assert.equal(original.terminated,true);assert.equal(f.timers.size,0);assert.equal(f.held,false);
  assert.equal(JSON.parse(await f.api.exportCompanion()).metadata.revision,1);
  await f.api.retryLife();const saved=f.storage.getItem(COMPANION_STORAGE_KEY);
  oldCallback({data:{type:'state',state:{server:{}},checkpoint:checkpoint(999)}});
  assert.equal(f.storage.getItem(COMPANION_STORAGE_KEY),saved);assert.equal(f.api.getPersistence().runtimeStatus,'ready');
}));

test('another tab cannot obtain the writer or change primary; retry succeeds after first owner exits',async()=>withBrowser({},async f=>{
  await f.api.retryLife();const saved=f.storage.getItem(COMPANION_STORAGE_KEY),second=await f.module(),errors=[];
  second.subscribeLife(()=>{},error=>errors.push(error.message));await turn();
  assert.match(errors[0],/另一个标签页/);assert.equal(f.workers.length,1);assert.equal(f.storage.getItem(COMPANION_STORAGE_KEY),saved);
  await f.dispatch('pagehide');assert.equal(f.held,false);await second.retryLife();assert.equal(f.workers.length,2);assert.equal(second.getPersistence().runtimeStatus,'ready');
}));

test('storage quota failure does not report saved and latest identity can still be exported',async()=>withBrowser({},async f=>{
  f.storage.failKey=COMPANION_STORAGE_KEY;await f.api.retryLife();
  assert.equal(f.api.getPersistence().status,'error');assert.equal(f.api.getPersistence().lastSavedAt,null);assert.equal(f.api.getPersistence().revision,null);
  assert.equal(JSON.parse(await f.api.exportCompanion()).companion.identity.id,sample.companion.identity.id);
  f.storage.failKey=null;f.workers[0].emit({type:'state',state:{server:{}},checkpoint:checkpoint(2,61000)});
  assert.equal(f.api.getPersistence().status,'saved');assert.equal(f.api.getPersistence().revision,2);
}));

test('auxiliary recovery corruption reports degraded safety without blocking a valid live primary',async()=>withBrowser({},async f=>{
  f.storage.values.set(GOOD_SNAPSHOTS_STORAGE_KEY,'preserved broken good snapshots');await f.api.retryLife();
  const saved=f.api.getPersistence();assert.equal(saved.status,'degraded');assert.ok(saved.lastSavedAt);assert.equal(saved.revision,1);
  assert.ok(saved.snapshotError);assert.match(saved.error,/主存档已保存/);assert.equal(f.api.rawGoodCompanionBackup(),'preserved broken good snapshots');
  const incoming=checkpoint(10);await f.api.importCompanion(JSON.stringify(incoming));
  assert.equal(readCompanionStorage(f.storage).metadata.revision,10);assert.equal(f.api.rawGoodCompanionBackup(),'preserved broken good snapshots');
}));

test('live snapshot write failure publishes a saved primary warning and clears it when storage recovers',async()=>withBrowser({},async f=>{
  f.storage.failKey=GOOD_SNAPSHOTS_STORAGE_KEY;
  const states=[];f.api.subscribeLife(state=>states.push(state));await f.api.retryLife();
  const degraded=f.api.getPersistence();
  assert.equal(degraded.status,'degraded');assert.ok(degraded.lastSavedAt);assert.equal(degraded.revision,1);
  assert.equal(degraded.runtimeStatus,'ready');assert.ok(degraded.snapshotError);
  assert.deepEqual(degraded.goodSnapshots,[]);
  assert.equal(states.at(-1).server.persistence.status,'degraded');
  assert.equal(readCompanionStorage(f.storage).metadata.revision,1);
  f.storage.failKey=null;f.workers[0].emit({type:'state',state:{server:{}},checkpoint:checkpoint(2,61000)});
  const recovered=f.api.getPersistence();
  assert.equal(recovered.status,'saved');assert.equal(recovered.error,null);assert.equal(recovered.snapshotError,null);
  assert.equal(recovered.goodSnapshots[0].revision,2);
}));

test('a refused import keeps the live worker and writer usable until its backup can be written',async()=>withBrowser({},async f=>{
  await f.api.retryLife();const previous=f.storage.getItem(COMPANION_STORAGE_KEY);
  f.storage.failKey=BACKUP_STORAGE_KEY;
  await assert.rejects(f.api.importCompanion(JSON.stringify(checkpoint(8))),/storage full/);
  assert.equal(f.storage.getItem(COMPANION_STORAGE_KEY),previous);
  assert.equal(f.api.getPersistence().runtimeStatus,'ready');assert.equal(f.workers[0].terminated,false);
  assert.equal(f.held,true);assert.equal(f.reloads,0);
  f.storage.failKey=null;await f.api.importCompanion(JSON.stringify(checkpoint(8)));
  assert.equal(f.storage.getItem(BACKUP_STORAGE_KEY),previous);assert.equal(f.reloads,1);
}));

test('invalid imports do not terminate or write; valid imports preserve raw predecessor and release writer',async()=>withBrowser({},async f=>{
  await f.api.retryLife();const prior=f.storage.getItem(COMPANION_STORAGE_KEY),writes=f.storage.writes.length;
  await assert.rejects(f.api.importCompanion('{broken'));assert.equal(f.storage.writes.length,writes);assert.equal(f.workers[0].terminated,false);
  const incoming=checkpoint(8);incoming.companion.identity.id='11111111-1111-4111-8111-111111111111';
  await f.api.importCompanion(JSON.stringify(incoming));assert.equal(f.storage.getItem(BACKUP_STORAGE_KEY),prior);
  assert.equal(readCompanionStorage(f.storage).companion.identity.id,incoming.companion.identity.id);assert.equal(f.held,false);assert.equal(f.reloads,1);
}));

test('damaged primary stays untouched until a chosen valid rolling snapshot is restored',async()=>withBrowser({},async f=>{
  writeCompanionStorage(f.storage,checkpoint());f.storage.values.set(COMPANION_STORAGE_KEY,'damaged player data');
  f.api.subscribeLife(()=>{},()=>{});await turn();assert.equal(f.workers.length,0);assert.equal(f.storage.getItem(COMPANION_STORAGE_KEY),'damaged player data');
  const backups=f.api.goodCompanionBackups();assert.equal(backups.length,1);assert.equal(JSON.parse(f.api.exportGoodCompanionBackup(backups[0].key)).metadata.revision,1);
  assert.throws(()=>f.api.exportGoodCompanionBackup('missing'),/不可用/);
  await f.api.restoreGoodCompanionBackup(backups[0].key);assert.equal(f.storage.getItem(BACKUP_STORAGE_KEY),'damaged player data');
  assert.equal(readCompanionStorage(f.storage).companion.identity.id,sample.companion.identity.id);assert.equal(f.reloads,1);
}));

test('pagehide cancels pending requests and returns writer; BFCache pageshow reconstructs via reload',async()=>withBrowser({apiReply:false},async f=>{
  await f.api.retryLife();const request=f.api.localApi('/api/state');await turn();const rejected=assert.rejects(request,/已停止/);
  document.hidden=true;await f.dispatch('visibilitychange');assert.ok(f.workers[0].messages.some(message=>message.type==='visibility'&&message.hidden));
  await f.dispatch('pagehide');await rejected;assert.equal(f.held,false);assert.equal(f.timers.size,0);assert.equal(f.workers[0].terminated,true);
  await f.dispatch('pageshow',{persisted:true});assert.equal(f.reloads,1);assert.equal(f.workers.length,1);
}));

test('API timeout clears only that request, and serialization failure stops the failed worker',async()=>withBrowser({apiReply:false},async f=>{
  await f.api.retryLife();const request=f.api.localApi('/api/state');await turn();const rejected=assert.rejects(request,/响应超时/);
  f.fireTimer(15000);await rejected;assert.equal(f.api.getPersistence().runtimeStatus,'ready');assert.equal(f.timers.size,0);
  f.options.postFailure=true;await assert.rejects(f.api.localApi('/api/state'),/postMessage failure/);await turn();
  assert.equal(f.api.getPersistence().runtimeStatus,'failed');assert.equal(f.workers[0].terminated,true);assert.equal(f.held,false);assert.equal(f.timers.size,0);
}));

test('worker ignores duplicate init, stops periodic hidden snapshots and resumes without offline catch-up',async()=>{
  const source=(await readFile(new URL('../public/browser-life-worker.mjs',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'');
  const messages=[],timers=[];let now=0,created=0,steps=0;
  class Simulation{
    constructor(){created++;this.state={paused:false,companion:{identity:{adoptedAt:1}}};this.neural={fingerprint:'a'.repeat(64),snapshot:()=>({}),learning:{serializeWeights:()=>structuredClone(sample.synapticMemory)}};}
    snapshot(){return {simSeconds:steps};}setPaused(value){this.state.paused=value;}setSpeed(){}
  }
  const context={EmbodiedLife:Simulation,RuntimeClock:class{advance(elapsed){steps+=elapsed;}snapshot(){return {};}} ,
    collisionInfo:{},restoreCompanion(){},companionCheckpoint(state,metadata){return {metadata};},flushCompanion(){},adoptCompanion(){},validName:value=>value,
    performance:{now:()=>now},postMessage:message=>messages.push(message),setInterval:(callback,interval)=>timers.push({callback,interval}),URL};
  vm.runInNewContext(source,context,{filename:'browser-life-worker.mjs'});
  context.onmessage({data:{type:'init',saved:{metadata:{revision:40}},hidden:false}});
  context.onmessage({data:{type:'init',saved:null}});assert.equal(created,1);
  assert.equal(messages.find(message=>message.type==='state').checkpoint.metadata.revision,41);
  const clockTimer=timers.find(timer=>timer.interval===8),stateTimer=timers.find(timer=>timer.interval===200);
  now=20;clockTimer.callback();assert.equal(steps,.02);
  context.onmessage({data:{type:'visibility',hidden:true}});const hiddenMessages=messages.length;
  now=20000;clockTimer.callback();stateTimer.callback();stateTimer.callback();assert.equal(steps,.02);assert.equal(messages.length,hiddenMessages);
  context.onmessage({data:{type:'visibility',hidden:false}});now=20020;clockTimer.callback();assert.ok(Math.abs(steps-.04)<1e-9);
});
