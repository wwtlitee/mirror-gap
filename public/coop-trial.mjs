// 镜隙可重玩试炼 v8.5.0 — Unclecow. Pure trusted-event reduction only.
import {validateCampaignEvent} from './mirror-campaign.mjs';

const VERSION='8.5.0',KINDS=new Set(['courier','signal']),ORDER=['cup','shelf','table'];
const STATE_KEYS=['format','productVersion','id','kind','status','attempt','elapsed','route','decodedPhases','signalSeconds','collisionActive','delivery','stats','result'];
const STAT_KEYS=['energySpent','collisions','mistakes'],RESULT_KEYS=['elapsed','energySpent','collisions','mistakes'];
const own=(value,key)=>Object.hasOwn(value,key);
const finite=(value,min=0,max=Infinity)=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max;
const counter=value=>Number.isSafeInteger(value)&&value>=0;
const clone=value=>structuredClone(value);
const invalid=message=>{throw Error('合作试炼：'+message);};
function exactObject(value,keys,label){
  if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))
    ||Reflect.ownKeys(value).length!==keys.length||keys.some(key=>!own(value,key)))invalid(label+'字段无效');
}
function trialId(kind,attempt){return 'coop-trial-'+kind+'-'+attempt;}
function achieved(state){return state.kind==='courier'?state.route.length===ORDER.length&&state.delivery!==null:
  state.decodedPhases.length===2&&state.signalSeconds>=2-1e-9;}
function makeResult(state){return {elapsed:state.elapsed,energySpent:state.stats.energySpent,collisions:state.stats.collisions,mistakes:state.stats.mistakes};}

function validateState(state){
  exactObject(state,STATE_KEYS,'状态');
  if(state.format!==1||state.productVersion!==VERSION||!KINDS.has(state.kind)||!Number.isSafeInteger(state.attempt)||state.attempt<1
    ||state.id!==trialId(state.kind,state.attempt)||!['playing','complete'].includes(state.status)||!finite(state.elapsed)
    ||typeof state.collisionActive!=='boolean')invalid('版本、身份、时间或状态无效');
  exactObject(state.stats,STAT_KEYS,'统计');
  if(!finite(state.stats.energySpent)||!counter(state.stats.collisions)||!counter(state.stats.mistakes)
    ||state.collisionActive&&state.stats.collisions===0)invalid('能耗、碰撞或错序统计无效');
  if(!Array.isArray(state.route)||state.route.length>ORDER.length||Array.from(state.route).some((id,i)=>id!==ORDER[i]))invalid('路线必须为cup→shelf→table的前缀');
  if(!Array.isArray(state.decodedPhases)||state.decodedPhases.length>2||Array.from(state.decodedPhases).some(phase=>phase!==0&&phase!==1)
    ||new Set(state.decodedPhases).size!==state.decodedPhases.length||!finite(state.signalSeconds)||state.signalSeconds>state.elapsed+1e-8)invalid('相位或信号累计时间无效');
  if(state.kind==='courier'){
    if(state.decodedPhases.length||state.signalSeconds!==0)invalid('递送试炼混入信号进度');
    if(state.delivery!==null){
      exactObject(state.delivery,['type','foodId','amount','cargoId'],'递送事实');validateCampaignEvent(state.delivery,0);
      if(state.delivery.type!=='delivery'||state.delivery.foodId!=='fig'||state.status!=='complete')invalid('递送事实必须是完成时的真实fig投递');
    }
  }else if(state.route.length||state.delivery!==null)invalid('信号试炼混入递送进度');
  const done=achieved(state);
  if(state.status==='playing'){
    if(done||state.result!==null)invalid('进行中状态不能包含已完成结果');
  }else{
    if(!done)invalid('完成状态缺少实际任务事实');exactObject(state.result,RESULT_KEYS,'结果');
    const expected=makeResult(state);if(RESULT_KEYS.some(key=>state.result[key]!==expected[key]))invalid('结果与最终统计不一致');
  }
}

export function createCoopTrial(kind,{attempt=1}={}){
  if(!KINDS.has(kind)||!Number.isSafeInteger(attempt)||attempt<1)invalid('未知试炼或尝试次数无效');
  return {format:1,productVersion:VERSION,id:trialId(kind,attempt),kind,status:'playing',attempt,elapsed:0,
    route:[],decodedPhases:[],signalSeconds:0,collisionActive:false,delivery:null,
    stats:{energySpent:0,collisions:0,mistakes:0},result:null};
}

export function restoreCoopTrial(saved){validateState(saved);return clone(saved);}

function checkpoint(state,event){
  if(!event.carrying)return;
  if(event.id===ORDER[state.route.length]){state.route.push(event.id);return;}
  state.stats.mistakes++;state.route=event.id===ORDER[0]?[ORDER[0]]:[];
}
function receiveDelivery(state,event){
  if(state.route.length===ORDER.length&&event.foodId==='fig'){
    state.delivery={type:'delivery',foodId:'fig',amount:event.amount,cargoId:event.cargoId};
  }else{state.stats.mistakes++;state.route=[];state.delivery=null;}
}

/** Session gates real selected-A, power and pulse facts; this reducer never sees UI input. */
export function advanceCoopTrial(saved,{seconds=0,events=[],energySpent=0,collision=false}={}){
  validateState(saved);
  if(!finite(seconds,0,.25)||!Array.isArray(events)||events.length>64||typeof collision!=='boolean'
    ||typeof energySpent!=='number'||!Number.isFinite(energySpent))invalid('时间、事件批次、碰撞或能耗输入无效');
  for(const event of events)validateCampaignEvent(event,seconds);
  const state=clone(saved);if(state.status==='complete')return state;
  state.elapsed+=seconds;state.stats.energySpent+=Math.max(0,energySpent);
  if(collision&&!state.collisionActive)state.stats.collisions++;
  state.collisionActive=collision;
  let pulseSeconds=0;
  for(const event of events){
    if(state.kind==='courier'){
      if(event.type==='checkpoint')checkpoint(state,event);
      else if(event.type==='delivery')receiveDelivery(state,event);
    }else{
      const selectedA=!own(event,'selected')||event.selected==='A';
      if(event.type==='decodedSignal'&&selectedA&&event.input===0&&!state.decodedPhases.includes(event.phase))state.decodedPhases.push(event.phase);
      if(event.type==='signal'&&selectedA&&event.powered&&event.output===1){
        const accepted=Math.max(0,Math.min(event.seconds,seconds-pulseSeconds));pulseSeconds+=accepted;state.signalSeconds+=accepted;
      }
    }
    if(achieved(state)){state.status='complete';state.result=makeResult(state);break;}
  }
  validateState(state);return state;
}
