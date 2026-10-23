import {RuntimeClock} from '../src/runtime-clock.mjs';

const COMMANDS=new Set(['emit','probe','swap','endProbe','pause','reset']);
const validId=value=>Number.isSafeInteger(value)&&value>0;
const errorMessage=error=>error instanceof Error?error.message:String(error);
const defaultSessionFactory=async({seed})=>{
  const {CueTrainingSession}=await import('../src/cue-training-session.mjs');return new CueTrainingSession({seed});
};

/** Scheduling and messages only; the session owns every physical and neural change. */
export function createCueTrainingWorkerRuntime({send,sessionFactory=defaultSessionFactory,now=()=>performance.now(),
  setInterval:schedule=globalThis.setInterval,clearInterval:cancel=globalThis.clearInterval}={}){
  if(typeof send!=='function')throw Error('Training worker needs a message sender');
  let session=null,clock=null,generation=null,revision=0,lastRequestId=0,last=now();
  let hidden=false,manualPaused=false,busy=false,disposed=false,failed=false,sessionDisposed=false;
  const timers=[];
  function stopTimers(){for(const timer of timers)cancel(timer);timers.length=0;}
  function cleanSession(value=session){
    if(!value||value===session&&sessionDisposed)return;
    try{value.dispose();}finally{if(value===session)sessionDisposed=true;}
  }
  function snapshot(){
    const value=session.snapshot();return {...value,runtime:{status:failed?'failed':'ready',hidden,manualPaused,
      paused:hidden||manualPaused,timing:clock?.snapshot()??null}};
  }
  function publish(){
    if(!session||disposed||failed)return null;
    const state=snapshot();send({type:'state',generation,revision:++revision,state});return state;
  }
  function respond(data,ok,value,code){
    if(disposed)return;
    send({type:'response',id:data.id,generation:data.generation,ok,revision,
      ...(ok?{result:value}:{error:errorMessage(value),code:code??'COMMAND_FAILED'})});
  }
  function clearDebt(){last=now();if(clock)clock.debt=0;}
  function syncPause(){if(session&&!sessionDisposed)session.command('pause',hidden||manualPaused);clearDebt();}
  function fail(error){
    if(disposed||failed)return;failed=true;busy=false;stopTimers();
    let state=null,cleanupError=null;
    try{cleanSession();}catch(cleanup){cleanupError=errorMessage(cleanup);}
    if(session)try{state=snapshot();}catch{}
    try{send({type:'error',generation,error:errorMessage(error),fatal:true,state,cleanupError});}catch{}
  }
  function pump(){
    if(disposed||failed)return;
    try{
      const instant=now(),elapsed=Math.max(0,(instant-last)/1000);last=instant;
      if(!session||busy||hidden||manualPaused){if(clock)clock.debt=0;return;}
      clock.advance(elapsed);
    }catch(error){fail(error);}
  }
  async function handle(data){
    if(disposed||failed||!data||typeof data!=='object')return;
    if(data.type==='dispose'){
      if(generation===null||data.generation===generation)dispose();return;
    }
    if(data.type==='visibility'){
      if(data.generation!==generation||typeof data.hidden!=='boolean')return;
      hidden=data.hidden;clearDebt();
      if(!busy&&session)try{syncPause();publish();}catch(error){fail(error);}return;
    }
    if(!validId(data.id)||!validId(data.generation))return;
    if(generation!==null&&data.generation!==generation)return;
    if(data.id<=lastRequestId){respond(data,false,Error('训练室请求已过期'),'STALE_REQUEST');return;}
    lastRequestId=data.id;
    if(busy){respond(data,false,Error('训练室正在处理上一操作'),'BUSY');return;}
    if(data.type==='init'){
      if(session){respond(data,true,publish());return;}
      if(!Number.isSafeInteger(data.seed)||data.seed<0||typeof data.hidden!=='boolean'){
        respond(data,false,Error('训练室初始化参数无效'),'INVALID_ARGUMENT');return;
      }
      generation=data.generation;hidden=data.hidden;busy=true;
      try{
        const created=await sessionFactory({seed:data.seed});
        if(disposed){cleanSession(created);return;}
        if(!created||!['command','tick','snapshot','dispose'].every(name=>typeof created[name]==='function')){
          if(typeof created?.dispose==='function')try{created.dispose();}catch{}
          throw Error('训练室会话接口无效');
        }
        session=created;clock=new RuntimeClock({state:{paused:false},tick:seconds=>session.tick(seconds)},
          {now,budgetMs:8,maxDebt:.25});busy=false;syncPause();respond(data,true,publish());
      }catch(error){busy=false;respond(data,false,error,'STARTUP_FAILED');fail(error);}return;
    }
    if(data.type!=='command'||!COMMANDS.has(data.action)){respond(data,false,Error('未知训练室操作'),'INVALID_COMMAND');return;}
    if(!session){respond(data,false,Error('训练室尚未就绪'),'NOT_READY');return;}
    if(data.action==='pause'&&typeof data.payload!=='boolean'){respond(data,false,Error('暂停参数无效'),'INVALID_ARGUMENT');return;}
    busy=true;
    try{
      if(data.action==='pause'){manualPaused=data.payload;syncPause();}
      else{await session.command(data.action,data.payload);if(disposed)return;syncPause();}
      respond(data,true,publish());
    }catch(error){if(!disposed){respond(data,false,error,'COMMAND_FAILED');try{publish();}catch(publishError){fail(publishError);}}}
    finally{busy=false;clearDebt();}
  }
  function dispose(){
    if(disposed)return;disposed=true;busy=false;stopTimers();
    try{cleanSession();}catch{}
    session=null;clock=null;
  }
  timers.push(schedule(pump,8));timers.push(schedule(()=>{if(!disposed&&!failed&&!busy&&!hidden&&session)try{publish();}catch(error){fail(error);}},200));
  return {handle,pump,dispose,timing:()=>clock?.snapshot()??{pendingSeconds:0,droppedSeconds:0,physicsSteps:0}};
}

if(typeof WorkerGlobalScope!=='undefined'&&globalThis instanceof WorkerGlobalScope){
  const runtime=createCueTrainingWorkerRuntime({send:message=>postMessage(message)});
  globalThis.onmessage=({data})=>{void runtime.handle(data);};postMessage({type:'booted'});
}
