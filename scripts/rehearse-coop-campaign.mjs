#!/usr/bin/env node
/** 镜隙 v8.5.0 公开命令演练器 — Unclecow.
 * plan/dry-physical never import a neural session. Only execute may construct one.
 * Dry routes are mechanical reachability evidence, never native campaign success.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {setImmediate as yieldTick} from 'node:timers/promises';
import {ROOM} from '../public/world-spec.mjs';
import {CAMPAIGN_STAGES} from '../public/mirror-campaign.mjs';
import {coopWorldObjects,COOP_INTERACTION_RADIUS,distance3} from '../public/mirror-coop-world.mjs';
import {advanceMechanicalFly,pickupMechanicalCargo,dropMechanicalCargo,MECHANICAL_FLY_RADIUS} from '../public/mechanical-fly.mjs';
import {TAPEOUT_PULSE_SOURCE,DEFAULT_TAPEOUT,parseCircuit,stepCircuit} from '../public/tapeout-circuit.mjs';
import {COOP_CLOCK_SECONDS,restoreCoopClock} from '../public/coop-clock.mjs';
import {withFoodStock,foodStock} from '../public/food-stock.mjs';
import {RESOURCE_DEFINITIONS} from '../public/resource-spec.mjs';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const DEFAULT_CHECKPOINT=path.join(ROOT,'output/mirror-coop-v8.5.0/ui-browser-01/13-native-export.json');
const DT=.02,CRUISE=ROOM.cruiseHeight,RADIUS=MECHANICAL_FLY_RADIUS;
const NEUTRAL_LEVEL={phaseBit:0,relays:{west:0,east:0},dropped:[],visited:[]};
const sha=value=>createHash('sha256').update(value).digest('hex');
const clone=value=>structuredClone(value);
const stopInput=emit=>({move:[0,0],lift:0,emit,interact:false});
const SOURCE_FILES=['scripts/rehearse-coop-campaign.mjs','public/mirror-campaign.mjs','src/mirror-coop-session.mjs','public/coop-pairing.mjs','public/mirror-coop-world.mjs','public/mechanical-fly.mjs','public/mechanical-room-collision.mjs','public/tapeout-circuit.mjs','public/assets/room-collision.bin','public/assets/room-collision.json','public/assets/resource-surfaces.json'];

export function parseOptions(argv){
  const options={mode:'plan',checkpoint:DEFAULT_CHECKPOINT,seed:null,fresh:false,learningWait:180,consumptionWait:120,maxStageSeconds:300,maxNodes:12000,allowNeural:false,stopBeforeStage:null,resume:false,retryCurrent:false};
  let checkpointExplicit=false;
  for(let i=0;i<argv.length;i++){
    const key=argv[i];
    if(key==='--allow-neural-run'){options.allowNeural=true;continue;}
    if(key==='--fresh'){options.fresh=true;continue;}
    if(key==='--resume'){options.resume=true;continue;}
    if(key==='--retry-current'){options.retryCurrent=true;continue;}
    const value=argv[++i];if(value===undefined)throw Error('参数缺少值：'+key);
    if(key==='--mode')options.mode=value;
    else if(key==='--checkpoint'){options.checkpoint=path.resolve(value);checkpointExplicit=true;}
    else if(key==='--seed')options.seed=Number(value);
    else if(key==='--out')options.out=path.resolve(value);
    else if(key==='--learning-wait')options.learningWait=Number(value);
    else if(key==='--consumption-wait')options.consumptionWait=Number(value);
    else if(key==='--max-stage-seconds')options.maxStageSeconds=Number(value);
    else if(key==='--max-nodes')options.maxNodes=Number(value);
    else if(key==='--stop-before-stage')options.stopBeforeStage=Number(value);
    else throw Error('未知参数：'+key);
  }
  if(!['plan','dry-physical','execute'].includes(options.mode))throw Error('mode 必须为 plan/dry-physical/execute');
  if(options.mode==='execute'&&!options.allowNeural)throw Error('真实执行需要显式 --allow-neural-run；先由 Root 择时');
  for(const key of ['learningWait','consumptionWait','maxStageSeconds'])if(!Number.isFinite(options[key])||options[key]<=0||options[key]>3600)throw Error('等待预算无效：'+key);
  if(!Number.isSafeInteger(options.maxNodes)||options.maxNodes<100||options.maxNodes>50000)throw Error('路径搜索节点预算无效');
  if(options.stopBeforeStage!==null&&(!Number.isSafeInteger(options.stopBeforeStage)||options.stopBeforeStage<3||options.stopBeforeStage>11))throw Error('停止章节必须为3..11');
  if(options.retryCurrent&&(!options.resume||options.mode!=='execute'))throw Error('retry-current 仅允许显式 resume execute 的公开重试');
  if(options.fresh&&(options.resume||options.retryCurrent||checkpointExplicit))throw Error('fresh 不能与 checkpoint/resume/retry-current 混用');
  if(options.seed!==null&&!options.fresh)throw Error('seed 仅用于 fresh，不改变原生检查点种子');
  if(options.fresh){options.seed??=8502;if(!Number.isSafeInteger(options.seed)||options.seed<0||options.seed>0xffffffff)throw Error('fresh seed 必须为 uint32');}
  if(options.fresh&&options.mode==='dry-physical')throw Error('fresh 的纯计划不创建身体；dry-physical 请提供真实检查点，不从旧档伪造 stage0');
  return options;
}

export function buildCampaignPlan(checkpoint,{resume=false,fresh=false,seed=null}={}){
  const startStage=fresh?0:checkpoint?.coop?.campaign?.stage;
  if(fresh){if(checkpoint!==null||resume||!Number.isSafeInteger(seed)||seed<0||seed>0xffffffff)throw Error('fresh 计划必须从新 Session 的 uint32 seed 出发');}
  else if(checkpoint?.format!==1||checkpoint.productVersion!=='8.5.0'||!Number.isSafeInteger(startStage)||startStage<0||startStage>11||!resume&&startStage!==2||checkpoint.coop.campaign.status!=='playing')throw Error('必须使用真实 v8.5.0 playing 原生检查点；非stage2需显式resume，不自动跳章或转换');
  const visit=(id,extra={})=>({kind:'visit',id,...extra});
  const charge=id=>({kind:'charge',id});
  const supply={kind:'pickup',id:'supply'};
  const programs={
    0:[charge('dock'),supply,visit('plate-fig',{interact:true,delivery:true})],
    1:[{kind:'wait',condition:'first-meal',drySeconds:0,budget:'consumptionWait'}],
    2:[charge('dock'),visit('west',{interact:true}),visit('east',{interact:true})],
    3:[charge('dock'),{kind:'emit',emit:'A'},visit('phase'),{kind:'wait',condition:'first-phase',drySeconds:1.6,maxSeconds:8},visit('phase',{interact:true}),{kind:'wait',condition:'cleared',drySeconds:1.6,maxSeconds:8}],
    4:[charge('dock'),supply,visit('cup'),visit('shelf'),visit('table')],
    5:[charge('dock'),supply,visit('plate-pizza',{interact:true,delivery:true}),supply,visit('plate-burger',{interact:true,delivery:true})],
    6:[charge('shelf'),supply,charge('table'),visit('arrival')],
    7:[charge('dock'),visit('signal-window'),{kind:'emit',emit:'A'},{kind:'wait',condition:'cleared',drySeconds:7,maxSeconds:15}],
    8:[charge('dock'),supply,visit('plate-fig',{interact:true,delivery:true}),{kind:'pair-near-resident',budget:'learningWait'}],
    9:[charge('dock'),{kind:'emit',emit:'B'},{kind:'wait',condition:'cleared',drySeconds:8,maxSeconds:35}],
    10:[{kind:'emit',emit:'off'},{kind:'probe',maxSeconds:45},{kind:'wait',condition:'cleared',drySeconds:20,maxSeconds:22}],
    11:[charge('dock'),supply,visit('plate-fig',{interact:true,delivery:true}),{kind:'emit',emit:'A'},{kind:'wait',condition:'cleared',drySeconds:0,budget:'consumptionWait'}],
  };
  return {
    format:1,productVersion:'8.5.0',startStage,fresh,seed,room:{...ROOM},cruiseHeight:CRUISE,
    preflightMarkers:coopWorldObjects(1,NEUTRAL_LEVEL).filter(o=>o.discovery).map(o=>({id:o.id,position:o.position,threshold:.25})),
    stages:Array.from({length:12-startStage},(_,index)=>{const stage=index+startStage;return {stage,id:CAMPAIGN_STAGES[stage].id,title:CAMPAIGN_STAGES[stage].title,actions:programs[stage],markers:coopWorldObjects(stage,NEUTRAL_LEVEL)};}),
    boundary:'dry-physical checks only mechanical paths and energy; no resident, reward, q, inventory, or campaign progression is fabricated',
  };
}

class MinHeap{
  values=[];
  push(item){const a=this.values;a.push(item);let i=a.length-1;while(i){const p=(i-1)>>1;if(a[p].score<=item.score)break;a[i]=a[p];i=p;}a[i]=item;}
  pop(){const a=this.values,top=a[0],last=a.pop();if(a.length){let i=0;while(true){let j=i*2+1;if(j>=a.length)break;if(j+1<a.length&&a[j+1].score<a[j].score)j++;if(a[j].score>=last.score)break;a[i]=a[j];i=j;}a[i]=last;}return top;}
  get length(){return this.values.length;}
}

export function createPathPlanner({resolveMove,maxNodes=12000,grid=.25}={}){
  if(typeof resolveMove!=='function')throw Error('需要真实房间 sphere-sweep resolver');
  const clearCache=new Map(),lineCache=new Map();
  const key=p=>p.map(x=>x.toFixed(5)).join(',');
  function clear(p){
    const k=key(p);if(clearCache.has(k))return clearCache.get(k);let valid=false;
    if(Math.abs(p[0])<=ROOM.width/2-RADIUS&&p[1]>=RADIUS&&p[1]<=ROOM.height-RADIUS&&Math.abs(p[2])<=ROOM.depth/2-RADIUS){
      try{const result=resolveMove({position:p,desiredPosition:p,radius:RADIUS,seconds:0});valid=distance3(result.position,p)<1e-6;}catch{}
    }
    clearCache.set(k,valid);return valid;
  }
  function line(a,b){
    const k=key(a)+'>'+key(b);if(lineCache.has(k))return lineCache.get(k);
    if(!clear(a)||!clear(b)){lineCache.set(k,false);return false;}
    const length=distance3(a,b),count=Math.max(1,Math.ceil(length/.09));let previous=a,valid=true;
    for(let i=1;i<=count;i++){
      const next=a.map((value,axis)=>value+(b[axis]-value)*i/count),dx=next[0]-previous[0],dz=next[2]-previous[2];
      const seconds=Math.max(Math.hypot(dx,dz)/.7,Math.abs(next[1]-previous[1])/.45);
      try{const result=resolveMove({position:previous,desiredPosition:next,radius:RADIUS,seconds});if(distance3(result.position,next)>2e-5){valid=false;break;}}
      catch{valid=false;break;}previous=next;
    }
    lineCache.set(k,valid);return valid;
  }
  function anchor(target,start){
    const offsets=[[0,0,0],[0,.08,0],[0,.16,0],[.12,0,0],[-.12,0,0],[0,0,.12],[0,0,-.12],[.12,.08,.1],[-.12,.08,.1],[.12,.08,-.1],[-.12,.08,-.1]];
    const candidates=offsets.map(o=>target.map((x,i)=>x+o[i])).filter(clear);
    candidates.sort((a,b)=>distance3(a,target)-distance3(b,target)||distance3(a,start)-distance3(b,start));
    if(!candidates.length)throw Error('标记周围 .18m 内没有机械蝇可站立的清空球：'+key(target));
    return candidates[0];
  }
  function compact(points){const result=[points[0]];let index=0;while(index<points.length-1){let next=points.length-1;while(next>index+1&&!line(points[index],points[next]))next--;result.push(points[next]);index=next;}return result;}
  function search(start,goal){
    const heap=new MinHeap(),nodes=new Map(),origin=[...start],startKey='0,0,0';
    heap.push({indices:[0,0,0],position:start,g:0,score:distance3(start,goal),key:startKey,parent:null});let expanded=0;
    while(heap.length){
      const current=heap.pop();if(nodes.has(current.key))continue;nodes.set(current.key,current);expanded++;
      if(distance3(current.position,goal)<.55&&line(current.position,goal)){
        const points=[goal];for(let n=current;n;n=n.parent)points.push(n.position);return {points:compact(points.reverse()),expanded};
      }
      if(expanded>=maxNodes)throw Error('机械 A* 达到节点预算 '+maxNodes);
      for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++){
        if(!x&&!y&&!z)continue;const indices=current.indices.map((v,i)=>v+[x,y,z][i]),k=indices.join(',');if(nodes.has(k))continue;
        const p=indices.map((n,i)=>origin[i]+n*grid);if(!clear(p)||!line(current.position,p))continue;
        const g=current.g+distance3(current.position,p);heap.push({indices,position:p,g,score:g+distance3(p,goal),key:k,parent:current});
      }
    }
    throw Error('机械路径不可达');
  }
  return {clear,line,plan(start,target){
    const goal=anchor(target,start),skyA=[start[0],CRUISE,start[2]],skyB=[goal[0],CRUISE,goal[2]];
    if(line(start,goal))return {points:[start,goal],expanded:0,method:'direct',anchor:goal};
    // A local obstacle must not automatically cause a costly full-height climb.
    try{return {...search(start,goal),method:'bounded-3d-A*',anchor:goal};}
    catch(error){if(line(start,skyA)&&line(skyA,skyB)&&line(skyB,goal))return {points:[start,skyA,skyB,goal],expanded:maxNodes,method:'cruise-fallback',anchor:goal,localSearchError:error.message};throw error;}
  }};
}

export function steering(position,target,seconds=.1,emit='off'){
  const dx=target[0]-position[0],dy=target[1]-position[1],dz=target[2]-position[2],duration=Math.max(seconds,Math.hypot(dx,dz)/.7,Math.abs(dy)/.45);
  const move=[dx/(.7*duration),dz/(.7*duration)],lift=dy/(.45*duration);
  const scale=Math.max(1,Math.hypot(...move),Math.abs(lift))*(1+4*Number.EPSILON),bounded=value=>Math.max(-1,Math.min(1,value/scale));
  return {move:move.map(bounded),lift:bounded(lift),emit,interact:false};
}

export async function collectRehearsalSources({root=ROOT,entrypoints=SOURCE_FILES,manifests=['package.json','package-lock.json']}={}){
  const workspace=path.resolve(root),seen=new Map(),queue=[...entrypoints,...manifests].map(name=>path.resolve(workspace,name));
  const add=file=>{if(!seen.has(file))queue.push(file);};
  while(queue.length){
    const file=path.resolve(queue.pop());if(seen.has(file))continue;
    const stat=await fs.stat(file);if(!stat.isFile())continue;
    const bytes=await fs.readFile(file);seen.set(file,{bytes:bytes.length,sha256:sha(bytes)});
    if(path.extname(file)==='.json'&&path.basename(file)==='resource-surfaces.json'){
      const index=JSON.parse(bytes);for(const entry of index.files??[]){if(typeof entry.file!=='string')throw Error('资源索引缺少 file');add(path.resolve(path.dirname(file),entry.file));}
    }
    if(!['.mjs','.js','.cjs'].includes(path.extname(file)))continue;
    const code=bytes.toString('utf8'),specifiers=[];
    const patterns=[/^[ \t]*import\b\s*(?!\()(?:(?:[\w$\s{},*]+?)\s+from\s*)?['"]([^'"\r\n]+)['"]/gm,/^[ \t]*export\s+(?:\{[\s\S]*?\}|\*)\s+from\s*['"]([^'"\r\n]+)['"]/gm,/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,/\bnew\s+URL\s*\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g];
    for(const regex of patterns)for(const match of code.matchAll(regex))specifiers.push(match[1]);
    if(path.basename(file)==='platform-io.mjs')for(const block of code.matchAll(/\bconst\s+paths\s*=\s*\[([^\]]+)\]/g))for(const match of block[1].matchAll(/['"]([^'"]+)['"]/g))specifiers.push(match[1].startsWith('.')?match[1]:'./'+match[1]);
    for(const specifier of specifiers){
      if(specifier.startsWith('node:')||/^(https?:|data:)/.test(specifier))continue;
      if(specifier.startsWith('.')){add(fileURLToPath(new URL(specifier,pathToFileURL(file))));continue;}
      if(specifier.startsWith('file:')){add(fileURLToPath(specifier));continue;}
      const resolved=fileURLToPath(import.meta.resolve(specifier));add(resolved);
      const normalized=resolved.replaceAll('\\','/'),marker=normalized.lastIndexOf('/node_modules/');
      if(marker>=0){const tail=normalized.slice(marker+14).split('/'),name=tail[0].startsWith('@')?tail.slice(0,2).join('/'):tail[0];add(normalized.slice(0,marker+14)+name+'/package.json');}
    }
  }
  const files=[...seen].sort(([a],[b])=>a.localeCompare(b)).map(([file,metadata])=>{const rel=path.relative(workspace,file),id=rel.startsWith('..'+path.sep)?pathToFileURL(file).href:rel.replaceAll('\\','/');return {id,path:file,...metadata};});
  return {files,sourceHashes:Object.fromEntries(files.map(file=>[file.id,file.sha256])),totalBytes:files.reduce((n,f)=>n+f.bytes,0)};
}
async function sourceHashes(){return (await collectRehearsalSources()).sourceHashes;}
export function estimateRouteEnergy(points,{cargoWeight=0,emit='off'}={}){
  let energy=0;for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],horizontal=Math.hypot(b[0]-a[0],b[2]-a[2]),vertical=Math.abs(b[1]-a[1]),seconds=Math.max(horizontal/.7,vertical/.45);energy+=seconds*(.1+(emit==='off'?0:.6))+(horizontal/.7*3.5+vertical/.45*6)*(1+cargoWeight);}return energy;
}
export function choosePairingBehavior(state,{consumedDelta=0,returnReserve=35}={}){
  const body=state?.actor?.position,m=state?.coop?.mechanical;
  if(!Array.isArray(body)||body.length!==3||!body.every(Number.isFinite)||!Array.isArray(m?.position)||m.position.length!==3||!m.position.every(Number.isFinite)||!Number.isFinite(m.battery)||!Number.isFinite(consumedDelta)||consumedDelta<0)throw Error('配对导航需要真实有限位姿与消费差量');
  const distance=distance3(body,m.position);
  if(state.coop.campaign.status==='cleared')return {kind:'complete',emit:'off',distance};
  if(m.battery<returnReserve)return {kind:'charge',emit:'off',distance};
  const stock=state.living?.care?.foods,knownStock=stock&&typeof stock==='object'&&Object.keys(stock).length>0;
  const available=knownStock&&Object.values(stock).some(amount=>Number.isFinite(amount)&&amount>0);
  if(knownStock&&!available)return {kind:'resupply',emit:'off',distance,reason:'real-food-stock-empty'};
  const nearB=(state.neural?.sensory?.inputs??[]).some(input=>input.kind==='neutral-odor'&&input.odor==='B'&&input.intensity>.5);
  const nearFood=available&&RESOURCE_DEFINITIONS.some(food=>food.kind==='food'&&stock[food.id]>0&&distance3(body,food.position)<.8);
  const foraging=state.living?.focus?.action==='eat'||state.actor.action==='eat';
  // At range 1.2, .65m still gives exp(-.65/1.2)>.5; keep A continuous
  // during nearby pursuit instead of resetting its settle time every .24m.
  const cue=distance<=.65&&!nearB&&(consumedDelta>0||available&&(nearFood||foraging));
  if(distance>.30)return {kind:'approach',emit:cue?'A':'off',distance,target:[body[0],body[1]+.08,body[2]]};
  if(nearB)return {kind:'wait',emit:'off',distance,reason:'actual-nearby-B'};
  return {kind:'wait',emit:cue?'A':'off',distance,reason:cue?'nearby-feeding-opportunity':'waiting-for-feeding-opportunity'};
}
async function writeJson(file,value){await fs.writeFile(file,JSON.stringify(value,null,2)+'\n','utf8');}

/** Read public diagnostics and the real helper save; cached sensory frames are not tick samples. */
export function nativeTickMeasurement(state,saved){
  const learning=state.neural?.learning??{},c=state.coop??{},helper=saved?.coop?.level?.pairedStart??null;
  const diagnostic=c.diagnostics?.learning,missingMeasurements=[];
  const cueSamples=Array.isArray(diagnostic?.cueSamples)?diagnostic.cueSamples.map(cue=>({id:cue.id,odor:cue.odor,intensity:cue.intensity,distance:cue.distance})):null;
  if(cueSamples===null)missingMeasurements.push('cueSamples');
  const window=diagnostic?.rewardWindowRemainingMs??helper?.lastRewardWindowRemainingMs;
  const rewardWindowRemainingMs=Number.isFinite(window)?window:null;
  if(rewardWindowRemainingMs===null)missingMeasurements.push('rewardWindowRemainingMs');
  const pending=helper?.pending,summary=c.pairing;
  if(summary&&!helper)missingMeasurements.push('pending');
  return {simSeconds:state.simSeconds,stage:c.campaign?.stage??null,selected:c.circuit?.selected??null,actual:c.circuit?.actual??null,
    pulse:{state:clone(c.circuit?.pulseState??[]),output:c.circuit?.pulseOutput??null,elapsed:c.circuit?.elapsed??null,steps:c.circuit?.steps??null,phase:c.circuit?.phase??null},
    npcPosition:clone(state.actor.position),mechanicalPosition:clone(c.mechanical.position),distance:distance3(state.actor.position,c.mechanical.position),
    cueSamples,rewardWindowRemainingMs,consumedAmount:learning.consumedAmount??0,rewardPulses:learning.rewardPulses??0,
    paired:{qualifiedPulses:helper?.counts?.qualifiedPulses??summary?.counts?.qualifiedPulses??0,pairedPulses:helper?.pairedPulses??summary?.pairedPulses??0,
      pairedConsumption:helper?.pairedConsumption??summary?.pairedConsumption??0,changedSynapses:helper?.changedSynapses??summary?.changedSynapses??0,
      pending:pending?{at:pending.at,consumedAmount:pending.consumedAmount,expectedEndSimSeconds:pending.expectedEndSimSeconds,changedSynapses:pending.changedIndices.length}:null},missingMeasurements};
}

/** Compare adjacent completed physics ticks, including short reward windows between bot decisions. */
export function nativeTickEvent(before,after,{nativePhysicsCalls=0}={}){
  if(after.simSeconds-before.simSeconds<1e-9)return null;
  const consumedDelta=Math.max(0,after.consumedAmount-before.consumedAmount),teacherDelta=Math.max(0,after.rewardPulses-before.rewardPulses);
  const signature=value=>JSON.stringify([value.paired.qualifiedPulses,value.paired.pairedPulses,value.paired.pending]);
  if(consumedDelta===0&&teacherDelta===0&&signature(before)===signature(after))return null;
  return {type:'native-learning-event',...clone(after),intervalSeconds:after.simSeconds-before.simSeconds,nativePhysicsCalls,consumedDelta,teacherDelta};
}
function publicEvidence(state,checkpoint){
  const learning=state.neural?.learning??state.neural?.neutralLearning??{},memory=checkpoint.body?.synapticMemory;
  return {simSeconds:state.simSeconds,brainStep:checkpoint.body?.neural?.step??null,satiety:state.needs?.satiety,activeFocus:state.living?.focus?.action??null,action:state.actor?.action,
    foodStock:clone(foodStock(clone(checkpoint.body))),bodyPosition:state.actor?.position,bodyHeading:state.actor?.heading,
    campaign:clone(state.coop.campaign),mechanical:clone(state.coop.mechanical),circuit:clone(state.coop.circuit),probe:clone(state.coop.probe),
    learning:clone(learning),pairing:clone(state.coop.pairing??null),food:clone(state.home),qSha256:sha(JSON.stringify(memory?.efficacy??null))};
}

async function loadPhysics(body){
  const {makeMechanicalRoomResolver}=await import('../public/mechanical-room-collision.mjs');
  const {meshClearance}=await import('../public/collision-world.mjs');
  const rawResolver=makeMechanicalRoomResolver();
  return {resolveMove:args=>withFoodStock(body,()=>rawResolver(args)),clearance:point=>withFoodStock(body,()=>meshClearance(point,RADIUS))};
}

async function dryPhysical(checkpoint,plan,options,out){
  const physics=await loadPhysics(clone(checkpoint.body));
  const planner=createPathPlanner({...physics,maxNodes:options.maxNodes});
  const pulse=parseCircuit(TAPEOUT_PULSE_SOURCE),xor=parseCircuit(DEFAULT_TAPEOUT);
  const clock=restoreCoopClock(checkpoint.coop.circuit);
  const makeContext=()=>({mechanical:clone(checkpoint.coop.mechanical),stage:2,seconds:0,ticks:0,emit:'off',phase:0,pulseState:clone(clock.pulseState),pulseElapsed:clock.elapsed,pulseOutput:clock.pulseOutput,signalSeconds:0,routes:[],serial:0});
  const objects=ctx=>coopWorldObjects(ctx.stage,NEUTRAL_LEVEL);
  function advance(ctx,input,seconds){
    let remaining=seconds;
    while(remaining>1e-9){const dt=Math.min(DT,remaining);remaining-=dt;
      const charging=objects(ctx).some(o=>o.kind==='charge'&&distance3(o.position,ctx.mechanical.position)<.22);
      const next=advanceMechanicalFly(ctx.mechanical,input,dt,{resolveMove:physics.resolveMove,charging});
      if(next.recoveredThisStep)throw Error('机械演练触发回收，不能当作合法飞行成功：'+next.recoveredReason);
      ctx.mechanical=next;ctx.seconds+=dt;ctx.ticks++;ctx.pulseElapsed+=dt;
      while(ctx.pulseElapsed>=COOP_CLOCK_SECONDS-1e-9){const r=stepCircuit(pulse,{state:Uint8Array.from(ctx.pulseState)});ctx.pulseState=Array.from(r.newState);ctx.pulseOutput=r.outputs[0]&1;ctx.pulseElapsed=Math.max(0,ctx.pulseElapsed-COOP_CLOCK_SECONDS);}
      const output=stepCircuit(xor,{inputs:Uint8Array.of((ctx.emit==='B'?1:0)|(ctx.phase<<1))}).outputs[0]&1;
      if(ctx.emit!=='off'&&ctx.mechanical.battery>0&&ctx.pulseOutput)ctx.signalSeconds+=dt;
      if(![0,1].includes(output))throw Error('电路输出无效');
    }
  }
  async function fly(ctx,marker){
    const before=clone(ctx.mechanical),route=planner.plan(before.position,marker.position),begin=ctx.seconds;
    for(const target of route.points.slice(1)){
      let attempts=0;
      while(distance3(ctx.mechanical.position,target)>.012){
        if(++attempts>4000)throw Error('机械路径执行预算耗尽：'+marker.id);
        const step=Math.min(.1,Math.max(.02,distance3(ctx.mechanical.position,target)/.8));
        advance(ctx,steering(ctx.mechanical.position,target,step,ctx.emit),step);
      }
    }
    const distance=distance3(ctx.mechanical.position,marker.position);
    if(distance>=.21)throw Error('到达点超出操作/机关半径：'+marker.id);
    const result={id:marker.id,position:marker.position,anchor:route.anchor,arrived:clone(ctx.mechanical.position),distance,method:route.method,expanded:route.expanded,waypoints:route.points,seconds:ctx.seconds-begin,batteryBefore:before.battery,batteryAfter:ctx.mechanical.battery,markerClearance:physics.clearance(marker.position)?.distance??null};
    ctx.routes.push(result);return result;
  }
  const preflight=makeContext();preflight.stage=1;const extra=[];
  for(const marker of plan.preflightMarkers){
    try{
      await fly(preflight,objects(preflight).find(o=>o.id==='dock'));
      let chargingSeconds=0;while(preflight.mechanical.battery<99.5&&chargingSeconds<10){advance(preflight,stopInput('off'),.1);chargingSeconds+=.1;}
      if(preflight.mechanical.battery<99)throw Error('探索预检无法在合法dock充足电');
      extra.push({ok:true,...await fly(preflight,marker)});
    }catch(error){extra.push({id:marker.id,ok:false,error:error.message,markerClearance:physics.clearance(marker.position)?.distance??null});break;}
  }
  const ctx=makeContext(),stages=[];
  for(const stage of plan.stages){ctx.stage=stage.stage;ctx.phase=0;ctx.emit='off';const start=ctx.seconds,routeStart=ctx.routes.length,record={stage:stage.stage,id:stage.id,ok:false};
    try{
      for(const action of stage.actions){
        if(action.kind==='emit'){ctx.emit=action.emit;continue;}
        if(action.kind==='pair-near-resident')continue;
        if(action.kind==='probe')continue;
        if(action.kind==='wait'){if(action.drySeconds)advance(ctx,stopInput(ctx.emit),action.drySeconds);continue;}
        if(action.kind==='pickup'&&ctx.mechanical.cargo)continue;
        const marker=objects(ctx).find(o=>o.id===action.id);if(!marker)throw Error('缺少标记：'+action.id);
        await fly(ctx,marker);
        if(action.kind==='charge'){
          let chargeSeconds=0;while(ctx.mechanical.battery<99.5&&chargeSeconds<10){advance(ctx,stopInput('off'),.1);chargeSeconds+=.1;}
          if(ctx.mechanical.battery<99)throw Error('真实充能区域没有提高电量：'+marker.id);
        }else if(action.kind==='pickup')ctx.mechanical=pickupMechanicalCargo(ctx.mechanical,{id:'dry-cargo-'+(++ctx.serial),weight:.35});
        else if(action.delivery){if(!ctx.mechanical.cargo)throw Error('演练缺少合法拾取的货物');ctx.mechanical=dropMechanicalCargo(ctx.mechanical).state;}
        else if(action.interact&&action.id==='phase')ctx.phase^=1;
      }
      record.ok=true;
    }catch(error){record.error=error.message;}
    Object.assign(record,{mechanicalSeconds:ctx.seconds-start,routes:ctx.routes.slice(routeStart),finalMechanical:clone(ctx.mechanical),nativeCampaignCompleted:false});
    if(stage.stage===6){record.nativeEntryBattery=35;record.firstChargeTravelCost=record.routes[0].batteryBefore-record.routes[0].batteryAfter;record.firstChargeAffordable=record.firstChargeTravelCost<35;if(!record.firstChargeAffordable){record.ok=false;record.error='能源章35电量不足以合法抵达首个充电点';}}
    stages.push(record);
    await writeJson(path.join(out,String(stage.stage).padStart(2,'0')+'-'+stage.id+'-dry.json'),record);
    if(!record.ok)break;
  }
  const result={mode:'dry-physical',preflight:extra,stages,allReachable:extra.every(x=>x.ok)&&stages.length===plan.stages.length&&stages.every(x=>x.ok),mechanicalSeconds:ctx.seconds,physicsSteps:ctx.ticks,
    stage8And11NaturalWaitExcluded:true,nativePhysicsCalls:0,neuralSessionImported:false,signalSeconds:ctx.signalSeconds,
    caveat:'Markers/charging/cargo are pure mechanical rehearsal only. Resident food/q/campaign are never simulated or awarded. Native stage6 sets battery=35; the dry route reports energy deltas without rewriting any checkpoint field.'};
  await writeJson(path.join(out,'dry-summary.json'),result);return result;
}

async function executeNative(checkpoint,plan,options,out,lockedSources){
  // Root must explicitly authorize timing by invoking execute --allow-neural-run.
  const {MirrorCoopSession}=await import('../src/mirror-coop-session.mjs');
  const session=new MirrorCoopSession(options.fresh?{seed:options.seed}:{saved:checkpoint});let state=session.snapshot(),emit='off',wall=Date.now(),activeStage=null,lastHeartbeat=0,nativePhysicsCalls=0,lastConsumedDelta=0;
  const initialNative=session.serialize(),initialBrainStep=initialNative.body.neural.step,initialSimSeconds=initialNative.body.simSeconds;
  if(options.fresh&&state.coop.campaign.stage!==0)throw Error('新 Session 没有从原生 stage0 开始');
  const receipts=[],nativeEventFile=path.join(out,'native-learning-events.jsonl');
  let contextGeometry=state,activeCommands=[],attemptedInput=null,activeNavigation=null,previousTick=nativeTickMeasurement(state,initialNative);
  async function checkSources(){if(JSON.stringify(await sourceHashes())!==JSON.stringify(lockedSources))throw Error('SOURCE_CHANGED：执行期间生产文件发生变化，保留进度并停止');}
  async function heartbeat(force=false){
    if(!force&&Date.now()-lastHeartbeat<1000)return;lastHeartbeat=Date.now();
    const saved=session.serialize(),evidence=publicEvidence(state,saved);
    await writeJson(path.join(out,'live-status.json'),{pid:process.pid,status:'running',at:new Date().toISOString(),stage:state.coop.campaign.stage,brainStepDelta:evidence.brainStep-initialBrainStep,simDelta:state.simSeconds-initialSimSeconds,nativePhysicsCalls,evidence});
  }
  async function advance(input,seconds){
    const consumedBefore=state.neural?.learning?.consumedAmount??0;
    attemptedInput={input:clone(input),seconds,at:state.simSeconds};
    session.command('input',input);let remaining=seconds;
    while(remaining>1e-9){const dt=Math.min(DT,remaining);remaining-=dt;
      await yieldTick();session.tick(dt);nativePhysicsCalls++;
      state=session.snapshot();
      if(state.simSeconds-previousTick.simSeconds>1e-9){
        const measured=nativeTickMeasurement(state,session.serialize()),event=nativeTickEvent(previousTick,measured,{nativePhysicsCalls});
        previousTick=measured;
        if(event)await fs.appendFile(nativeEventFile,JSON.stringify(event)+'\n','utf8');
      }
    }
    lastConsumedDelta=Math.max(0,(state.neural?.learning?.consumedAmount??0)-consumedBefore);contextGeometry=state;await heartbeat();return state;
  }
  async function save(prefix){state=session.snapshot();const saved=session.serialize();await writeJson(path.join(out,prefix+'-checkpoint.json'),saved);const evidence=publicEvidence(state,saved);await writeJson(path.join(out,prefix+'-state.json'),evidence);return evidence;}
  async function fly(marker,{travelBudget=Infinity}={}){
    const dynamicPhysics=await loadPhysics(contextGeometry),dynamicPlanner=createPathPlanner({...dynamicPhysics,maxNodes:options.maxNodes});
    const route=dynamicPlanner.plan(state.coop.mechanical.position,marker.position),begin=state.simSeconds;
    for(const target of route.points.slice(1)){
      let attempts=0;while(distance3(state.coop.mechanical.position,target)>.012){
        if(marker.kind==='charge'&&distance3(state.coop.mechanical.position,marker.position)<.20)return {...route,stoppedInsideChargeRadius:true};
        if(++attempts>4000)throw Error('真实路径超时：'+marker.id);
        const seconds=Math.min(.1,Math.max(.02,distance3(state.coop.mechanical.position,target)/.8));
        activeNavigation={id:marker.id,target:clone(target),position:clone(state.coop.mechanical.position),seconds};
        const before=state.coop.mechanical.recoveredCount;await advance(steering(state.coop.mechanical.position,target,seconds,emit),seconds);
        if(state.coop.mechanical.recoveredCount!==before){
          if(state.coop.campaign.stage!==8)throw Error('真实机械蝇触发回收：'+marker.id);
          emit='off';const recovery=await save('08-recovery-'+state.coop.mechanical.recoveredCount),beginCharge=state.simSeconds;
          activeCommands.push({kind:'legal-recovery',id:marker.id,at:state.simSeconds,mechanical:clone(state.coop.mechanical)});
          if(!state.coop.objects.some(o=>o.active&&o.kind==='charge'&&distance3(o.position,state.coop.mechanical.position)<.22))throw Error('回收点不是当前可用充电区域，保留真实恢复状态');
          while(state.coop.mechanical.battery<99.5&&state.simSeconds-beginCharge<12){await advance(stopInput('off'),.1);if(state.simSeconds-stageStart>options.maxStageSeconds)throw Error('合法回收后等待达到章节预算');}
          if(state.coop.mechanical.battery<99)throw Error('合法回收后实际充电失败');
          return {...await fly(marker,{travelBudget}),recoveredFrom:recovery.mechanical.recoveredCount};
        }
        if(state.simSeconds-stageStart>options.maxStageSeconds)throw Error('章节执行达到总模拟秒预算');
        if(state.simSeconds-begin>=travelBudget)return {...route,partial:true,travelSeconds:state.simSeconds-begin};
      }
    }
    if(distance3(state.coop.mechanical.position,marker.position)>=.21)throw Error('真实到达点不在操作半径：'+marker.id);
    return route;
  }
  async function chargeAt(marker,commands){
    emit='off';const route=await fly(marker),begin=state.simSeconds,initial=state.coop.mechanical.battery;
    while(state.coop.mechanical.battery<99.5&&state.simSeconds-begin<10)await advance(stopInput('off'),.1);
    if(state.coop.mechanical.battery<99||initial<99&&state.coop.mechanical.battery<=initial)throw Error('真实充电未发生：'+marker.id);
    commands.push({kind:'charge',id:marker.id,route,seconds:state.simSeconds-begin,battery:state.coop.mechanical.battery});
  }
  async function pairNearResident(action,commands){
    const begin=state.simSeconds,budget=options[action.budget],startedConsumed=state.neural?.learning?.consumedAmount??0;
    let lastDecision='',lastEvidence=-Infinity,chargerCache=null;
    while(state.coop.campaign.status!=='cleared'&&state.simSeconds-begin<budget){
      if(state.simSeconds-stageStart>options.maxStageSeconds)throw Error('近场教学达到章节总预算，保留真实失败');
      if(!chargerCache||state.simSeconds-chargerCache.at>=2||distance3(state.coop.mechanical.position,chargerCache.position)>.5){
        const physics=await loadPhysics(contextGeometry),planner=createPathPlanner({...physics,maxNodes:options.maxNodes});
        const chargers=state.coop.objects.filter(o=>o.active&&o.kind==='charge');
        const routes=chargers.map(marker=>{try{const route=planner.plan(state.coop.mechanical.position,marker.position);return {marker,route,cost:estimateRouteEnergy(route.points,{cargoWeight:state.coop.mechanical.cargo?.weight??0})};}catch{return null;}}).filter(Boolean).sort((a,b)=>a.cost-b.cost);
        chargerCache={routes,at:state.simSeconds,position:clone(state.coop.mechanical.position)};
      }
      const routes=chargerCache.routes;
      if(!routes.length)throw Error('近场教学没有可达的真实充电点');
      if(routes[0].cost+8>=99&&state.coop.mechanical.battery>=99)throw Error('真实回充路线超出满电与保留余量预算，停止而非重复原地充电');
      const decision=choosePairingBehavior(state,{consumedDelta:lastConsumedDelta,returnReserve:Math.max(12,routes[0].cost+8)});
      if(decision.kind!==lastDecision||state.simSeconds-lastEvidence>=2){commands.push({kind:'pairing-behavior',at:state.simSeconds,decision:decision.kind,emit:decision.emit,distance:decision.distance,battery:state.coop.mechanical.battery,consumedDelta:lastConsumedDelta,pairing:clone(state.coop.pairing??null),bodyPosition:clone(state.actor.position)});lastDecision=decision.kind;lastEvidence=state.simSeconds;}
      emit=decision.emit;
      if(decision.kind==='charge'){await advance(stopInput('off'),DT);await chargeAt(routes[0].marker,commands);continue;}
      if(decision.kind==='resupply'){
        await advance(stopInput('off'),DT);
        const before=clone(foodStock(session.serialize().body));
        if(!state.coop.mechanical.cargo){const supply=state.coop.objects.find(o=>o.active&&o.id==='supply');if(!supply)throw Error('空盘后没有合法补给点');await fly(supply);session.command('interact');state=session.snapshot();contextGeometry=state;if(!state.coop.mechanical.cargo)throw Error('公开拾取没有取得补给');}
        const plate=state.coop.objects.find(o=>o.active&&o.id==='plate-fig');if(!plate)throw Error('空盘后没有合法投递点');await fly(plate);session.command('interact');state=session.snapshot();contextGeometry=state;
        const after=clone(foodStock(session.serialize().body));if(!(after.fig>before.fig))throw Error('公开投递没有实际补入食物');
        commands.push({kind:'actual-resupply',at:state.simSeconds,before,after});lastConsumedDelta=0;chargerCache=null;continue;
      }
      if(decision.kind==='approach'){
        await advance(stopInput(emit),DT);
        const route=await fly({id:'resident-nearby',position:decision.target},{travelBudget:decision.distance<=.65?.3:.6});
        commands.push({kind:'resident-route',at:state.simSeconds,target:decision.target,route});continue;
      }
      await advance(stopInput(emit),.1);
    }
    emit='off';await advance(stopInput('off'),DT);
    commands.push({kind:'pairing-finished',seconds:state.simSeconds-begin,actualConsumedDelta:(state.neural?.learning?.consumedAmount??0)-startedConsumed,pairing:clone(state.coop.pairing??null),completed:state.coop.campaign.status==='cleared'});
    if(state.coop.campaign.status!=='cleared')throw Error('真实近场教学超时；不注入食欲、目标、奖励、权重或通关状态');
  }
  let stageStart=state.simSeconds;
  try{
    await fs.writeFile(nativeEventFile,'',{encoding:'utf8',flag:'wx'});
    await yieldTick();await yieldTick();
    if(options.retryCurrent){
      const before=session.serialize();session.command('retry');const after=session.serialize();
      if(JSON.stringify(before.body)!==JSON.stringify(after.body)||JSON.stringify(before.body.synapticMemory)!==JSON.stringify(after.body.synapticMemory))throw Error('公开retry意外改变原脑、身体或权重，停止');
      state=session.snapshot();await writeJson(path.join(out,'public-retry.json'),{action:'retry',beforeStage:before.coop.campaign.stage,afterStage:after.coop.campaign.stage,beforeAttempt:before.coop.campaign.attempt,afterAttempt:after.coop.campaign.attempt,bodyUnchanged:true,qUnchanged:true,brainStep:after.body.neural.step});
    }
    session.command('pause',false);state=session.snapshot();previousTick=nativeTickMeasurement(state,session.serialize());
    await save(options.fresh?'fresh-native-initial':'resumed-native-initial');
    await heartbeat(true);console.log(JSON.stringify({type:'EXECUTE_LIVE',pid:process.pid,out,stage:state.coop.campaign.stage,brainStep:initialBrainStep,stopBeforeStage:options.stopBeforeStage}));
    for(const stage of plan.stages){
      await checkSources();activeStage=stage;stageStart=state.simSeconds;const stageWall=Date.now(),prefix=String(stage.stage).padStart(2,'0')+'-'+stage.id;
      if(state.coop.campaign.stage!==stage.stage)throw Error('真实章节与计划不同；禁止改写stage跳关');
      const before=await save(prefix+'-before'),stageWeights=clone(session.serialize().body.synapticMemory?.efficacy??[]),commands=[];activeCommands=commands;emit='off';await advance(stopInput('off'),DT);
      for(const action of stage.actions){
        if(state.coop.campaign.status==='cleared')break;
        if(action.kind==='emit'){emit=action.emit;await advance(stopInput(emit),DT);commands.push({kind:'emit',emit});continue;}
        if(action.kind==='pair-near-resident'){await pairNearResident(action,commands);continue;}
        if(action.kind==='wait'){
          const begin=state.simSeconds,budget=action.budget?options[action.budget]:action.maxSeconds;
          const done=()=>action.condition==='first-phase'?state.coop.campaign.progress.decodedPhases?.includes(0):state.coop.campaign.status==='cleared';
          while(!done()&&state.simSeconds-begin<budget){await advance(stopInput(emit),.1);if(state.simSeconds-stageStart>options.maxStageSeconds)throw Error('章节等待达到总模拟秒预算');}
          commands.push({kind:'wait',condition:action.condition,seconds:state.simSeconds-begin,completed:done()});
          if(!done())throw Error('真实等待超时：'+stage.id+'；不注入奖励或强制通关');continue;
        }
        if(action.kind==='probe'){
          const begin=state.simSeconds;let lastError;
          while(!state.coop.probe.running&&state.simSeconds-begin<action.maxSeconds){
            try{session.command('probe',{swapped:false});state=session.snapshot();}catch(error){lastError=error;await advance(stopInput('off'),.5);}
          }
          if(!state.coop.probe.running)throw Error('自然观察位置始终不合法：'+lastError?.message);commands.push({kind:'probe',startedAt:state.simSeconds});continue;
        }
        if(action.kind==='pickup'&&state.coop.mechanical.cargo)continue;
        const marker=state.coop.objects.find(o=>o.id===action.id&&o.active);if(!marker)throw Error('真实场景没有活动标记：'+action.id);
        const route=await fly(marker);commands.push({kind:action.kind,id:marker.id,route});
        if(action.kind==='charge'){
          const begin=state.simSeconds,initial=state.coop.mechanical.battery;while(state.coop.mechanical.battery<99.5&&state.simSeconds-begin<10)await advance(stopInput('off'),.1);
          if(state.coop.mechanical.battery<99||initial<99&&state.coop.mechanical.battery<=initial)throw Error('真实充电未发生：'+marker.id);
        }else if(action.kind==='pickup'||action.interact){
          if(stage.stage===8&&action.delivery){
            const begin=state.simSeconds;
            while(state.simSeconds-begin<1.8&&distance3(state.actor.position,state.coop.mechanical.position)<=.65){emit='A';await advance(stopInput('A'),.1);if(state.coop.circuit.actual==='A')break;}
            if(distance3(state.actor.position,state.coop.mechanical.position)>.65){emit='off';await advance(stopInput('off'),DT);}
            commands.push({kind:'pre-delivery-cue',at:state.simSeconds,selected:emit,actual:state.coop.circuit.actual,distance:distance3(state.actor.position,state.coop.mechanical.position)});
          }
          session.command('interact');state=session.snapshot();contextGeometry=state;
        }
      }
      if(state.coop.campaign.status!=='cleared')throw Error('动作完成但真实任务未完成：'+stage.id);
      await advance(stopInput('off'),DT);const after=await save(prefix+'-after');
      const afterWeights=session.serialize().body.synapticMemory?.efficacy??[],qChangedThisStage=stageWeights.reduce((n,q,i)=>n+(Math.abs(q-afterWeights[i])>1e-10?1:0),0);
      const receipt={stage:stage.stage,id:stage.id,ok:true,before,after,commands,simSeconds:state.simSeconds-stageStart,brainStepDelta:after.brainStep-before.brainStep,qChangedThisStage,wallMs:Date.now()-stageWall};receipts.push(receipt);await writeJson(path.join(out,prefix+'-receipt.json'),receipt);
      console.log(JSON.stringify({type:'STAGE_CLEARED',stage:stage.stage,simSeconds:receipt.simSeconds,brainStepDelta:receipt.brainStepDelta,satiety:after.satiety,rewardPulses:after.learning.rewardPulses,consumedAmount:after.learning.consumedAmount}));
      session.command('continue');state=session.snapshot();contextGeometry=state;
      if(options.stopBeforeStage!==null&&state.coop.campaign.stage>=options.stopBeforeStage){
        session.command('pause',true);state=session.snapshot();const final=await save('stop-before-'+String(options.stopBeforeStage).padStart(2,'0'));
        const result={mode:'execute',ok:true,stoppedBeforeStage:options.stopBeforeStage,campaignComplete:false,receipts,final,brainStepDelta:final.brainStep-initialBrainStep,simSeconds:state.simSeconds-initialSimSeconds,nativePhysicsCalls,wallMs:Date.now()-wall};
        await writeJson(path.join(out,'live-status.json'),{pid:process.pid,status:'paused-at-boundary',at:new Date().toISOString(),...result});return result;
      }
    }
    await checkSources();const final=await save('final');return {mode:'execute',ok:state.coop.campaign.status==='complete',receipts,final,brainStepDelta:final.brainStep-initialBrainStep,simSeconds:state.simSeconds-initialSimSeconds,nativePhysicsCalls,wallMs:Date.now()-wall};
  }catch(error){
    // Capture the real failed state first, then cancel probe/pause through public commands.
    state=session.snapshot();const failedBeforeCleanup=await save('failed-before-cleanup');
    try{session.command('endProbe');session.command('pause',true);state=session.snapshot();}catch{}
    const failed=await save('failed');const result={mode:'execute',ok:false,error:error.message,stage:state.coop.campaign.stage,receipts,activeCommands,attemptedInput,activeNavigation,failedBeforeCleanup,failed,brainStepDelta:failed.brainStep-initialBrainStep,simSeconds:state.simSeconds-initialSimSeconds,nativePhysicsCalls,wallMs:Date.now()-wall};
    await writeJson(path.join(out,'failure.json'),result);await writeJson(path.join(out,'live-status.json'),{pid:process.pid,status:'failed',at:new Date().toISOString(),...result});return result;
  }finally{session.dispose();}
}

export async function main(argv=process.argv.slice(2)){
  const options=parseOptions(argv),raw=options.fresh?null:await fs.readFile(options.checkpoint,'utf8'),checkpoint=options.fresh?null:JSON.parse(raw),plan=buildCampaignPlan(checkpoint,{resume:options.resume,fresh:options.fresh,seed:options.seed});
  const stamp=new Date().toISOString().replace(/[:.]/g,'-'),out=options.out??path.join(ROOT,'output/mirror-coop-v8.5.0','rehearsal-'+options.mode+'-'+stamp);
  await fs.mkdir(out,{recursive:true});try{await fs.access(path.join(out,'run.json'));throw Error('输出目录已有演练记录，不覆盖：'+out);}catch(error){if(error.code!=='ENOENT')throw error;}
  const lockedSources=await sourceHashes();
  await writeJson(path.join(out,'run.json'),{productVersion:'8.5.0',mode:options.mode,pid:process.pid,startedAt:new Date().toISOString(),origin:options.fresh?'new-MirrorCoopSession':'native-checkpoint',seed:options.seed,checkpoint:options.fresh?null:options.checkpoint,inputSha256:raw===null?null:sha(raw),scriptSha256:sha(await fs.readFile(fileURLToPath(import.meta.url))),sources:lockedSources,options});
  await fs.writeFile(path.join(out,'runner-at-start.mjs'),await fs.readFile(fileURLToPath(import.meta.url)),{flag:'wx'});
  await writeJson(path.join(out,'plan.json'),plan);
  const result=options.mode==='plan'?{mode:'plan',stages:plan.stages.length,startStage:plan.startStage,preflightMarkers:plan.preflightMarkers,neuralSessionImported:false}:
    options.mode==='dry-physical'?await dryPhysical(checkpoint,plan,options,out):await executeNative(checkpoint,plan,options,out,lockedSources);
  await writeJson(path.join(out,'result.json'),result);
  if(!options.fresh){const afterRaw=await fs.readFile(options.checkpoint,'utf8');if(sha(afterRaw)!==sha(raw))throw Error('输入检查点被外部修改，停止并保留已有证据');}
  const stageFailure=Array.isArray(result.stages)?result.stages.find(s=>!s.ok)?.error:null;
  const summary={mode:options.mode,out,ok:result.allReachable??result.ok??true,stages:Array.isArray(result.stages)?result.stages.length:result.receipts?.length??plan.stages.length,mechanicalSeconds:result.mechanicalSeconds??null,physicsSteps:result.physicsSteps??null,neuralSessionImported:options.mode==='execute',error:result.error??stageFailure??null};
  console.log(JSON.stringify(summary));return {result,out};
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){main().then(({result})=>{if(result.ok===false||result.allReachable===false)process.exitCode=1;}).catch(error=>{console.error(error.message);process.exitCode=1;});}
