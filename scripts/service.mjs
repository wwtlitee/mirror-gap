import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
const stateDir=path.join(root,'runtime-v5.7.0'),port=4191,url='http://127.0.0.1:'+port;
const action=process.argv[2]??'start';
if(!['start','stop','restart','status'].includes(action))throw Error('Use start, stop, restart or status');
await fs.mkdir(stateDir,{recursive:true});
const mutex=path.join(stateDir,'service-control.lock');
const alive=pid=>{try{process.kill(pid,0);return true}catch(e){if(e.code==='ESRCH')return false;throw e}};
try{const old=JSON.parse(await fs.readFile(mutex,'utf8'));if(alive(old.pid))throw Error('Another service command is running');await fs.unlink(mutex)}catch(e){if(e.code!=='ENOENT')throw e}
const guard=await fs.open(mutex,'wx');await guard.writeFile(JSON.stringify({pid:process.pid}));await guard.close();
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function health(){try{const r=await fetch(url+'/api/health',{signal:AbortSignal.timeout(3000)});if(!r.ok)throw Error('HTTP '+r.status);return await r.json()}catch(e){if(e.cause?.code==='ECONNREFUSED')return null;throw e}}
async function owned(){const h=await health();if(!h)return null;let lock;try{lock=JSON.parse(await fs.readFile(path.join(stateDir,'server.lock'),'utf8'))}catch{throw Error('Port 4191 is occupied but its identity cannot be verified; no new port will be used')}
if(!lock.instanceId||lock.instanceId!==h.instanceId||lock.pid!==h.pid||path.resolve(lock.root)!==path.resolve(root)||path.resolve(lock.stateDir)!==stateDir||lock.port!==port)throw Error('Service identity mismatch; refusing to stop or replace it');return {h,lock};}
async function stop(current){if(!current)return;const r=await fetch(url+'/api/shutdown',{method:'POST',headers:{Origin:url,Authorization:'Bearer '+current.lock.controlToken},signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Save/shutdown failed: '+await r.text());for(let i=0;i<100;i++){if(!alive(current.lock.pid)&&!await health())return;await delay(100)}throw Error('Shutdown did not finish; no replacement started');}
async function start(){const out=await fs.open(path.join(stateDir,'server.stdout.log'),'a'),err=await fs.open(path.join(stateDir,'server.stderr.log'),'a');let child;try{child=spawn(process.execPath,[path.join(root,'server.mjs')],{cwd:root,windowsHide:true,detached:true,stdio:['ignore',out.fd,err.fd],env:{...process.env,MIRROR_HOME_PORT:String(port),MIRROR_HOME_STATE_DIR:stateDir,MIRROR_HOME_TEST_MODE:'0'}});await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject)});child.unref()}finally{await out.close();await err.close()}
for(let i=0;i<100;i++){await delay(150);const current=await owned();if(current){if(current.h.pid!==child.pid)throw Error('Unexpected listener');if(!current.h.ok)throw Error('Persistence unhealthy');return current;}if(!alive(child.pid))throw Error('Server exited; inspect runtime-v5.7.0/server.stderr.log')}throw Error('Startup timeout; inspect the existing process before retrying');}
try{if(action==='status'){const h=await health();console.log(JSON.stringify({running:Boolean(h),url,pid:h?.pid,version:h?.version,managed:Boolean(h?.instanceId)}));}else{let current=await owned();if(action==='stop'||action==='restart'){await stop(current);current=null}if(action!=='stop')current??=await start();console.log(JSON.stringify({running:Boolean(current),url,pid:current?.h.pid,version:current?.h.version}));}}finally{await fs.unlink(mutex)}
