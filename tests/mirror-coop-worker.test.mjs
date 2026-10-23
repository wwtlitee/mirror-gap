import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

let workerApi={}, clientApi={};
try { workerApi=await import('../public/mirror-coop-worker.mjs'); } catch(e) { if(e.code!=='ERR_MODULE_NOT_FOUND')throw e; }
try { clientApi=await import('../public/mirror-coop-client.mjs'); } catch(e) { if(e.code!=='ERR_MODULE_NOT_FOUND')throw e; }
const ready=()=>{assert.equal(typeof workerApi.createMirrorCoopWorkerRuntime,'function');assert.equal(typeof clientApi.createMirrorCoopClient,'function');};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function scheduler(){let serial=0;const jobs=new Map();return {jobs,setInterval(fn,ms){const id=++serial;jobs.set(id,{fn,ms});return id;},clearInterval(id){jobs.delete(id);},setTimeout(fn,ms){const id=++serial;jobs.set(id,{fn,ms});return id;},clearTimeout(id){jobs.delete(id);},fire(ms){for(const j of [...jobs.values()])if(j.ms===ms)j.fn();}};}
function sessionFixture({saved=null}={}){return {value:{steps:0,paused:false,marker:saved?.marker??'original'},commands:[],disposed:0,
 command(action,payload){this.commands.push({action,payload});if(action==='pause')this.value.paused=payload;if(action==='import'){if(payload.checkpoint?.invalid)throw Error('bad checkpoint');this.value.marker=payload.checkpoint.marker;}},
 tick(dt){assert.equal(dt,.02);this.value.steps++;},snapshot(){return {...this.value};},serialize(){return {format:'mirror-coop-save-v1',marker:this.value.marker,steps:this.value.steps};},dispose(){this.disposed++;}};}
async function runtimeFixture(factory){ready();let instant=0;const clock=scheduler(),messages=[],session=sessionFixture();const runtime=workerApi.createMirrorCoopWorkerRuntime({send:m=>messages.push(structuredClone(m)),sessionFactory:factory??(()=>session),now:()=>instant,setInterval:clock.setInterval,clearInterval:clock.clearInterval});return {runtime,session,clock,messages,setNow:t=>{instant=t;}};}
const init={type:'init',id:1,epoch:1,seed:8501,saved:null,hidden:false};

test('explicit initPaused keeps physics stopped before any UI acknowledgement or pause command',async()=>{
 let release;const created=sessionFixture(),f=await runtimeFixture(()=>new Promise(done=>{release=done;}));
 try{
  const initializing=f.runtime.handle({...init,initPaused:true});
  f.setNow(5000);f.runtime.pump();assert.equal(created.value.steps,0);
  release(created);await initializing;
  assert.deepEqual(created.commands[0],{action:'pause',payload:true});
  const published=f.messages.find(message=>message.type==='state');
  assert.equal(published.state.paused,true);assert.equal(published.state.runtime.manualPaused,true);
  f.setNow(15000);f.clock.fire(8);assert.equal(created.value.steps,0);assert.equal(f.runtime.timing().physicsSteps,0);
  await f.runtime.handle({type:'visibility',epoch:1,hidden:true});
  await f.runtime.handle({type:'visibility',epoch:1,hidden:false});
  f.setNow(20000);f.runtime.pump();assert.equal(created.value.steps,0);
  await f.runtime.handle({type:'command',id:2,epoch:1,action:'pause',payload:false});
  f.setNow(20020);f.runtime.pump();assert.equal(created.value.steps,1);
 }finally{f.runtime.dispose();}
});

test('legacy omitted and explicit false initPaused both retain default autonomous startup',async()=>{
 for(const option of [{},{initPaused:false}]){
  const f=await runtimeFixture();try{await f.runtime.handle({...init,...option});f.setNow(20);f.runtime.pump();assert.equal(f.session.value.steps,1);assert.equal(f.session.value.paused,false);}
  finally{f.runtime.dispose();}
 }
});

test('malformed initPaused is rejected before creating or ticking a session',async()=>{
 for(const initPaused of [null,0,1,'true',{},[]]){
  let creations=0;const f=await runtimeFixture(()=>{creations++;return sessionFixture();});
  try{await f.runtime.handle({...init,initPaused});assert.equal(creations,0);assert.equal(f.messages.at(-1).ok,false);assert.equal(f.messages.at(-1).code,'INVALID_ARGUMENT');}
  finally{f.runtime.dispose();}
 }
});

test('trial start and exit pass through both transport whitelists in order',async()=>{
 const f=await clientFixture(),w=await boot(f);
 try{
  let pending=f.client.command('trial',{kind:'courier'});await flush();let message=w.sent.at(-1);
  assert.equal(message.action,'trial');assert.deepEqual(message.payload,{kind:'courier'});answer(w,message,2);await pending;
  pending=f.client.command('endTrial');await flush();message=w.sent.at(-1);assert.equal(message.action,'endTrial');answer(w,message,3);await pending;
 }finally{f.client.dispose();}
 const r=await runtimeFixture();try{await r.runtime.handle(init);
  await r.runtime.handle({type:'command',id:2,epoch:1,action:'trial',payload:{kind:'signal'}});
  await r.runtime.handle({type:'command',id:3,epoch:1,action:'endTrial'});
  assert.deepEqual(r.session.commands.filter(x=>['trial','endTrial'].includes(x.action)),[{action:'trial',payload:{kind:'signal'}},{action:'endTrial',payload:undefined}]);
 }finally{r.runtime.dispose();}
});

test('worker restores once, rejects stale epochs/ids and advances only bounded fixed physics',async()=>{
 let creations=0;const f=await runtimeFixture(opts=>{creations++;assert.equal(opts.saved.marker,'kept');return sessionFixture(opts);});
 await f.runtime.handle({...init,saved:{marker:'kept'}});await f.runtime.handle({...init,id:2});assert.equal(creations,1);
 await f.runtime.handle({type:'command',id:3,epoch:1,action:'interact'});const rev=f.messages.filter(m=>m.type==='state').at(-1).revision;
 await f.runtime.handle({type:'command',id:3,epoch:1,action:'interact'});await f.runtime.handle({type:'command',id:4,epoch:2,action:'interact'});
 assert.equal(f.messages.filter(m=>m.type==='state').at(-1).revision,rev);f.setNow(1000);f.runtime.pump();assert.equal(f.runtime.timing().physicsSteps,5);assert.ok(f.runtime.timing().droppedSeconds>=.75);f.runtime.dispose();assert.equal(f.clock.jobs.size,0);
});

test('hidden and manual pause are synchronized without suspension debt',async()=>{
 const f=await runtimeFixture();await f.runtime.handle(init);await f.runtime.handle({type:'command',id:2,epoch:1,action:'pause',payload:true});
 await f.runtime.handle({type:'visibility',epoch:1,hidden:true});f.setNow(5000);f.runtime.pump();await f.runtime.handle({type:'visibility',epoch:1,hidden:false});f.setNow(6000);f.runtime.pump();assert.equal(f.session.value.steps,0);assert.equal(f.session.value.paused,true);
 await f.runtime.handle({type:'command',id:3,epoch:1,action:'pause',payload:false});f.setNow(6020);f.runtime.pump();assert.equal(f.session.value.steps,1);f.runtime.dispose();
});

test('busy input coalesces only adjacent inputs while interact remains an ordering barrier',async()=>{
 const f=await runtimeFixture();await f.runtime.handle(init);let release;f.session.command=function(action,payload){this.commands.push({action,payload});if(action==='probe')return new Promise(done=>{release=done;});};
 const active=f.runtime.handle({type:'command',id:2,epoch:1,action:'probe'});await flush();
 const a=f.runtime.handle({type:'command',id:3,epoch:1,action:'input',payload:{move:1}}),b=f.runtime.handle({type:'command',id:4,epoch:1,action:'input',payload:{move:2}}),c=f.runtime.handle({type:'command',id:5,epoch:1,action:'interact'}),d=f.runtime.handle({type:'command',id:6,epoch:1,action:'input',payload:{move:3}});
 release();await Promise.all([active,a,b,c,d]);const relevant=f.session.commands.filter(x=>x.action!=='pause');assert.deepEqual(relevant.map(x=>[x.action,x.payload?.move]),[['probe',undefined],['input',2],['interact',undefined],['input',3]]);assert.equal(f.messages.filter(m=>m.type==='response'&&m.id>=2&&m.ok).length,5);f.runtime.dispose();
});

test('save cadence is one second and export/import return JSON-safe checkpoints',async()=>{
 const f=await runtimeFixture();await f.runtime.handle(init);f.clock.fire(1000);assert.equal(f.messages.filter(m=>m.type==='save').length,1);
 await f.runtime.handle({type:'command',id:2,epoch:1,action:'export'});assert.equal(f.messages.at(-1).result.marker,'original');
 await f.runtime.handle({type:'command',id:3,epoch:1,action:'import',payload:{checkpoint:{marker:'restored'}}});assert.equal(f.session.value.marker,'restored');
 f.session.serialize=()=>({id:1n});f.clock.fire(1000);assert.ok(f.messages.some(m=>m.type==='error'&&/BigInt|serializ/i.test(m.error)));assert.equal(f.clock.jobs.size,0);f.runtime.dispose();
});

test('disposing async startup closes its late session and never publishes or saves it',async()=>{
 let release;const late=sessionFixture(),f=await runtimeFixture(()=>new Promise(done=>{release=done;}));const starting=f.runtime.handle(init);await flush();f.runtime.dispose();release(late);await starting;assert.equal(late.disposed,1);assert.equal(f.clock.jobs.size,0);assert.equal(f.messages.some(m=>m.type==='state'||m.type==='save'),false);
});

test('automatic save cannot serialize the middle of an awaited input command',async()=>{
 const f=await runtimeFixture();await f.runtime.handle(init);let release;
 f.session.command=function(action,payload){if(action==='input'){this.value.marker='partial';return new Promise(done=>{release=()=>{this.value.marker=payload.marker;done();};});}if(action==='pause')this.value.paused=payload;};
 const pending=f.runtime.handle({type:'command',id:2,epoch:1,action:'input',payload:{marker:'complete'}});await flush();f.clock.fire(1000);assert.equal(f.messages.some(m=>m.type==='save'),false);
 release();await pending;f.clock.fire(1000);assert.equal(f.messages.filter(m=>m.type==='save').at(-1).checkpoint.marker,'complete');f.runtime.dispose();
});

test('worker bounds coalesced input acknowledgments and keeps the newest input',async()=>{
 const f=await runtimeFixture();await f.runtime.handle(init);let release;f.session.command=function(action,payload){this.commands.push({action,payload});if(action==='probe')return new Promise(done=>{release=done;});};
 const active=f.runtime.handle({type:'command',id:2,epoch:1,action:'probe'});await flush();const pending=[];
 for(let i=0;i<300;i++)pending.push(f.runtime.handle({type:'command',id:3+i,epoch:1,action:'input',payload:{move:i}}));
 assert.equal(f.messages.filter(m=>m.code==='INPUT_SUPERSEDED').length,44);release();await Promise.all([active,...pending]);assert.deepEqual(f.session.commands.filter(c=>c.action==='input').map(c=>c.payload.move),[299]);f.runtime.dispose();
});

function visibility(){const listeners=new Map();return {hidden:false,addEventListener(t,f){if(!listeners.has(t))listeners.set(t,new Set());listeners.get(t).add(f);},removeEventListener(t,f){listeners.get(t)?.delete(f);},fire(t){for(const f of listeners.get(t)??[])f();}};}
class FakeWorker{sent=[];terminated=0;postMessage(m){this.sent.push(structuredClone(m));}terminate(){this.terminated++;}deliver(data){this.onmessage?.({data});}}
function storageFixture(initial){const data=new Map(initial),writes=[];return {data,writes,getItem:k=>data.get(k)??null,setItem(k,v){writes.push(k);data.set(k,v);}};}
async function clientFixture(storage=storageFixture(),options={}){ready();const clock=scheduler(),page=visibility(),events=visibility(),workers=[];const client=clientApi.createMirrorCoopClient({storage,document:page,eventTarget:events,workerFactory:()=>{const w=new FakeWorker();workers.push(w);return w;},setTimeout:clock.setTimeout,clearTimeout:clock.clearTimeout,...options});return {client,clock,page,events,workers,storage};}
async function boot(f){const p=f.client.start();await flush();const w=f.workers[0];w.deliver({type:'booted'});const init=w.sent.at(-1);w.deliver({type:'response',id:init.id,epoch:init.epoch,ok:true,revision:1,result:{marker:'running'}});await p;return w;}
function answer(w,m,revision,result={marker:'running'}){w.deliver({type:'response',id:m.id,epoch:m.epoch,ok:true,revision,result});}

test('client sends explicit initPaused in init and defaults it to false',async()=>{
 for(const options of [{initPaused:true},{initPaused:false},{}]){
  const f=await clientFixture(storageFixture(),options);
  try{const w=await boot(f),message=w.sent.find(value=>value.type==='init');assert.equal(message.initPaused,options.initPaused??false);assert.equal(w.sent.some(value=>value.action==='pause'),false);}
  finally{f.client.dispose();}
 }
});

test('client validates initPaused before it can create a worker',()=>{
 for(const initPaused of [null,0,1,'true',{},[]])assert.throws(()=>clientApi.createMirrorCoopClient({initPaused}),/暂停|initPaused/);
});

test('cooperative HTML declares a self-contained SVG favicon with no fallback network asset',async()=>{
 const source=await readFile(new URL('../public/coop.html',import.meta.url),'utf8');
 const link=source.match(/<link\b[^>]*\brel="icon"[^>]*>/i)?.[0];assert.ok(link,'cooperative entry must declare its favicon');
 const href=link.match(/\bhref="([^"]+)"/)?.[1];assert.ok(href?.startsWith('data:image/svg+xml,'));
 const svg=decodeURIComponent(href.slice(href.indexOf(',')+1));assert.match(svg,/<svg\b/);assert.match(svg,/xmlns=['"]http:\/\/www\.w3\.org\/2000\/svg['"]/);assert.doesNotMatch(svg,/<(?:image|script)\b|(?:href|src)=/i);
});

test('client owns only its dedicated save key and restores saved input without touching daily storage',async()=>{
 const key='mirror-gap-coop-save-v1';const storage=storageFixture([[key,JSON.stringify({marker:'kept'})],['daily-life','untouched']]);const f=await clientFixture(storage),w=await boot(f);assert.equal(w.sent.find(m=>m.type==='init').saved.marker,'kept');
 w.deliver({type:'save',epoch:w.sent[0].epoch,revision:2,checkpoint:{marker:'next'}});assert.equal(JSON.parse(storage.data.get(key)).marker,'next');assert.deepEqual(storage.writes,[key]);assert.equal(storage.data.get('daily-life'),'untouched');f.client.dispose();
});

test('bad stored JSON is backed up, retained and fails without creating a worker',async()=>{
 const key='mirror-gap-coop-save-v1',raw='{broken';const storage=storageFixture([[key,raw]]),f=await clientFixture(storage);await assert.rejects(f.client.start(),/存档|checkpoint|JSON/);assert.equal(f.client.status,'failed');assert.equal(f.workers.length,0);assert.equal(storage.data.get(key),raw);assert.ok([...storage.data].some(([k,v])=>k.startsWith(key+'.backup-')&&v===raw));f.client.dispose();
});

test('client serializes commands and coalesces busy input without losing interact sequence',async()=>{
 const f=await clientFixture(),w=await boot(f);const first=f.client.command('probe');await flush();const probe=w.sent.at(-1);
 const a=f.client.flushInput({move:1}),b=f.client.flushInput({move:2}),c=f.client.command('interact'),d=f.client.flushInput({move:3});answer(w,probe,2);await flush();let m=w.sent.at(-1);assert.equal(m.action,'input');assert.equal(m.payload.move,2);answer(w,m,3);await flush();m=w.sent.at(-1);assert.equal(m.action,'interact');answer(w,m,4);await flush();m=w.sent.at(-1);assert.equal(m.payload.move,3);answer(w,m,5);await Promise.all([first,a,b,c,d]);assert.equal(w.sent.filter(m=>m.type==='init').length,1);f.client.dispose();
});

test('semantic startup failure preserves the original raw save and cannot silently restart',async()=>{
 const key='mirror-gap-coop-save-v1',raw=JSON.stringify({invalid:true}),f=await clientFixture(storageFixture([[key,raw]]));const p=f.client.start();await flush();const w=f.workers[0];w.deliver({type:'booted'});const m=w.sent.at(-1);w.deliver({type:'response',id:m.id,epoch:m.epoch,ok:false,error:'bad checkpoint',code:'STARTUP_FAILED'});await assert.rejects(p,/checkpoint/);await assert.rejects(f.client.start(),/失败|stopped|failed/);assert.equal(f.storage.data.get(key),raw);assert.ok(f.storage.writes.some(k=>k.startsWith(key+'.backup-')));assert.equal(f.workers.length,1);f.client.dispose();
});

test('semantic import rejection preserves both the existing save and the exact incoming text',async()=>{
 const key='mirror-gap-coop-save-v1',old=JSON.stringify({marker:'old'}),raw='{ "invalid": true }',f=await clientFixture(storageFixture([[key,old]])),w=await boot(f);
 const importing=f.client.import(raw);await flush();const m=w.sent.at(-1);w.deliver({type:'response',id:m.id,epoch:m.epoch,revision:2,ok:false,error:'checkpoint invalid',code:'COMMAND_FAILED'});
 await assert.rejects(importing,/invalid/);assert.equal(f.storage.data.get(key),old);assert.ok([...f.storage.data].some(([k,v])=>k.startsWith(key+'.backup-')&&v===raw));assert.equal(w.sent.filter(m=>m.type==='init').length,1);f.client.dispose();
});

test('pagehide/pageshow resynchronize visibility, and unconfirmed new game cannot erase saves',async()=>{
 const f=await clientFixture(),w=await boot(f);f.events.fire('pagehide');assert.equal(w.sent.at(-1).hidden,true);f.events.fire('pageshow');assert.equal(w.sent.at(-1).hidden,false);
 await assert.rejects(f.client.command('newGame',{confirm:false}),/确认/);assert.equal(w.sent.filter(m=>m.action==='newGame').length,0);f.client.dispose();
});

test('successful import fences late older automatic saves by persisted revision',async()=>{
 const key='mirror-gap-coop-save-v1',f=await clientFixture(),w=await boot(f),p=f.client.import({marker:'new'});await flush();const m=w.sent.at(-1);
 w.deliver({type:'response',id:m.id,epoch:m.epoch,ok:true,revision:5,result:{marker:'new'},checkpoint:{marker:'new'}});await p;
 w.deliver({type:'save',epoch:m.epoch,revision:4,checkpoint:{marker:'old'}});assert.equal(JSON.parse(f.storage.data.get(key)).marker,'new');f.client.dispose();
});

test('client bounds queued controls and coalesces pending input without accumulating promises',async()=>{
 const f=await clientFixture(),w=await boot(f),active=f.client.command('probe').catch(e=>e);await flush();
 const a=f.client.flushInput({move:1}),b=f.client.flushInput({move:2});assert.equal(a,b);const input=a.catch(e=>e);
 const controls=[];for(let i=0;i<255;i++)controls.push(f.client.command('interact').catch(e=>e));
 await assert.rejects(f.client.command('interact'),/队列|QUEUE/);f.client.dispose();await Promise.all([active,input,...controls]);
});

test('queued input captures its value before an interact barrier even when UI reuses a mutable object',async()=>{
 const f=await clientFixture(),w=await boot(f),active=f.client.command('probe');await flush();const probe=w.sent.at(-1),payload={move:{x:1}};
 const first=f.client.flushInput(payload),interact=f.client.command('interact');payload.move.x=2;const second=f.client.flushInput(payload);
 answer(w,probe,2);await flush();let m=w.sent.at(-1);assert.equal(m.payload.move.x,1);answer(w,m,3);await flush();m=w.sent.at(-1);assert.equal(m.action,'interact');answer(w,m,4);await flush();m=w.sent.at(-1);assert.equal(m.payload.move.x,2);answer(w,m,5);await Promise.all([active,first,interact,second]);f.client.dispose();
});

test('real transport loop restores, exports and imports without replacing the isolated session',async()=>{
 ready();const storage=storageFixture([['mirror-gap-coop-save-v1',JSON.stringify({marker:'restored'})]]),clock=scheduler();let created=0,worker;
 class LoopWorker{
  constructor(){this.clock=scheduler();this.runtime=workerApi.createMirrorCoopWorkerRuntime({send:m=>queueMicrotask(()=>this.onmessage?.({data:structuredClone(m)})),sessionFactory:opts=>{created++;return sessionFixture(opts);},setInterval:this.clock.setInterval,clearInterval:this.clock.clearInterval});queueMicrotask(()=>this.onmessage?.({data:{type:'booted'}}));}
  postMessage(message){queueMicrotask(()=>{void this.runtime.handle(structuredClone(message));});}
  terminate(){this.runtime.dispose();}
 }
 const client=clientApi.createMirrorCoopClient({storage,document:visibility(),eventTarget:visibility(),workerFactory:()=>worker=new LoopWorker(),setTimeout:clock.setTimeout,clearTimeout:clock.clearTimeout});
 await client.start();assert.equal((await client.export()).marker,'restored');await client.import('{ "marker": "imported" }');assert.equal((await client.export()).marker,'imported');await assert.rejects(client.import({invalid:true}),/checkpoint/);assert.equal(JSON.parse(storage.data.get('mirror-gap-coop-save-v1')).marker,'imported');assert.equal(created,1);client.dispose();assert.equal(worker.clock.jobs.size,0);
});

test('worker and client do not import daily runtime or own wallet/signing state',async()=>{
 ready();for(const name of ['mirror-coop-worker.mjs','mirror-coop-client.mjs']){const source=await readFile(new URL('../public/'+name,import.meta.url),'utf8');assert.doesNotMatch(source,/browser-life(?:-worker)?\.mjs|COMPANION_STORAGE_KEY|navigator\.locks|privateKey|eth_sendTransaction/);}
});
