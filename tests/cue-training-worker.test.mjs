import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const clientModule=()=>import('../public/cue-training-client.mjs');
const workerModule=()=>import('../public/cue-training-worker.mjs');
const flush=()=>new Promise(resolve=>setImmediate(resolve));

function scheduler(){
  let serial=0;const jobs=new Map();
  return {jobs,setTimeout(fn,ms){const id=++serial;jobs.set(id,{fn,ms,interval:false});return id;},
    clearTimeout(id){jobs.delete(id);},setInterval(fn,ms){const id=++serial;jobs.set(id,{fn,ms,interval:true});return id;},
    clearInterval(id){jobs.delete(id);},fire(id){const job=jobs.get(id);if(!job)return;if(!job.interval)jobs.delete(id);job.fn();}};
}
function visibility(){
  const listeners=new Map();return {hidden:false,listeners,
    addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},
    removeEventListener(type,fn){listeners.get(type)?.delete(fn);},
    fire(type){for(const fn of listeners.get(type)??[])fn();}};
}
class FakeWorker {
  sent=[];terminated=0;onmessage=null;onerror=null;onmessageerror=null;
  postMessage(message){this.sent.push(structuredClone(message));}
  terminate(){this.terminated++;}
  deliver(data){this.onmessage?.({data});}
}
async function clientFixture(options={}){
  const {createCueTrainingClient}=await clientModule(),clock=scheduler(),document=visibility(),events=visibility(),workers=[];
  const client=createCueTrainingClient({seed:8401,workerFactory:()=>{const w=new FakeWorker();workers.push(w);return w;},
    document,eventTarget:events,setTimeout:clock.setTimeout,clearTimeout:clock.clearTimeout,...options});
  return {client,clock,document,events,workers};
}
async function readyFixture(){
  const f=await clientFixture(),ready=f.client.start(),worker=f.workers[0];
  worker.deliver({type:'booted'});const init=worker.sent.find(message=>message.type==='init');
  worker.deliver({type:'response',id:init.id,generation:init.generation,ok:true,revision:1,result:{phase:'training',food:100}});
  await ready;return {...f,worker,init};
}

test('independent training worker and client exist before connecting any daily pet',async()=>{
  let client=false,worker=false;
  try{client=typeof(await clientModule()).createCueTrainingClient==='function';}catch{}
  try{worker=typeof(await workerModule()).createCueTrainingWorkerRuntime==='function';}catch{}
  assert.equal(client,true,'Training requires a separate client');assert.equal(worker,true,'Training requires a separate worker runtime');
});

test('start handshakes once and carries a lab seed and page visibility without any daily save',async()=>{
  const f=await clientFixture();f.document.hidden=true;
  const first=f.client.start(),again=f.client.start();assert.equal(first,again);assert.equal(f.workers.length,1);
  const worker=f.workers[0];worker.deliver({type:'booted'});worker.deliver({type:'booted'});
  const messages=worker.sent.filter(message=>message.type==='init');assert.equal(messages.length,1);
  const init=messages[0];assert.equal(init.seed,8401);assert.equal(init.hidden,true);
  assert.equal('saved' in init,false);assert.equal('checkpoint' in init,false);
  worker.deliver({type:'response',id:init.id,generation:init.generation,ok:true,revision:1,result:{phase:'training'}});
  assert.deepEqual(await first,{phase:'training'});assert.equal(f.client.status,'ready');f.client.dispose();
});

test('client matches request ids, rejects overlapping commands and ignores old state revisions',async()=>{
  const f=await readyFixture(),states=[];f.client.subscribe(state=>states.push(state));
  const pending=f.client.command('emit','A');await flush();const request=f.worker.sent.at(-1);
  assert.equal(f.client.busy,true);await assert.rejects(f.client.command('probe'),/busy|正在/i);
  f.worker.deliver({type:'response',id:request.id+50,generation:request.generation,ok:true,revision:2,result:{phase:'wrong'}});
  assert.equal(f.client.busy,true);
  f.worker.deliver({type:'state',generation:request.generation,revision:4,state:{phase:'training',time:4}});
  f.worker.deliver({type:'response',id:request.id,generation:request.generation,ok:true,revision:3,result:{phase:'training',time:3}});
  assert.equal((await pending).time,4);assert.equal(f.client.state.time,4);assert.equal(f.client.busy,false);
  f.worker.deliver({type:'state',generation:request.generation,revision:2,state:{time:2}});
  assert.equal(f.client.state.time,4);f.client.dispose();
});

test('request timeout terminates the uncertain lab and clears stale food-free state',async()=>{
  const f=await readyFixture(),errors=[];f.client.subscribe(()=>{},error=>errors.push(error));
  const request=f.client.command('probe'),rejected=assert.rejects(request,/超时|timeout/i);
  await flush();
  const timer=[...f.clock.jobs].find(([,job])=>!job.interval);assert.ok(timer);f.clock.fire(timer[0]);
  await rejected;assert.equal(f.worker.terminated,1);assert.equal(f.client.status,'failed');assert.equal(f.client.state,null);
  assert.equal(f.client.busy,false);assert.equal(errors.length,1);assert.equal(f.clock.jobs.size,0);f.client.dispose();
});

test('startup error and uncloneable command failure reject promises and release the worker',async()=>{
  const f=await clientFixture(),start=f.client.start(),startRejected=assert.rejects(start,/startup failed/);
  f.workers[0].onerror({message:'startup failed'});await startRejected;assert.equal(f.workers[0].terminated,1);f.client.dispose();
  const ready=await readyFixture();ready.worker.postMessage=()=>{throw Error('clone failed');};
  await assert.rejects(ready.client.command('emit',{odor:'A'}),/clone failed/);
  assert.equal(ready.worker.terminated,1);assert.equal(ready.client.state,null);ready.client.dispose();
});

test('startup deadline cleans a silent worker and a retried session ignores every previous-generation response',async()=>{
  const f=await clientFixture(),start=f.client.start(),old=f.workers[0],oldHandler=old.onmessage;
  const rejected=assert.rejects(start,/超时|timeout/i),timer=[...f.clock.jobs.keys()][0];f.clock.fire(timer);await rejected;
  assert.equal(old.terminated,1);assert.equal(f.client.status,'failed');
  const retry=f.client.start(),active=f.workers[1];active.deliver({type:'booted'});const init=active.sent.at(-1);
  active.deliver({type:'response',id:init.id,generation:init.generation,ok:true,revision:1,result:{phase:'training',experiment:'new'}});await retry;
  oldHandler({data:{type:'state',generation:init.generation-2,revision:999,state:{phase:'probe',food:0}}});
  assert.equal(f.client.state.experiment,'new');f.client.dispose();assert.equal(f.clock.jobs.size,0);
});

test('an ordinary command cannot silently replace a failed learned individual with a new lab',async()=>{
  const f=await readyFixture();f.worker.onerror({message:'worker lost'});let failure;
  const operation=f.client.command('emit','A').catch(error=>{failure=error;});
  try{await flush();assert.equal(f.workers.length,1);await operation;assert.match(failure.message,/重新|停止/);}
  finally{f.client.dispose();await operation;}
});

test('visibility is forwarded independently while pagehide and dispose remove every listener and timer',async()=>{
  const f=await readyFixture();f.document.hidden=true;f.document.fire('visibilitychange');
  assert.deepEqual(f.worker.sent.at(-1),{type:'visibility',generation:f.init.generation,hidden:true});
  const oldHandler=f.worker.onmessage,request=f.client.command('pause',true),rejected=assert.rejects(request,/停止|disposed/i);
  f.events.fire('pagehide');await rejected;f.client.dispose();
  assert.equal(f.worker.terminated,1);assert.equal(f.client.status,'disposed');assert.equal(f.client.state,null);
  assert.equal(f.clock.jobs.size,0);assert.ok([...f.document.listeners.values(),...f.events.listeners.values()].every(set=>set.size===0));
  oldHandler({data:{type:'state',generation:f.init.generation,revision:99,state:{phase:'probe',food:0}}});
  assert.equal(f.client.state,null);await assert.rejects(f.client.start(),/停止|disposed/i);
});

test('subscriber exceptions do not lose other subscribers and unsubscribe stops delivery',async()=>{
  const errors=[],f=await clientFixture({onSubscriberError:error=>errors.push(error)});
  const ready=f.client.start(),worker=f.workers[0];worker.deliver({type:'booted'});const init=worker.sent.at(-1);
  worker.deliver({type:'response',id:init.id,generation:init.generation,ok:true,revision:1,result:{phase:'training'}});await ready;
  const seen=[];f.client.subscribe(()=>{throw Error('render failure');});assert.equal(errors.length,1);
  const subscription=f.client.subscribe(state=>seen.push(state));assert.equal(seen.length,1);subscription.close();
  worker.deliver({type:'state',generation:init.generation,revision:2,state:{phase:'training',time:2}});
  assert.equal(seen.length,1);await assert.rejects(f.client.command('unknown-action'),/未知|Unknown/i);f.client.dispose();
});

function sessionFixture(){
  const value={phase:'training',paused:false,food:100,seconds:0},calls=[],steps=[];
  return {value,calls,steps,disposed:0,snapshot(){return structuredClone(value);},
    tick(dt){assert.ok(dt<=.02000001);steps.push(dt);if(!value.paused)value.seconds+=dt;},
    command(action,payload){calls.push({action,payload});if(action==='pause')value.paused=payload;
      else if(action==='probe')value.phase='probe',value.food=0;else if(action==='end')value.phase='ended',value.food=100;
      else if(action==='explode')throw Error('session failed');return this.snapshot();},dispose(){this.disposed++;value.food=100;value.phase='ended';}};
}
async function runtimeFixture(factory){
  const {createCueTrainingWorkerRuntime}=await workerModule(),clock=scheduler(),messages=[],session=sessionFixture();let now=0;
  const runtime=createCueTrainingWorkerRuntime({send:message=>messages.push(structuredClone(message)),
    sessionFactory:factory??(()=>session),now:()=>now,setInterval:clock.setInterval,clearInterval:clock.clearInterval});
  return {runtime,clock,messages,session,setNow(value){now=value;}};
}
const initMessage={type:'init',id:1,generation:1,seed:8401,hidden:false};

test('worker init is independent, duplicate init cannot replace a living lab, and outdated ids cannot replay commands',async()=>{
  let creations=0;const f=await runtimeFixture(()=>{creations++;return sessionFixture();});await f.runtime.handle(initMessage);
  await f.runtime.handle({...initMessage,id:2});assert.equal(creations,1);
  await f.runtime.handle({type:'command',id:3,generation:1,action:'probe'});
  const revision=f.messages.filter(message=>message.type==='state').at(-1).revision;
  await f.runtime.handle({type:'command',id:3,generation:1,action:'end'});
  await f.runtime.handle({type:'command',id:4,generation:0,action:'end'});
  assert.equal(f.messages.filter(message=>message.type==='state').at(-1).revision,revision);f.runtime.dispose();
});

test('runtime advances bounded real physics steps and drops suspension debt rather than jumping over physics',async()=>{
  const f=await runtimeFixture();await f.runtime.handle(initMessage);f.setNow(1000);f.runtime.pump();
  assert.equal(f.session.steps.length,5);assert.ok(Math.abs(f.session.value.seconds-.1)<1e-10);
  assert.ok(f.runtime.timing().droppedSeconds>=.75);f.runtime.dispose();assert.equal(f.clock.jobs.size,0);
});

test('hidden lab never advances and resume preserves a manually paused lesson',async()=>{
  const f=await runtimeFixture();await f.runtime.handle(initMessage);
  await f.runtime.handle({type:'command',id:2,generation:1,action:'pause',payload:true});
  await f.runtime.handle({type:'visibility',generation:1,hidden:true});f.setNow(5000);f.runtime.pump();
  await f.runtime.handle({type:'visibility',generation:1,hidden:false});f.setNow(6000);f.runtime.pump();
  assert.equal(f.session.value.paused,true);assert.equal(f.session.steps.length,0);
  await f.runtime.handle({type:'command',id:3,generation:1,action:'pause',payload:false});f.setNow(6020);f.runtime.pump();
  assert.equal(f.session.steps.length,1);f.runtime.dispose();
});

test('busy async startup rejects commands and disposal closes a late-created session without publishing it',async()=>{
  let resolve;const late=sessionFixture(),f=await runtimeFixture(()=>new Promise(done=>{resolve=done;}));
  const init=f.runtime.handle(initMessage);await flush();
  await f.runtime.handle({type:'command',id:2,generation:1,action:'probe'});
  assert.equal(f.messages.at(-1).code,'BUSY');f.runtime.dispose();resolve(late);await init;
  assert.equal(late.disposed,1);assert.equal(f.messages.some(message=>message.type==='state'),false);assert.equal(f.clock.jobs.size,0);
});

test('simulation failure ends the isolated lab before exposing an error or disposal',async()=>{
  const f=await runtimeFixture();await f.runtime.handle(initMessage);
  await f.runtime.handle({type:'command',id:2,generation:1,action:'probe'});
  f.session.tick=()=>{throw Error('physics failed');};f.setNow(20);f.runtime.pump();
  const error=f.messages.find(message=>message.type==='error');assert.match(error.error,/physics failed/);
  assert.equal(error.state.food,100);assert.equal(f.session.value.food,100);assert.equal(f.session.disposed,1);
  assert.equal(f.clock.jobs.size,0);f.runtime.dispose();assert.equal(f.session.disposed,1);
});

test('invalid session factory results are disposed before startup is rejected',async()=>{
  const invalid={disposed:0,dispose(){this.disposed++;}},f=await runtimeFixture(()=>invalid);
  await f.runtime.handle(initMessage);assert.equal(invalid.disposed,1);
  assert.equal(f.messages.some(message=>message.type==='error'),true);assert.equal(f.clock.jobs.size,0);f.runtime.dispose();
});

test('real session connects through the worker while hidden, emits without fabricated learning and advances only actual bounded ticks',async()=>{
  const {CueTrainingSession}=await import('../src/cue-training-session.mjs');let session;
  const f=await runtimeFixture(({seed})=>(session=new CueTrainingSession({seed})));
  try{
    await f.runtime.handle({...initMessage,hidden:true});
    const initial=session.snapshot(),memory=session.exportMemory();
    assert.equal(initial.experiment.phase,'training');assert.equal(initial.experiment.paused,true);
    await f.runtime.handle({type:'command',id:2,generation:1,action:'emit',payload:'A'});
    const emitted=session.snapshot();assert.equal(emitted.experiment.emission,'A');
    assert.deepEqual(emitted.actor.position,initial.actor.position);assert.equal(emitted.simSeconds,initial.simSeconds);
    assert.deepEqual(session.exportMemory(),memory);assert.equal(emitted.experiment.teachingEvents,0);
    await f.runtime.handle({type:'command',id:3,generation:1,action:'probe'});
    assert.equal(f.messages.at(-2).ok,false);assert.equal(session.snapshot().home.food,initial.home.food);
    await f.runtime.handle({type:'visibility',generation:1,hidden:false});f.setNow(20);f.runtime.pump();
    assert.ok(Math.abs(session.snapshot().simSeconds-initial.simSeconds-.02)<1e-9);
    await f.runtime.handle({type:'command',id:4,generation:1,action:'pause',payload:true});
    f.setNow(1000);f.runtime.pump();assert.ok(Math.abs(session.snapshot().simSeconds-initial.simSeconds-.02)<1e-9);
  }finally{f.runtime.dispose();}
  assert.equal(session.snapshot().experiment.phase,'disposed');assert.equal(f.clock.jobs.size,0);
});

test('worker/client never import the daily browser runtime or use persistence and lock APIs',async()=>{
  for(const name of ['cue-training-worker.mjs','cue-training-client.mjs']){
    const source=await readFile(new URL('../public/'+name,import.meta.url),'utf8');
    assert.doesNotMatch(source,/browser-life(?:-worker)?\.mjs|COMPANION_STORAGE_KEY|localStorage|sessionStorage|navigator\.locks|companion-checkpoint/);
  }
});
