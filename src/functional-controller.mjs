import { waterContact } from '../public/environment-spec.mjs';
import {resourceWithinReach,resourceContact} from '../public/resource-contact.mjs';
import {focusedActivity,activityPermitted} from '../public/behavior-focus.mjs';
import { readFileSync } from './platform-io.mjs';
import { Brain } from './neural-core.mjs';
import { NeuralObserver } from './neural-observer.mjs';
import { RECEPTORS, senseEnvironment, NeuralController as LegacyController } from './neural-controller.mjs';
import { clamp } from '../public/environment-spec.mjs';
import { NeuralMetrics } from './neural-metrics.mjs';
import {OdorLearning} from './odor-learning.mjs';
import {NeutralOdorLearning} from './neutral-odor-learning.mjs';
import {validateSynapticMemory,validateSynapticMemoryMode} from '../public/synaptic-memory-schema.mjs';

const calibration = JSON.parse(readFileSync(new URL('./functional-calibration.json', import.meta.url), 'utf8'));
export const FUNCTIONAL_FINGERPRINT = calibration.graphHash;
export const NEURAL_FRAME_SECONDS = 1;
const zero = () => ({local:[0,0,0], drive:0, populations:[0,0,0,0]});

export function smoothMotorVector(previous,next,heading,dt,live=true){
  if(!live)return [0,0,0];
  const angle=(previous.referenceHeading??heading)-heading;
  const c=Math.cos(angle),s=Math.sin(angle),old=previous.local;
  // Align old and new neural vectors before averaging across body turns.
  const aligned=[old[0]*c+old[2]*s,old[1],-old[0]*s+old[2]*c];
  return next.map((value,i)=>{
    const responseSeconds=i===1?.30:dt>=.5?.9:.18;
    return clamp(aligned[i]+(value-aligned[i])*(1-Math.exp(-dt/responseSeconds)),-1,1);
  });
}

export function validateFunctionalGraph(g) {
  if (!g || g.selection !== 'functional-paths-v1' || g.neurons !== 4386 || g.dt_ms !== .1
    || !Array.isArray(g.pre) || g.pre.length !== 302896 || g.post?.length !== g.pre.length || g.weights?.length !== g.pre.length
    || g.labels?.length !== g.neurons || g.channels?.length !== 9 || g.motorIndices?.length !== 80
    || [...g.pre,...g.post,...g.motorIndices].some(n=>!Number.isInteger(n)||n<0||n>=g.neurons)
    || g.weights.some(n=>!Number.isFinite(n))) throw new Error('功能回路数据无效');
  const inputs = new Set(g.channels.flat());
  if (g.motorIndices.some(n=>inputs.has(n))) throw new Error('运动读出不得包含被注入的细胞');
  return g;
}

export function migrateNeural(saved) {
  if (!saved || saved.fingerprint === FUNCTIONAL_FINGERPRINT) return saved;
  // Only the known, valid legacy model may migrate. Corruption is never a reset trigger.
  new LegacyController({saved});
  return null;
}

export class FunctionalController extends NeuralObserver {
  constructor({saved=null, seed=0x4d495252, learningMode, ...options}={}) {
    const savedMode=saved&&(Object.hasOwn(saved,'synapticMemory')||Object.hasOwn(saved,'synapticMemoryMode'))
      ?validateSynapticMemoryMode(saved.synapticMemoryMode??'legacy-food'):null;
    const mode=validateSynapticMemoryMode(learningMode??savedMode??'neutral');
    if(savedMode&&savedMode!==mode)throw Error('突触记忆模式不一致，不能重新解释旧权重。');
    super({modelPath:new URL('./functional-connectome.json',import.meta.url),
      hashPath:new URL('./functional-connectome.sha256',import.meta.url), validator:validateFunctionalGraph, seed, ...options});
    this.motor=zero(); this.rng=seed>>>0||1; this.sensory={inputs:Array(9).fill(0),signals:[]}; this.computeMs=0;
    // Pending geometry work belongs to this living runtime, not another body
    // sharing the module. It is rebuilt from current geometry after restore.
    this.landingSearchCache=new Map();
    this.behavior={feeding:0,grooming:0};
    if(this.error)return;
    if(this.fingerprint!==calibration.graphHash)throw new Error('功能运动校准与图不一致');
    this.brain=new Brain(this.graph,()=>{let x=this.rng;x^=x<<13;x^=x>>>17;x^=x<<5;this.rng=x>>>0;return this.rng/4294967296;},{inputChannels:this.graph.channels});
    this.readout=new Int16Array(this.brain.n).fill(-1);
    this.graph.motorIndices.forEach((n,i)=>this.readout[n]=i);
    this.rates=new Float64Array(this.graph.motorIndices.length);
    this.metrics=new NeuralMetrics(this.graph);
    this.learningMode=mode;
    this.learning=mode==='legacy-food'?new OdorLearning({seed:(seed^0x4f444f52)>>>0})
      :new NeutralOdorLearning({seed:(seed^0x4f444f52)>>>0});
    Object.defineProperty(this,'neutralLearning',{value:mode==='neutral'?this.learning:null});
    if(saved)this.restore(saved);
  }

  tick(state,dt=NEURAL_FRAME_SECONDS) {
    let remaining=400;
    while(remaining>0){const amount=Math.min(remaining,400-(this.pending?.steps??0));this.advanceSlice(state,amount,dt);remaining-=amount;if(this.error)break;}
  }

  advanceSlice(state,steps=80,dt=NEURAL_FRAME_SECONDS) {
    if(!Number.isSafeInteger(steps)||steps<1||steps>400)throw Error('Invalid neural slice');
    this.paused=state.paused;
    if(!this.brain||this.error||this.paused)return;
    const start=performance.now();
    try {
      if(!this.pending){
      const sense=senseEnvironment(state,this.pulses,undefined,{feedbackSeconds:dt,
        foodLearning:this.learningMode==='legacy-food'&&state.synapticForaging!==false?this.learning.refreshReadouts():null,
        neutralOdors:this.neutralLearning?.sense(state)??[],
        landingCandidateBudget:state.companion?.identity.adoptedAt&&state.actor.bodyScale<.15?2:Infinity,
        landingSearchCache:this.landingSearchCache}), signal=id=>sense.signals.find(s=>s.id===id)?.intensity??0;
      const nearFood=activityPermitted(state,'eat')&&Boolean(resourceWithinReach(state.actor,'food'))&&state.home.food>0;
      const continuingTaste=focusedActivity(state)==='eat'&&state.needs.satiety<99.5
        &&state.home.food>0&&Boolean(resourceContact(state.actor,'food'));
      const drinking=activityPermitted(state,'drink')&&waterContact(state.actor)&&state.home.water>0;
      // First four channels encode heading/goal populations by a declared engineering
      // projection. The remaining channels stimulate actual taste/JON/looming types.
      const inputs=[...sense.inputs, nearFood?clamp(Math.max((1-state.needs.satiety/100)*.65,continuingTaste?.42:0),0,.8):0,
        drinking?(.15+(state.living.physiology?.thirst??0)*.55):0,clamp((activityPermitted(state,'clean')?(state.living.physiology?.dirt??0)*.35+state.living.wetness*.5:0)+this.pulses.chime*.3+(state.living.care?.stimulus??0),0,.8),
        clamp(signal('looming')*.65,0,.8),clamp(signal('looming')*.65,0,.8)];
      this.sensory={...sense,inputs,channelNames:this.graph.channelNames};
      this.pending={steps:0,spikes:[],transmitted:[],inputs:[...inputs],heading:state.actor.heading,dt,computeMs:0};
      }
      const pending=this.pending,amount=Math.min(steps,400-pending.steps);
      const slice=this.brain.advance(pending.inputs,amount,{deferSummary:pending.steps+amount<400});
      pending.steps+=amount;
      for(const n of slice.spikes)pending.spikes.push(n);
      for(const n of slice.transmitted)pending.transmitted.push(n);
      pending.computeMs+=performance.now()-start;
      if(pending.steps<400)return;
      const result={...slice,spikes:pending.spikes,transmitted:pending.transmitted},inputs=pending.inputs;
      dt=pending.dt;this.pending=null;this.computeMs=pending.computeMs;
      const counts=new Float64Array(this.rates.length);
      this.metrics.sample(result.spikes,400,result.steps/400);
      for(const n of result.spikes)if(this.readout[n]>=0)counts[this.readout[n]]++;
      const smoothing=1-Math.exp(-dt/.30);
      for(let i=0;i<counts.length;i++)this.rates[i]=counts[i]/400;
      const live=this.rates.some(v=>v>1e-5);
      const decoded=calibration.inverse.map(row=>live?clamp(.34+row.reduce((sum,w,i)=>sum+w*(this.rates[i]-calibration.baseline[i]),0),0,1.2):0);
      this.motor.populations=decoded;
      const next=[0,1,2].map(axis=>clamp(RECEPTORS.reduce((sum,dir,i)=>sum+dir[axis]*decoded[i],0)*.75/.28,-1,1));
      // Smooth vectors in a common frame. Blending left/right neural rates from
      // different body headings turns yesterday's left into today's left again.
      this.motor.local=smoothMotorVector(this.motor,next,pending.heading,dt,live);
      // Local receptors were sampled in this body frame. Holding the command
      // must not rotate its world force every time the body turns in between.
      this.motor.referenceHeading=pending.heading;
      this.motor.drive=clamp(decoded.reduce((a,b)=>a+b,0)/4/.34,0,1.4);
      for(const [key,indices] of Object.entries(this.graph.behaviorIndices)) {
        const count=result.spikes.filter(n=>indices.includes(n)).length;
        this.behavior[key]+=(clamp(count/3,0,1)-this.behavior[key])*smoothing;
      }
      this.totalSpikes+=result.spikes.length;
      this.frame={sequence:result.steps/400,steps:result.steps,neuralMs:result.steps*.1,at:Date.now(),inputs,intervalSeconds:dt,
        spikes:[...new Set(result.spikes)],transmitted:[...new Set(result.transmitted)],spikeCount:result.spikes.length,totalSpikes:this.totalSpikes};
      for(const type of Object.keys(this.pulses))this.pulses[type]*=Math.exp(-dt/4);
    }catch(error){this.error=error.message;this.motor=zero();this.frame=null;this.pending=null;}
    finally{this.sliceMs=performance.now()-start;}
  }

  snapshot(){return {...super.snapshot(),bodyControl:'functional-neural-motor',interface:'identified-circuits-engineering-projection',
    timeScale:.04/(this.frame?.intervalSeconds??NEURAL_FRAME_SECONDS),decisionHz:1,feedbackHz:1/(this.frame?.intervalSeconds??NEURAL_FRAME_SECONDS),motor:structuredClone(this.motor),behavior:structuredClone(this.behavior),sensory:structuredClone(this.sensory),
    learning:this.learning?.snapshot()??null,metrics:this.metrics?.snapshot(this.sensory.inputs)??null,computeMs:this.computeMs,sliceMs:this.sliceMs??0};}

  cells(options){
    if(!this.brain||this.error)throw Object.assign(new Error('神经数据暂不可用'),{statusCode:503});
    return {...this.metrics.cells(this.brain,options),paused:this.paused,status:this.paused?'paused':this.frame?'live':'starting'};
  }

  serialize(){
    if(!this.brain||this.error)return null;
    const b=this.brain;
    return {fingerprint:this.fingerprint,rng:this.rng,step:b.step,v:[...b.v],g:[...b.g],ref:[...b.ref],queue:b.queue.map(q=>[...q]),
      count:[...b.count],frames:b.frames,pulses:{...this.pulses},motor:structuredClone(this.motor),rates:[...this.rates],behavior:{...this.behavior},totalSpikes:this.totalSpikes,sensory:structuredClone(this.sensory),
      synapticMemory:this.learning.serializeWeights(),synapticMemoryMode:this.learningMode,
      ...(this.pending?{pending:{...structuredClone(this.pending),computeMs:0}}:{})};
  }

  restore(s){
    if(s&&Object.hasOwn(s,'synapticMemory'))validateSynapticMemory(s.synapticMemory);
    if(s&&(Object.hasOwn(s,'synapticMemory')||Object.hasOwn(s,'synapticMemoryMode'))
      &&validateSynapticMemoryMode(s.synapticMemoryMode??'legacy-food')!==this.learningMode){
      throw Error('突触记忆模式不一致，原神经状态没有被修改。');
    }
    const finite=v=>typeof v==='number'&&Number.isFinite(v),integer=v=>Number.isSafeInteger(v)&&v>=0;
    const vector=(a,n,check=finite)=>Array.isArray(a)&&a.length===n&&a.every(check);
    const n=this.brain.n;
    if(!s||s.fingerprint!==this.fingerprint||!integer(s.rng)||s.rng<1||s.rng>0xffffffff||!integer(s.step)||!integer(s.frames)||!integer(s.totalSpikes)
      ||!vector(s.v,n)||!vector(s.g,n)||!vector(s.ref,n,integer)||!vector(s.count,16,v=>finite(v)&&v>=0)
      ||!vector(s.rates,this.rates.length,v=>finite(v)&&v>=0)||!vector(s.queue,19,q=>Array.isArray(q)&&q.length<=n&&q.every(i=>integer(i)&&i<n))
      ||!s.motor||!vector(s.motor.local,3,v=>finite(v)&&Math.abs(v)<=1)||!vector(s.motor.populations,4,v=>finite(v)&&v>=0&&v<=1.2)
      ||!finite(s.motor.drive)||s.motor.drive<0||s.motor.drive>1.4
      ||s.motor.referenceHeading!==undefined&&!finite(s.motor.referenceHeading)
      ||!s.pulses||!['feed','mist','chime'].every(k=>finite(s.pulses[k])&&s.pulses[k]>=0&&s.pulses[k]<=.9)
      ||!s.behavior||!['feeding','grooming'].every(k=>finite(s.behavior[k])&&s.behavior[k]>=0&&s.behavior[k]<=1))throw new Error('功能神经存档无效，原始文件保留');
    this.rng=s.rng;this.totalSpikes=s.totalSpikes;this.rates.set(s.rates);this.behavior={...s.behavior};
    for(const k of ['v','g','ref','count'])this.brain[k].set(s[k]);
    this.brain.queue=s.queue.map(q=>[...q]);this.brain.step=s.step;this.brain.frames=s.frames;
    if(s.sensory!==undefined){
      let nodes=0;const safe=(v,depth=0)=>{if(++nodes>12000||depth>12)return false;if(typeof v==='number')return Number.isFinite(v);if(v===null||['undefined','string','boolean'].includes(typeof v))return true;if(Array.isArray(v))return v.every(x=>safe(x,depth+1));if(v&&typeof v==='object')return Object.values(v).every(x=>safe(x,depth+1));return false;};
      if(!s.sensory||!vector(s.sensory.inputs,9)||!Array.isArray(s.sensory.signals)||s.sensory.signals.length>256||!safe(s.sensory))throw Error('Sensory checkpoint invalid');
      this.sensory=structuredClone(s.sensory);
    }
    this.pulses={...s.pulses};this.motor=structuredClone(s.motor);
    if(s.pending!==undefined){
      const p=s.pending,ids=a=>Array.isArray(a)&&a.length<=n*20&&a.every(i=>integer(i)&&i<n);
      if(!p||!integer(p.steps)||p.steps<1||p.steps>=400||!vector(p.inputs,9,v=>finite(v)&&v>=0&&v<=1)
        ||!ids(p.spikes)||!ids(p.transmitted)||!finite(p.dt)||p.dt<=0||p.dt>1||!finite(p.computeMs)||p.computeMs<0
        ||!finite(p.heading)||s.step<p.steps)throw Error('Invalid pending neural frame');
      this.pending={...structuredClone(p),computeMs:0};
    }
    if(Object.hasOwn(s,'synapticMemory'))this.learning.restoreWeights(s.synapticMemory);
  }
}
