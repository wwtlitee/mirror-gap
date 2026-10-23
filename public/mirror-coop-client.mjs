// 镜隙合作传输与独立存档 v8.5.0 — Unclecow.
export const MIRROR_COOP_SAVE_KEY='mirror-gap-coop-save-v1';
const ACTIONS=new Set(['input','interact','continue','retry','probe','endProbe','pause','newGame','export','import','trial','endTrial']);
const MAX_QUEUED_COMMANDS=256;
const errorOf=value=>value instanceof Error?value:new Error(String(value??'合作线程响应失败'));
function checkpointObject(value){
  let result=value;
  if(typeof value==='string')try{result=JSON.parse(value);}catch(error){throw Error('合作存档 JSON 无法解析：'+error.message);}
  if(!result||typeof result!=='object'||Array.isArray(result))throw Error('合作 checkpoint 必须为对象');
  const raw=JSON.stringify(result,(_key,item)=>{
    if(typeof item==='bigint'||typeof item==='number'&&!Number.isFinite(item))throw Error('合作存档含不可序列化数值');
    return item;
  });
  return {checkpoint:JSON.parse(raw),raw};
}

/** One client owns one isolated worker, its command FIFO and one dedicated save key. */
export function createMirrorCoopClient({seed=8501,storage,initPaused=false,
  workerFactory=()=>new Worker(new URL('./mirror-coop-worker.mjs',import.meta.url),{type:'module'}),
  document:page=globalThis.document,eventTarget=globalThis,requestTimeoutMs=15000,startupTimeoutMs=90000,
  setTimeout:schedule=globalThis.setTimeout,clearTimeout:cancel=globalThis.clearTimeout,
  onSubscriberError=error=>console.error(error)}={}){
  if(!Number.isSafeInteger(seed)||seed<0)throw Error('合作随机种子无效');
  if(typeof initPaused!=='boolean')throw Error('合作初始暂停参数无效（initPaused）');
  for(const v of [requestTimeoutMs,startupTimeoutMs])if(!Number.isFinite(v)||v<=0)throw Error('合作超时设置无效');
  const subscribers=new Map(),pending=new Map(),queue=[];
  let store=storage,worker=null,epoch=0,serial=0,revision=0,saveRevision=0,status='idle',state=null;
  let starting=null,startResolve=null,startReject=null,startupTimer=null,startupRaw=null,lastSavedRaw=null;
  let disposed=false,draining=false,commandBusy=false,backupSerial=0,latestInput=null;
  function callbackFailed(error){try{onSubscriberError(error);}catch{}}
  function notifyError(error){for(const callback of subscribers.values())if(typeof callback==='function')try{callback(error);}catch(e){callbackFailed(e);}}
  function backupRaw(raw){
    if(typeof raw!=='string'||!store)return false;
    try{store.setItem(MIRROR_COOP_SAVE_KEY+'.backup-'+Date.now()+'-'+(++backupSerial),raw);return true;}catch{return false;}
  }
  function persist(checkpoint){
    const {raw}=checkpointObject(checkpoint);
    if(raw!==lastSavedRaw){store.setItem(MIRROR_COOP_SAVE_KEY,raw);lastSavedRaw=raw;}
  }
  function publish(value,incomingRevision){
    if(!value||typeof value!=='object'||!Number.isSafeInteger(incomingRevision)||incomingRevision<=revision)return;
    revision=incomingRevision;state=value;
    for(const callback of subscribers.keys())try{callback(state);}catch(error){callbackFailed(error);}
  }
  function stop(error,nextStatus){
    epoch++;cancel(startupTimer);startupTimer=null;
    const reject=startReject;startReject=null;startResolve=null;starting=null;
    const stopped=worker;worker=null;
    if(stopped){stopped.onmessage=null;stopped.onerror=null;stopped.onmessageerror=null;try{stopped.terminate();}catch{}}
    status=nextStatus;commandBusy=false;
    for(const request of pending.values()){cancel(request.timer);request.reject(error);}pending.clear();
    for(const entry of queue.splice(0))for(const waiter of entry.waiters)waiter.reject(error);
    reject?.(error);
  }
  function fail(value,run){
    if(disposed||run!==epoch)return;
    const error=errorOf(value);
    if(status==='starting'&&startupRaw!==null){backupRaw(startupRaw);startupRaw=null;}
    stop(error,'failed');notifyError(error);
  }
  function send(message,run){if(!worker||run!==epoch)throw Error('合作线程已停止');worker.postMessage(message);}
  function receive(data,run,active){
    if(disposed||run!==epoch||active!==worker||!data||typeof data!=='object')return;
    try{
      if(data.type==='booted'){
        if(active.initialized)return;active.initialized=true;const id=++serial;active.initId=id;
        send({type:'init',id,epoch:run,seed,saved:active.saved,hidden:page?.hidden===true,initPaused},run);return;
      }
      if(data.epoch!==run)return;
      if(data.type==='error'){if(data.state)publish(data.state,revision+1);fail(Error(data.error||'合作线程停止'),run);return;}
      if(data.type==='state'){publish(data.state,data.revision);return;}
      if(data.type==='save'){
        if(status!=='ready'||!Number.isSafeInteger(data.revision)||data.revision<saveRevision)return;
        try{persist(data.checkpoint);saveRevision=Math.max(saveRevision,data.revision??0);}catch(error){notifyError(Error('合作存档保存失败：'+error.message));}return;
      }
      if(data.type!=='response'||!Number.isSafeInteger(data.id))return;
      if(data.id===active.initId&&status==='starting'){
        if(data.ok!==true){fail(Error(data.error||'合作启动失败'),run);return;}
        publish(data.result,data.revision);cancel(startupTimer);startupTimer=null;status='ready';startupRaw=null;
        const resolve=startResolve;startResolve=null;startReject=null;resolve?.(state??data.result);return;
      }
      const request=pending.get(data.id);if(!request||request.epoch!==run)return;
      pending.delete(data.id);cancel(request.timer);
      if(data.ok!==true){
        if(request.action==='import'&&request.importRaw!==null)backupRaw(request.importRaw);
        request.reject(Object.assign(Error(data.error||'合作操作失败'),{code:data.code??'COMMAND_FAILED'}));return;
      }
      try{
        if(request.action==='export'){persist(data.result);saveRevision=Math.max(saveRevision,data.revision??0);request.resolve(data.result);}
        else{publish(data.result,data.revision);if(data.checkpoint){persist(data.checkpoint);saveRevision=Math.max(saveRevision,data.revision??0);}request.resolve(state??data.result);}
      }catch(error){request.reject(Error('合作存档保存失败：'+error.message));notifyError(error);}
    }catch(error){fail(error,run);}
  }
  function start(){
    if(disposed)return Promise.reject(Error('合作线程已停止（disposed）'));
    if(status==='failed')return Promise.reject(Error('合作线程启动或运行失败（failed），已保留存档，请明确处理后重新加载。'));
    if(status==='ready')return Promise.resolve(state);
    if(starting)return starting;
    const run=++epoch;status='starting';revision=0;saveRevision=0;
    starting=new Promise((resolve,reject)=>{startResolve=resolve;startReject=reject;});const result=starting;
    try{
      if(store===undefined)store=globalThis.localStorage;
      if(!store||typeof store.getItem!=='function'||typeof store.setItem!=='function')throw Error('无法访问合作独立存档');
      startupRaw=store.getItem(MIRROR_COOP_SAVE_KEY);lastSavedRaw=startupRaw;
      const saved=startupRaw===null?null:checkpointObject(startupRaw).checkpoint;
      const active=workerFactory();if(!active||typeof active.postMessage!=='function'||typeof active.terminate!=='function')throw Error('合作线程无法建立');
      worker=active;active.saved=saved;active.onmessage=({data})=>receive(data,run,active);
      active.onerror=event=>fail(Error(event?.message||'合作线程停止'),run);
      active.onmessageerror=()=>fail(Error('合作线程消息无法读取'),run);
      startupTimer=schedule(()=>fail(Error('合作线程启动超时，原存档已保留。'),run),startupTimeoutMs);
    }catch(error){fail(error,run);}
    return result;
  }
  function request(action,payload,importRaw=null){
    const run=epoch,id=++serial;
    return new Promise((resolve,reject)=>{
      const timer=schedule(()=>fail(Error('合作操作响应超时，线程已停止且存档保留。'),run),requestTimeoutMs);
      pending.set(id,{epoch:run,timer,resolve,reject,action,importRaw});
      try{send({type:'command',id,epoch:run,action,payload},run);}catch(error){fail(error,run);}
    });
  }
  async function drain(){
    if(draining)return;draining=true;
    try{
      while(queue.length&&!disposed){
        try{await start();}catch(error){for(const entry of queue.splice(0))for(const waiter of entry.waiters)waiter.reject(error);break;}
        const entry=queue.shift();if(!entry)break;commandBusy=true;
        try{const result=await request(entry.action,entry.payload,entry.importRaw);for(const waiter of entry.waiters)waiter.resolve(result);}
        catch(error){for(const waiter of entry.waiters)waiter.reject(error);}
        finally{commandBusy=false;}
      }
    }finally{draining=false;}
  }
  function command(action,payload){
    if(!ACTIONS.has(action))return Promise.reject(Error('未知合作操作'));
    if(disposed||status==='failed')return Promise.reject(Error('合作线程已停止，存档保留。'));
    if(action==='newGame'&&payload?.confirm!==true)return Promise.reject(Error('新游戏需要明确确认'));
    let importRaw=null;
    if(action==='import'){
      try{importRaw=typeof payload?.checkpoint==='string'?payload.checkpoint:JSON.stringify(payload?.checkpoint);payload={checkpoint:checkpointObject(payload?.checkpoint).checkpoint};}
      catch(error){if(typeof payload?.checkpoint==='string')backupRaw(payload.checkpoint);return Promise.reject(error);}
    }
    try{payload=structuredClone(payload);}catch(error){return Promise.reject(Error('合作输入无法复制：'+error.message));}
    const tail=queue.at(-1);
    if(action==='input'&&tail?.action==='input'){tail.payload=payload;latestInput=tail.promise;return tail.promise;}
    if(queue.length>=MAX_QUEUED_COMMANDS)return Promise.reject(Object.assign(Error('合作指令队列已满，请等待当前操作完成。'),{code:'QUEUE_FULL'}));
    let entry;
    const result=new Promise((resolve,reject)=>{entry={action,payload,importRaw,waiters:[{resolve,reject}]};queue.push(entry);});
    entry.promise=result;void drain();
    if(action==='input')latestInput=result;
    return result;
  }
  function visibilityChanged(){if(worker&&!disposed)try{send({type:'visibility',epoch,hidden:page?.hidden===true},epoch);}catch(error){fail(error,epoch);}}
  function dispose(){if(disposed)return;try{if(worker)send({type:'dispose',epoch},epoch);}catch{}disposed=true;
    page?.removeEventListener?.('visibilitychange',visibilityChanged);eventTarget?.removeEventListener?.('pagehide',pageHidden);
    eventTarget?.removeEventListener?.('pageshow',visibilityChanged);
    stop(Error('合作线程已停止（disposed），存档保留。'),'disposed');subscribers.clear();}
  function pageHidden(){if(worker&&!disposed)try{send({type:'visibility',epoch,hidden:true},epoch);}catch(error){fail(error,epoch);}}
  page?.addEventListener?.('visibilitychange',visibilityChanged);eventTarget?.addEventListener?.('pagehide',pageHidden);
  eventTarget?.addEventListener?.('pageshow',visibilityChanged);
  return {start,command,flushInput:payload=>payload===undefined?(latestInput??Promise.resolve(state)):command('input',payload),
    import:checkpoint=>command('import',{checkpoint}),export:()=>command('export'),dispose,
    subscribe(onState,onError){if(disposed)throw Error('合作线程已停止');if(typeof onState!=='function')throw Error('合作订阅需要回调');
      subscribers.set(onState,onError);if(state)try{onState(state);}catch(error){callbackFailed(error);}return {close(){subscribers.delete(onState);}};},
    get status(){return status;},get state(){return state;},get busy(){return commandBusy||queue.length>0||status==='starting';}};
}
