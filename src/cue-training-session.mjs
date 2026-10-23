import {EmbodiedLife} from './embodied-life.mjs';
import {createCompanion,adoptCompanion} from '../public/companion-identity.mjs';
import {growthSummary} from '../public/companion-growth.mjs';
import {createCare} from '../public/pet-care.mjs';
import {FOOD_IDS,foodStock,syncFoodTotal,withFoodStock} from '../public/food-stock.mjs';
import {surfaceBelow,supportedFeet,collisionInfo} from '../public/collision-world.mjs';
import {resourceContact} from '../public/resource-contact.mjs';

export const CUE_TRAINING_DURATION=20;
export const CUE_TRAINING_DEFAULT_SEED=0x4d495252;
const EPSILON=1e-8,STEP=.02,SAMPLE_SECONDS=.25;
const TRAINING_SOURCE=Object.freeze({position:Object.freeze([-3.43,1.12,1.33]),strength:1,range:2});
const PROBE_POSITIONS=Object.freeze({left:Object.freeze([-4.25,1.10,1.33]),right:Object.freeze([-2.61,1.10,1.33])});
const distance=(a,b)=>Math.hypot(...a.map((value,i)=>value-b[i]));
const emptyEvidence=()=>({actualFeedingSeconds:0,consumedAmount:0,teachingEvents:0,changedSynapses:0});
function validSeed(seed){
  if(!Number.isSafeInteger(seed)||seed<0||seed>0xffffffff)throw Error('实验种子必须是有效的32位非负整数。');
  return seed;
}
function emptyProbe(){
  return {duration:CUE_TRAINING_DURATION,elapsed:0,swapped:false,mapping:{left:'A',right:'B'},
    sourcePositions:structuredClone(PROBE_POSITIONS),running:false,trace:[],inventoryBefore:null,flagsBefore:null,result:null};
}

/** A separate, unsaved lab individual. Only initialization/reset establishes a pose. */
export class CueTrainingSession {
  #sim;#seed;#id;#phase;#emission;#evidence;#changed;#probe;#error;

  constructor({seed=CUE_TRAINING_DEFAULT_SEED}={}){
    this.#seed=validSeed(seed);this.#initialize();
  }

  #initialize(){
    const sim=new EmbodiedLife(null,{seed:this.#seed,learningMode:'neutral'}),s=sim.state;
    const id=crypto.randomUUID(),identitySeed=this.#seed.toString(16).padStart(8,'0').repeat(4);
    s.companion=createCompanion({id,seed:identitySeed,now:1000});adoptCompanion(s.companion,'训练果蝇',2000);
    s.living.care=createCare();for(const foodId of FOOD_IDS)foodStock(s)[foodId]=100;syncFoodTotal(s);
    const scale=growthSummary(s.companion).bodyScale;
    const ground=withFoodStock(s,()=>surfaceBelow(-3.6,1.5,1.5,1,scale));
    if(!ground)throw Error('实验初始桌面缺少真实支撑。');
    Object.assign(s.actor,{bodyScale:scale,position:[-3.6,ground.position[1]+.09*scale+.0001,1.5],
      heading:0,velocity:[0,0,0],contact:true,zoneId:'feed',mode:'activity',action:'observe'});
    const feet=withFoodStock(s,()=>supportedFeet(s.actor.position,s.actor.heading,scale));
    if(feet!==6||withFoodStock(s,()=>resourceContact(s.actor,'food')))throw Error('实验释放点必须六足支撑且尚未接触食物。');
    s.actor.supportFeet=feet;s.needs.satiety=25;s.living.physiology.thirst=.1;s.living.contactSeconds=4;
    s.living.focus.action='eat';s.living.clock={mode:'preview',hour:12,anchor:s.simSeconds};
    sim.setSpeed(1);sim.setPaused(false);sim.neural.learning.setCues([]);
    // The preceding instance is cleaned only after the new one initializes.
    if(this.#sim)this.#finishProbe('reset');
    this.#sim=sim;this.#id=id;this.#phase='training';this.#emission='off';this.#error=null;
    this.#evidence={A:emptyEvidence(),B:emptyEvidence()};this.#changed={A:new Set(),B:new Set()};this.#probe=emptyProbe();
  }

  #canProbe(){
    return !this.#sim.state.paused&&['training','result'].includes(this.#phase)
      &&['A','B'].some(odor=>{const evidence=this.#evidence[odor];
        return evidence.consumedAmount>0&&evidence.teachingEvents>0&&evidence.changedSynapses>0;});
  }

  command(type,value){
    if(this.#phase==='disposed')throw Error('这次实验已结束，请新建实验。');
    if(typeof type!=='string')throw Error('训练室命令无效。');
    if(type==='emit'){
      if(!['A','B','off'].includes(value))throw Error('请选择气味 A、B 或关闭气味。');
      if(this.#phase==='probing')throw Error('探测期间气味位置固定，请先结束探测。');
      const cues=value==='off'?[]:[{id:'cue-training',odor:value,...structuredClone(TRAINING_SOURCE),enabled:true}];
      this.#sim.neural.learning.setCues(cues);this.#emission=value;
    }else if(type==='pause'){
      if(typeof value!=='boolean')throw Error('暂停参数必须是布尔值。');
      this.#sim.setPaused(value);
    }else if(type==='probe'||type==='swap'){
      if(value!==undefined)throw Error('探测命令不接受额外参数。');
      if(this.#phase==='probing')throw Error('探测已经开始，不能重复开始或中途交换。');
      if(!this.#canProbe())throw Error('先让果蝇在气味出现时实际进食，并形成可确认的突触变化。');
      this.#startProbe(type==='swap'?!this.#probe.swapped:false);
    }else if(type==='endProbe'){
      if(value!==undefined)throw Error('结束探测不接受额外参数。');
      this.#finishProbe('ended');
    }else if(type==='reset'){
      if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==1||value.newExperiment!==true){
        throw Error('重置会丢弃本实验记忆；必须明确创建一只新的实验果蝇。');
      }
      this.#initialize();
    }else throw Error('未知的训练室命令。');
    return this.snapshot();
  }

  #startProbe(swapped){
    const learning=this.#sim.neural.learning,s=this.#sim.state,mapping=swapped?{left:'B',right:'A'}:{left:'A',right:'B'};
    const probe={...emptyProbe(),swapped,mapping,running:true,inventoryBefore:structuredClone(foodStock(s)),
      flagsBefore:{frozen:learning.frozen,rewardEnabled:learning.rewardEnabled},
      weightsBefore:learning.serializeWeights().efficacy,integralA:0,integralB:0,integralPI:0};
    const previousCues=learning.cues.map(cue=>({...cue,position:[...cue.position]}));
    try{
      learning.setCues(Object.entries(mapping).map(([side,odor])=>({id:'cue-'+side,odor,
        position:[...PROBE_POSITIONS[side]],strength:1,range:1.2,enabled:true})));
      for(const id of FOOD_IDS)foodStock(s)[id]=0;syncFoodTotal(s);
      learning.frozen=true;learning.rewardEnabled=false;
    }catch(error){
      Object.assign(foodStock(s),probe.inventoryBefore);syncFoodTotal(s);
      learning.frozen=probe.flagsBefore.frozen;learning.rewardEnabled=probe.flagsBefore.rewardEnabled;
      learning.setCues(previousCues);throw error;
    }
    this.#probe=probe;this.#phase='probing';this.#emission='off';this.#recordMetric(0,true);
  }

  #metric(){
    const probe=this.#probe,position=[...this.#sim.state.actor.position];
    const a=probe.mapping.left==='A'?PROBE_POSITIONS.left:PROBE_POSITIONS.right;
    const b=probe.mapping.left==='B'?PROBE_POSITIONS.left:PROBE_POSITIONS.right;
    const distanceA=distance(position,a),distanceB=distance(position,b);
    return {t:probe.elapsed,position,distanceA,distanceB,
      preferenceIndex:(distanceB-distanceA)/Math.max(1e-9,distanceA+distanceB)};
  }

  #recordMetric(seconds,force=false){
    const probe=this.#probe,metric=this.#metric(),previous=probe.trace.at(-1);
    probe.integralA+=metric.distanceA*seconds;probe.integralB+=metric.distanceB*seconds;
    probe.integralPI+=metric.preferenceIndex*seconds;
    if(force||!previous||Math.floor((metric.t+EPSILON)/SAMPLE_SECONDS)>Math.floor((previous.t+EPSILON)/SAMPLE_SECONDS)){
      if(!previous||Math.abs(previous.t-metric.t)>EPSILON)probe.trace.push(metric);
    }
    return metric;
  }

  #finishProbe(reason){
    if(this.#phase!=='probing')return;
    const probe=this.#probe,learning=this.#sim.neural.learning,s=this.#sim.state;
    let result;
    try{
      const metric=this.#recordMetric(0,true),elapsed=probe.elapsed;
      const weights=learning.serializeWeights().efficacy;
      result={completed:reason==='complete',aborted:reason!=='complete',reason,elapsed,duration:probe.duration,
        mapping:{...probe.mapping},swapped:probe.swapped,
        preferenceIndex:elapsed>0?probe.integralPI/elapsed:metric.preferenceIndex,
        meanDistanceA:elapsed>0?probe.integralA/elapsed:metric.distanceA,
        meanDistanceB:elapsed>0?probe.integralB/elapsed:metric.distanceB,
        finalDistanceA:metric.distanceA,finalDistanceB:metric.distanceB,trace:structuredClone(probe.trace),
        weightsUnchanged:weights.every((q,i)=>q===probe.weightsBefore[i]),inventoryRestored:false};
    }finally{
      Object.assign(foodStock(s),probe.inventoryBefore);syncFoodTotal(s);
      learning.frozen=probe.flagsBefore.frozen;learning.rewardEnabled=probe.flagsBefore.rewardEnabled;
      learning.setCues([]);this.#emission='off';probe.running=false;this.#phase='result';
    }
    result.inventoryRestored=FOOD_IDS.every(id=>foodStock(s)[id]===probe.inventoryBefore[id]);probe.result=result;
  }

  tick(seconds){
    if(typeof seconds!=='number'||!Number.isFinite(seconds)||seconds<0||seconds>.25)throw Error('训练室时间增量必须在0到0.25秒之间。');
    if(seconds===0||this.#phase==='disposed'||this.#sim.state.paused)return;
    let remaining=seconds;
    try{
      while(remaining>EPSILON){
        const learning=this.#sim.neural.learning,s=this.#sim.state,odor=this.#emission;
        const before={time:s.simSeconds,ate:s.stats.ateSeconds,consumed:learning.consumedAmount,rewards:learning.rewardPulses};
        const qBefore=odor!=='off'&&this.#phase!=='probing'?learning.serializeWeights().efficacy:null;
        const amount=Math.min(STEP,remaining);this.#sim.tick(amount);remaining-=amount;
        if(this.#sim.neural.error)throw Error(this.#sim.neural.error);
        const elapsed=s.simSeconds-before.time;
        if(elapsed<=EPSILON)continue;
        if(this.#phase==='probing'){
          const sampleSeconds=Math.min(elapsed,CUE_TRAINING_DURATION-this.#probe.elapsed);
          this.#probe.elapsed=Math.min(CUE_TRAINING_DURATION,this.#probe.elapsed+sampleSeconds);
          this.#recordMetric(sampleSeconds);
          if(this.#probe.elapsed>=CUE_TRAINING_DURATION-EPSILON){this.#probe.elapsed=CUE_TRAINING_DURATION;this.#finishProbe('complete');break;}
        }else if(odor!=='off'){
          const evidence=this.#evidence[odor],qAfter=learning.serializeWeights().efficacy;
          evidence.actualFeedingSeconds+=Math.max(0,s.stats.ateSeconds-before.ate);
          evidence.consumedAmount+=Math.max(0,learning.consumedAmount-before.consumed);
          evidence.teachingEvents+=Math.max(0,learning.rewardPulses-before.rewards);
          for(let i=0;i<qAfter.length;i++)if(qAfter[i]<qBefore[i]-1e-12)this.#changed[odor].add(i);
          evidence.changedSynapses=this.#changed[odor].size;
        }
      }
    }catch(error){
      try{this.#finishProbe('error');}finally{
        this.#sim.neural.learning.setCues([]);this.#sim.setPaused(true);
        this.#phase='disposed';this.#emission='off';this.#error=error.message;
      }
      throw error;
    }
  }

  exportMemory(){
    return {synapticMemoryMode:'neutral',synapticMemory:this.#sim.neural.learning.serializeWeights()};
  }

  snapshot(){
    const state=this.#sim.snapshot(),learning=this.#sim.neural.learning.snapshot(),probe=this.#probe;
    const paused=this.#sim.state.paused;
    return {...state,neural:this.#sim.neural.snapshot(),collision:collisionInfo,
      experiment:{id:this.#id,seed:this.#seed,phase:this.#phase,emission:this.#emission,paused,
        canEmit:['training','result'].includes(this.#phase),canProbe:this.#canProbe(),
        actualFeedingSeconds:this.#sim.state.stats.ateSeconds,
        teachingEvents:this.#evidence.A.teachingEvents+this.#evidence.B.teachingEvents,
        cueTraining:structuredClone(this.#evidence),learning,error:this.#error,
        probe:{duration:probe.duration,elapsed:probe.elapsed,remaining:Math.max(0,probe.duration-probe.elapsed),
          swapped:probe.swapped,mapping:{...probe.mapping},sourcePositions:structuredClone(probe.sourcePositions),
          running:probe.running,trace:structuredClone(probe.trace),inventoryBefore:structuredClone(probe.inventoryBefore),
          flagsBefore:structuredClone(probe.flagsBefore),result:structuredClone(probe.result)}}};
  }

  dispose(){
    if(this.#phase!=='disposed'){
      try{this.#finishProbe('disposed');}finally{
        this.#sim.neural.learning.setCues([]);this.#sim.setPaused(true);this.#phase='disposed';this.#emission='off';
      }
    }
    return this.snapshot();
  }
}
