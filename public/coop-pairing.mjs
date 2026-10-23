// Cooperative A pairing evidence v8.5.0 — Unclecow. Measurement only; no neural runtime imports.
import {validateSynapticMemory,SYNAPTIC_WEIGHT_COUNT} from './synaptic-memory-schema.mjs';

export const COOP_PAIRING_PROTOCOL=Object.freeze({productVersion:'8.5.0',intensityExclusive:.5,
  minConfirmedPulses:2,minElapsedSeconds:12,weightEpsilon:1e-10,maxRewardWindowMs:250});
const EPS=1e-7,copy=value=>structuredClone(value),finite=(n,min=0,max=Infinity)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
const counter=n=>Number.isSafeInteger(n)&&n>=0;
const error=message=>{throw Error('合作配对记录：'+message);};
const STATE_KEYS=['format','productVersion','baselineWeights','lastWeights','startedAtSimSeconds','lastSimSeconds','firstPairedAt',
  'pairedPulses','pairedConsumption','changedSynapses','elapsed','pairs','pairedChangedIndices','pending','counts',
  'lastRewardWindowRemainingMs','reloadNeedsFreshWindow','receipt','rewardCandidate'];
const COUNT_KEYS=['qualifiedPulses','interruptedPairs','interruptedOnLoad','interruptedNearB','interruptedFrozen','interruptedRewardDisabled'];
const SAMPLE_KEYS=['simSeconds','seconds','consumedDelta','rewardPulseDelta','rewardWindowRemainingMs','actualOdor','cueSamples','weights','frozen','rewardEnabled'];
function exact(value,keys){
  if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))
    ||Reflect.ownKeys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))error('字段无效');
}
function indices(value){
  if(!Array.isArray(value)||value.length>SYNAPTIC_WEIGHT_COUNT)error('突触差量索引无效');
  for(let i=0;i<value.length;i++)if(!Number.isSafeInteger(value[i])||value[i]<0||value[i]>=SYNAPTIC_WEIGHT_COUNT||(i&&value[i]<=value[i-1]))error('突触差量索引无效');
}
const changed=(a,b)=>a.efficacy.flatMap((q,i)=>Math.abs(q-b.efficacy[i])>COOP_PAIRING_PROTOCOL.weightEpsilon?[i]:[]);
const union=(a,b)=>[...new Set([...a,...b])].sort((x,y)=>x-y);
function refresh(state){
  state.pairedPulses=state.pairs.length;
  state.pairedConsumption=state.pairs.reduce((sum,pair)=>sum+pair.consumedAmount,0);
  state.firstPairedAt=state.pairs[0]?.at??state.pending?.at??null;
  state.elapsed=state.firstPairedAt===null?0:state.lastSimSeconds-state.firstPairedAt;
  const evidence=new Set(state.pairedChangedIndices);
  state.changedSynapses=changed(state.baselineWeights,state.lastWeights).filter(index=>evidence.has(index)).length;
  return state;
}
function validateState(state){
  if(state&&[Object.prototype,null].includes(Object.getPrototypeOf(state))&&!Object.hasOwn(state,'rewardCandidate'))state={...state,rewardCandidate:null};
  exact(state,STATE_KEYS);validateSynapticMemory(state.baselineWeights);validateSynapticMemory(state.lastWeights);
  if(state.format!==1||state.productVersion!=='8.5.0'||!finite(state.startedAtSimSeconds)||!finite(state.lastSimSeconds,state.startedAtSimSeconds)
    ||!finite(state.lastRewardWindowRemainingMs,0,250)||typeof state.reloadNeedsFreshWindow!=='boolean')error('版本、时间或奖励窗无效');
  indices(state.pairedChangedIndices);exact(state.counts,COUNT_KEYS);
  if(COUNT_KEYS.some(key=>!counter(state.counts[key]))||state.counts.interruptedPairs!==state.counts.interruptedOnLoad+
    state.counts.interruptedNearB+state.counts.interruptedFrozen+state.counts.interruptedRewardDisabled)error('中断统计无效');
  if(!Array.isArray(state.pairs)||state.pairs.length>4096)error('配对事实过多');
  let previous=state.startedAtSimSeconds;
  for(const pair of state.pairs){
    exact(pair,['at','closedAt','consumedAmount']);
    if(!finite(pair.at,previous)||!finite(pair.closedAt,pair.at,state.lastSimSeconds)||!finite(pair.consumedAmount,Number.MIN_VALUE))error('已确认配对事实无效');
    previous=pair.closedAt;
  }
  if(state.rewardCandidate!==null){
    const candidate=state.rewardCandidate;exact(candidate,['at','consumedAmount','expectedEndSimSeconds']);
    if(!finite(candidate.at,state.startedAtSimSeconds,state.lastSimSeconds)||!finite(candidate.consumedAmount,Number.MIN_VALUE)
      ||!finite(candidate.expectedEndSimSeconds,candidate.at,candidate.at+.25+EPS)||state.lastRewardWindowRemainingMs<=0||state.pending
      ||Math.abs((candidate.expectedEndSimSeconds-state.lastSimSeconds)*1000-state.lastRewardWindowRemainingMs)>EPS*1000)error('待确认的真实奖励窗无效');
  }
  if(state.pending!==null){
    exact(state.pending,['at','consumedAmount','expectedEndSimSeconds','changedIndices']);indices(state.pending.changedIndices);
    if(!finite(state.pending.at,previous,state.lastSimSeconds)||!finite(state.pending.consumedAmount,Number.MIN_VALUE)
      ||!finite(state.pending.expectedEndSimSeconds,state.pending.at,state.pending.at+.25+EPS)
      ||state.lastRewardWindowRemainingMs<=0
      ||Math.abs((state.pending.expectedEndSimSeconds-state.lastSimSeconds)*1000-state.lastRewardWindowRemainingMs)>EPS*1000)error('未完成配对窗口无效');
  }
  if(state.counts.qualifiedPulses!==state.pairs.length+(state.pending?1:0)+state.counts.interruptedPairs)error('配对统计不一致');
  const derived=refresh(copy(state));
  for(const key of ['firstPairedAt','pairedPulses','pairedConsumption','changedSynapses','elapsed'])if(state[key]!==derived[key])error('派生配对统计无效');
  if(state.receipt!==null){
    exact(state.receipt,['type','odor','consumedAmount','teachingEvents','changedSynapses','elapsed']);const r=state.receipt;
    if(r.type!=='pairedLearning'||r.odor!=='A'||r.teachingEvents!==state.pairedPulses||r.teachingEvents<2||r.consumedAmount!==state.pairedConsumption
      ||!counter(r.changedSynapses)||r.changedSynapses<1||r.changedSynapses>state.pairedChangedIndices.length
      ||!finite(r.elapsed,12,state.elapsed+EPS))error('已发导演事实无效');
  }
  return state;
}
function validateSample(state,sample){
  exact(sample,SAMPLE_KEYS);validateSynapticMemory(sample.weights);
  if(!finite(sample.seconds,Number.MIN_VALUE,.1)||!finite(sample.simSeconds,state.lastSimSeconds)
    ||Math.abs(sample.simSeconds-state.lastSimSeconds-sample.seconds)>EPS||!finite(sample.consumedDelta)
    ||![0,1].includes(sample.rewardPulseDelta)||!finite(sample.rewardWindowRemainingMs,0,250)
    ||!['A','B','off'].includes(sample.actualOdor)||typeof sample.frozen!=='boolean'||typeof sample.rewardEnabled!=='boolean')error('本tick差量或世界时间无效');
  if(!Array.isArray(sample.cueSamples)||sample.cueSamples.length>32)error('实际气味样本无效');
  const ids=new Set();
  for(const cue of sample.cueSamples){
    exact(cue,['id','odor','intensity','distance','position','kind']);
    if(typeof cue.id!=='string'||!cue.id.startsWith('cue-')||ids.has(cue.id)||!['A','B'].includes(cue.odor)||cue.kind!=='neutral-odor'
      ||!finite(cue.intensity,0,1)||!finite(cue.distance)||!Array.isArray(cue.position)||cue.position.length!==3
      ||Array.from(cue.position).some(x=>!finite(x,-Infinity)))error('必须使用本tick cueSamples 实际浓度');
    ids.add(cue.id);
  }
}

export function createCoopPairing(value){
  exact(value,['simSeconds','weights']);validateSynapticMemory(value.weights);if(!finite(value.simSeconds))error('本段起始时间无效');
  return {format:1,productVersion:'8.5.0',baselineWeights:copy(value.weights),lastWeights:copy(value.weights),
    startedAtSimSeconds:value.simSeconds,lastSimSeconds:value.simSeconds,firstPairedAt:null,pairedPulses:0,pairedConsumption:0,
    changedSynapses:0,elapsed:0,pairs:[],pairedChangedIndices:[],pending:null,rewardCandidate:null,
    counts:{qualifiedPulses:0,interruptedPairs:0,interruptedOnLoad:0,interruptedNearB:0,interruptedFrozen:0,interruptedRewardDisabled:0},
    lastRewardWindowRemainingMs:0,reloadNeedsFreshWindow:false,receipt:null};
}

function interrupt(state,reason){
  if(!state.pending)return;
  state.pending=null;state.counts.interruptedPairs++;state.counts[reason]++;
}

/** Only a real load uses this function. Never call it as a per-tick validator. */
export function restoreCoopPairing(saved){
  saved=validateState(saved);const state=copy(saved);
  if(state.lastRewardWindowRemainingMs>0)state.reloadNeedsFreshWindow=true;
  state.rewardCandidate=null;
  interrupt(state,'interruptedOnLoad');
  return refresh(state);
}

/** Deltas must bracket exactly one natural physics tick. q copies are measurement references, never weight owners. */
export function advanceCoopPairing(saved,sample){
  saved=validateState(saved);validateSample(saved,sample);const state=copy(saved),qDelta=changed(state.lastWeights,sample.weights);
  state.lastSimSeconds=sample.simSeconds;state.lastWeights=copy(sample.weights);state.lastRewardWindowRemainingMs=sample.rewardWindowRemainingMs;
  if(state.receipt!==null)return {state:refresh(state),ready:true,receipt:null};
  const nearB=sample.cueSamples.some(cue=>cue.odor==='B'&&cue.intensity>.5),nearA=sample.actualOdor==='A'
    &&sample.cueSamples.some(cue=>cue.odor==='A'&&cue.intensity>.5)&&!nearB;
  if(nearB)interrupt(state,'interruptedNearB');
  else if(sample.frozen)interrupt(state,'interruptedFrozen');
  else if(!sample.rewardEnabled)interrupt(state,'interruptedRewardDisabled');
  const interrupted=nearB||sample.frozen||!sample.rewardEnabled;
  if(interrupted)state.rewardCandidate=null;
  if(sample.consumedDelta>0&&sample.rewardPulseDelta===1&&!interrupted){
    if(state.pending||state.rewardCandidate)error('未结束奖励窗内出现重叠的新教学脉冲');
    if(sample.rewardWindowRemainingMs<=0)error('新奖励脉冲必须具有实际未结束窗口');
    state.rewardCandidate={at:sample.simSeconds,consumedAmount:sample.consumedDelta,expectedEndSimSeconds:sample.simSeconds+sample.rewardWindowRemainingMs/1000};
  }
  const qualified=nearA&&!interrupted&&sample.consumedDelta>0&&sample.rewardWindowRemainingMs>0&&state.rewardCandidate!==null;
  if(qualified){
    if(state.pending)error('未完成奖励窗内出现重叠的新配对脉冲');
    if(sample.rewardWindowRemainingMs<=0)error('新奖励脉冲必须具有实际未结束窗口');
    state.pending={at:sample.simSeconds,consumedAmount:sample.consumedDelta,
      expectedEndSimSeconds:state.rewardCandidate.expectedEndSimSeconds,changedIndices:[]};
    state.rewardCandidate=null;
    state.counts.qualifiedPulses++;
  }
  if(state.rewardCandidate&&sample.rewardWindowRemainingMs===0){
    if(sample.simSeconds+EPS<state.rewardCandidate.expectedEndSimSeconds)error('奖励时钟重置不能冒充未配对窗自然结束');
    state.rewardCandidate=null;
  }
  if(state.pending){
    state.pending.changedIndices=union(state.pending.changedIndices,qDelta);
    if(sample.rewardWindowRemainingMs===0){
      if(sample.simSeconds+EPS<state.pending.expectedEndSimSeconds)error('奖励时钟重置不能冒充自然窗结束，请按真实load恢复跟踪器');
      const pending=state.pending;
      state.pairs.push({at:pending.at,closedAt:sample.simSeconds,consumedAmount:pending.consumedAmount});
      state.pairedChangedIndices=union(state.pairedChangedIndices,pending.changedIndices);state.pending=null;state.reloadNeedsFreshWindow=false;
    }else if(sample.simSeconds>state.pending.expectedEndSimSeconds+EPS)error('实际奖励窗意外延长，拒绝伪造完成');
  }
  refresh(state);
  const ready=state.pairedPulses>=2&&state.elapsed>=12&&state.changedSynapses>0&&!state.pending
    &&sample.rewardWindowRemainingMs===0&&!state.reloadNeedsFreshWindow&&!sample.frozen&&sample.rewardEnabled;
  const receipt=ready?{type:'pairedLearning',odor:'A',consumedAmount:state.pairedConsumption,
    teachingEvents:state.pairedPulses,changedSynapses:state.changedSynapses,elapsed:state.elapsed}:null;
  if(receipt)state.receipt=copy(receipt);
  validateState(state);
  return {state,ready,receipt};
}
