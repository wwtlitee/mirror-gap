// 镜隙合作运行时 v8.5.0 — Unclecow. Scheduling/transport only.
import {RuntimeClock} from '../src/runtime-clock.mjs';

const ACTIONS=new Set(['input','interact','continue','retry','probe','endProbe','pause','newGame','export','import','trial','endTrial']);
const validId=value=>Number.isSafeInteger(value)&&value>0;
const messageOf=error=>error instanceof Error?error.message:String(error);
const jsonSafe=value=>JSON.parse(JSON.stringify(value,(_key,item)=>{
  if(typeof item==='bigint')throw Error('BigInt is not serializable in a cooperation checkpoint');
  if(typeof item==='number'&&!Number.isFinite(item))throw Error('Non-finite cooperation state is not serializable');
  return item;
}));
const defaultSessionFactory=async options=>{
  const {MirrorCoopSession}=await import('../src/mirror-coop-session.mjs');
  return new MirrorCoopSession(options);
};

export function createMirrorCoopWorkerRuntime({send,sessionFactory=defaultSessionFactory,now=()=>performance.now(),
  setInterval:schedule=globalThis.setInterval,clearInterval:cancel=globalThis.clearInterval}={}){
  if(typeof send!=='function')throw Error('合作线程缺少消息出口');
  let session=null,clock=null,epoch=null,revision=0,lastRequestId=0,last=now();
  let hidden=false,manualPaused=false,busy=false,disposed=false,failed=false,sessionDisposed=false;
  const timers=[],queue=[];
  function finish(entry){for(const done of entry.completions)done();entry.completions.length=0;}
  function stopTimers(){for(const id of timers)cancel(id);timers.length=0;}
  function cleanSession(value=session){
    if(!value||(value===session&&sessionDisposed))return;
    try{value.dispose();}finally{if(value===session)sessionDisposed=true;}
  }
  function snapshot(){return jsonSafe({...session.snapshot(),runtime:{status:failed?'failed':'ready',hidden,
    manualPaused,paused:hidden||manualPaused,timing:clock?.snapshot()??null}});}
  function publish(){
    if(!session||disposed||failed)return null;
    const state=snapshot();send({type:'state',epoch,revision:++revision,state});return state;
  }
  function respond(data,ok,value,code,extra={}){
    if(disposed)return;
    send({type:'response',id:data.id,epoch:data.epoch,ok,revision,
      ...(ok?{result:value}:{error:messageOf(value),code:code??'COMMAND_FAILED'}),...extra});
  }
  function clearDebt(){last=now();if(clock)clock.debt=0;}
  async function syncPause(){if(session&&!sessionDisposed)await session.command('pause',hidden||manualPaused);clearDebt();}
  function save(){
    if(!session||disposed||failed||busy)return;
    send({type:'save',epoch,revision,checkpoint:jsonSafe(session.serialize())});
  }
  function fail(error){
    if(disposed||failed)return;failed=true;busy=false;stopTimers();let state=null,cleanupError=null;
    if(session)try{state=snapshot();}catch{}
    try{cleanSession();}catch(cleanup){cleanupError=messageOf(cleanup);}
    for(const entry of queue.splice(0)){for(const data of entry.messages)respond(data,false,error,'RUNTIME_FAILED');finish(entry);}
    try{send({type:'error',epoch,error:messageOf(error),fatal:true,state,cleanupError});}catch{}
  }
  function pump(){
    if(disposed||failed)return;
    try{const instant=now(),elapsed=Math.max(0,(instant-last)/1000);last=instant;
      if(!session||busy||hidden||manualPaused){if(clock)clock.debt=0;return;}clock.advance(elapsed);
    }catch(error){fail(error);}
  }
  async function drain(){
    if(busy||disposed||failed||!session)return;
    busy=true;
    try{
      while(queue.length&&!disposed&&!failed){
        const entry=queue.shift(),data=entry.messages.at(-1);let result,extra={};
        try{
          if(data.action==='export')result=jsonSafe(session.serialize());
          else{
            if(data.action==='pause')manualPaused=data.payload;
            else await session.command(data.action,data.payload);
            if(disposed||failed){finish(entry);break;}
            await syncPause();result=publish();
            if(data.action==='import'||data.action==='newGame')extra.checkpoint=jsonSafe(session.serialize());
          }
          for(const request of entry.messages)respond(request,true,result,undefined,extra);
        }catch(error){
          if(!disposed&&!failed){for(const request of entry.messages)respond(request,false,error,'COMMAND_FAILED');
            try{publish();}catch(publishError){fail(publishError);}}
        }finally{clearDebt();finish(entry);}
      }
    }finally{busy=false;clearDebt();}
  }
  async function handle(data){
    if(disposed||failed||!data||typeof data!=='object')return;
    if(data.type==='dispose'){if(epoch===null||data.epoch===epoch)dispose();return;}
    if(data.type==='visibility'){
      if(data.epoch!==epoch||typeof data.hidden!=='boolean')return;hidden=data.hidden;clearDebt();
      if(!busy&&session)try{await syncPause();publish();}catch(error){fail(error);}return;
    }
    if(!validId(data.id)||!validId(data.epoch))return;
    if(epoch!==null&&data.epoch!==epoch)return;
    if(data.id<=lastRequestId){respond(data,false,Error('合作请求已过期'),'STALE_REQUEST');return;}
    lastRequestId=data.id;
    if(data.type==='init'){
      if(session){respond(data,true,publish());return;}
      if(busy){respond(data,false,Error('合作线程正在启动'),'BUSY');return;}
      if(!Number.isSafeInteger(data.seed)||data.seed<0||typeof data.hidden!=='boolean'
        ||(data.initPaused!==undefined&&typeof data.initPaused!=='boolean')){
        respond(data,false,Error('合作初始化参数无效'),'INVALID_ARGUMENT');return;
      }
      // The init request establishes the scheduling gate before async session
      // creation. A blocked main thread cannot let the arrival screen run time.
      epoch=data.epoch;hidden=data.hidden;manualPaused=data.initPaused??false;busy=true;
      try{
        const saved=data.saved==null?null:jsonSafe(data.saved),created=await sessionFactory({seed:data.seed,saved});
        if(disposed){cleanSession(created);return;}
        if(!created||!['command','tick','snapshot','serialize','dispose'].every(name=>typeof created[name]==='function')){
          if(typeof created?.dispose==='function')try{created.dispose();}catch{}throw Error('合作会话接口无效');
        }
        session=created;clock=new RuntimeClock({state:{paused:false},tick:seconds=>session.tick(seconds)},
          {now,budgetMs:8,maxDebt:.25});await syncPause();busy=false;respond(data,true,publish());void drain();
      }catch(error){busy=false;respond(data,false,error,'STARTUP_FAILED');fail(error);}return;
    }
    if(data.type!=='command'||!ACTIONS.has(data.action)){respond(data,false,Error('未知合作操作'),'INVALID_COMMAND');return;}
    if(!session){respond(data,false,Error('合作会话尚未就绪'),'NOT_READY');return;}
    if(data.action==='pause'&&typeof data.payload!=='boolean'){respond(data,false,Error('暂停参数无效'),'INVALID_ARGUMENT');return;}
    if(data.action==='newGame'&&data.payload?.confirm!==true){respond(data,false,Error('新游戏需要明确确认'),'CONFIRM_REQUIRED');return;}
    if(queue.length>=256&&!(data.action==='input'&&queue.at(-1)?.messages.at(-1)?.action==='input')){respond(data,false,Error('合作指令队列已满'),'QUEUE_FULL');return;}
    await new Promise(done=>{
      const tail=queue.at(-1);
      if(data.action==='input'&&tail?.messages.at(-1)?.action==='input'){
        if(tail.messages.length>=256){const previous=tail.messages.shift(),completed=tail.completions.shift();respond(previous,false,Error('输入已被较新输入替代'),'INPUT_SUPERSEDED');completed();}
        tail.messages.push(data);tail.completions.push(done);
      }else queue.push({messages:[data],completions:[done]});
      void drain();
    });
  }
  function dispose(){
    if(disposed)return;disposed=true;busy=false;stopTimers();
    for(const entry of queue.splice(0))finish(entry);try{cleanSession();}catch{}session=null;clock=null;
  }
  timers.push(schedule(pump,8));
  timers.push(schedule(()=>{if(!disposed&&!failed&&!busy&&!hidden&&session)try{publish();}catch(error){fail(error);}},200));
  timers.push(schedule(()=>{try{save();}catch(error){fail(error);}},1000));
  return {handle,pump,dispose,timing:()=>clock?.snapshot()??{pendingSeconds:0,droppedSeconds:0,physicsSteps:0}};
}

if(typeof WorkerGlobalScope!=='undefined'&&globalThis instanceof WorkerGlobalScope){
  const runtime=createMirrorCoopWorkerRuntime({send:message=>postMessage(message)});
  globalThis.onmessage=({data})=>{void runtime.handle(data);};postMessage({type:'booted'});
}
