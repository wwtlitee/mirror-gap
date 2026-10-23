const COMMANDS=new Set(['emit','probe','swap','endProbe','pause','reset']);
const errorOf=value=>value instanceof Error?value:new Error(String(value??'训练室响应失败'));

/** An ephemeral laboratory transport. Each instance owns one isolated worker. */
export function createCueTrainingClient({seed=8401,
  workerFactory=()=>new Worker(new URL('./cue-training-worker.mjs',import.meta.url),{type:'module'}),
  document:page=globalThis.document,eventTarget=globalThis,requestTimeoutMs=15000,startupTimeoutMs=90000,
  setTimeout:schedule=globalThis.setTimeout,clearTimeout:cancel=globalThis.clearTimeout,
  onSubscriberError=error=>console.error(error)}={}){
  if(!Number.isSafeInteger(seed)||seed<0)throw Error('训练室随机种子无效');
  for(const value of [requestTimeoutMs,startupTimeoutMs])if(!Number.isFinite(value)||value<=0)throw Error('训练室超时设置无效');
  const subscribers=new Map(),pending=new Map();
  let worker=null,generation=0,serial=0,revision=0,status='idle',state=null,starting=null,startReject=null,startResolve=null;
  let startupTimer=null,disposed=false,commandBusy=false,activeCommand=null;

  function callbackFailed(error){try{onSubscriberError(error);}catch{}}

  function notifyError(error){
    for(const callback of subscribers.values())if(typeof callback==='function')try{callback(error);}catch(callbackError){callbackFailed(callbackError);}
  }
  function publish(value,incomingRevision){
    if(!value||typeof value!=='object'||!Number.isSafeInteger(incomingRevision)||incomingRevision<=revision)return;
    revision=incomingRevision;state=value;
    for(const callback of subscribers.keys())try{callback(state);}catch(error){callbackFailed(error);}
  }
  function detach(stopped){
    if(!stopped)return;
    stopped.onmessage=null;stopped.onerror=null;stopped.onmessageerror=null;
    try{stopped.terminate();}catch{}
  }
  function stop(error,nextStatus){
    generation++;cancel(startupTimer);startupTimer=null;
    const reject=startReject;startReject=null;startResolve=null;starting=null;
    const stopped=worker;worker=null;detach(stopped);status=nextStatus;commandBusy=false;activeCommand=null;state=null;revision=0;
    for(const request of pending.values()){cancel(request.timer);request.reject(error);}pending.clear();reject?.(error);
  }
  function fail(value,run){
    if(disposed||run!==generation)return;
    const error=errorOf(value);stop(error,'failed');notifyError(error);
  }
  function send(message,run){
    if(!worker||run!==generation)throw Error('训练室已停止');
    worker.postMessage(message);
  }
  function receive(data,run,active){
    if(disposed||run!==generation||active!==worker||!data||typeof data!=='object')return;
    try{
      if(data.type==='booted'){
        if(active.initialized)return;active.initialized=true;
        const id=++serial;active.initId=id;
        send({type:'init',id,generation:run,seed,hidden:page?.hidden===true},run);return;
      }
      if(data.generation!==run)return;
      if(data.type==='error'){
        fail(Error(data.error||'训练室线程停止'),run);return;
      }
      if(data.type==='state'){publish(data.state,data.revision);return;}
      if(data.type!=='response'||!Number.isSafeInteger(data.id))return;
      if(data.id===active.initId&&status==='starting'){
        if(data.ok!==true){fail(Error(data.error||'训练室启动失败'),run);return;}
        publish(data.result,data.revision);cancel(startupTimer);startupTimer=null;status='ready';
        const resolve=startResolve;startResolve=null;startReject=null;resolve?.(state??data.result);return;
      }
      const request=pending.get(data.id);if(!request||request.generation!==run)return;
      pending.delete(data.id);cancel(request.timer);commandBusy=false;
      if(data.ok===true){publish(data.result,data.revision);request.resolve(state??data.result);}
      else request.reject(Object.assign(Error(data.error||'训练室操作失败'),{code:data.code??'COMMAND_FAILED'}));
    }catch(error){fail(error,run);}
  }
  function start(){
    if(disposed)return Promise.reject(Error('训练室已停止（disposed）'));
    if(starting)return starting;
    if(status==='ready')return Promise.resolve(state);
    const run=++generation;status='starting';revision=0;state=null;
    starting=new Promise((resolve,reject)=>{startResolve=resolve;startReject=reject;});
    const result=starting;
    try{
      const active=workerFactory();if(!active||typeof active.postMessage!=='function'||typeof active.terminate!=='function')throw Error('训练室线程无法建立');
      worker=active;
      active.onmessage=({data})=>receive(data,run,active);
      active.onerror=event=>fail(Error(event?.message||'训练室线程停止'),run);
      active.onmessageerror=()=>fail(Error('训练室消息无法读取'),run);
      startupTimer=schedule(()=>fail(Error('训练室启动超时，请重新建立实验。'),run),startupTimeoutMs);
    }catch(error){fail(error,run);}
    return result;
  }
  async function command(action,payload){
    if(!COMMANDS.has(action))throw Error('未知训练室操作');
    if(disposed)throw Error('训练室已停止（disposed）');
    if(status==='failed')throw Error('训练室线程已停止，请明确重新建立实验。');
    if(commandBusy)throw Object.assign(Error('正在处理上一操作（busy）'),{code:'BUSY'});
    commandBusy=true;const token=Symbol('command');activeCommand=token;
    try{
      await start();if(disposed)throw Error('训练室已停止（disposed）');
      if(!worker||status!=='ready')throw Error('训练室尚未就绪');
      const run=generation,id=++serial;
      return await new Promise((resolve,reject)=>{
        const timer=schedule(()=>fail(Error('训练室操作响应超时，实验线程已停止。'),run),requestTimeoutMs);
        pending.set(id,{generation:run,timer,resolve,reject});
        try{send({type:'command',id,generation:run,action,payload},run);}
        catch(error){fail(error,run);}
      });
    }finally{if(activeCommand===token){activeCommand=null;commandBusy=false;}}
  }
  function visibilityChanged(){
    if(!worker||disposed)return;
    try{send({type:'visibility',generation,hidden:page?.hidden===true},generation);}
    catch(error){fail(error,generation);}
  }
  function dispose(){
    if(disposed)return;disposed=true;
    page?.removeEventListener?.('visibilitychange',visibilityChanged);eventTarget?.removeEventListener?.('pagehide',dispose);
    if(worker)try{worker.postMessage({type:'dispose',generation});}catch{}
    stop(Error('训练室已停止（disposed）'),'disposed');subscribers.clear();
  }
  page?.addEventListener?.('visibilitychange',visibilityChanged);eventTarget?.addEventListener?.('pagehide',dispose);
  return {start,command,dispose,
    subscribe(onState,onError){
      if(typeof onState!=='function')throw Error('训练室订阅需要状态回调');
      if(disposed)throw Error('训练室已停止（disposed）');
      subscribers.set(onState,onError);if(state)try{onState(state);}catch(error){callbackFailed(error);}
      return {close(){subscribers.delete(onState);}};
    },get state(){return state;},get status(){return status;},get busy(){return commandBusy;}};
}
