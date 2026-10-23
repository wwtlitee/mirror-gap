import {
  readCompanionStorage,writeCompanionStorage,parseCompanionCheckpoint,
  readGoodCompanionSnapshots,companionSnapshotKey,BACKUP_STORAGE_KEY,COMPANION_STORAGE_KEY,GOOD_SNAPSHOTS_STORAGE_KEY,
} from './companion-checkpoint.mjs';

export const browserLife=globalThis.MIRROR_BROWSER_LIFE===true;
const subscribers=new Map(),pending=new Map();
let worker=null,ready=null,latestCheckpoint=null,lastState=null,serial=0,generation=0;
let lockLease=null,lockSettled=Promise.resolve(),startupReject=null,startupTimer=null;
let runtimeStatus='idle';
const persistence={status:'unavailable',lastSavedAt:null,revision:null,productVersion:null,modelFingerprint:null,error:null,snapshotError:null,goodSnapshots:[]};

const snapshotSummary=checkpoint=>({key:companionSnapshotKey(checkpoint),revision:checkpoint.metadata?.revision??0,
  savedAt:checkpoint.savedAt,productVersion:checkpoint.metadata?.productVersion??null,identityName:checkpoint.companion.identity.name});
export function getPersistence(){return {...persistence,runtimeStatus,canRetry:runtimeStatus==='failed',goodSnapshots:persistence.goodSnapshots.map(item=>({...item}))};}

function reportError(error){
  for(const onError of subscribers.values())if(typeof onError==='function'){
    try{onError(error);}catch(callbackError){console.error(callbackError);}
  }
}
function publishState(state){
  state.server??={};
  state.server.lastSavedAt=persistence.lastSavedAt;state.server.persistenceError=persistence.error;
  state.server.persistence=getPersistence();lastState=state;
  for(const onState of subscribers.keys())try{onState(state);}catch(error){console.error(error);}
}
function save(){
  if(!latestCheckpoint||!lockLease)return false;
  persistence.status='saving';
  try{
    const {snapshots,snapshotError}=writeCompanionStorage(localStorage,latestCheckpoint);
    persistence.status=snapshotError?'degraded':'saved';persistence.lastSavedAt=new Date().toISOString();
    persistence.revision=latestCheckpoint.metadata?.revision??0;
    persistence.productVersion=latestCheckpoint.metadata?.productVersion??null;
    persistence.modelFingerprint=latestCheckpoint.metadata?.modelFingerprint??null;
    persistence.snapshotError=snapshotError;persistence.error=snapshotError?`主存档已保存；${snapshotError}`:null;
    persistence.goodSnapshots=snapshots.map(snapshotSummary);return true;
  }catch(error){persistence.status='error';persistence.error=error.message;return false;}
}

function releaseWriter(){
  const lease=lockLease;lockLease=null;
  if(!lease)return lockSettled;
  lease.release();lockSettled=lease.done.catch(()=>{});return lockSettled;
}
async function acquireWriter(){
  await lockSettled;
  if(!navigator.locks)throw Error('当前浏览器不支持安全存档，请用新版浏览器通过 HTTPS 或 localhost 打开。');
  let resolveGrant,rejectGrant;
  const granted=new Promise((resolve,reject)=>{resolveGrant=resolve;rejectGrant=reject;});
  const lease={release:null,done:null};
  let request;
  try{
    request=navigator.locks.request('mirror-gap-companion-writer',{ifAvailable:true},async lock=>{
      if(!lock){rejectGrant(Error('这只果蝇已经在另一个标签页生活，请关闭那个页面后重试。'));return;}
      const held=new Promise(resolve=>{lease.release=resolve;});resolveGrant(lease);await held;
    });
  }catch(error){rejectGrant(error);}
  lease.done=Promise.resolve(request);lease.done.catch(rejectGrant);
  return granted;
}

function stopSession(error=Error('数字分身已停止')){
  generation++;clearTimeout(startupTimer);startupTimer=null;
  const reject=startupReject;startupReject=null;
  const stopped=worker;worker=null;
  if(stopped){stopped.onmessage=null;stopped.onerror=null;stopped.onmessageerror=null;stopped.terminate();}
  ready=null;runtimeStatus='idle';
  for(const request of pending.values())request.reject(error);pending.clear();
  reject?.(error);return releaseWriter();
}
function failSession(error,run){
  if(run!==generation)return;
  void stopSession(error);runtimeStatus='failed';reportError(error);
}

function start(){
  if(ready)return ready;
  const run=++generation;runtimeStatus='starting';
  const attempt=(async()=>{
    const lease=await acquireWriter();
    if(run!==generation){lease.release();await lease.done;throw Error('数字分身启动已取消');}
    lockLease=lease;
    let saved;
    try{saved=readCompanionStorage(localStorage);}catch(error){
      throw Error(`本地存档无法读取。请在设置的存档与备份中导入备份，原数据没有被覆盖。${error.message}`);
    }
    latestCheckpoint=saved?.format===2?saved:null;
    if(saved?.format===2){
      persistence.lastSavedAt=new Date(saved.savedAt).toISOString();persistence.revision=saved.metadata?.revision??0;
      persistence.productVersion=saved.metadata?.productVersion??null;persistence.modelFingerprint=saved.metadata?.modelFingerprint??null;
    }
    try{persistence.goodSnapshots=readGoodCompanionSnapshots(localStorage).map(snapshotSummary);}catch(error){persistence.error=error.message;}
    return new Promise((resolve,reject)=>{
      startupReject=reject;
      startupTimer=setTimeout(()=>failSession(Error('果蝇启动超时，请重试。'),run),90000);
      const activeWorker=new Worker(new URL('./browser-life-worker.mjs',import.meta.url),{type:'module'});worker=activeWorker;
      let initialized=false;
      activeWorker.onerror=event=>failSession(Error(event.message||'数字分身线程停止'),run);
      activeWorker.onmessageerror=()=>failSession(Error('数字分身消息无法读取，请重试。'),run);
      activeWorker.onmessage=({data})=>{
        if(run!==generation||worker!==activeWorker)return;
        try{
          if(data.type==='booted'){
            if(initialized)return;initialized=true;
            activeWorker.postMessage({type:'init',saved,hidden:document.hidden});return;
          }
          if(data.type==='state'){
            if(data.checkpoint){latestCheckpoint=data.checkpoint;save();}
            clearTimeout(startupTimer);startupTimer=null;startupReject=null;runtimeStatus='ready';resolve();publishState(data.state);return;
          }
          if(data.id){
            const request=pending.get(data.id);if(!request||request.run!==run)return;
            pending.delete(data.id);data.error?request.reject(Error(data.error)):request.resolve(data.result);return;
          }
          if(data.type==='error')failSession(Error(data.error||'数字分身线程停止'),run);
        }catch(error){failSession(error,run);}
      };
    });
  })();
  ready=attempt;
  void attempt.catch(error=>failSession(error,run));return attempt;
}

export function retryLife(){return start();}
export async function localApi(path,body){
  await start();const activeWorker=worker,run=generation;
  if(!activeWorker||runtimeStatus!=='ready')throw Error('数字分身尚未就绪，请重试。');
  return new Promise((resolve,reject)=>{
    const id=++serial,timer=setTimeout(()=>{
      pending.delete(id);reject(Error('数字分身响应超时，请查看当前状态。'));
    },15000);
    pending.set(id,{run,resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});
    try{activeWorker.postMessage({id,path,body});}catch(error){pending.delete(id);clearTimeout(timer);reject(error);failSession(error,run);}
  });
}
export function subscribeLife(onState,onError){
  subscribers.set(onState,onError);
  if(runtimeStatus==='ready'&&lastState)try{onState(lastState);}catch(error){console.error(error);}
  void start().catch(()=>{});return {close(){subscribers.delete(onState);}};
}
export async function exportCompanion(){
  if(runtimeStatus==='failed'&&latestCheckpoint)return JSON.stringify(latestCheckpoint,null,2);
  const checkpoint=await localApi('/api/companion/export');return JSON.stringify(checkpoint,null,2);
}
export async function importCompanion(text){
  const checkpoint=parseCompanionCheckpoint(text);
  let acquired=false;
  if(!lockLease){lockLease=await acquireWriter();acquired=true;}
  try{
    const {snapshots,snapshotError}=writeCompanionStorage(localStorage,checkpoint,{backup:true});
    persistence.status=snapshotError?'degraded':'saved';persistence.lastSavedAt=new Date().toISOString();persistence.revision=checkpoint.metadata?.revision??0;
    persistence.productVersion=checkpoint.metadata?.productVersion??null;persistence.modelFingerprint=checkpoint.metadata?.modelFingerprint??null;
    persistence.snapshotError=snapshotError;persistence.error=snapshotError?`主存档已保存；${snapshotError}`:null;
    persistence.goodSnapshots=snapshots.map(snapshotSummary);
  }catch(error){
    persistence.status='error';persistence.error=error.message;if(acquired)await releaseWriter();throw error;
  }
  latestCheckpoint=null;lastState=null;await stopSession();location.reload();
}
export function goodCompanionBackups(){return readGoodCompanionSnapshots(localStorage).map(snapshotSummary);}
export function exportGoodCompanionBackup(key){
  const checkpoint=readGoodCompanionSnapshots(localStorage).find(item=>companionSnapshotKey(item)===key);
  if(!checkpoint)throw Error('这份恢复快照已不可用，请重新打开快照列表。');return JSON.stringify(checkpoint,null,2);
}
export function restoreGoodCompanionBackup(key){return importCompanion(exportGoodCompanionBackup(key));}
export function recoveryBackup(){return localStorage.getItem(BACKUP_STORAGE_KEY);}
export function rawCompanionBackup(){return localStorage.getItem(COMPANION_STORAGE_KEY);}
export function rawGoodCompanionBackup(){return localStorage.getItem(GOOD_SNAPSHOTS_STORAGE_KEY);}

if(browserLife){
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden)worker?.postMessage({type:'visibility',hidden:false});
    else if(document.hidden){save();worker?.postMessage({type:'visibility',hidden:true});}
  });
  addEventListener('pagehide',()=>{save();void stopSession();});
  // The UI also disposes on pagehide. Reconstruct it with the writer together.
  addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
}
